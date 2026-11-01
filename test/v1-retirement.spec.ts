import { test, expect } from '@playwright/test';

for (const path of ['/', '/de', '/de/words/a1/lernen', '/de-trainer/de/words']) {
  test(`obsolete entry ${path} opens only v2`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(path);
    await expect(page).toHaveURL(/\/v2\/today\.html$/);
    await expect(page.locator('#decks li').first()).toBeVisible();
    // v1 runtime files lived at the site root; v2 has its own `/v2/core/progress.js`.
    expect(requests.some(path => /^(\/de-trainer)?\/(main|router|supabase|progress|srs)\.js$|\/pages\//.test(path))).toBe(false);
  });
}

test.describe('old installation retirement', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a controlled direct v2 entry removes the old worker and cache before boot', async ({ page }) => {
    await page.goto('/v2/session.html');
    await expect(page.locator('#decks li').first()).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      await (await caches.open('drillcards-2.47.0')).put('/main.js', new Response('old runtime'));
      await (await caches.open('another-app')).put('/keep', new Response('keep'));
    });
    await page.reload();
    await expect(page.locator('#decks li').first()).toBeVisible();
    await expect.poll(() => page.evaluate(async () => ({
      legacyWorkers: (await navigator.serviceWorker.getRegistrations()).filter(r => !r.active?.scriptURL.includes('app=v2')).length,
      controlled: !!navigator.serviceWorker.controller?.scriptURL.includes('app=v2'),
      legacyCaches: (await caches.keys()).filter(key => key.startsWith('drillcards-') && !key.startsWith('drillcards-v2-')),
      otherCache: await caches.has('another-app'),
    }))).toEqual({ legacyWorkers: 0, controlled: true, legacyCaches: [], otherCache: true });
  });
});
