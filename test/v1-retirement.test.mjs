import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const cleanup = () => {
  const run = new AsyncFunction('navigator', 'caches', 'location', 'globalThis',
    readFileSync('public/retire-v1.js', 'utf8').replace(/^export \{\};?\s*$/m, ''));
  return (navigator, caches, location) => run(navigator, caches, location, caches ? { caches } : {});
};

test('v2 startup removes the retired registration and caches, preserving other apps', async () => {
  const removed = []; const deleted = [];
  await cleanup()({ serviceWorker: { getRegistrations: async () => [
    { active: { scriptURL: 'https://drillcards.org/sw.js' }, unregister: async () => removed.push('v1') },
    { active: { scriptURL: 'https://drillcards.org/sw.js?app=v2' }, unregister: async () => removed.push('other') },
  ] } }, { keys: async () => ['drillcards-2.47.0', 'drillcards-v2-2.49.0', 'other-app'], delete: async key => deleted.push(key) },
  { reload: () => assert.fail('uncontrolled page must not reload') });
  assert.deepEqual(removed, ['v1']); assert.deepEqual(deleted, ['drillcards-2.47.0']);
});

test('a controlled page reloads and cannot continue booting v2 under the v1 worker', async () => {
  let resolveReload; const reloaded = new Promise(resolve => { resolveReload = resolve; });
  let continued = false;
  void cleanup()({ serviceWorker: { controller: { scriptURL: 'https://drillcards.org/sw.js' },
    getRegistrations: async () => [] } }, { keys: async () => [] }, { reload: resolveReload })
    .then(() => { continued = true; });
  await reloaded; await Promise.resolve(); assert.equal(continued, false);
});

test('startup also works in a browser without service workers or Cache Storage', async () => {
  await cleanup()({}, undefined, { reload: () => assert.fail('no controller') });
});

test('rebuilding a reused output directory removes emitted v1 modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drillcards-build-'));
  try {
    mkdirSync(join(dir, 'public/pages/grammar'), { recursive: true });
    mkdirSync(join(dir, 'public/v2'), { recursive: true });
    for (const path of ['main.js', 'router.js', 'supabase.js', 'pages/grammar/kasus.js', 'sw.js', 'v2/session.html'])
      writeFileSync(join(dir, 'public', path), 'fixture');
    execFileSync(process.execPath, [resolve('scripts/clean-client.mjs')], { cwd: dir });
    for (const path of ['main.js', 'router.js', 'supabase.js', 'pages'])
      assert.equal(existsSync(join(dir, 'public', path)), false, path);
    assert.ok(existsSync(join(dir, 'public/sw.js')));
    assert.ok(existsSync(join(dir, 'public/v2/session.html')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
