import { test, expect, type Page } from '@playwright/test';

// M5 (#337) user paths on /v2/konjunktiv2.html: the four trainers, text and token modes with each
// trainer's own check rule, a mode switch that keeps the draft, hints and alternatives, retries,
// prev/next without lost or doubled answers, statistics, TTS, keyboard, RU/EN/DE and a phone screen.
// The committed datasets are served as they are (85 sentences).
test.beforeEach(async ({ page }) => {
  // Recorded speech: a German voice that "finishes" at once.
  await page.addInitScript(() => {
    const spoken: string[] = []; (window as unknown as { spoken: string[] }).spoken = spoken;
    const voice = { lang: 'de-DE', name: 'Test', default: true, localService: true, voiceURI: 'test' };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [voice], addEventListener() {}, removeEventListener() {}, cancel() {}, pending: false, speaking: false,
      speak(u: { text: string; onend?: () => void }) { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); },
    } });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class { lang = ''; voice: unknown; onend?: () => void; onerror?: () => void; constructor(public text: string) {} };
  });
});

const prompt = (page: Page) => page.locator('.dc-prompt');
const status = (page: Page) => page.locator('.dc-status');
const input = (page: Page) => page.locator('.dc-text input');
const check = (page: Page) => page.locator('.dc-card button[type=submit]');
const next = (page: Page) => page.getByRole('button', { name: 'Дальше', exact: true });
const chip = (page: Page, zone: 'pool' | 'answer', text: string) =>
  page.locator(`[data-token-zone=${zone}] [data-token-id]`).filter({ hasText: new RegExp(`^${text}$`) });
const placed = (page: Page) => page.locator('[data-token-zone=answer] [data-token-id]');
async function events(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('drillcards-learning-v2');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction('partitions').objectStore('partitions').getAll();
      req.onsuccess = () => { resolve((req.result as { facts: unknown[] }[]).reduce((n, p) => n + p.facts.length, 0)); open.result.close(); };
    };
  }));
}
async function useMode(page: Page, mode: 'Ввод' | 'Слова') {
  await page.getByRole('radio', { name: mode }).check();
  await expect(page.getByRole('radio', { name: mode })).toBeChecked();
}

test('text mode: a typed answer is saved once with hint and statistics, and survives reload and Next/Previous', async ({ page }) => {
  await page.goto('/v2/konjunktiv2.html');
  await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
  await expect(page.locator('.dc-card h2')).toHaveText('Поставь глагол в Konjunktiv II.');
  await expect(page.locator('#itemStats')).toHaveText('Это предложение: ещё без ответа');
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeDisabled();
  await input(page).fill('Hätte!');
  await check(page).click();
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('.dc-k2-hint')).toHaveText('Подсказка: haben → hätte');
  await expect(page.locator('#itemStats')).toHaveText('Это предложение: ответов 1, с первой попытки 1');
  await expect(page.locator('#trainerStats li[data-mode=text]')).toHaveText('Ввод: отвечено 1 из 25, точность 100%');
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeEnabled();
  await page.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual(['Ich hätte gern mehr Zeit.']);
  expect(await events(page)).toBe(1);
  await page.reload();
  await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
  await expect(status(page)).toHaveText('Верно!');
  await expect(input(page)).toHaveValue('Hätte!');
  await next(page).click();
  await expect(prompt(page)).toHaveText('Wenn er (kommen) ___, wäre ich froh.');
  // Alternative answer of v1 ("kommen würde") is accepted and the other accepted form is listed.
  await input(page).fill('kommen würde');
  await check(page).click();
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('.dc-k2-alternatives')).toHaveText('Тоже верно: kommen würde');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
  await expect(input(page)).toHaveValue('');
  expect(await events(page), 'Previous wrote no event').toBe(2);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(prompt(page)).not.toHaveText('Ich (haben) ___ gern mehr Zeit.');
  expect(await events(page)).toBe(2);
});

test('switching the mode keeps the current answer in both directions and writes nothing', async ({ page }) => {
  await page.goto('/v2/konjunktiv2.html#trainer=conditional');
  await expect(page.locator('#trainer')).toHaveValue('conditional');
  await expect(prompt(page)).toHaveText('Wenn ich reich (sein) ___, (reisen) ___ ich um die Welt.');
  await input(page).fill('wäre, würde');
  await useMode(page, 'Слова');
  await expect(page.locator('.dc-card h2')).toHaveText('Расставь обе формы Konjunktiv II по порядку.');
  await expect(placed(page)).toHaveText(['wäre', 'würde']);
  await chip(page, 'answer', 'würde').click();
  await chip(page, 'pool', 'wären').click();
  await useMode(page, 'Ввод');
  await expect(input(page)).toHaveValue('wäre wären');
  await useMode(page, 'Слова');
  await expect(placed(page)).toHaveText(['wäre', 'wären']);
  expect((await page.locator('[data-token-zone=pool] [data-token-id]').allTextContents()).sort()).toEqual(['hätte', 'könnte', 'wurde', 'würde']);
  expect(await events(page)).toBe(0);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Слова' })).toBeChecked();
  await expect(prompt(page)).toHaveText('Wenn ich reich (sein) ___, (reisen) ___ ich um die Welt.');
});

