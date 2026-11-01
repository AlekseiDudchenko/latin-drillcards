import { bindItemEvent, buildCorrectionTasks, createItemExerciseRegistry, createWordExerciseRegistry, evaluateItemAnswer, evaluateWordAnswer,
  isItemSessionPlan, isLearningEvent, replayWord, sessionTasks, type Evaluation, type ItemDataset, type LearningEvent, type LearningStore, type Task, type VocabularySessionPlan, type Owner, type SessionState, type Word,
  type RecordedWordFact, type WordReplayResult } from '../core/index.js';

export const LEARNING_DB_VERSION = 1;
export const LOCAL_DATA_VERSION = 1;
export const LEARNING_DB_NAME = 'drillcards-learning-v2';
export interface Epoch { readonly dataEpoch: string; readonly epochStartedAt: string }
export interface SessionArchive {
  readonly state: SessionState;
  readonly catalogVersion: string;
  readonly words: readonly Word[];
  /** G3 (#332): the pinned datasets of an item session (absent for vocabulary sessions, additive to version 1). */
  readonly datasets?: readonly ItemDataset[];
}
export interface StoredFact extends RecordedWordFact {}
export interface LocalSnapshot {
  readonly schemaVersion: 1;
  readonly owner: Owner;
  readonly epoch: Epoch;
  readonly projectionAsOf: string;
  readonly sessions: readonly SessionArchive[];
  readonly facts: readonly StoredFact[];
  readonly projections: readonly WordReplayResult[];
  /** Durable IDs only; resolve payload + immutable task archive in this same scope. */
  readonly outbox: readonly string[];
  /** S2 server sync; absent until the first acknowledgement/merge (additive to data version 1). */
  readonly sync?: SyncState;
}
export interface SyncState {
  /** Highest server journal sequence merged locally; all lower ones are present. */
  readonly cursor: number;
  /** Refused by the server for good: kept as history, excluded from local replay as on the server. */
  readonly rejected: readonly { readonly eventId: string; readonly reason: string }[];
  /** Published revisions of server-only journal entries (answered on another device). */
  readonly words: readonly Word[];
  /** Local events replaced by a conflicting server record (the server's journal wins); kept for display/audit. */
  readonly conflicts?: readonly SyncConflict[];
}
export interface SyncConflict {
  readonly eventId: string;
  readonly reason: 'event-conflict' | 'command-conflict';
  readonly event: LearningEvent;
}
interface Partition extends LocalSnapshot { readonly transferredTo?: string }
interface OwnerHead { readonly epoch: Epoch }
type CommitInput = Parameters<LearningStore['commit']>[0];
const copy = <T>(value: T): T => structuredClone(value);
const key = (owner: Owner, epoch?: string): string => JSON.stringify(epoch === undefined
  ? ['owner', owner.kind, owner.id] : ['data', owner.kind, owner.id, epoch]);
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function assertOwner(owner: Owner): void {
  if (!owner || !['account', 'guest'].includes(owner.kind) || typeof owner.id !== 'string' || !owner.id.trim()) throw new RangeError('Invalid owner');
}
function time(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new RangeError('Invalid timestamp');
  return result;
}
function assertEpoch(epoch: Epoch): void {
  if (!epoch.dataEpoch?.trim()) throw new RangeError('Missing data epoch');
  time(epoch.epochStartedAt);
}
/** The scope's epoch was reset, or its guest data moved to an account: it can never be written again.
 * Long-running work (a sync pass) must stop instead of retrying. Messages are unchanged for callers.
 */
