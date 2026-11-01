import test from 'node:test';
import assert from 'node:assert/strict';

// config.js reads the page location and <base> at import; no DOM in unit tests.
globalThis.location ??= new URL('http://localhost:5173/v2/session.html');
globalThis.document ??= { querySelector: () => null };
const { offlineCatalog, verifiedEnvironment, boundStore, catalogIndexFromRows, deckFileFromRows, staticCatalog, hostedCatalog, rememberReturn, takeReturn, SHARED_DECK_ORDER } =
  await import('../public/v2/learning-context.js');
const { StaleLearningContext } = await import('../public/v2/storage/learning-db.js');
const { DECKS } = await import('../scripts/vocabulary-seed.mjs');

const site = { siteUrl: 'https://drillcards.org/v2/' };
const word = (id, lemma) => ({ id, lemma, meanings: {} });
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; };

const fakeScope = (id = 'a') => ({ owner: { kind: 'account', id }, epoch: { dataEpoch: 'e', epochStartedAt: '2026-10-01T00:00:00.000Z' },
  snapshot: async () => 'snap', restore: async at => `restore ${at}`, startSession: async () => 'committed',
  saveSession: async () => 'committed', commit: async input => input.result });
/** Mirrors ActiveLearningContext.run: no current scope (invalidated) rejects before any work. */
const active = () => { const ctx = { current: undefined, run: async op => { if (!ctx.current) throw new StaleLearningContext(); return op(ctx.current); } }; return ctx; };

test('only a committed answer wakes sync; reads and session saves pass through', async () => {
  const scope = fakeScope(); const ctx = active(); ctx.current = scope;
  let woke = 0;
  const store = boundStore(scope, ctx.run, () => { woke++; });
  assert.deepEqual([store.owner, store.epoch], [scope.owner, scope.epoch]);
  assert.equal(await store.restore('t'), 'restore t');
  assert.equal(await store.saveSession({}, 3), 'committed');
  assert.equal(await store.commit({ result: 'duplicate' }), 'duplicate');
  assert.equal(await store.commit({ result: 'conflict' }), 'conflict');
  assert.equal(woke, 0, 'nothing new was written');
  assert.equal(await store.commit({ result: 'committed' }), 'committed');
  assert.equal(woke, 1);
});

test('after sign-out or an owner change the page store refuses every call and never wakes sync', async () => {
  const scope = fakeScope('a'); const ctx = active(); ctx.current = scope;
  let woke = 0; let written = 0;
  scope.commit = async () => (written++, 'committed');
  const store = boundStore(scope, ctx.run, () => { woke++; });
  ctx.current = undefined; // sign-out started: the auth context invalidated the scope synchronously
  await assert.rejects(store.commit({}), StaleLearningContext);
  await assert.rejects(store.startSession({}), StaleLearningContext);
  ctx.current = fakeScope('b'); // another owner is active now
  await assert.rejects(store.commit({}), StaleLearningContext);
  await assert.rejects(store.snapshot(), StaleLearningContext);
  assert.equal(written, 0); assert.equal(woke, 0);
});

test('the server catalog maps to the home index and keeps deck order for published words only', () => {
  const release = [{ catalog_version: 'cat-7' }];
  const index = catalogIndexFromRows(release, [{ id: 'a1', title: 'A1', wordIds: ['w-b', 'w-a'] }]);
  assert.deepEqual(index, { catalogVersion: 'cat-7', decks: [{ id: 'a1', title: 'A1', wordIds: ['w-b', 'w-a'] }] });
  const file = deckFileFromRows(release, { id: 'a1', title: 'A1', wordIds: ['w-b', 'w-gone', 'w-a'] },
    [{ id: 'w-a', word: word('w-a', 'A') }, { id: 'w-b', word: word('w-b', 'B') }]);
  assert.deepEqual(file.deck.wordIds, ['w-b', 'w-a']);
  assert.deepEqual(file.words.map(w => w.lemma), ['B', 'A']);
  assert.equal(file.catalogVersion, 'cat-7');
});

test('shared decks keep the seed order on the server too; personal decks follow by ID', () => {
  assert.deepEqual([...SHARED_DECK_ORDER], DECKS.map(([id]) => id), 'keep in step with scripts/vocabulary-seed.mjs');
  const rows = ['uid:z', 'kollokationen', 'arch', 'b1', 'uid:a', 'a1', 'beruf'].map(id => ({ id, title: id, wordIds: [] }));
  assert.deepEqual(catalogIndexFromRows([{ catalog_version: 'c' }], rows).decks.map(d => d.id),
    ['a1', 'b1', 'beruf', 'arch', 'kollokationen', 'uid:a', 'uid:z']);
});

