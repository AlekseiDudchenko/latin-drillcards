import { test, expect, type Page } from '@playwright/test';

// #420: "Скачать приложение" in the footer opens the browser's install dialog when it offers one, the install guide otherwise.
const footer = (page: Page) => page.getByRole('contentinfo');
const installLink = (page: Page) => footer(page).getByRole('link', { name: 'Скачать приложение' });
/** What Chrome, Edge and Android do when the app is installable; `prompt()` calls are counted on the window. */
const offerInstall = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { prompts: number }; w.prompts = 0;
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }),
    { prompt: async () => { w.prompts += 1; }, userChoice: Promise.resolve({ outcome: 'accepted' }) }));
});
const prompts = (page: Page) => page.evaluate(() => (window as unknown as { prompts?: number }).prompts ?? 0);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('without an install offer the footer link opens the guide, this device first, in the interface language', async ({ page }) => {
  await page.goto('/v2/today.html');
  await expect(installLink(page)).toHaveAttribute('href', './install.html');
  await installLink(page).click();
  await expect(page).toHaveURL(/\/v2\/install\.html$/);
  await expect(page.locator('#title')).toHaveText('Скачать приложение');
  await expect(page.locator('#install')).toBeHidden();
  const cards = page.locator('.dc-install-platform');
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toHaveAttribute('data-platform', 'desktop');
  await expect(cards.first().getByRole('heading')).toHaveText('Компьютер: Chrome и Edge Ваше устройство');
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#title')).toHaveText('Get the app');
  await expect(footer(page).getByRole('link', { name: 'Get the app' })).toBeVisible();
  await expect(cards.first().locator('li').first()).toHaveText('Open Latin DrillCards in Chrome or Edge.');
});

test('with an install offer the footer link opens the browser dialog, also after the banner was dismissed', async ({ page }) => {
  await page.goto('/v2/today.html');
  await page.evaluate(() => localStorage.setItem('install_dismissed', '1'));
  await page.reload();
  await expect(installLink(page)).toBeVisible(); // mounted together with the install listener
  await offerInstall(page);
  await expect(page.locator('#install-banner')).toHaveCount(0);
  await installLink(page).click();
  await expect.poll(() => prompts(page)).toBe(1);
  await expect(page).toHaveURL(/\/v2\/today\.html$/);
  // The browser offers its dialog once per page: afterwards the link leads to the guide.
  await installLink(page).click();
  await expect(page).toHaveURL(/\/v2\/install\.html$/);
});

test('the banner and the footer link share one offer: installing from the footer closes the banner for good', async ({ page }) => {
  await page.goto('/v2/practice.html');
  await expect(installLink(page)).toBeVisible();
  await offerInstall(page);
  await expect(page.locator('#install-banner')).toBeVisible();
  await installLink(page).click();
  await expect(page.locator('#install-banner')).toHaveCount(0);
  await expect.poll(() => prompts(page)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('install_dismissed'))).toBe('1');
});

test('the guide shows the browser’s install button while the browser offers it', async ({ page }) => {
  await page.goto('/v2/install.html');
  await expect(footer(page)).toBeVisible();
  await expect(page.locator('#install')).toBeHidden();
  await offerInstall(page);
  await expect(page.locator('#install')).toHaveText('Установить');
  await page.locator('#install').click();
  await expect.poll(() => prompts(page)).toBe(1);
  await expect(page.locator('#install')).toBeHidden();
});

test('inside the installed app the footer has no install link and the guide says it is installed', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query } as MediaQueryList : original(query);
  });
  await page.goto('/v2/today.html');
  await expect(footer(page)).toBeVisible();
  await expect(installLink(page)).toHaveCount(0);
  await page.goto('/v2/install.html');
  await expect(page.locator('#installed')).toHaveText('Приложение уже установлено: вы открыли его с главного экрана.');
  await offerInstall(page);
  await expect(page.locator('#install')).toBeHidden();
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the guide starts with the iPhone steps and fits the screen', async ({ page }) => {
    await page.goto('/v2/today.html');
    await installLink(page).click();
    await expect(page).toHaveURL(/\/v2\/install\.html$/);
    const first = page.locator('.dc-install-platform').first();
    await expect(first).toHaveAttribute('data-platform', 'ios');
    await expect(first.locator('li').nth(2)).toHaveText('Выберите «На экран „Домой“» и нажмите «Добавить».');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