export class RetiredScopeError extends RangeError {
  constructor(message: string) { super(message); this.name = 'RetiredScopeError'; }
}
export class StaleLearningContext extends Error {
  constructor() { super('Learning context is no longer active'); this.name = 'StaleLearningContext'; }
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

/** Platform adapter only. No auth lookup, network, localStorage, or implicit clock. */
export class LearningDatabase {
  private constructor(private readonly db: IDBDatabase) {}
  static open(factory: IDBFactory = indexedDB, name = LEARNING_DB_NAME): Promise<LearningDatabase> {
    return new Promise((resolve, reject) => {
      let blocked = false;
      const req = factory.open(name, LEARNING_DB_VERSION);
      req.onupgradeneeded = () => { req.result.createObjectStore('owners'); req.result.createObjectStore('partitions'); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => { blocked = true; reject(new Error('Learning database upgrade is blocked; close older tabs')); };
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(new LearningDatabase(db));
      };
    });
  }
  close(): void { this.db.close(); }
  private async transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = this.db.transaction(['owners', 'partitions'], mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Learning transaction aborted'));
      tx.onerror = () => {}; // onabort is the definitive result, never request success.
    });
    try { const result = await work(tx); await done; return result; }
    catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  }
  async scope(owner: Owner, epoch: Epoch): Promise<LearningScope> {
    assertOwner(owner); assertEpoch(epoch); owner = copy(owner); epoch = copy(epoch);
    await this.transaction('readwrite', async tx => {
      const heads = tx.objectStore('owners');
      const head = await request(heads.get(key(owner))) as OwnerHead | undefined;
      if (head && !equal(head.epoch, epoch)) throw new RangeError('Data epoch mismatch; explicit reset required');
      if (!head) {
        await request(heads.add({ epoch }, key(owner)));
        await request(tx.objectStore('partitions').add({ schemaVersion: LOCAL_DATA_VERSION, owner, epoch,
          projectionAsOf: epoch.epochStartedAt, sessions: [], facts: [], projections: [], outbox: [] } satisfies Partition, key(owner, epoch.dataEpoch)));
      }
    });
    return new LearningScope(this, owner, epoch);
  }
  /** A reset is explicit and CAS-bound to the former epoch. Old partitions remain inaccessible. */
  async reset(scope: LearningScope, next: Epoch): Promise<LearningScope> {
    assertEpoch(next); next = copy(next);
    if (next.dataEpoch === scope.epoch.dataEpoch) throw new RangeError('Reset requires a new data epoch');
    await this.transaction('readwrite', async tx => {
      await this.partition(tx, scope);
      const store = tx.objectStore('partitions');
      if (await request(store.get(key(scope.owner, next.dataEpoch)))) throw new RangeError('Cannot reuse a prior data epoch');
      await request(tx.objectStore('owners').put({ epoch: next }, key(scope.owner)));
      await request(store.add({ schemaVersion: LOCAL_DATA_VERSION, owner: scope.owner, epoch: next,
        projectionAsOf: next.epochStartedAt, sessions: [], facts: [], projections: [], outbox: [] } satisfies Partition, key(scope.owner, next.dataEpoch)));
    });
    return new LearningScope(this, scope.owner, next);
  }
  private async partition(tx: IDBTransaction, scope: LearningScope, allowTransferred = false): Promise<Partition> {
    const head = await request(tx.objectStore('owners').get(key(scope.owner))) as OwnerHead | undefined;
    if (!head || !equal(head.epoch, scope.epoch)) throw new RetiredScopeError('Stale data epoch');
    const data = await request(tx.objectStore('partitions').get(key(scope.owner, scope.epoch.dataEpoch))) as Partition;
    if (!data || data.schemaVersion !== LOCAL_DATA_VERSION) throw new RangeError('Unsupported local data version');
    if (data.transferredTo && !allowTransferred) throw new RetiredScopeError('Guest progress has already been transferred');
    return data;
  }
  async read(scope: LearningScope): Promise<LocalSnapshot> {
    return this.transaction('readonly', tx => this.partition(tx, scope));
  }
  /** Re-evaluate deferred facts when restoring later; projection time never moves backwards. */
  async restore(scope: LearningScope, asOf: string): Promise<LocalSnapshot> {
    time(asOf);
    return this.transaction('readwrite', async tx => {
      const data = await this.partition(tx, scope);
      const projectionAsOf = later(asOf, data.projectionAsOf);
      const restored: Partition = { ...data, projectionAsOf, projections: projectAll(data, projectionAsOf) };
      await request(tx.objectStore('partitions').put(restored, key(scope.owner, scope.epoch.dataEpoch)));
      return restored;
    });
  }
  async start(scope: LearningScope, archive: SessionArchive): Promise<'committed' | 'duplicate'> {
    archive = copy(archive);
    return this.transaction('readwrite', async tx => {
      const { result, next } = startInPartition(await this.partition(tx, scope), scope, archive);
      if (next) await request(tx.objectStore('partitions').put(next, key(scope.owner, scope.epoch.dataEpoch)));
      return result;
    });
  }
  /** Pause/resume/next changes only the cursor; never manufactures an answer or SRS evidence. */
  async saveSession(scope: LearningScope, state: SessionState, expectedRevision: number): Promise<'committed' | 'conflict'> {
    state = copy(state);
    return this.transaction('readwrite', async tx => {
      const data = await this.partition(tx, scope);
      const saved = data.sessions.find(s => s.state.plan.sessionId === state.plan.sessionId);
      if (!saved) throw new RangeError('Unknown session');
      if (saved.state.revision !== expectedRevision) return 'conflict';
      validateArchive({ ...saved, state }, scope);
      validateNext(saved.state, state);
      // Leaving a circuit's last planned task: the round is exactly the journal's mistakes, or absent without any.
      if (isItemSessionPlan(state.plan)) {
        if (state.corrections !== undefined) throw new RangeError('Only circuits have a correction round');
      } else if (!equal(state.corrections, saved.state.corrections)) {
        const expected = buildCorrectionTasks(state.plan as VocabularySessionPlan, createWordExerciseRegistry(saved.words, saved.catalogVersion), data.facts);
        if (!equal(state.corrections ?? [], expected) || (state.corrections && state.status !== 'presenting')) throw new RangeError('Corrections must match the session journal');
      } else if (saved.state.corrections === undefined && state.taskIndex === state.plan.tasks.length && state.taskIndex > saved.state.taskIndex &&
          buildCorrectionTasks(state.plan as VocabularySessionPlan, createWordExerciseRegistry(saved.words, saved.catalogVersion), data.facts).length) throw new RangeError('Corrections must match the session journal');
      if (['answered', 'feedback'].includes(state.status) && !data.facts.some(f => f.event.sessionId === state.plan.sessionId &&
          f.event.taskId === sessionTasks(state)[state.taskIndex]?.id && ['answer', 'introduction'].includes(f.event.kind))) throw new RangeError('Feedback requires an atomic event commit');
      if (state.taskIndex > saved.state.taskIndex && !data.facts.some(f => f.event.sessionId === saved.state.plan.sessionId &&
          f.event.taskId === sessionTasks(saved.state)[saved.state.taskIndex]?.id && ['answer', 'introduction'].includes(f.event.kind))) throw new RangeError('Advancing requires a persisted answer/introduction');
      await request(tx.objectStore('partitions').put({ ...data,
        sessions: data.sessions.map(s => s === saved ? { ...saved, state } : s) } satisfies Partition, key(scope.owner, scope.epoch.dataEpoch)));
      return 'committed';
    });
  }
  async commit(scope: LearningScope, input: CommitInput): Promise<'committed' | 'duplicate' | 'conflict'> {
    input = copy(input);
    return this.transaction('readwrite', async tx => {
      const { result, next } = commitInPartition(await this.partition(tx, scope), scope, input);
      if (next) await request(tx.objectStore('partitions').put(next, key(scope.owner, scope.epoch.dataEpoch)));
      return result;
    });
  }
  /** S2: acknowledge server results for specific outbox IDs; IDs no longer pending are ignored. */
  async acknowledge(scope: LearningScope, acks: readonly SyncAck[]): Promise<LocalSnapshot> {
    acks = copy(acks);
    return this.transaction('readwrite', async tx => {
      const next = acknowledgeInPartition(await this.partition(tx, scope), acks);
      await request(tx.objectStore('partitions').put(next, key(scope.owner, scope.epoch.dataEpoch)));
      return next;
    });
  }
  /** S2: union server journal records into this owner's journal and replay; the cursor never decreases. */
  async mergeRemote(scope: LearningScope, remote: readonly RemoteFact[], words: readonly Word[], asOf: string): Promise<LocalSnapshot> {
    remote = copy(remote); words = copy(words);
    return this.transaction('readwrite', async tx => {
      const next = mergeRemoteInPartition(await this.partition(tx, scope), remote, words, asOf);
      await request(tx.objectStore('partitions').put(next, key(scope.owner, scope.epoch.dataEpoch)));
      return next;
    });
  }
  /** Explicit all-or-nothing move of NEW guest data within the same global data epoch. */
  async transferGuest(source: LearningScope, destination: LearningScope, asOf: string): Promise<'committed' | 'duplicate'> {
    time(asOf);
    if (source.owner.kind !== 'guest' || destination.owner.kind !== 'account' || !equal(source.epoch, destination.epoch)) throw new RangeError('Transfer requires guest/account in the same data epoch');
    return this.transaction('readwrite', async tx => {
      const from = await this.partition(tx, source, true);
      const to = await this.partition(tx, destination);
      const targetKey = key(destination.owner, destination.epoch.dataEpoch);
      if (from.transferredTo) {
        if (from.transferredTo !== targetKey) throw new RangeError('Guest already transferred to another account');
        return 'duplicate';
      }
      const sessions = from.sessions.map(s => ({ ...s, state: { ...s.state, plan: { ...s.state.plan, owner: destination.owner } } }));
      if (sessions.some(s => to.sessions.some(t => t.state.plan.sessionId === s.state.plan.sessionId))) throw new RangeError('Transfer session collision');
      const facts = [...to.facts, ...from.facts.map(f => ({ ...f, owner: destination.owner }))];
      for (const f of from.facts) if (to.facts.some(t => t.event.eventId === f.event.eventId || t.event.commandId === f.event.commandId ||
        (f.event.kind === 'answer' && t.event.kind === 'answer' && t.event.attemptId === f.event.attemptId))) throw new RangeError('Transfer event identity collision');
      const allSessions = [...to.sessions, ...sessions];
      const projectionAsOf = later(asOf, later(from.projectionAsOf, to.projectionAsOf));
      const projections = projectAll({ ...to, sessions: allSessions, facts }, projectionAsOf);
      const store = tx.objectStore('partitions');
      await request(store.put({ ...to, sessions: allSessions, facts, projections, projectionAsOf, outbox: [...new Set([...to.outbox, ...from.outbox])] } satisfies Partition, targetKey));
      await request(store.put({ ...from, transferredTo: targetKey } satisfies Partition, key(source.owner, source.epoch.dataEpoch)));
      return 'committed';
    });
  }
}