test('a missing release or a malformed row is an error, not an empty catalog', () => {
  assert.throws(() => catalogIndexFromRows([], []), /release/);
  assert.throws(() => catalogIndexFromRows([{ catalog_version: 'a' }, { catalog_version: 'b' }], []), /release/);
  assert.throws(() => catalogIndexFromRows([{ catalog_version: 'a' }], [{ id: 'x', title: 'X', wordIds: [1] }]), /deck/);
  assert.throws(() => deckFileFromRows([{ catalog_version: 'a' }], { id: 'x', title: 'X', wordIds: ['w-a'] },
    [{ id: 'w-a', word: word('w-other', 'A') }]), /word/);
});

test('hosted catalog reads release, decks and words in batches and surfaces backend errors', async () => {
  const ids = Array.from({ length: 230 }, (_, i) => `w-${i}`);
  const requests = [];
  const query = (table, result) => {
    const q = { select: () => q, order: () => q, eq: (_c, v) => (requests.push(`${table} eq ${v}`), q),
      in: (_c, values) => (requests.push(`${table} in ${values.length}`), Promise.resolve({ data: values.map(id => ({ id, word: word(id, id) })), error: null })),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    return q;
  };
  const client = { from: table => table === 'catalog_release' ? query(table, { data: [{ catalog_version: 'cat-1' }], error: null })
    : table === 'catalog_decks' ? query(table, { data: [{ id: 'big', title: 'Big', wordIds: ids }], error: null })
    : query(table, undefined) };
  let releases = 0;
  const from = client.from; client.from = table => (table === 'catalog_release' && releases++, from(table));
  const source = hostedCatalog(client);
  const file = await source.deck('big');
  assert.equal(file.words.length, 230);
  assert.deepEqual(requests, ['catalog_words in 100', 'catalog_words in 100', 'catalog_words in 30']);
  await source.index(); await source.deck('big');
  assert.equal(releases, 1, 'one catalog version per page');
  assert.equal(requests.length, 3, 'refreshing the page model reuses its loaded words');
  const failing = { from: table => query(table, table === 'catalog_decks' ? { data: null, error: { message: 'denied' } } : { data: [{ catalog_version: 'c' }], error: null }) };
  await assert.rejects(hostedCatalog(failing).index(), /Catalog read failed/);
});

function catalogBackend() {
  const state = { version: 'c1', decks: [{ id: 'a', title: 'A', wordIds: ['w-a'] },
    { id: 'b', title: 'B', wordIds: ['w-b'] }], calls: [], fail: undefined };
  const client = { from(table) {
    state.calls.push(table);
    let ids, deckId;
    const q = { select: () => q, eq: (_field, value) => (deckId = value, q), in: (_field, values) => (ids = values, q),
      then(resolve, reject) {
        const data = table === 'catalog_release' ? [{ catalog_version: state.version }]
          : table === 'catalog_decks' ? state.decks.filter(deck => !deckId || deck.id === deckId) : ids.map(id => ({ id, word: word(id, id) }));
        return Promise.resolve({ data, error: state.fail === table ? { message: 'down' } : null }).then(resolve, reject);
      } };
    return q;
  } };
  return { state, client };
}
const snapshots = () => {
  const saved = new Map();
  return { saved, get: async key => saved.get(key), put: async (key, value) => { saved.set(key, structuredClone(value)); } };
};

test('today loads one deck index and shares concurrent deck reads', async () => {
  const { state, client } = catalogBackend();
  const catalog = hostedCatalog(client);
  await Promise.all([catalog.index(), catalog.index(), catalog.deck('a'), catalog.deck('a'), catalog.deck('b')]);
  assert.equal(state.calls.filter(t => t === 'catalog_decks').length, 1);
  assert.equal(state.calls.filter(t => t === 'catalog_words').length, 2);
  assert.equal(state.calls.filter(t => t === 'catalog_release').length, 1);
});

test('a new page reuses words only after checking the current release and accessible decks', async () => {
  const { state, client } = catalogBackend(); const cache = snapshots();
  const first = await hostedCatalog(client, cache).deck('a');
  state.calls.length = 0;
  assert.deepEqual(await hostedCatalog(client, cache).deck('a'), first);
  assert.deepEqual(state.calls.sort(), ['catalog_decks', 'catalog_release']);
  state.version = 'c2'; state.calls.length = 0;
  assert.equal((await hostedCatalog(client, cache).deck('a')).catalogVersion, 'c2');
  assert.ok(state.calls.includes('catalog_words'), 'a new release reloads words');
  state.decks[0] = { ...state.decks[0], wordIds: ['w-new'] }; state.calls.length = 0;
  assert.equal((await hostedCatalog(client, cache).deck('a')).words[0].id, 'w-new');
  assert.ok(state.calls.includes('catalog_words'), 'changed membership invalidates the saved deck');
  state.decks = []; state.calls.length = 0;
  await assert.rejects(hostedCatalog(client, cache).deck('a'), /not found/);
  assert.ok(!state.calls.includes('catalog_words'), 'removed access cannot use a saved deck');
});

test('saved words never mask online backend errors; failed reads can retry', async () => {
  const { state, client } = catalogBackend(); const cache = snapshots();
  await hostedCatalog(client, cache).deck('a');
  for (const table of ['catalog_release', 'catalog_decks']) {
    state.fail = table;
    const catalog = hostedCatalog(client, cache);
    await assert.rejects(catalog.deck('a'), /Catalog .* failed/);
    state.fail = undefined;
    assert.equal((await catalog.deck('a')).words.length, 1);
  }
  const catalog = hostedCatalog(client);
  state.fail = 'catalog_words';
  await assert.rejects(catalog.deck('a'), /Catalog words read failed/);
  state.fail = undefined;
  assert.equal((await catalog.deck('a')).words.length, 1);
});

test('a damaged or unavailable cache reloads words without breaking learning', async () => {
  const { state, client } = catalogBackend(); const cache = snapshots();
  await hostedCatalog(client, cache).deck('a');
  for (const words of [[], [null], [{ id: 'wrong' }]]) {
    cache.saved.get('published-deck/a').words = words;
    state.calls.length = 0;
    assert.equal((await hostedCatalog(client, cache).deck('a')).words[0].id, 'w-a');
    assert.ok(state.calls.includes('catalog_words'));
  }
  const unavailable = { get: async () => { throw new Error('no storage'); }, put: async () => { throw new Error('quota'); } };
  assert.equal((await hostedCatalog(client, unavailable).deck('a')).words.length, 1);
});

test('static catalog reads the seed files next to the module and fails on HTTP errors', async () => {
  const seen = [];
  const source = staticCatalog(new URL('https://x.test/v2/catalog/'), async url => (seen.push(String(url)),
    String(url).endsWith('index.json') ? new Response('{"catalogVersion":"s","decks":[]}') : new Response('', { status: 404 })));
  assert.deepEqual(await source.index(), { catalogVersion: 's', decks: [] });
  await assert.rejects(source.deck('a 1'), /404/);
  assert.deepEqual(seen, ['https://x.test/v2/catalog/index.json', 'https://x.test/v2/catalog/deck-a%201.json']);
});

test('sign-in returns once to the page it started from, only inside the v2 site', () => {
  const storage = memory();
  rememberReturn(storage, 'https://drillcards.org/v2/gaps.html#x', site);
  assert.equal(takeReturn(storage, site), 'https://drillcards.org/v2/gaps.html#x');
  assert.equal(takeReturn(storage, site), undefined, 'consumed');
  for (const href of ['https://evil.test/v2/gaps.html', 'https://drillcards.org/de/', 'https://drillcards.org/v2/environment.html']) {
    rememberReturn(storage, href, site);
    assert.equal(takeReturn(storage, site), undefined, href);
  }
  storage.setItem('dc_v2_return', 'https://evil.test/v2/session.html');
  assert.equal(takeReturn(storage, site), undefined, 'a planted value is validated again');
});

test('offline the catalog falls back to the last snapshot; online a server error is never masked', async () => {
  const saved = new Map(); const store = { get: async k => saved.get(k), put: async (k, v) => { saved.set(k, v); } };
  let online = true; let failing = false;
  const source = { index: async () => { if (failing) throw new Error('down'); return { catalogVersion: 'c', decks: [] }; },
    deck: async id => { if (failing) throw new Error('down'); return { catalogVersion: 'c', deck: { id, title: id, wordIds: [] }, words: [] }; } };
  const catalog = offlineCatalog(source, store, () => online);
  await catalog.index(); await catalog.deck('a1');
  await new Promise(resolve => setTimeout(resolve, 0));
  failing = true;
  await assert.rejects(catalog.index(), /down/, 'online: the backend error is shown');
  online = false;
  assert.deepEqual(await catalog.index(), { catalogVersion: 'c', decks: [] });
  assert.equal((await catalog.deck('a1')).deck.id, 'a1');
  await assert.rejects(catalog.deck('b1'), /down/, 'a deck never read online is not invented');
});

test('the offline start uses only a stored environment that still passes the public allowlist', () => {
  const ready = { schemaVersion: 1, configured: true, environment: 'local', supabaseUrl: 'http://127.0.0.1:54321',
    siteUrl: 'http://localhost:5173/v2/', publishableKey: 'sb_publishable_localtest1234', dataEpoch: 'e1', epochStartedAt: '2026-10-27T00:00:00.000Z' };
  const storage = value => ({ getItem: () => value });
  assert.equal(verifiedEnvironment(storage(JSON.stringify(ready))).dataEpoch, 'e1');
  assert.equal(verifiedEnvironment(storage(null)), undefined);
  assert.equal(verifiedEnvironment(storage('{broken')), undefined);
  assert.deepEqual(verifiedEnvironment(storage(JSON.stringify({ schemaVersion: 1, configured: false, environment: 'local' }))),
    { schemaVersion: 1, configured: false, environment: 'local' }, 'an unconfigured build starts offline as the local preview');
  assert.equal(verifiedEnvironment(storage(JSON.stringify({ ...ready, serviceRoleKey: 'x' }))), undefined, 'the allowlist still applies');
});
