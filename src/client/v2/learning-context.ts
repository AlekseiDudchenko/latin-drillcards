import type { SupabaseClient, createClient } from '@supabase/supabase-js';
import { assetUrl } from '../config.js';
import type { Deck, Owner, Word } from './core/index.js';
import type { CatalogIndex, DeckFile } from './home-model.js';
import type { RunnerStore } from './session-runner.js';
import { LearningDatabase, StaleLearningContext } from './storage/learning-db.js';
import { assertServerEnvironment, parseV2Environment, v2Namespace, type PublicEnvironment, type ReadyEnvironment } from './environment-config.js';
import { V2AuthContext, type AuthView } from './auth-context.js';
import { SyncService, createSyncTransport, type SyncStatus } from './sync-service.js';

/** R1a (#325): the one way a v2 page opens its learning store, catalog and account.
 * An unconfigured build keeps the local preview journal (one guest in a fixed epoch).
 * A configured build is the hosted environment: the signed-in owner (or the namespaced
 * guest), the server catalog and, for an account, sync after every saved answer.
 * Errors of a configured backend are thrown, never replaced by the local preview.
 */
export const LOCAL_EPOCH = Object.freeze({ dataEpoch: 'preview-1', epochStartedAt: '2026-10-01T00:00:00.000Z' });
const LOCAL_GUEST_KEY = 'dc_v2_preview_guest';
const RETURN_KEY = 'dc_v2_return';
/** The last environment this browser started with online (a hosted one only after its server check): the offline start uses it. */
const VERIFIED_KEY = 'dc_v2_environment_verified';
/** While the page stays open, also check every minute (other devices, a missed trigger). */
const IDLE_SYNC_MS = 60_000;
/** Word IDs per catalog_words request, so a large deck never exceeds a URL length limit. */
const WORD_BATCH = 100;
/** The shared decks in the seed's curated order (scripts/vocabulary-seed.mjs DECKS); the server has no deck position.
 * The home and a word's first deck depend on it, so hosted and local builds show the same order. */
export const SHARED_DECK_ORDER = Object.freeze(['a1', 'a2', 'b1', 'b2', 'c1', 'beruf', 'arch', 'kollokationen']);

export type LearningMode = 'local' | 'hosted';
/** What the account bar shows; `local` has no account and no sync. */
export interface AccountState {
  readonly phase: 'loading' | 'ready' | 'error';
  readonly owner?: Owner;
  readonly avatarUrl?: string;
  readonly sync?: SyncStatus;
}
export interface AccountControls {
  readonly state: AccountState;
  subscribe(listener: () => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): void;
}
/** Catalog reads for one page and owner. */
export interface CatalogSource {
  index(): Promise<CatalogIndex>;
  deck(id: string): Promise<DeckFile>;
}
export interface PageLearning {
  readonly mode: LearningMode;
  /** Bound to the page's first owner: after a sign-out or owner change it rejects (StaleLearningContext),
   * and a new owner reloads the page (onOwnerChange). */
  readonly store: RunnerStore;
  readonly catalog: CatalogSource;
  readonly account?: AccountControls;
  dispose(): void;
}
export interface OpenOptions {
  /** A different owner became active (sign-in/out here or in another tab). Default: reload, which
   * drops the running session, its card and every owner-derived view in one step. */
  readonly onOwnerChange?: () => void;
}

const sameOwner = (a: Owner | undefined, b: Owner | undefined): boolean => !!a && !!b && a.kind === b.kind && a.id === b.id;
type ActiveRun = <T>(operation: (current: RunnerStore) => Promise<T>) => Promise<T>;

/** The Runner's store for one owner. Every call goes through `run` (the auth context's active scope),
 * so a sign-out or owner change cuts it off synchronously: the next read or write rejects with
 * StaleLearningContext instead of landing in the previous owner's journal. A committed answer
 * asks the account's sync to send it.
 */
export function boundStore(scope: RunnerStore, run: ActiveRun, committed: () => void): RunnerStore {
  const guarded: ActiveRun = operation => run(current => {
    if (!sameOwner(current.owner, scope.owner) || current.epoch.dataEpoch !== scope.epoch.dataEpoch) throw new StaleLearningContext();
    return operation(current);
  });
  return {
    owner: scope.owner, epoch: scope.epoch,
    snapshot: () => guarded(current => current.snapshot()),
    restore: asOf => guarded(current => current.restore(asOf)),
    startSession: archive => guarded(current => current.startSession(archive)),
    saveSession: (state, revision) => guarded(current => current.saveSession(state, revision)),
    async commit(input) {
      const result = await guarded(current => current.commit(input));
      if (result === 'committed') committed();
      return result;
    },
  };
}