type ScopeIdentity = Pick<LearningScope, 'owner' | 'epoch'>;
/** Pure transaction bodies: the IndexedDB adapter and in-memory test stores share them. */
export function startInPartition<P extends LocalSnapshot>(data: P, scope: ScopeIdentity, archive: SessionArchive): { result: 'committed' | 'duplicate'; next?: P } {
  validateArchive(archive, scope);
  if (archive.state.revision !== 0 || archive.state.taskIndex !== 0 || archive.state.status !== 'ready' ||
      archive.state.corrections !== undefined) throw new RangeError('Invalid initial session');
  const existing = data.sessions.find(s => s.state.plan.sessionId === archive.state.plan.sessionId);
  if (existing) {
    if (!equal(existing.state.plan, archive.state.plan) || !equal(existing.words, archive.words) || existing.catalogVersion !== archive.catalogVersion ||
        !equal(existing.datasets, archive.datasets)) throw new RangeError('Session identity collision');
    return { result: 'duplicate' };
  }
  return { result: 'committed', next: { ...data, sessions: [...data.sessions, archive] } };
}
export function commitInPartition<P extends LocalSnapshot>(data: P, scope: ScopeIdentity, input: CommitInput): { result: 'committed' | 'duplicate' | 'conflict'; next?: P } {
  const receivedAt = input.receivedAt; time(receivedAt);
  if (!equal(input.owner, scope.owner) || input.dataEpoch !== scope.epoch.dataEpoch || !isLearningEvent(input.event)) throw new RangeError('Invalid commit scope/event');
  const event = input.event;
  const existing = data.facts.find(f => f.event.eventId === event.eventId || f.event.commandId === event.commandId ||
    (event.kind === 'answer' && f.event.kind === 'answer' && f.event.attemptId === event.attemptId));
  if (existing) {
    if (!equal(existing.event, event)) throw new RangeError('Event/command/attempt identity collision');
    return { result: 'duplicate' };
  }
  const saved = data.sessions.find(s => s.state.plan.sessionId === event.sessionId);
  if (!saved) throw new RangeError('Unknown session');
  if (saved.state.revision !== input.expectedSessionRevision) return { result: 'conflict' };
  validateArchive({ ...saved, state: input.session }, scope);
  validateNext(saved.state, input.session);
  if (input.session.taskIndex !== saved.state.taskIndex || !['presenting', 'answered', 'feedback'].includes(input.session.status)) throw new RangeError('Event commit must retain the current task');
  const task = sessionTasks(saved.state)[saved.state.taskIndex];
  if (!task || task.id !== event.taskId || event.sessionId !== input.session.plan.sessionId || event.dataEpoch !== scope.epoch.dataEpoch ||
      event.studyTimezone !== saved.state.plan.studyTimezone || event.policyVersion !== saved.state.plan.policyVersion) throw new RangeError('Event/session binding mismatch');
  if (isItemSessionPlan(saved.state.plan)) {
    // Items: the same journal and outbox, the shared item evaluator, and no word projection.
    if (input.wordProgress) throw new RangeError('Item events have no word projection');
    const items = createItemExerciseRegistry(saved.datasets ?? []);
    bindItemEvent(items, task, event);
    if (event.intent !== saved.state.plan.intent) throw new RangeError('Event/task binding mismatch');
    const fact: StoredFact = { owner: scope.owner, event, receivedAt,
      ...(event.kind === 'answer' ? { evaluation: evaluateItemAnswer(items, task, event) } : {}) };
    return { result: 'committed', next: { ...data, facts: [...data.facts, fact], projectionAsOf: later(receivedAt, data.projectionAsOf),
      sessions: data.sessions.map(s => s === saved ? { ...saved, state: input.session } : s), outbox: [...data.outbox, event.eventId] } };
  }
  const registry = createWordExerciseRegistry(saved.words, saved.catalogVersion);
  const canonicalTask = registry.validateTask(task);
  if (!equal(event.target, task.target) || event.exerciseId !== task.exerciseId || event.taskVersion !== task.taskVersion ||
      event.contentVersion !== task.contentVersion || event.answerLanguage !== canonicalTask.specification.answerLanguage ||
      ('request' in saved.state.plan && event.intent !== (saved.state.plan as { request: { intent: string } }).request.intent)) throw new RangeError('Event/task binding mismatch');
  if ((event.kind === 'answer' && task.exerciseId === 'introduction') || (event.kind === 'introduction' && task.exerciseId !== 'introduction')) throw new RangeError('Invalid introduction event');
  const fact: StoredFact = { owner: scope.owner, event, receivedAt,
    ...(event.kind === 'answer' ? { evaluation: evaluateWordAnswer(registry, task, event) } : {}) };
  const facts = [...data.facts, fact];
  const wordId = (task.target as { wordId: string }).wordId;
  const wordFacts = counted({ ...data, facts }).filter(f => f.event.target.kind === 'word' && f.event.target.wordId === wordId);
  const word = replayRevision(data, wordId, wordFacts);
  const projectionAsOf = later(receivedAt, data.projectionAsOf);
  const projection = replayWord(word, wordFacts, { owner: scope.owner, ...scope.epoch, asOf: projectionAsOf });
  if (input.wordProgress && !equal(input.wordProgress, projection.progress)) throw new RangeError('Caller projection disagrees with journal replay');
  return { result: 'committed', next: { ...data, facts, projectionAsOf,
    projections: [...data.projections.filter(p => p.progress.wordId !== word.id), projection],
    sessions: data.sessions.map(s => s === saved ? { ...saved, state: input.session } : s),
    outbox: [...data.outbox, event.eventId] } };
}

