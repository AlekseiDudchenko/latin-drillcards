import { test, expect, type Page } from '@playwright/test';
import { PREVIEW_CATALOG_VERSION, PREVIEW_DECK, PREVIEW_WORDS } from '../src/client/v2/preview-catalog.js';

// The Today home: goal, queues, the unfinished session and the way into a deck, over a two-deck stub catalog.
const OFFICE = { id: 'office', title: 'Büro', wordIds: ['tisch', 'lampe'] };
test.beforeEach(async ({ page }) => {
  const words = (deck: { readonly wordIds: readonly string[] }) => PREVIEW_WORDS.filter(word => deck.wordIds.includes(word.id));
  const files: Record<string, unknown> = {
    'index.json': { catalogVersion: PREVIEW_CATALOG_VERSION, decks: [PREVIEW_DECK, OFFICE] },
    [`deck-${PREVIEW_DECK.id}.json`]: { catalogVersion: PREVIEW_CATALOG_VERSION, deck: PREVIEW_DECK, words: words(PREVIEW_DECK) },
    'deck-office.json': { catalogVersion: PREVIEW_CATALOG_VERSION, deck: OFFICE, words: words(OFFICE) },
  };
  await page.route('**/v2/catalog/*', route => {
    const body = files[new URL(route.request().url()).pathname.split('/').pop()!];
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
  });
});
const sections = (page: Page) => page.getByRole('navigation', { name: 'Разделы' });
const progress = (page: Page) => page.locator('#progress');

test('a new guest sees an empty goal, new words in the first deck, nothing to review and every deck', async ({ page }) => {
  await page.goto('/v2/today.html');
  await expect(page.locator('#title')).toHaveText('Сегодня');
  await expect(sections(page).getByRole('link', { name: 'Сегодня' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#goalValue')).toHaveText('0');
  await expect(page.locator('#goalNote')).toHaveText('осталось 25');
  await expect(page.locator('#streakValue')).toHaveText('0 дней');
  await expect(page.locator('#freshLabel')).toHaveText('Новые слова · колода Zuhause');
  await expect(page.locator('#freshValue')).toHaveText('8 доступно');
  await expect(page.locator('#dueValue')).toHaveText('—');
  await expect(page.locator('#dueNote')).toHaveText('Пока нечего повторять');
  await expect(page.locator('#dueAction')).toBeHidden();
  await expect(page.locator('#continue')).toBeHidden();
  await expect(page.locator('#decks li')).toHaveCount(2);
  await expect(page.locator('#decks a[data-focus=true]')).toContainText('Zuhause');
  await expect(page.locator('#practiceLinks a')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Learn new leads into the deck screen; the unfinished session is offered on Today, then finished from there', async ({ page }) => {
  await page.goto('/v2/today.html');
  await page.locator('#freshAction').click();
  await expect(page).toHaveURL(/\/v2\/session\.html#deck=preview-home$/);
  await page.locator('#learnNew').click();
  await expect(progress(page)).toHaveText('Задание 1 из 35');

  await sections(page).getByRole('link', { name: 'Сегодня' }).click();
  await expect(page).toHaveURL(/\/v2\/today\.html$/);
  await expect(page.locator('#continue')).toBeVisible();
  await expect(page.locator('#continueLine')).toHaveText('Zuhause · задание 1 из 35');
  await expect(page.locator('#freshValue')).toHaveText('7 доступно');
  await page.locator('#continueFinish').click();
  await expect(page.locator('#continue')).toBeHidden();
  await expect(page.locator('#notice')).toBeEmpty();
});

test('answers given today fill the goal; the section bar and the page follow the interface language', async ({ page }) => {
  await page.goto('/v2/session.html#deck=preview-home');
  await page.locator('#learnNew').click();
  await expect(progress(page)).toHaveText('Задание 1 из 35');
  for (let i = 0; i < 5; i++) {
    const before = await progress(page).textContent();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(progress(page)).not.toHaveText(before!);
  }
  await page.locator('.dc-choice span').first().click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText(/^(Правильно|Не совсем)$/);

  await page.goto('/v2/today.html');
  await expect(page.locator('#goalValue')).toHaveText('1');
  await expect(page.locator('#goalNote')).toHaveText('осталось 24');
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#title')).toHaveText('Today');
  await expect(page.locator('#goalNote')).toHaveText('24 to go');
  await expect(sections(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Practice' })).toBeVisible();
  await page.locator('#language').selectOption('ru');
});
