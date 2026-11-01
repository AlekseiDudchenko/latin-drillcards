import { test, expect, type Page, type Route } from '@playwright/test';
import { PREVIEW_CATALOG_VERSION, PREVIEW_DECK, PREVIEW_WORDS } from '../src/client/v2/preview-catalog.js';

// R1a (#325): the v2 pages on a configured environment. Real SDK, IndexedDB, Runner and SyncService;
// only the network is stubbed: Auth, the catalog views, the learning journal and the S1 intake.
const config = { schemaVersion: 1, configured: true, environment: 'local', supabaseUrl: 'http://127.0.0.1:54321',
  siteUrl: 'http://localhost:5173/v2/', publishableKey: 'sb_publishable_localtest1234', dataEpoch: 'v2-test-1', epochStartedAt: '2026-10-27T00:00:00.000Z' };
const namespace = 'drillcards-v2:local:127.0.0.1:54321:v2-test-1';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
const base64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (id: string) => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const access = [base64url({ alg: 'HS256', typ: 'JWT' }), base64url({ sub: id, role: 'authenticated', exp: expires }), 'test-signature'].join('.');
  return { access_token: access, refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expires,
    user: { id, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', app_metadata: { provider: 'google' }, user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/a/test-photo' }, created_at: '2026-10-27T00:00:00Z' } };
};
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const list = (value: string | null) => (value ?? '').replace(/^(eq|in)\.\(?|\)$/g, '').split(',').map(id => id.replace(/^"|"$/g, ''));

async function backend(page: Page, { account = true, catalog = 'ok' as 'ok' | 'fail' } = {}) {
  const server = { pushes: [] as { authorization?: string; eventIds: string[] }[], rows: [] as unknown[], catalogReads: 0,
    deckReads: 0, wordReads: 0, logout: 'ok' as 'ok' | 'fail' };
  await page.route('https://lh3.googleusercontent.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#4285f4"/></svg>' }));
  await page.route('**/v2/environment.json*', route => json(route, config));
  // A configured build must never read the static seed.
  await page.route('**/v2/catalog/*', route => route.fulfill({ status: 500 }));
  await page.route('http://127.0.0.1:54321/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    if (table === 'v2_environment') return json(route, [{ schema_version: 1, environment: 'local', data_epoch: config.dataEpoch, epoch_started_at: config.epochStartedAt }]);
    if (table === 'learning_events') {
      const after = Number(url.searchParams.get('sequence')!.slice(3));
      return json(route, server.rows.filter(row => (row as { sequence: number }).sequence > after));
    }
    server.catalogReads++;
    if (catalog === 'fail') return json(route, { message: 'denied' }, 500);
    if (table === 'catalog_release') return json(route, [{ catalog_version: PREVIEW_CATALOG_VERSION }]);
    if (table === 'catalog_decks') {
      server.deckReads++;
      const id = url.searchParams.get('id');
      return json(route, id && !list(id).includes(PREVIEW_DECK.id) ? [] : [PREVIEW_DECK]);
    }
    if (table === 'catalog_words') {
      server.wordReads++;
      const ids = list(url.searchParams.get('id'));
      return json(route, PREVIEW_WORDS.filter(word => ids.includes(word.id)).map(word => ({ id: word.id, word })));
    }
    return json(route, []);
  });
  await page.route('http://127.0.0.1:54321/functions/v1/v2-learning-events', async route => {
    const body = route.request().postDataJSON() as { events: { event: { eventId: string }; evaluation?: unknown }[] };
    server.pushes.push({ authorization: route.request().headers()['authorization'], eventIds: body.events.map(item => item.event.eventId) });
    const results = body.events.map(item => {
      server.rows.push({ user_id: 'account-A', sequence: server.rows.length + 1, event: item.event, evaluation: item.evaluation ?? null, received_at: new Date().toISOString() });
      return { eventId: item.event.eventId, status: 'accepted' };
    });
    return json(route, { ok: true, journalRevision: server.rows.length, results });
  });
  await page.route('http://127.0.0.1:54321/auth/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/logout')) return server.logout === 'ok' ? json(route, {}) : json(route, { msg: 'temporary failure' }, 500);
    if (path.endsWith('/user')) return json(route, token('account-A').user);
    if (path.endsWith('/token')) return json(route, token('account-A'));
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'Google sign-in requested' });
  });
  if (account) await page.addInitScript(({ key, session }) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, JSON.stringify(session)); sessionStorage.setItem('seeded', '1'); }
  }, { key: namespace + ':auth', session: token('account-A') });
  return server;
}