export type SyncAck = { readonly eventId: string; readonly status: 'accepted' | 'duplicate' | 'rejected'; readonly reason?: string };
/** A server journal record, readable by its owner through RLS. Evaluation and receipt are the server's. */
export interface RemoteFact {
  readonly sequence: number;
  readonly event: LearningEvent;
  readonly evaluation?: Evaluation;
  readonly receivedAt: string;
}
export interface OutboxItem { readonly event: LearningEvent; readonly task: Task }
const syncState = (data: LocalSnapshot): SyncState => data.sync ?? { cursor: 0, rejected: [], words: [] };

/** Pending payloads in commit order, each with its immutable archived task. */
export function outboxItems(data: LocalSnapshot): OutboxItem[] {
  return data.outbox.map(id => {
    const event = data.facts.find(f => f.event.eventId === id)?.event;
    const session = event && data.sessions.find(s => s.state.plan.sessionId === event.sessionId);
    const task = session && sessionTasks(session.state).find(t => t.id === event.taskId);
    if (!event || !task) throw new RangeError('Outbox entry without its event/task archive');
    return { event, task };
  });
}
/** Accepted/duplicate leave the outbox; rejected leave it with their reason (a retry cannot succeed). */
export function acknowledgeInPartition<P extends LocalSnapshot>(data: P, acks: readonly SyncAck[]): P {
  const done = new Map(acks.filter(a => data.outbox.includes(a.eventId)).map(a => [a.eventId, a]));
  if (!done.size) return data;
  const sync = syncState(data);
  const refused = [...done.values()].filter(a => a.status === 'rejected');
  const rejected = [...sync.rejected, ...refused.map(a => ({ eventId: a.eventId, reason: a.reason ?? 'rejected' }))];
  const next = { ...data, outbox: data.outbox.filter(id => !done.has(id)), sync: { ...sync, rejected } };
  // A refused answer stops counting locally too, so this device's progress matches the server's.
  return refused.length ? { ...next, projections: projectAll(next, data.projectionAsOf) } : next;
}
/** Union by eventId with the server journal. Server records keep their authoritative receipt and
 * evaluation; a local event they confirm leaves the outbox. Unknown words come with `words`.
 * Older or repeated pages are harmless: the union is idempotent and the cursor only grows.
 */