test('conditional: typed forms need the comma, chips do not; Try again is not counted as independent', async ({ page }) => {
  await page.goto('/v2/konjunktiv2.html#trainer=conditional');
  await input(page).fill('wäre würde');
  await input(page).press('Enter');
  await expect(status(page)).toHaveText('Не совсем. Правильно: wäre, würde');
  await expect(page.locator('.dc-k2-hint')).toHaveText('Подсказка: sein → wäre, reisen → würde … reisen');
  await expect(next(page)).toBeFocused();
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await expect(input(page)).toHaveValue('');
  await input(page).fill('wäre,würde');
  await input(page).press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('#itemStats')).toHaveText('Это предложение: ответов 2, с первой попытки 0');
  expect(await events(page)).toBe(2);
  // Chips: the same two forms without a comma; the wrong order is wrong.
  await useMode(page, 'Слова');
  await expect(page.locator('#notice')).toHaveText('Новый режим начнётся со следующего предложения.');
  await next(page).click();
  await expect(prompt(page)).toHaveText('Wenn ich mehr Zeit (haben) ___, (lernen) ___ ich Klavier.');
  await chip(page, 'pool', 'würde').click(); await chip(page, 'pool', 'hätte').click();
  await check(page).click();
  await expect(status(page)).toHaveText('Не совсем. Правильно: hätte, würde');
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await chip(page, 'pool', 'hätte').click(); await chip(page, 'pool', 'würde').click();
  await check(page).click();
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('#trainerStats li[data-mode=tokens]')).toHaveText('Слова: отвечено 1 из 20, точность 0%');
  expect(await events(page)).toBe(4);
});

test('all four trainers: their own sentences, task text and check; polite and past with chips', async ({ page }) => {
  await page.goto('/v2/konjunktiv2.html');
  // Wait for the first card: a mode picked before the page has initialised is reset by its first render.
  await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
  await useMode(page, 'Слова');
  await expect(page.locator('[data-token-zone=pool]')).toBeVisible();
  await page.locator('#trainer').selectOption('polite');
  await expect(page).toHaveURL(/#trainer=polite$/);
  await expect(prompt(page)).toHaveText('(Können) ___ Sie mir bitte helfen?');
  await expect(page.locator('.dc-card h2')).toHaveText('Выбери вежливую форму Konjunktiv II.');
  await chip(page, 'pool', 'Könnten').click();
  await check(page).click();
  await expect(status(page)).toHaveText('Верно!');
  await page.locator('#trainer').selectOption('past');
  await expect(prompt(page)).toHaveText('Wenn ich das (wissen) ___, hätte ich anders gehandelt.');
  await chip(page, 'pool', 'gewusst').click(); await chip(page, 'pool', 'hätte').click();
  await check(page).click();
  await expect(status(page)).toHaveText('Верно!');
  await page.locator('#trainer').selectOption('transformation');
  await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
  await page.locator('#trainer').selectOption('conditional');
  await expect(prompt(page)).toHaveText('Wenn ich reich (sein) ___, (reisen) ___ ich um die Welt.');
  expect(await events(page), 'switching trainers wrote no extra event').toBe(2);
});

test('keyboard only: type and Enter, Enter for next, ← previous, → next; tokens with Enter; auto-speak', async ({ page }) => {
  await page.goto('/v2/konjunktiv2.html#trainer=past');
  // Wait for the first card: init resets the auto-speak box from storage, so an earlier check is lost.
  await expect(prompt(page)).toHaveText('Wenn ich das (wissen) ___, hätte ich anders gehandelt.');
  await page.locator('#autoSpeak').check();
  await input(page).focus();
  await page.keyboard.type('gewusst hätte');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken))
    .toEqual(['Wenn ich das gewusst hätte, hätte ich anders gehandelt.']);
  await expect(next(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Wenn sie früher (kommen) ___, hätten wir zusammen essen können.');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowLeft');
  await expect(prompt(page)).toHaveText('Wenn ich das (wissen) ___, hätte ich anders gehandelt.');
  // As in v1 the text field takes focus on a new sentence and keeps its arrow keys; leave it first.
  await expect(input(page)).toBeFocused();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(prompt(page)).not.toHaveText('Wenn ich das (wissen) ___, hätte ich anders gehandelt.');
  await useMode(page, 'Слова');
  const shown = await prompt(page).textContent();
  expect(shown).toContain('___');
  await chip(page, 'pool', (await page.locator('[data-token-zone=pool] [data-token-id]').first().textContent())!).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-token-zone=answer] [data-token-id]')).toHaveCount(1);
});

test('interface language switches labels without replacing the task or its draft; phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/v2/konjunktiv2.html');
  await input(page).fill('hät');
  for (const [lang, nextLabel, title] of [['de', 'Prüfen', 'Setze das Verb in den Konjunktiv II.'],
    ['en', 'Check', 'Put the verb in Konjunktiv II form.'], ['ru', 'Проверить', 'Поставь глагол в Konjunktiv II.']] as const) {
    await page.locator('#language').selectOption(lang);
    await expect(page.getByRole('button', { name: nextLabel, exact: true })).toBeVisible();
    await expect(page.locator('.dc-card h2')).toHaveText(title);
    await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
    await expect(input(page)).toHaveValue('hät');
  }
  await useMode(page, 'Слова');
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('radio', { name: 'Wörter' })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#language').selectOption('ru');
});

test('the Practice hub links to the Konjunktiv II page', async ({ page }) => {
  await page.goto('/v2/session.html');
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Практика' }).click();
  await page.locator('.dc-hub-list').getByRole('link', { name: 'Konjunktiv II' }).click();
  await expect(page).toHaveURL(/\/v2\/konjunktiv2\.html$/);
  await expect(prompt(page)).toHaveText('Ich (haben) ___ gern mehr Zeit.');
});