function deckFromRow(row: unknown): Deck {
  const { id, title, wordIds } = (row ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(wordIds) || wordIds.some(w => typeof w !== 'string'))
    throw new Error('Invalid catalog deck');
  return { id, title, wordIds: wordIds as string[] };
}
function releaseVersion(rows: readonly unknown[]): string {
  const version = (rows[0] as { catalog_version?: unknown } | undefined)?.catalog_version;
  if (rows.length !== 1 || typeof version !== 'string' || !version) throw new Error('No published catalog release');
  return version;
}
/** Shared decks in curated order, then any other shared deck and the owner's own decks by ID. */
const deckRank = (id: string): number => { const i = SHARED_DECK_ORDER.indexOf(id); return i < 0 ? SHARED_DECK_ORDER.length : i; };
/** catalog_release + catalog_decks rows → the index the home renders. */
export function catalogIndexFromRows(release: readonly unknown[], decks: readonly unknown[]): CatalogIndex {
  const parsed = decks.map(deckFromRow).sort((a, b) => deckRank(a.id) - deckRank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { catalogVersion: releaseVersion(release), decks: parsed };
}
/** One deck and its published words, in deck order. A word unpublished since the deck was read is left out. */
export function deckFileFromRows(release: readonly unknown[], deck: unknown, words: readonly unknown[]): DeckFile {
  const parsed = deckFromRow(deck);
  const byId = new Map<string, Word>();
  for (const row of words) {
    const { id, word } = (row ?? {}) as { id?: unknown; word?: Word };
    if (typeof id !== 'string' || !word || word.id !== id) throw new Error('Invalid catalog word');
    byId.set(id, word);
  }
  const wordIds = parsed.wordIds.filter(id => byId.has(id));
  return { catalogVersion: releaseVersion(release), deck: { ...parsed, wordIds }, words: wordIds.map(id => byId.get(id)!) };
}

/** The seed catalog as static JSON (scripts/build-seed-catalog.mjs), under any site base. */
export function staticCatalog(base = new URL('./catalog/', import.meta.url), fetcher: typeof fetch = (...args) => fetch(...args)): CatalogSource {
  async function json<T>(path: string): Promise<T> {
    const response = await fetcher(new URL(path, base));
    if (!response.ok) throw new Error(`Catalog ${path}: ${response.status}`);
    return response.json() as Promise<T>;
  }
  return { index: () => json<CatalogIndex>('index.json'), deck: id => json<DeckFile>(`deck-${encodeURIComponent(id)}.json`) };
}

/** The published catalog with the current user's access: a signed-in owner also sees their own decks.
 * The release and accessible deck index are read once per page. Saved words are reused only
 * for that release and an identical deck in this fresh, authorized index. */
export function hostedCatalog(client: Pick<SupabaseClient, 'from'>, snapshots?: SnapshotStore): CatalogSource {
  let releaseRows: Promise<unknown[]> | undefined;
  const release = () => releaseRows ??= Promise.resolve(client.from('catalog_release').select('catalog_version')).then(result => {
    if (result.error) throw new Error('Catalog release read failed');
    return result.data as unknown[];
  }).catch(error => { releaseRows = undefined; throw error; });
  let indexRead: Promise<CatalogIndex> | undefined;
  const deckReads = new Map<string, Promise<DeckFile>>();
  const index = (): Promise<CatalogIndex> => indexRead ??= (async () => {
    const [rows, decks] = await Promise.all([release(), client.from('catalog_decks').select('id,title,wordIds')]);
    if (decks.error) throw new Error('Catalog read failed');
    return catalogIndexFromRows(rows, decks.data);
  })().catch(error => { indexRead = undefined; throw error; });
  async function loadDeck(id: string): Promise<DeckFile> {
    // Always authorize against this page's fresh index before consulting a saved deck.
    const current = await index();
    const deck = current.decks.find(deck => deck.id === id);
    if (!deck) throw new Error(`Deck ${id} not found`);
    const key = `published-deck/${id}`;
    const saved = await snapshots?.get(key).catch(() => undefined) as DeckFile | undefined;
    if (saved?.catalogVersion === current.catalogVersion &&
        JSON.stringify(saved.deck) === JSON.stringify(deck) && Array.isArray(saved.words)) {
      try {
        if (JSON.stringify(saved.words.map(word => word.id)) !== JSON.stringify(deck.wordIds)) throw new Error('Incomplete snapshot');
        return deckFileFromRows([{ catalog_version: current.catalogVersion }], deck,
          saved.words.map(word => ({ id: word.id, word })));
      } catch { /* A damaged snapshot is a cache miss. */ }
    }
    const ids = deck.wordIds;
    const batches = await Promise.all(Array.from({ length: Math.ceil(ids.length / WORD_BATCH) }, (_, i) =>
      client.from('catalog_words').select('id,word').in('id', ids.slice(i * WORD_BATCH, (i + 1) * WORD_BATCH))));
    if (batches.some(batch => batch.error)) throw new Error('Catalog words read failed');
    const file = deckFileFromRows([{ catalog_version: current.catalogVersion }], deck, batches.flatMap(batch => batch.data as unknown[]));
    await snapshots?.put(key, file).catch(() => {});
    return file;
  }
  return {
    index,
    deck(id) {
      let read = deckReads.get(id);
      if (!read) {
        read = loadDeck(id).catch(error => { deckReads.delete(id); throw error; });
        deckReads.set(id, read);
      }
      return read;
    },
  };
}

export interface SnapshotStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}
/** Offline fallback for the deck list and decks this owner last read online. Online, the source
 * validates the release and accessible index before reusing words; backend errors still surface. */