export function mergeRemoteInPartition<P extends LocalSnapshot>(data: P, remote: readonly RemoteFact[], words: readonly Word[], asOf: string): P {
  time(asOf);
  if (data.owner.kind !== 'account') throw new RangeError('Only accounts have a server journal');
  const sync = syncState(data);
  let facts = [...data.facts]; let outbox = [...data.outbox]; let cursor = sync.cursor;
  const conflicts = [...sync.conflicts ?? []];
  // The server journal is what every device converges on: a local event that contradicts one of
  // its records is set aside (never resent, never replayed), not allowed to stop synchronization.
  const setAside = (local: StoredFact, reason: SyncConflict['reason']): void => {
    conflicts.push({ eventId: local.event.eventId, reason, event: local.event });
    facts = facts.filter(f => f !== local); outbox = outbox.filter(id => id !== local.event.eventId);
  };
  for (const record of remote) {
    const event = record.event;
    if (!Number.isSafeInteger(record.sequence) || record.sequence < 1 || !isLearningEvent(event) ||
        event.dataEpoch !== data.epoch.dataEpoch) throw new RangeError('Invalid server journal record');
    time(record.receivedAt);
    const fact: StoredFact = { owner: data.owner, event, receivedAt: record.receivedAt,
      ...(record.evaluation === undefined ? {} : { evaluation: record.evaluation }) };
    const same = facts.find(f => f.event.eventId === event.eventId);
    if (same && !equal(same.event, event)) setAside(same, 'event-conflict');
    for (const local of facts.filter(f => f.event.eventId !== event.eventId && (f.event.commandId === event.commandId ||
      (event.kind === 'answer' && f.event.kind === 'answer' && f.event.attemptId === event.attemptId)))) setAside(local, 'command-conflict');
    const index = facts.findIndex(f => f.event.eventId === event.eventId);
    if (index >= 0) facts[index] = fact; else facts.push(fact);
    outbox = outbox.filter(id => id !== event.eventId);
    cursor = Math.max(cursor, record.sequence);
  }
  // Every revision is kept: replay needs the one its facts were answered on, not only the newest.
  const known = new Map(sync.words.map(w => [`${w.id}\u0000${w.contentVersion}`, w]));
  for (const word of words) known.set(`${word.id}\u0000${word.contentVersion}`, word);
  const projectionAsOf = later(asOf, data.projectionAsOf);
  // An ID the server journal holds names an accepted event, even if this device's own version of it was refused.
  const confirmed = new Set(remote.map(r => r.event.eventId));
  const rejected = sync.rejected.filter(r => !confirmed.has(r.eventId));
  const next = { ...data, facts, outbox, projectionAsOf,
    sync: { ...sync, cursor, rejected, words: [...known.values()], ...(conflicts.length ? { conflicts } : {}) } };
  return { ...next, projections: projectAll(next, projectionAsOf) };
}
/** Facts that count for progress: server-refused events stay in the journal but never in replay. */
function counted(data: LocalSnapshot): StoredFact[] {
  const refused = new Set(syncState(data).rejected.map(r => r.eventId));
  return data.facts.filter(f => !refused.has(f.event.eventId));
}
/** Same rule as the S1 server: the published revision at the highest contentVersion among the word's
 * counted facts. If that exact revision is not on this device (a server-only fact answered on an older
 * revision than the current catalog), the newest known revision is the documented fallback.
 */
