import { test, expect } from '@playwright/test';
// R3 (#327): v2 pages are their own documents in the offline cache, never the v1 shell.
test.describe('PWA and v2 pages', () => {
  test.use({ serviceWorkers: 'allow' });
  const controlled = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });

  test('a v2 page registers the worker and reopens offline as itself, with its catalog', async ({ page, context }) => {
    await page.goto('/v2/session.html');
    await expect(page.locator('#decks li a').first()).toBeVisible();
    await controlled(page);
    await page.reload(); // now through the worker: the page, modules and catalog are cached
    await expect(page.locator('#decks li a').first()).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#title')).toHaveText('Слова');
    await expect(page.locator('#decks li a').first()).toBeVisible();
    // Retired routes also continue on the v2 offline home.
    await page.goto('/de').catch(() => {});
    await expect(page.locator('#title')).toHaveText('Сегодня');
    await context.setOffline(false);
  });

  test('with the v2 entry an offline visit to a v1 route continues on the cached v2 home', async ({ page, context }) => {
    await page.goto('/v2/today.html');
    await controlled(page);
    expect(await page.evaluate(async () => !!(await caches.match('/v2/today')))).toBe(true);
    await context.setOffline(true);
    await page.goto('/de/words').catch(() => {});
    await expect(page).toHaveURL(/\/v2\/today$/);
    await expect(page.locator('#title')).toHaveText('Сегодня');
    await context.setOffline(false);
  });

  test('an installable browser gets the install banner once, in the page language, until dismissed', async ({ page }) => {
    await page.goto('/v2/today.html');
    await expect(page.locator('#site-nav')).toBeVisible(); // mounted together with the install listener
    await page.evaluate(() => { const event = new Event('beforeinstallprompt', { cancelable: true }); window.dispatchEvent(event); });
    const banner = page.locator('#install-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.install-accept')).toHaveText('Установить');
    await page.selectOption('#language', 'en');
    await expect(banner.locator('.install-accept')).toHaveText('Install');
    await banner.locator('.install-dismiss').click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#site-nav')).toBeVisible();
    await page.evaluate(() => { window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })); });
    await expect(page.locator('#install-banner')).toHaveCount(0);
  });
});
