import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// #408: the site footer on every v2 page, the legal pages it links to, and the version of the running build.
const VERSION = readFileSync('VERSION', 'utf8').trim();
const footer = (page: Page) => page.getByRole('contentinfo');
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('every v2 page ends with the footer: sections, contact, legal pages, author and the build version', async ({ page }) => {
  for (const name of ['today', 'session', 'practice', 'progress', 'sentences', 'privacy', 'terms']) {
    await page.goto(`/v2/${name}.html`);
    await expect(footer(page), name).toBeVisible();
    await expect(footer(page).locator('.dc-footer-version'), name).toHaveText(`Версия ${VERSION}`);
  }
  await page.goto('/v2/practice.html');
  const links = footer(page).getByRole('link');
  for (const [name, href] of [['Сегодня', './today.html'], ['Слова', './session.html'], ['Практика', './practice.html'],
    ['Прогресс', './progress.html'], ['Политика конфиденциальности', './privacy.html'], ['Условия использования', './terms.html'],
    ['Написать нам', 'mailto:alexey.dudchenko@gmail.com'], ['Latin DrillCards', './today.html']]) await expect(links.filter({ hasText: name }).first()).toHaveAttribute('href', href);
  for (const name of ['Aleksei Dudchenko']) {
    await expect(footer(page).getByRole('link', { name })).toHaveAttribute('target', '_blank');
    await expect(footer(page).getByRole('link', { name })).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(footer(page)).toContainText(`© ${new Date().getFullYear()} Latin DrillCards`);
});

test('the footer follows the interface language', async ({ page }) => {
  await page.goto('/v2/practice.html');
  // The footer is mounted after the page script has bound the language picker.
  await expect(footer(page)).toBeVisible();
  await page.locator('#language').selectOption('en');
  await expect(footer(page).getByRole('heading', { name: 'Legal' })).toBeVisible();
  await expect(footer(page).getByRole('link', { name: 'Privacy policy' })).toBeVisible();
  await expect(footer(page).locator('.dc-footer-version')).toHaveText(`Version ${VERSION}`);
  await page.locator('#language').selectOption('de');
  await expect(footer(page).getByRole('link', { name: 'Nutzungsbedingungen' })).toBeVisible();
  await expect(footer(page).getByRole('link', { name: 'Wörter' })).toBeVisible();
});

test('the legal pages open from the footer, link to each other and switch language', async ({ page }) => {
  await page.goto('/v2/today.html');
  await footer(page).getByRole('link', { name: 'Условия использования' }).click();
  await expect(page).toHaveURL(/\/v2\/terms\.html$/);
  await expect(page.locator('#title')).toHaveText('Условия использования');
  await expect(page.locator('#legal h2')).toHaveCount(8);
  await page.locator('#legal').getByRole('link', { name: 'Политику конфиденциальности' }).click();
  await expect(page).toHaveURL(/\/v2\/privacy\.html$/);
  await expect(page.locator('#legal')).toContainText('Google API Services User Data Policy');
  await expect(page.locator('#legal').getByRole('link', { name: 'alexey.dudchenko@gmail.com' }).first()).toHaveAttribute('href', 'mailto:alexey.dudchenko@gmail.com');
  await page.locator('#language').selectOption('de');
  await expect(page.locator('#title')).toHaveText('Datenschutzerklärung');
  await expect(page).toHaveTitle('Latin DrillCards · Datenschutzerklärung');
  await expect(page.locator('#legal h2').first()).toHaveText('Ohne Konto');
});

test('on a phone the footer stacks without horizontal scrolling and stays at the bottom of a short page', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const name of ['today', 'practice', 'privacy']) {
    await page.goto(`/v2/${name}.html`);
    await expect(footer(page)).toBeVisible();
    expect(await fitsWidth(page), name).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/v2/progress.html');
  await expect(footer(page)).toBeVisible();
  const bottom = await footer(page).evaluate(element => element.getBoundingClientRect().bottom);
  expect(Math.round(bottom)).toBe(1400);
});

test('the legal pages keep the section bar and the footer when the learning store cannot open', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get: () => { throw new Error('blocked'); } }); });
  await page.goto('/v2/privacy.html');
  await expect(page.locator('#legal h2').first()).toBeVisible();
  await expect(page.locator('#site-nav')).toBeVisible();
  await expect(footer(page).getByRole('link', { name: 'Условия использования' })).toBeVisible();
});

test('the static footer of the site entry is replaced by the full one', async ({ page }) => {
  await page.goto('/v2/today.html');
  await expect(footer(page).locator('.dc-footer-version')).toBeVisible();
  await expect(page.locator('footer')).toHaveCount(1);
});
