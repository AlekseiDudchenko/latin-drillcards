import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { indexableHome, siteEntry } from '../scripts/build-site-entry.mjs';

const hosted = { schemaVersion: 1, configured: true, environment: 'production' };

test('v2 is the only entry, with unconfigured builds allowed only for local previews', () => {
  assert.deepEqual(siteEntry({}, { configured: false, environment: 'local' }), { entry: 'v2', redirects: null });
  assert.throws(() => siteEntry({ DRILLCARDS_SITE_ENTRY: 'v1' }, hosted), /retired/);
  assert.throws(() => siteEntry({ CF_PAGES: '1' }, { configured: false, environment: 'local' }), /configured/);
  assert.equal(siteEntry({}, hosted).entry, 'v2');
});

test('the v2 entry redirects the root and every v1 route to the v2 home, the v1 legal URLs to the v2 legal pages, with a reversible 302', () => {
  const { entry, redirects } = siteEntry({ DRILLCARDS_SITE_ENTRY: 'v2' }, hosted);
  assert.equal(entry, 'v2');
  const rules = redirects.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/));
  assert.deepEqual(rules, [['/', '/v2/today', '302'], ['/index.html', '/v2/today', '302'],
    ['/de', '/v2/today', '302'], ['/de/*', '/v2/today', '302'],
    ['/privacy', '/v2/privacy', '302'], ['/terms', '/v2/terms', '302']]);
  assert.ok(!rules.some(([from]) => from.startsWith('/v2')), 'no rule may loop on a v2 page');
});

test('the v2 entry refuses a build without a hosted backend instead of making every visitor a local guest', () => {
  assert.throws(() => siteEntry({ DRILLCARDS_SITE_ENTRY: 'v2' }, { configured: false, environment: 'local' }), /configured/);
  assert.throws(() => siteEntry({ DRILLCARDS_SITE_ENTRY: 'v2' }, { ...hosted, environment: 'local' }), /hosted/);
  assert.throws(() => siteEntry({ DRILLCARDS_SITE_ENTRY: 'V2' }, hosted), /must be v2/);
});

test('the offline worker cannot serve or cache the retired shell', () => {
  const source = readFileSync('public/sw.js', 'utf8');
  assert.doesNotMatch(source, /main\.js|index\.html|ENTRY/);
  assert.match(source, /drillcards-v2-/);
  assert.doesNotThrow(() => new Script(source));
});

test('with the v2 entry the v2 home is indexable (the root redirects to it); otherwise it stays noindex', () => {
  // A fixture is required here: a production build has already removed noindex
  // from public/v2/today.html before the deployment gate runs this test.
  const html = '<!doctype html><html><head><meta name="robots" content="noindex"><title>DrillCards · Сегодня</title></head><body></body></html>';
  assert.equal(indexableHome(html, 'v1'), html);
  const home = indexableHome(html, 'v2');
  assert.doesNotMatch(home, /noindex/);
  assert.match(home, /<title>DrillCards · Сегодня<\/title>/);
  assert.equal(indexableHome(home, 'v2'), home, 'a rebuild in the same tree is a no-op');
});

test('the built home has the indexing policy of its actual environment', () => {
  const environment = JSON.parse(readFileSync('public/v2/environment.json', 'utf8'));
  const html = readFileSync('public/v2/today.html', 'utf8');
  if (environment.configured) assert.doesNotMatch(html, /<meta name="robots" content="noindex">/, 'hosted home is indexable');
  else assert.match(html, /<meta name="robots" content="noindex">/, 'local preview stays noindex');
});
