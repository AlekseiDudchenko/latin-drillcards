import { test, expect, type Page } from '@playwright/test';

// M8 (#340) user paths on /v2/level-test.html: blocks and the 70 % threshold, early finish, boundary
// results, the stored result on the home screen, explicit Next across language switches,
// Stop and reload, keyboard, a phone screen and RU/EN/DE. The dataset is a 40-question slice of the
// committed one (10 per level), so every run asks exactly these questions.
type Option = { id: string; ru: string; en: string };
type Item = { id: string; content: { level: string; prompt: { text: string }; options: Option[]; correctOptionId: string } };
let dataset: { items: Item[] };
let byPrompt: Map<string, Item>;
test.beforeAll(async ({ request }) => {
  const full = await (await request.get('/data/items/level-test.json')).json() as { items: Item[] };
  const seen = new Set<string>();
  const items = ['a1', 'a2', 'b1', 'b2'].flatMap(level => full.items.filter(item => item.content.level === level &&
    !seen.has(item.content.prompt.text) && seen.add(item.content.prompt.text)).slice(0, 10));
  dataset = { ...full, items };
  byPrompt = new Map(items.map(item => [item.content.prompt.text, item]));
});
test.beforeEach(async ({ page }) => {
  await page.route('**/data/items/level-test.json', route => route.fulfill({ json: dataset }));
});

const progress = (page: Page) => page.locator('#progress');
const status = (page: Page) => page.locator('.dc-status');
async function shown(page: Page): Promise<Item> {
  return byPrompt.get((await page.locator('.dc-prompt').textContent())!)!;
}
/** Answer the shown question right or wrong, by mouse (default) or by digit + Enter. */
async function answer(page: Page, correct: boolean, { keyboard = false, lang = 'ru' as 'ru' | 'en' } = {}) {
  const item = await shown(page);
  const option = item.content.options.find(o => (o.id === item.content.correctOptionId) === correct)!;
  if (keyboard) {
    const labels = await page.locator('.dc-choice span').allTextContents();
    await page.keyboard.press(String(labels.indexOf(option[lang]) + 1));
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('radio', { name: option[lang], exact: true }).check();
    await page.getByRole('button', { name: /Проверить|Check|Prüfen/ }).click();
  }
  await expect(status(page)).toHaveText(correct ? /Верно|Correct|Richtig/ : /Неверно|Wrong|Falsch/);
}
/** Answer a block, then explicitly advance after every stored answer. */
async function block(page: Page, correct: number, startAt: number, options: { keyboard?: boolean; last?: boolean } = {}) {
  for (let i = 0; i < 10; i++) {
    await answer(page, i < correct, options);
    if (options.keyboard) await page.keyboard.press('Enter');
    else await page.getByRole('button', { name: /^(Дальше|Next|Weiter)$/ }).click();
    if (i < 9 || !options.last) await expect(progress(page)).toContainText(`${startAt + i + 1} /`);
  }
}
type Journal = { facts: { kind: string; intent: string; target: string; itemId: string }[]; projections: number; outbox: number;
  sessions: { status: string; taskIndex: number }[] };
const journal = (page: Page): Promise<Journal> => page.evaluate(async () => {
  const path = '/v2/storage/learning-db.js';
  const { LearningDatabase } = await import(path);
  const db = await LearningDatabase.open();
  const scope = await db.scope({ kind: 'guest', id: localStorage.getItem('dc_v2_preview_guest') },
    { dataEpoch: 'preview-1', epochStartedAt: '2026-10-01T00:00:00.000Z' });
  const data = await scope.snapshot(); db.close();
  return { facts: data.facts.map((f: { event: { kind: string; intent: string; target: { kind: string; itemId: string } } }) =>
    ({ kind: f.event.kind, intent: f.event.intent, target: f.event.target.kind, itemId: f.event.target.itemId })),
    projections: data.projections.length, outbox: data.outbox.length,
    sessions: data.sessions.map((s: { state: { status: string; taskIndex: number } }) => ({ status: s.state.status, taskIndex: s.state.taskIndex })) };
});

test('a failed first block ends the test early; the result is stored and shown on the home screen without word progress', async ({ page }) => {
  await page.goto('/v2/level-test.html');
  await expect(page.locator('#intro-text')).toContainText('70 %');
  await page.getByRole('button', { name: 'Начать тест' }).click();
  await expect(progress(page)).toHaveText('Вопрос 1 / 40 · Уровень A1');
  await expect(page.getByRole('heading', { name: 'Выберите перевод' })).toBeVisible();
  await block(page, 6, 1, { last: true });
  await expect(page.locator('#resultTitle')).toHaveText('Ваш результат');
  await expect(page.locator('#resultLevel')).toHaveText('≈ A1');
  await expect(page.locator('#resultNote')).toHaveText('Тест остановлен после первого блока ниже 70 %.');
  await expect(page.locator('.dc-level-block')).toHaveCount(1);
  await expect(page.locator('.dc-level-block')).toContainText('6/10 · не пройден');
  await expect(page.getByRole('link', { name: 'Начать с A1' })).toHaveAttribute('href', './session.html#deck=a1');
  const data = await journal(page);
  expect(data.facts).toHaveLength(10);
  expect(data.facts.every(f => f.kind === 'answer' && f.intent === 'assessment' && f.target === 'assessment')).toBe(true);
  expect(data.projections).toBe(0); // no WordProgress from a test
  expect(data.outbox).toBe(10);     // the shared outbox/SyncService carries them, no page-own queue
  expect(data.sessions).toEqual([{ status: 'abandoned', taskIndex: 9 }]);
  // The result survives a reload, and the home screen shows it with the recommended deck.
  await page.reload();
  await expect(page.locator('#lastResult')).toContainText('Последний результат: ≈ A1');
  await page.goto('/v2/session.html');
  await expect(page.locator('#levelResult')).toHaveText('Тест уровня: ≈ A1. Рекомендуем начать с A1.');
  await page.locator('#levelResult a').click();
  await expect(page).toHaveURL(/#deck=a1$/);
  await page.goto('/v2/session.html');
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Прогресс' }).click();
  await page.locator('.dc-hub-list').getByRole('link', { name: 'Тест уровня' }).click();
  await expect(page).toHaveURL(/level-test\.html$/);
});

test('7/10 passes into the next block (keyboard only); failing A2 recommends A2', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/v2/level-test.html');
  await page.getByRole('button', { name: 'Начать тест' }).click();
  await expect(progress(page)).toHaveText('Вопрос 1 / 40 · Уровень A1');
  await block(page, 7, 1, { keyboard: true });
  await expect(progress(page)).toHaveText('Вопрос 11 / 40 · Уровень A2');
  await block(page, 0, 11, { keyboard: true, last: true });
  await expect(page.locator('#resultLevel')).toHaveText('≈ A1');
  await expect(page.locator('.dc-level-block')).toHaveText([/A1.*7\/10 · пройден/, /A2.*0\/10 · не пройден/]);
  await expect(page.getByRole('link', { name: 'Начать с A2' })).toBeVisible();
  expect((await journal(page)).facts).toHaveLength(20);
});

