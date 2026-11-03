import type { Owner, Word } from './core/index.js';
import { RetiredScopeError, outboxItems, type LocalSnapshot, type OutboxItem, type RemoteFact, type SyncAck } from './storage/learning-db.js';
import type { ReadyEnvironment } from './environment-config.js';

/** S2 (#294): one owner's outbox → S1 intake, then the server journal → local journal.
 * The service never sends counters or projections; the server and every device replay
 * the same event union. One instance serves exactly one captured account scope.
 */
export type SyncErrorKind = 'offline' | 'auth' | 'owner' | 'server';
export class SyncError extends Error {
  constructor(readonly kind: SyncErrorKind) { super(`Sync ${kind}`); this.name = 'SyncError'; }
}
export interface SyncTransport {
  push(owner: Owner, items: readonly OutboxItem[]): Promise<{ readonly journalRevision: number; readonly results: readonly SyncAck[] }>;
  /** Server journal records with sequence > after, ascending, at most `limit`. */
  pull(owner: Owner, after: number, limit: number): Promise<readonly RemoteFact[]>;
  /** Current published models of words this device has never had in a session. */
  words(owner: Owner, ids: readonly string[]): Promise<readonly Word[]>;
}
/** A captured LearningScope (or a test store with the same pure partition semantics). */
export interface SyncStore {
  readonly owner: Owner;
  snapshot(): Promise<LocalSnapshot>;
  acknowledge(acks: readonly SyncAck[]): Promise<LocalSnapshot>;
  mergeRemote(remote: readonly RemoteFact[], words: readonly Word[], asOf: string): Promise<LocalSnapshot>;
}
/** `starting`: the outbox has not been read yet, so nothing is known to be sent. */
export type SyncPhase = 'starting' | 'idle' | 'syncing' | 'retrying' | 'offline' | 'stopped';
export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Saved on this device, not yet confirmed by the server. */
  readonly pending: number;
  /** Refused by the server for good; kept locally, never resent or counted. */
  readonly rejected: number;
  /** Refusals by server reason (`invalid-task`, `stale-epoch`, …), for diagnostics. */
  readonly rejectedReasons?: Readonly<Record<string, number>> | undefined;
  /** Local answers replaced by a conflicting server record; kept locally for display. */
  readonly conflicts: number;
  readonly cursor: number;
  readonly lastSyncedAt?: string;
  readonly retryAt?: string;
}
export interface SyncOptions {
  readonly now: () => string;
  readonly online: () => boolean;
  readonly random: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
  readonly onStatus?: (status: SyncStatus) => void;
  readonly batchSize?: number;
  readonly pullLimit?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Cross-tab mutual exclusion, e.g. `navigator.locks.request`. Without it, passes are per instance. */
  readonly lock?: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  /** Delay of the next pass after a successful one while the page stays open; off when absent. */
  readonly idleSyncMs?: number;
}
export const SYNC_BATCH_SIZE = 100;

/** What the UI says about the latest answers: kept on this device, or confirmed by the server. */
export type SyncLabel = 'sent' | 'saved-locally' | 'sending' | 'offline' | 'retrying';
export function syncLabel(status: SyncStatus): SyncLabel {
  if (status.phase === 'starting') return 'sending';
  if (status.pending === 0) return 'sent';
  if (status.phase === 'syncing') return 'sending';
  if (status.phase === 'offline' || status.phase === 'retrying') return status.phase;
  return 'saved-locally';
}