function replayRevision(data: LocalSnapshot, wordId: string, facts: readonly StoredFact[]): Word {
  const known = [...data.sessions.flatMap(s => s.words), ...syncState(data).words].filter(w => w.id === wordId);
  if (!known.length) throw new RangeError('Journal word without a known revision');
  const target = Math.max(...facts.map(f => f.event.contentVersion));
  return known.find(w => w.contentVersion === target) ?? known.reduce((a, b) => b.contentVersion > a.contentVersion ? b : a);
}

function later(a: string, b: string): string { return time(a) >= time(b) ? a : b; }
function projectAll(data: LocalSnapshot, asOf: string): WordReplayResult[] {
  const facts = counted(data);
  // Only word facts feed WordProgress; item facts have their own projectors (item-progress).
  const ids = new Set(facts.flatMap(f => f.event.target.kind === 'word' ? [f.event.target.wordId] : []));
  return [...ids].map(id => {
    const wordFacts = facts.filter(f => f.event.target.kind === 'word' && f.event.target.wordId === id);
    return replayWord(replayRevision(data, id, wordFacts), wordFacts, { owner: data.owner, ...data.epoch, asOf });
  });
}
function validateNext(before: SessionState, next: SessionState): void {
  if (!equal(before.plan, next.plan) || next.revision !== before.revision + 1 ||
      next.taskIndex < before.taskIndex || next.taskIndex > before.taskIndex + 1 ||
      ['completed', 'abandoned'].includes(before.status)) throw new RangeError('Invalid session revision/plan/cursor');
  // The correction round is appended once, by the step that leaves the last planned task.
  if (!equal(before.corrections, next.corrections) && (before.corrections !== undefined ||
      before.taskIndex !== before.plan.tasks.length - 1 || next.taskIndex !== before.plan.tasks.length)) throw new RangeError('Corrections are append-once after the plan');
}
function validateArchive(archive: SessionArchive, scope: ScopeIdentity): void {
  const { state, words, catalogVersion } = archive; const plan = state.plan; const tasks = sessionTasks(state);
  if (state.corrections !== undefined && (!Array.isArray(state.corrections) || !state.corrections.length ||
      !('request' in plan) || (plan as VocabularySessionPlan).request.format !== 'circuit')) throw new RangeError('Only circuits have a correction round');
  if (plan.schemaVersion !== 1 || !plan.sessionId.trim() || !plan.seed.trim() || !equal(plan.owner, scope.owner) || plan.dataEpoch !== scope.epoch.dataEpoch ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.taskIndex) || state.taskIndex < 0 ||
      state.taskIndex > tasks.length || !plan.tasks.length || !['ready', 'presenting', 'answered', 'feedback', 'paused', 'completed', 'abandoned'].includes(state.status) ||
      (state.taskIndex === tasks.length && !['completed', 'abandoned'].includes(state.status)) ||
      (state.status === 'completed' && state.taskIndex !== tasks.length)) throw new RangeError('Invalid session archive');
  time(plan.createdAt); new Intl.DateTimeFormat('en', { timeZone: plan.studyTimezone });
  let registry: { validateTask(task: Task): Task };
  if (isItemSessionPlan(plan)) {
    const datasets = archive.datasets ?? [];
    if (words.length || !equal(datasets.map(d => ({ datasetId: d.id, version: d.version })), plan.datasets)) throw new RangeError('Item session archive must carry exactly its pinned datasets');
    registry = createItemExerciseRegistry(datasets);
  } else {
    if (archive.datasets !== undefined) throw new RangeError('Vocabulary sessions carry no item datasets');
    registry = createWordExerciseRegistry(words, catalogVersion);
  }
  const ids = new Set<string>();
  for (const task of tasks) { if (ids.has(task.id)) throw new RangeError('Duplicate task ID'); ids.add(task.id); registry.validateTask(task); }
}