test('Today reuses its index and cached words across reloads without changing its counters', async ({ page }) => {
  const server = await backend(page);
  await page.goto('/v2/today.html');
  await expect(page.locator('#freshValue')).toHaveText(/\d/);
  const counters = await page.locator('#goalValue, #dueValue, #freshValue, #decks').allTextContents();
  expect(server.deckReads).toBe(1);
  expect(server.wordReads).toBe(1);
  await page.reload();
  await expect(page.locator('#freshValue')).toHaveText(/\d/);
  expect(await page.locator('#goalValue, #dueValue, #freshValue, #decks').allTextContents()).toEqual(counters);
  expect(server.deckReads).toBe(2);
  expect(server.wordReads).toBe(1);
});
const accountJournal = (page: Page) => page.evaluate(async ({ name, epoch }) => {
  const path = '/v2/storage/learning-db.js';
  const { LearningDatabase } = await import(path);
  const db = await LearningDatabase.open(indexedDB, name);
  const data = await (await db.scope({ kind: 'account', id: 'account-A' }, epoch)).snapshot(); db.close();
  return { facts: data.facts.length, outbox: data.outbox.length };
}, { name: namespace + ':learning', epoch: { dataEpoch: config.dataEpoch, epochStartedAt: config.epochStartedAt } });
/** Set before an action; gone after it only if the document was reloaded. */
const markDocument = (page: Page) => page.evaluate(() => { (window as unknown as { marker?: boolean }).marker = true; });
const sameDocument = (page: Page) => page.evaluate(() => !!(window as unknown as { marker?: boolean }).marker);

test('a signed-in account learns from the server catalog and every saved answer is sent', async ({ page }) => {
  const server = await backend(page);
  await page.goto('/v2/session.html');
  await expect(page.locator('#account-status')).toHaveText('Вы вошли: прогресс синхронизируется между устройствами.');
  await expect(page.locator('#account-login')).toBeHidden();
  await expect(page.locator('#account-photo')).toBeVisible();
  await expect(page.locator('#account-photo')).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a/test-photo');
  await expect(page.locator('body > :first-child')).toHaveId('account');
  await page.locator('#decks').getByRole('link', { name: new RegExp(PREVIEW_DECK.title) }).click();
  await expect(page.locator('#learnNew')).toHaveText(`Учить новые (${PREVIEW_DECK.wordIds.length})`);
  await page.locator('#learnNew').click();
  await expect(page.locator('#progress')).toContainText('Задание 1 из');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#progress')).toContainText('Задание 2 из');
  await expect.poll(() => server.pushes.flatMap(push => push.eventIds).length).toBeGreaterThanOrEqual(1);
  expect(server.pushes[0]!.authorization).toMatch(/^Bearer ey/);
  await expect.poll(async () => (await accountJournal(page)).outbox).toBe(0);
  // The answers live in the account's namespaced journal, not in the local preview database.
  const stored = await accountJournal(page);
  expect(stored.facts).toBeGreaterThanOrEqual(1);
  expect(stored.outbox).toBe(0);
});