test('passing every block gives B2+ and recommends B2', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/v2/level-test.html');
  await page.getByRole('button', { name: 'Начать тест' }).click();
  for (const [index, correct] of [10, 7, 8, 7].entries()) await block(page, correct, index * 10 + 1, { last: index === 3 });
  await expect(page.locator('#resultLevel')).toHaveText('≈ B2+');
  await expect(page.locator('#resultNote')).toHaveText('');
  await expect(page.locator('.dc-level-block')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Начать с B2' })).toBeVisible();
  const data = await journal(page);
  expect(data.facts).toHaveLength(40); expect(data.sessions).toEqual([{ status: 'completed', taskIndex: 40 }]);
});

test('feedback waits for Next across language switches, and Stop preserves the answer', async ({ page }) => {
  await page.goto('/v2/level-test.html');
  await page.getByRole('button', { name: 'Начать тест' }).click();
  await answer(page, true);
  // Both language switches preserve feedback until Next is requested.
  await page.locator('#language').selectOption('en');
  await page.locator('#translation').selectOption('en');
  await expect(progress(page)).toHaveText('Question 1 / 40 · Level A1');
  await page.waitForTimeout(1600);
  await expect(progress(page)).toHaveText('Question 1 / 40 · Level A1');
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(progress(page)).toHaveText('Question 2 / 40 · Level A1');
  const item = await shown(page);
  expect((await page.locator('.dc-choice span').allTextContents()).sort()).toEqual(item.content.options.map(o => o.en).sort());
  // Stop from feedback ends the run without a result and keeps the saved answer.
  await answer(page, false, { lang: 'en' });
  await page.getByRole('button', { name: 'Stop the test' }).click();
  await expect(page.locator('#resultLevel')).toHaveText('The last test was stopped before the end: no result.');
  await page.waitForTimeout(1800);
  await expect(page.locator('#result')).toBeVisible();
  const data = await journal(page);
  expect(data.facts).toHaveLength(2);
  expect(data.sessions).toEqual([{ status: 'abandoned', taskIndex: 1 }]);
  await page.goto('/v2/session.html');
  await expect(page.locator('#levelResult')).toBeHidden();
});

test('reload in the middle of a block continues the same run without asking an answered question again', async ({ page }) => {
  await page.goto('/v2/level-test.html');
  await page.getByRole('button', { name: 'Начать тест' }).click();
  for (let i = 0; i < 3; i++) { await answer(page, true); await page.keyboard.press('Enter'); await expect(progress(page)).toContainText(`Вопрос ${i + 2} /`); }
  const fourth = await shown(page);
  await answer(page, true);
  await page.reload(); // a stored answer remains in feedback until Next
  await expect(page.locator('#test')).toBeVisible();
  await expect(progress(page)).toHaveText('Вопрос 4 / 40 · Уровень A1');
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.getByRole('button', { name: 'Дальше', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(progress(page)).toHaveText('Вопрос 5 / 40 · Уровень A1');
  expect((await shown(page)).id).not.toBe(fourth.id);
  // A selection before a reload is a draft only; the question stays unanswered.
  const fifth = await shown(page);
  await page.getByRole('radio').first().check();
  await page.reload();
  await expect(progress(page)).toHaveText('Вопрос 5 / 40 · Уровень A1');
  expect((await shown(page)).id).toBe(fifth.id);
  const data = await journal(page);
  expect(data.facts.map(f => f.itemId)).toHaveLength(4);
  expect(new Set(data.facts.map(f => f.itemId)).size).toBe(4);
  expect(data.sessions).toEqual([{ status: 'presenting', taskIndex: 4 }]);
  await page.locator('#language').selectOption('de');
  await expect(progress(page)).toHaveText('Frage 5 / 40 · Niveau A1');
  await expect(page.getByRole('button', { name: 'Test abbrechen' })).toBeVisible();
  await expect(page.locator('#keyboard')).toHaveText('1–4 wählen · Enter prüfen, dann weiter');
});

test('phone screen: one column of options, no horizontal scroll, tap to answer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/v2/level-test.html');
  await page.getByRole('button', { name: 'Начать тест' }).click();
  await expect(page.locator('.dc-choice')).toHaveCount(4);
  const boxes = await page.locator('.dc-choice').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
  expect(new Set(boxes).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await answer(page, true);
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(progress(page)).toHaveText('Вопрос 2 / 40 · Уровень A1');
});