/** Captured handles never discover a different current owner after an await. */
export class LearningScope implements LearningStore {
  readonly owner: Owner;
  readonly epoch: Epoch;
  constructor(private readonly database: LearningDatabase, owner: Owner, epoch: Epoch) {
    this.owner = Object.freeze(copy(owner)); this.epoch = Object.freeze(copy(epoch));
    Object.freeze(this);
  }
  snapshot(): Promise<LocalSnapshot> { return this.database.read(this); }
  restore(asOf: string): Promise<LocalSnapshot> { return this.database.restore(this, asOf); }
  startSession(archive: SessionArchive): Promise<'committed' | 'duplicate'> { return this.database.start(this, archive); }
  saveSession(state: SessionState, expectedRevision: number): Promise<'committed' | 'conflict'> { return this.database.saveSession(this, state, expectedRevision); }
  commit(input: CommitInput): Promise<'committed' | 'duplicate' | 'conflict'> {
    return this.database.commit(this, input);
  }
  acknowledge(acks: readonly SyncAck[]): Promise<LocalSnapshot> { return this.database.acknowledge(this, acks); }
  mergeRemote(remote: readonly RemoteFact[], words: readonly Word[], asOf: string): Promise<LocalSnapshot> {
    return this.database.mergeRemote(this, remote, words, asOf);
  }
}

/** Auth/Runner integration point. Clear UI synchronously on switch; stale completions cannot repopulate it.
 * Each callback receives a captured scope. Network cancellation/ACK delivery belongs to S2.
 */
export class ActiveLearningContext {
  private generation = 0;
  private current?: LearningScope;
  constructor(private readonly onChange: () => void) {}
  switchTo(scope?: LearningScope): void { this.generation++; this.current = scope; this.onChange(); }
  async run<T>(operation: (scope: LearningScope) => Promise<T>): Promise<T> {
    const generation = this.generation; const scope = this.current;
    if (!scope) throw new StaleLearningContext();
    try {
      const result = await operation(scope);
      if (generation !== this.generation) throw new StaleLearningContext();
      return result;
    } catch (error) {
      if (generation !== this.generation) throw new StaleLearningContext();
      throw error;
    }
  }
}