export function offlineCatalog(source: CatalogSource, store: SnapshotStore, online: () => boolean): CatalogSource {
  async function read<T>(key: string, load: () => Promise<T>): Promise<T> {
    try {
      const value = await load();
      void store.put(key, value).catch(() => {});
      return value;
    } catch (error) {
      if (online()) throw error;
      const saved = await store.get(key).catch(() => undefined);
      if (saved === undefined) throw error;
      return saved as T;
    }
  }
  return { index: () => read('index', () => source.index()), deck: id => read(`deck/${id}`, () => source.deck(id)) };
}
/** Cache Storage, one cache per environment and owner (an account's private decks stay its own). */
function cacheStore(name: string): SnapshotStore {
  const url = (key: string) => new URL(`/__dc-v2-catalog/${encodeURIComponent(key)}`, location.origin).href;
  return {
    async get(key) { const hit = await (await caches.open(name)).match(url(key)); return hit ? hit.json() : undefined; },
    async put(key, value) {
      await (await caches.open(name)).put(url(key), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
    },
  };
}

/** Google always returns to the fixed callback (environment.html), which sends the user back here. */
export function rememberReturn(storage: Pick<Storage, 'setItem'>, href: string, config: Pick<ReadyEnvironment, 'siteUrl'>): void {
  if (returnTarget(href, config)) storage.setItem(RETURN_KEY, href);
}
/** The page sign-in started from, once, and only inside this deployment's v2 site. */
export function takeReturn(storage: Pick<Storage, 'getItem' | 'removeItem'>, config: Pick<ReadyEnvironment, 'siteUrl'>): string | undefined {
  const stored = storage.getItem(RETURN_KEY);
  storage.removeItem(RETURN_KEY);
  return stored ? returnTarget(stored, config) : undefined;
}
export function forgetReturn(storage: Pick<Storage, 'removeItem'>): void { storage.removeItem(RETURN_KEY); }
function returnTarget(href: string, config: Pick<ReadyEnvironment, 'siteUrl'>): string | undefined {
  try {
    const url = new URL(href); const site = new URL(config.siteUrl);
    if (url.origin !== site.origin || !url.pathname.startsWith(site.pathname) || url.pathname.endsWith('/environment.html')) return undefined;
    url.searchParams.delete('code');
    return url.href;
  } catch { return undefined; }
}

function localGuestId(): string {
  try {
    const stored = localStorage.getItem(LOCAL_GUEST_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID(); localStorage.setItem(LOCAL_GUEST_KEY, id); return id;
  } catch { return 'preview-guest'; }
}

/** Offline, the environment last verified online stands in (never a guess); the next online start checks again. */
export function verifiedEnvironment(storage: Pick<Storage, 'getItem'>): PublicEnvironment | undefined {
  try {
    const stored = storage.getItem(VERIFIED_KEY);
    return stored ? parseV2Environment(JSON.parse(stored)) : undefined;
  } catch { return undefined; }
}
function rememberEnvironment(config: PublicEnvironment): void {
  try { localStorage.setItem(VERIFIED_KEY, JSON.stringify(config)); } catch { /* the offline start then fails visibly */ }
}

async function publicEnvironment(): Promise<{ readonly config: PublicEnvironment; readonly offline: boolean }> {
  // A v1 service worker ignores Request.cache and may return an old environment.
  // A unique URL forces its cache miss without changing the current site's SW.
  const url = new URL(assetUrl('v2/environment.json')); url.searchParams.set('v2', crypto.randomUUID());
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store' }); }
  catch (error) {
    let last: PublicEnvironment | undefined;
    try { last = verifiedEnvironment(localStorage); } catch { /* storage blocked */ }
    if (last) return { config: last, offline: true };
    throw error;
  }
  if (!response.ok) throw new Error('Missing environment');
  const config = parseV2Environment(await response.json());
  if (!config.configured) rememberEnvironment(config);
  return { config, offline: false };
}

/** v2 pages register the v2-only worker, so a visitor who starts on v2 can continue offline. */
function registerWorker(): void {
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register(assetUrl('sw.js?app=v2')).catch(() => {}); }
  catch { /* unsupported */ }
}

/** The self-hosted SDK (public/v2/vendor), loaded only by a configured build. */
function loadSdk(): Promise<{ createClient: typeof createClient }> {
  const global = window as unknown as { supabase?: { createClient: typeof createClient } };
  if (global.supabase) return Promise.resolve(global.supabase);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/supabase.js', import.meta.url).href;
    script.onload = () => global.supabase ? resolve(global.supabase) : reject(new Error('Supabase SDK missing'));
    script.onerror = () => reject(new Error('Supabase SDK unavailable'));
    document.head.append(script);
  });
}

