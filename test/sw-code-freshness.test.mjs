import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** Runs public/sw.js against a fake cache and network and returns its fetch handler. */
function worker({ cached = {}, network = {}, httpCached = {} } = {}) {
  const listeners = {};
  const store = new Map(Object.entries(cached));
  const cache = {
    match: async request => store.get(typeof request === 'string' ? request : new URL(request.url).pathname),
    put: async (request, response) => { store.set(new URL(request.url).pathname, response); },
  };
  const self = { location: new URL('https://drillcards.org/'), addEventListener: (type, fn) => { listeners[type] = fn; } };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self, URL, Response,
    caches: { open: async () => cache, match: async () => undefined },
    fetch: async (request, options) => {
      const path = new URL(request.url).pathname;
      // A fresh HTTP entry can be old application code even on a network-first path.
      const body = options?.cache === 'no-cache' ? network[path] : httpCached[path] ?? network[path];
      if (body === undefined) throw new TypeError('offline');
      return new Response(body);
    },
  });
  const request = (path, destination, headers) => ({ headers: new Headers(headers), url: `https://drillcards.org${path}`, method: 'GET', mode: 'cors', destination });
  return {
    async get(path, destination, headers = {}) {
      let answer;
      listeners.fetch({ request: request(path, destination, headers), respondWith: promise => { answer = promise; } });
      if (!answer) return 'bypass';
      const response = await answer;
      return response.type === 'error' ? 'offline' : response.text();
    },
  };
}

test('a script comes from the network even when the previous release is cached', async () => {
  const sw = worker({ cached: { '/v2/session-page.js': new Response('old') }, network: { '/v2/session-page.js': 'new' } });
  assert.equal(await sw.get('/v2/session-page.js', 'script'), 'new');
});

test('styles and extension-only matches are fresh too', async () => {
  const sw = worker({ cached: { '/style.css': new Response('old'), '/v2/card-ui.js': new Response('old') },
    network: { '/style.css': 'new', '/v2/card-ui.js': 'new' } });
  assert.equal(await sw.get('/style.css', 'style'), 'new');
  assert.equal(await sw.get('/v2/card-ui.js', ''), 'new');
});

test('network-first code revalidates a still-fresh four-hour HTTP cache entry', async () => {
  for (const [path, destination] of [['/v2/today-page.js', 'script'], ['/style.css', 'style'], ['/v2/core/index.js', '']]) {
    const sw = worker({ cached: { [path]: new Response('old offline copy') },
      httpCached: { [path]: 'old HTTP copy' }, network: { [path]: 'new release' } });
    assert.equal(await sw.get(path, destination), 'new release', path);
  }
});

test('offline, the cached script is the fallback', async () => {
  const sw = worker({ cached: { '/v2/session-page.js': new Response('cached') } });
  assert.equal(await sw.get('/v2/session-page.js', 'script'), 'cached');
  assert.equal(await sw.get('/v2/missing.js', 'script'), 'offline');
});

test('data stays stale-while-revalidate', async () => {
  const sw = worker({ cached: { '/data/words-a1.json': new Response('cached') }, network: { '/data/words-a1.json': 'fresh' } });
  assert.equal(await sw.get('/data/words-a1.json', ''), 'cached');
});


test('partial audio requests bypass the worker instead of caching a 206 response', async () => {
  const sw = worker();
  assert.equal(await sw.get('/audio/words/b2/word.mp3', 'audio', { Range: 'bytes=0-' }), 'bypass');
});