export class SyncService {
  private stopped = false;
  private running?: Promise<void>;
  private again = false;
  private timer?: unknown;
  private failures = 0;
  private current: SyncStatus = { phase: 'starting', pending: 0, rejected: 0, conflicts: 0, cursor: 0 };
  constructor(private readonly store: SyncStore, private readonly transport: SyncTransport, private readonly options: SyncOptions) {
    if (store.owner.kind !== 'account') throw new RangeError('Only an account outbox is sent to the server');
  }
  get status(): SyncStatus { return this.current; }
  /** Startup with an existing session, sign-in, online, a new local commit or a manual retry. */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    // During a pass, request one more and resolve after it (the pass's own loop or the restart below).
    if (this.running) { this.again = true; return this.running.then(() => this.running); }
    if (this.timer !== undefined) { this.options.clearTimer(this.timer); this.timer = undefined; }
    this.running = this.run().finally(() => {
      this.running = undefined;
      // A sync() after the pass's last `again` check but before it settled must not be lost.
      if (this.again && !this.stopped) void this.sync();
    });
    return this.running;
  }
  /** Account switch/logout: no further request for this owner. Its outbox stays on the device. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.options.clearTimer(this.timer);
    this.timer = undefined;
    this.emit({ ...this.current, phase: 'stopped', retryAt: undefined });
  }
  private emit(status: SyncStatus): void {
    const { retryAt, lastSyncedAt, rejectedReasons, ...rest } = status;
    this.current = { ...rest, ...(rejectedReasons ? { rejectedReasons } : {}), ...(lastSyncedAt ? { lastSyncedAt } : {}), ...(retryAt ? { retryAt } : {}) };
    this.options.onStatus?.(this.current);
  }
  private counts(data: LocalSnapshot | undefined): Pick<SyncStatus, 'pending' | 'rejected' | 'rejectedReasons' | 'conflicts' | 'cursor'> {
    if (!data) return { pending: this.current.pending, rejected: this.current.rejected, rejectedReasons: this.current.rejectedReasons,
      conflicts: this.current.conflicts, cursor: this.current.cursor };
    const rejected = data.sync?.rejected ?? [];
    const reasons: Record<string, number> = {};
    for (const item of rejected) reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
    return { pending: data.outbox.length, rejected: rejected.length, conflicts: data.sync?.conflicts?.length ?? 0, cursor: data.sync?.cursor ?? 0,
      rejectedReasons: rejected.length ? reasons : undefined };
  }
  private async run(): Promise<void> {
    do {
      this.again = false;
      if (this.stopped) return;
      // Tabs of one browser share the outbox: one pass at a time per owner, the next reads what it left.
      const owner = this.store.owner;
      const work = (): Promise<boolean> => this.pass();
      const proceed = this.options.lock ? await this.options.lock(`drillcards-v2-sync:${owner.kind}:${owner.id}`, work) : await work();
      if (!proceed) return;
    } while (this.again);
    if (this.options.idleSyncMs && !this.stopped && this.timer === undefined) {
      // While the page stays open: pick up other devices' answers and anything a missed trigger left.
      this.timer = this.options.setTimer(() => { this.timer = undefined; void this.sync(); }, this.options.idleSyncMs);
    }
  }
  /** One push + pull. Returns false when the run ends early (offline, retry scheduled, stopped). */
  private async pass(): Promise<boolean> {
    let data: LocalSnapshot | undefined;
    try {
      if (this.stopped) return false;
      // Each pass starts from the store: answers committed during the previous pass are included.
      data = await this.store.snapshot();
      if (!this.options.online()) {
        this.again = false; // the `online` event starts the next pass
        this.emit({ ...this.current, ...this.counts(data), phase: 'offline', retryAt: undefined }); return false;
      }
      this.emit({ ...this.current, ...this.counts(data), phase: 'syncing', retryAt: undefined });
      data = await this.push(data);
      // Acknowledgements are already stored: a failing pull below changes nothing local and is retried.
      await this.pull(data);
      this.failures = 0;
      // Report what is pending now, not what this pass saw; anything new gets one more pass.
      data = await this.store.snapshot();
      if (data.outbox.length) this.again = true;
      this.emit({ ...this.counts(data), phase: 'idle', lastSyncedAt: this.options.now() });
      return true;
    } catch (error) {
      this.again = false; // the scheduled retry (backoff) is the next pass
      if (this.stopped) return false;
      // Owner switch, or this scope's epoch was reset / guest data moved: never write or send for it again.
      if ((error instanceof SyncError && error.kind === 'owner') || error instanceof RetiredScopeError) { this.stop(); return false; }
      const latest = await this.store.snapshot().catch(() => data);
      this.schedule(latest, error instanceof SyncError && error.kind === 'offline');
      return false;
    }
  }
  /** Send in commit order. Every result acknowledges only its own event ID; anything else stays pending. */
  private async push(data: LocalSnapshot): Promise<LocalSnapshot> {
    const size = this.options.batchSize ?? SYNC_BATCH_SIZE;
    for (;;) {
      const items = outboxItems(data).slice(0, size);
      if (!items.length) return data;
      if (this.stopped) throw new SyncError('owner');
      const response = await this.transport.push(this.store.owner, items);
      const sent = new Set(items.map(item => item.event.eventId));
      const acks = response.results.filter(result => sent.has(result.eventId));
      data = await this.store.acknowledge(acks);
      // Partial success: an event without its own result is retried later with backoff, never dropped.
      // Answers committed during the request only grow the outbox; the loop sends them next.
      if (acks.length < items.length) throw new SyncError('server');
    }
  }
  /** Merge the server journal after the local cursor, including this owner's other devices. */
  private async pull(data: LocalSnapshot): Promise<LocalSnapshot> {
    const limit = this.options.pullLimit ?? 500;
    for (;;) {
      if (this.stopped) throw new SyncError('owner');
      const cursor = data.sync?.cursor ?? 0;
      const page = await this.transport.pull(this.store.owner, cursor, limit);
      if (!page.length) return data;
      if (page.some(record => record.sequence <= cursor)) throw new SyncError('server');
      const known = new Set([...data.sessions.flatMap(s => s.words.map(w => w.id)), ...(data.sync?.words ?? []).map(w => w.id)]);
      const missing = [...new Set(page.flatMap(r => r.event.target.kind === 'word' && !known.has(r.event.target.wordId) ? [r.event.target.wordId] : []))];
      const words = missing.length ? await this.transport.words(this.store.owner, missing) : [];
      if (this.stopped) throw new SyncError('owner');
      data = await this.store.mergeRemote(page, words, this.options.now());
      if (page.length < limit) return data;
    }
  }
  private schedule(data: LocalSnapshot | undefined, offline: boolean): void {
    this.failures++;
    const base = this.options.baseDelayMs ?? 2000; const max = this.options.maxDelayMs ?? 300_000;
    // Exponential backoff with jitter in [50%, 100%] so devices do not retry in lockstep.
    const delay = Math.round(Math.min(max, base * 2 ** (this.failures - 1)) * (0.5 + this.options.random() / 2));
    const retryAt = new Date(Date.parse(this.options.now()) + delay).toISOString();
    this.timer = this.options.setTimer(() => { this.timer = undefined; void this.sync(); }, delay);
    this.emit({ ...this.current, ...this.counts(data), phase: offline ? 'offline' : 'retrying', retryAt });
  }
}