export async function openPageLearning(options: OpenOptions = {}): Promise<PageLearning> {
  registerWorker();
  const { config, offline } = await publicEnvironment();
  return config.configured ? openHosted(config, offline, options.onOwnerChange ?? (() => location.reload())) : openLocal();
}

async function openLocal(): Promise<PageLearning> {
  const db = await LearningDatabase.open();
  try {
    const store = await db.scope({ kind: 'guest', id: localGuestId() }, LOCAL_EPOCH);
    return { mode: 'local', store, catalog: staticCatalog(), dispose: () => db.close() };
  } catch (error) { db.close(); throw error; }
}

async function openHosted(config: ReadyEnvironment, offline: boolean, onOwnerChange: () => void): Promise<PageLearning> {
  // Same guard as environment.html: the callback and PKCE verifier exist only on the configured origin.
  if (new URL(config.siteUrl).origin !== location.origin) throw new Error('Wrong deployment origin');
  // Reaching a page means no sign-in is in flight in this tab (an abandoned one leaves its target behind).
  try { forgetReturn(sessionStorage); } catch { /* nothing stored */ }
  if (!offline) {
    const meta = await fetch(`${config.supabaseUrl}/rest/v1/v2_environment?select=schema_version,environment,data_epoch,epoch_started_at`,
      { headers: { apikey: config.publishableKey }, cache: 'no-store' });
    if (!meta.ok) throw new Error('Environment unavailable');
    const rows = await meta.json();
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Missing server configuration');
    assertServerEnvironment(config, rows[0]);
    rememberEnvironment(config);
  }
  const namespace = v2Namespace(config);
  const sdk = await loadSdk();
  let guestId: string;
  try { guestId = localStorage.getItem(namespace + ':guest') ?? crypto.randomUUID(); localStorage.setItem(namespace + ':guest', guestId); }
  catch { guestId = crypto.randomUUID(); }
  // The database first: a failure here leaves no SDK client with a running token refresh behind.
  const db = await LearningDatabase.open(indexedDB, namespace + ':learning');
  let client: SupabaseClient;
  try {
    client = sdk.createClient(config.supabaseUrl, config.publishableKey, { auth: { storageKey: namespace + ':auth',
      flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  } catch (error) { db.close(); throw error; }
  return new Promise<PageLearning>((resolve, reject) => {
    const account = new HostedAccount(client, db, config, guestId, onOwnerChange, (store, controls) => {
      const snapshots = cacheStore(`dc-v2-catalog:${namespace}:${store.owner.kind}:${store.owner.id}`);
      resolve({
        mode: 'hosted', store, account: controls, dispose: () => controls.dispose(),
        catalog: offlineCatalog(hostedCatalog(client, snapshots), snapshots, () => navigator.onLine),
      });
    }, reject);
    void account.start();
  });
}

class HostedAccount implements AccountControls {
  private readonly listeners = new Set<() => void>();
  private readonly auth: V2AuthContext;
  private current: AccountState = { phase: 'loading' };
  private owner?: Owner;
  private avatarUrl?: string;
  private sync?: SyncService;
  private disposed = false;
  private readonly wake = () => { void this.sync?.sync(); };
  private readonly visible = () => { if (document.visibilityState === 'visible') this.wake(); };
  constructor(private readonly client: SupabaseClient, private readonly db: LearningDatabase, private readonly config: ReadyEnvironment,
    guestId: string, private readonly onOwnerChange: () => void,
    private readonly ready: (store: RunnerStore, controls: HostedAccount) => void, private readonly failed: (error: Error) => void) {
    this.auth = new V2AuthContext(client.auth, db, config, guestId, view => this.changed(view));
    window.addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.visible);
  }
  get state(): AccountState { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(state: AccountState): void { this.current = state; this.listeners.forEach(listener => listener()); }
  async start(): Promise<void> {
    try { await this.auth.start(); }
    catch { this.fail(); }
  }
  private fail(): void {
    if (!this.owner) { this.dispose(); this.failed(new Error('Account unavailable')); }
  }
  /** Any identity change stops the previous owner's sync synchronously, before the next scope. */
  private changed(view: AuthView): void {
    this.sync?.stop(); this.sync = undefined;
    if (view.phase !== 'ready') {
      this.emit({ phase: view.phase, ...(this.owner ? { owner: this.owner } : {}), ...(this.avatarUrl ? { avatarUrl: this.avatarUrl } : {}) });
      if (view.phase === 'error') this.fail();
      return;
    }
    void this.auth.active.run(async scope => scope).then(scope => {
      if (this.disposed || this.auth.view !== view) return;
      if (this.owner && !sameOwner(this.owner, scope.owner)) { this.dispose(); this.onOwnerChange(); return; }
      const first = !this.owner;
      this.owner = scope.owner; this.avatarUrl = view.avatarUrl;
      if (scope.owner.kind === 'account') this.startSync(scope);
      this.emit({ phase: 'ready', owner: scope.owner, ...(view.avatarUrl ? { avatarUrl: view.avatarUrl } : {}), ...(this.sync ? { sync: this.sync.status } : {}) });
      if (first) this.ready(boundStore(scope, operation => this.auth.active.run(operation), this.wake), this);
      void this.sync?.sync();
    }).catch(() => {});
  }
  private startSync(scope: ConstructorParameters<typeof SyncService>[0]): void {
    const sdk = this.client;
    this.sync = new SyncService(scope, createSyncTransport(this.config, async () => {
      const { data } = await sdk.auth.getSession();
      return data.session ? { userId: data.session.user.id, accessToken: data.session.access_token } : null;
    }), { now: () => new Date().toISOString(), online: () => navigator.onLine, random: Math.random,
      setTimer: (run, ms) => setTimeout(run, ms), clearTimer: timer => clearTimeout(timer as number),
      onStatus: status => { if (this.current.phase === 'ready') this.emit({ ...this.current, sync: status }); },
      idleSyncMs: IDLE_SYNC_MS,
      ...(navigator.locks ? { lock: <T,>(name: string, work: () => Promise<T>) => navigator.locks.request(name, work) as Promise<T> } : {}) });
  }
  async signIn(): Promise<void> {
    try { rememberReturn(sessionStorage, location.href, this.config); } catch { /* the callback page then stays there */ }
    try { await this.auth.signIn(); }
    catch (error) { try { forgetReturn(sessionStorage); } catch { /* nothing stored */ } throw error; }
  }
  signOut(): Promise<void> { return this.auth.signOut(); }
  syncNow(): void { this.wake(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.sync?.stop(); this.sync = undefined; this.listeners.clear();
    window.removeEventListener('online', this.wake); document.removeEventListener('visibilitychange', this.visible);
    this.auth.dispose(); this.db.close(); void this.client.auth.stopAutoRefresh();
  }
}