test('a configured backend failure is shown, never replaced by the static seed', async ({ page }) => {
  const server = await backend(page, { catalog: 'fail' });
  await page.goto('/v2/session.html');
  await expect(page.locator('#notice')).not.toBeEmpty();
  await expect(page.locator('#notice')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#decks li a')).toHaveCount(0);
  expect(server.catalogReads).toBeGreaterThan(0);
});

test('sign-in from a v2 page goes through the fixed callback and comes back to that page', async ({ page }) => {
  await backend(page, { account: false });
  await page.goto('/v2/session.html');
  await expect(page.locator('#account-status')).toHaveText('Гость: прогресс хранится только на этом устройстве.');
  const authorize = page.waitForURL('**/auth/v1/authorize?**');
  await page.locator('#account-login').click(); await authorize;
  expect(new URL(page.url()).searchParams.get('redirect_to')).toBe('http://localhost:5173/v2/environment.html');
  // Google returns to the callback with a code; the SDK exchanges it, then the user is back on the home.
  await page.evaluate(key => localStorage.setItem(key + '-code-verifier', JSON.stringify('test-pkce-verifier')), namespace + ':auth');
  await page.goto('/v2/environment.html?code=test-auth-code');
  await page.waitForURL('**/v2/session.html');
  await expect(page.locator('#account-status')).toHaveText('Вы вошли: прогресс синхронизируется между устройствами.');
});

test('sign-out on a family page ends the account session there and continues as a guest', async ({ page }) => {
  await backend(page);
  await page.goto('/v2/gaps.html');
  await expect(page.locator('#account-status')).toHaveText('Вы вошли: прогресс синхронизируется между устройствами.');
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#account-logout')).toHaveText('Sign out');
  await markDocument(page);
  await page.locator('#account-logout').click();
  await expect(page.locator('#account-status')).toHaveText('Guest: progress is kept on this device only.');
  expect(await sameDocument(page), 'the owner change reloads the page').toBe(false);
  await expect(page.locator('#account-logout')).toBeHidden();
  await expect(page.locator('#account-login')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), namespace + ':auth')).toBeNull();
});

test('a sign-out that fails mid-session cuts the session off from the account until the retry succeeds', async ({ page }) => {
  const server = await backend(page);
  await page.goto('/v2/session.html');
  await page.locator('#decks').getByRole('link', { name: new RegExp(PREVIEW_DECK.title) }).click();
  await page.locator('#learnNew').click();
  await expect(page.locator('#progress')).toContainText('Задание 1 из');
  await expect.poll(async () => (await accountJournal(page)).outbox).toBe(0);
  const before = await accountJournal(page);
  const pushes = server.pushes.length;
  server.logout = 'fail';
  await page.locator('#account-logout').click();
  await expect(page.locator('#account-status')).toHaveText('Не удалось выполнить действие. Попробуйте ещё раз.');
  await expect(page.locator('#account-logout')).toBeVisible();
  // The open card can no longer write into the account the user asked to leave.
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#notice')).not.toBeEmpty();
  await expect(page.locator('#progress')).toContainText('Задание 1 из');
  expect(await accountJournal(page)).toEqual(before);
  expect(server.pushes.length).toBe(pushes);
  server.logout = 'ok';
  await page.locator('#account-logout').click();
  await expect(page.locator('#account-status')).toHaveText('Гость: прогресс хранится только на этом устройстве.');
  await expect(page.locator('#progress')).toBeEmpty();
  expect(await accountJournal(page)).toEqual(before);
});

test('a config for another origin is refused like on environment.html: no hosted mode, no sign-in', async ({ page }) => {
  await backend(page);
  await page.route('**/v2/environment.json*', route => json(route, { ...config, siteUrl: 'http://127.0.0.1:5173/v2/' }));
  await page.goto('/v2/session.html');
  await expect(page.locator('#notice')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#notice')).not.toBeEmpty();
  await expect(page.locator('#account')).toHaveCount(0);
});

test('an unconfigured build keeps the local preview journal and shows no account bar', async ({ page }) => {
  await page.route('**/v2/environment.json*', route => json(route, { schemaVersion: 1, configured: false, environment: 'local' }));
  await page.goto('/v2/gaps.html');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#account')).toHaveCount(0);
});