/** HTTP transport. Each request carries the token of the captured owner, checked before sending:
 * after an account switch the old queue cannot be sent or read with the new identity.
 */
export function createSyncTransport(config: Pick<ReadyEnvironment, 'supabaseUrl' | 'publishableKey'>,
  session: () => Promise<{ readonly userId: string; readonly accessToken: string } | null>, fetcher: typeof fetch = fetch): SyncTransport {
  const base = new URL(config.supabaseUrl);
  async function headers(owner: Owner): Promise<Record<string, string>> {
    const current = await session().catch(() => null);
    if (!current) throw new SyncError('auth');
    if (owner.kind !== 'account' || current.userId !== owner.id) throw new SyncError('owner');
    return { apikey: config.publishableKey, Authorization: `Bearer ${current.accessToken}`, Accept: 'application/json' };
  }
  async function call(url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(url, init); } catch { throw new SyncError('offline'); }
    if (response.status === 401) throw new SyncError('auth');
    if (!response.ok) throw new SyncError('server');
    try { return await response.json(); } catch { throw new SyncError('server'); }
  }
  const iso = (value: unknown): string => {
    const time = Date.parse(String(value));
    if (!Number.isFinite(time)) throw new SyncError('server');
    return new Date(time).toISOString();
  };
  return {
    async push(owner, items) {
      const body = await call(new URL('/functions/v1/v2-learning-events', base), { method: 'POST',
        headers: { ...await headers(owner), 'Content-Type': 'application/json' }, body: JSON.stringify({ events: items }) }) as
        { ok?: boolean; journalRevision?: unknown; results?: unknown };
      if (body?.ok !== true || !Array.isArray(body.results) || !Number.isSafeInteger(body.journalRevision)) throw new SyncError('server');
      return { journalRevision: body.journalRevision as number, results: (body.results as SyncAck[]).filter(r =>
        r && typeof r.eventId === 'string' && ['accepted', 'duplicate', 'rejected'].includes(r.status)) };
    },
    async pull(owner, after, limit) {
      const url = new URL('/rest/v1/learning_events', base);
      url.search = new URLSearchParams({ select: 'user_id,sequence,event,evaluation,received_at',
        sequence: `gt.${after}`, order: 'sequence.asc', limit: String(limit) }).toString();
      const rows = await call(url, { headers: await headers(owner) });
      if (!Array.isArray(rows)) throw new SyncError('server');
      return rows.map((row: { user_id: string; sequence: unknown; event: RemoteFact['event']; evaluation: RemoteFact['evaluation'] | null; received_at: unknown }) => {
        // RLS already filters by the token; this keeps a mismatched response out of the wrong owner's journal.
        if (row.user_id !== owner.id) throw new SyncError('owner');
        return { sequence: Number(row.sequence), event: row.event, receivedAt: iso(row.received_at),
          ...(row.evaluation ? { evaluation: row.evaluation } : {}) };
      });
    },
    async words(owner, ids) {
      const url = new URL('/rest/v1/catalog_words', base);
      url.search = new URLSearchParams({ select: 'word', id: `in.(${ids.map(id => JSON.stringify(id)).join(',')})` }).toString();
      const rows = await call(url, { headers: await headers(owner) });
      if (!Array.isArray(rows)) throw new SyncError('server');
      return rows.map((row: { word: Word }) => row.word);
    },
  };
}
