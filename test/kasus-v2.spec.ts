import { test, expect, type Page } from '@playwright/test';

// M4 (#336): FC07 user paths on the v2 Kasus page: article (ClozeInput), case and question (ChoiceInput) on the
// shared Runner and IndexedDB journal, the highlighted phrase, the explanation, the rule window, keys and RU/EN/DE.
declare global { interface Window { spoken: string[] } }

async function speech(page: Page) {
  await page.addInitScript(() => {
    window.spoken = [];
    const synth = new EventTarget() as EventTarget & Record<string, unknown>;
    synth.getVoices = () => [{ lang: 'de-DE', name: 'de-DE', default: true }];
    synth.cancel = () => {};
    synth.speak = (u: { text: string; onend?: () => void }) => { window.spoken.push(u.text); setTimeout(() => u.onend?.(), 0); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
  });
}
/** The shared preview journal: every stored fact of the guest, as the Runner committed it. */
const journal = (page: Page) => page.evaluate(async () => {
  const path = '/v2/storage/learning-db.js';
  const { LearningDatabase } = await import(path);
  const db = await LearningDatabase.open();
  const scope = await db.scope({ kind: 'guest', id: localStorage.getItem('dc_v2_preview_guest') },
    { dataEpoch: 'preview-1', epochStartedAt: '2026-10-01T00:00:00.000Z' });
  const data = await scope.snapshot(); db.close();
  return { facts: data.facts.map((f: { event: { kind: string; exerciseId: string; target: { datasetId: string; itemId: string }; rawAnswer?: unknown }; evaluation?: { outcome: string } }) =>
    ({ kind: f.event.kind, exerciseId: f.event.exerciseId, datasetId: f.event.target.datasetId, itemId: f.event.target.itemId,
      rawAnswer: f.event.rawAnswer, outcome: f.evaluation?.outcome })), projections: data.projections.length, outbox: data.outbox.length };
});
const progress = (page: Page) => page.locator('#progress');
const status = (page: Page) => page.locator('#card .dc-status');
const dialog = (page: Page) => page.getByRole('dialog');
/** The digit key of an option: options are in a per-task order, so it is read from the card. */
async function key(page: Page, label: string): Promise<string> {
  const labels = await page.locator('#card input[type=radio]').evaluateAll(radios => radios.map(radio => (radio as HTMLInputElement).value));
  const index = labels.indexOf(label);
  expect(index, `${label} in ${labels.join()}`).toBeGreaterThanOrEqual(0);
  return String(index + 1);
}
/** Answer with the keyboard: digit to choose, Enter to check. */
async function answerByKeys(page: Page, label: string) {
  await expect(page.locator('#card input[type=radio]').first()).toBeFocused();
  await page.keyboard.press(await key(page, label));
  await expect(page.locator(`#card input[type=radio][value="${label}"]`)).toBeChecked();
  await page.keyboard.press('Enter');
}
async function start(page: Page, filter: 'Все' | 'Артикль' | 'Падеж' | 'Вопрос' = 'Все') {
  await page.goto('/v2/kasus.html');
  await expect(page.locator('#statsList li')).toHaveCount(3);
  await page.getByRole('radio', { name: filter, exact: true }).check();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(progress(page)).toHaveText(/^Задание 1 из \d+$/);
}

test('all variants: article gap, highlighted case and question, explanation, rule window with its row, keys, previous, reload, statistics', async ({ page }) => {
  await speech(page);
  await start(page);
  await expect(progress(page)).toHaveText('Задание 1 из 10');

  // 1. Article on ClozeInput: the gap is in the sentence; a wrong article shows the right one and why.
  await expect(page.getByRole('heading', { name: 'Какой артикль подходит в пропуск?' })).toBeVisible();
  await expect(page.locator('#card .dc-cloze-sentence')).toHaveText('Ich sehe ___ Mann dort.');
  await expect(page.locator('#after')).toBeHidden();
  await answerByKeys(page, 'dem');
  await expect(status(page)).toHaveText('Неверно. Правильно: den');
  await expect(page.locator('.dc-cloze-results li')).toHaveText(['Пропуск 1 из 1: неверно · Правильный ответ: den']);
  await expect(page.locator('#explanationText')).toHaveText(/^«sehen» — переходный глагол.*der Mann — мужской род: der → den/);
  await expect(page.locator('#translationText')).toHaveText('Я вижу там мужчину.');
  await expect(page.locator('#ruleSummary')).toHaveText('Аккузатив: прямое дополнение (Wen? Was?)');
  await expect(page.locator('#itemStats')).toHaveText('Это предложение: ответов 1, верно с первой попытки 0');
  await expect(page.getByRole('button', { name: 'Дальше' })).toBeFocused();

  // The rule window: the table row of this noun is marked; Esc, ×, Close and the backdrop close it, focus returns.
  const rule = page.getByRole('button', { name: 'Правило' });
  await rule.click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('heading', { name: 'Аккузатив: прямое дополнение' })).toBeVisible();
  await expect(dialog(page).locator('tbody tr')).toHaveCount(4);
  await expect(dialog(page).locator('tr[aria-current=true]')).toHaveCount(1);
  await expect(dialog(page).locator('tr[aria-current=true]')).toContainText('мужской (der) (строка этого задания)derdeneinenkeinen / meinen');
  await expect(dialog(page).getByRole('button', { name: 'Закрыть' }).last()).toBeFocused();
  // Answer keys do nothing while the rule is open (and the card is answered anyway).
  await page.keyboard.press('1'); await page.keyboard.press('ArrowRight');
  await expect(progress(page)).toHaveText('Задание 1 из 10');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(rule).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(dialog(page)).toBeHidden();
  await rule.click();
  await page.mouse.click(5, 5);
  await expect(dialog(page)).toBeHidden();
  expect((await journal(page)).facts).toHaveLength(1);
  await page.getByRole('button', { name: 'Дальше' }).click();

  // 2. Case on ChoiceInput: the phrase is highlighted; a correct answer by keys.
  await expect(progress(page)).toHaveText('Задание 2 из 10');
  await expect(page.getByRole('heading', { name: 'В каком падеже выделенная группа слов?' })).toBeVisible();
  await expect(page.locator('#card .dc-prompt')).toHaveText('Ich sehe den Hund.');
  await expect(page.locator('#card .dc-prompt mark')).toHaveText('den Hund');
  await answerByKeys(page, 'Akkusativ');
  await expect(status(page)).toHaveText('Правильно!');
  await expect(page.locator('#explanationText')).toHaveText(/«den Hund» отвечает на вопрос Wen\? \/ Was\? — поэтому аккузатив/);
  await expect(page.locator('#itemStats')).toHaveText('Это предложение: ответов 1, верно с первой попытки 1');
  await page.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect.poll(() => page.evaluate(() => window.spoken)).toEqual(['Ich sehe den Hund.']);
  // Repeated answer keys after the answer record nothing.
  await page.getByRole('button', { name: 'Дальше' }).focus();
  for (const digit of ['1', '2']) await page.keyboard.press(digit);
  await page.keyboard.press('ArrowRight');

  // 3. Question: the rule row of a feminine/neuter noun; a wrong answer.
  await expect(progress(page)).toHaveText('Задание 3 из 10');
  await expect(page.getByRole('heading', { name: 'На какой вопрос отвечает выделенная группа слов?' })).toBeVisible();
  await expect(page.locator('#card .dc-prompt mark')).toHaveText('den Mann');
  await page.getByRole('radio', { name: 'Was?' }).check();
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(status(page)).toHaveText('Неверно. Правильно: Wen?');
  await expect(page.locator('#explanationText')).toHaveText(/Речь о человеке, поэтому вопрос Wen\?/);

  // Previous: read-only saved answers; the rule window works there too and records nothing.
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.locator('#reviewing')).toHaveText('Просмотр задания 2 (ответ уже сохранён)');
  await expect(page.locator('#card input[type=radio][value=Akkusativ]')).toBeChecked();
  await expect(page.locator('#card input[type=radio][value=Akkusativ]')).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#reviewing')).toHaveText('Просмотр задания 1 (ответ уже сохранён)');
  await expect(page.locator('.dc-cloze-results li')).toHaveText(['Пропуск 1 из 1: неверно · Правильный ответ: den']);
  await page.getByRole('button', { name: 'Правило' }).click();
  await expect(dialog(page).locator('tr[aria-current=true] th')).toContainText('мужской (der)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#reviewing')).toBeHidden();
  await expect(progress(page)).toHaveText('Задание 3 из 10');

  const saved = await journal(page);
  expect(saved.facts).toEqual([
    { kind: 'answer', exerciseId: 'kasus-article', datasetId: 'kasus-a2', itemId: 'ka_art_01', rawAnswer: { 'slot-1': 'dem' }, outcome: 'incorrect' },
    { kind: 'answer', exerciseId: 'kasus-case', datasetId: 'kasus-a2', itemId: 'ka_kas_01', rawAnswer: 'Akkusativ', outcome: 'correct' },
    { kind: 'answer', exerciseId: 'kasus-question', datasetId: 'kasus-a2', itemId: 'ka_frg_01', rawAnswer: 'Was?', outcome: 'incorrect' },
  ]);
  expect(saved.projections).toBe(0);
  expect(saved.outbox).toBe(3);

  // Reload: the same session continues at the saved feedback.
  await page.reload();
  await expect(page.locator('#continueLine')).toHaveText('Все · задание 3 из 10');
  await expect(page.getByRole('button', { name: 'Начать' })).toBeDisabled();
  await page.locator('#continueAction').click();
  await expect(progress(page)).toHaveText('Задание 3 из 10');
  await expect(page.locator('#card input[type=radio][value="Was?"]')).toBeChecked();
  await expect(status(page)).toHaveText('Неверно. Правильно: Wen?');
  await page.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('#summary')).toContainText('Верно: 1 из 10');
  await expect(page.locator('#summary li').first()).toHaveText('Ich sehe den Mann dort. — ошибка');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#statsList li[data-variant=article]')).toHaveText('Артикль: 1 из 80 предложений · верно с первой попытки 0%');
  await expect(page.locator('#statsList li[data-variant=case]')).toHaveText('Падеж: 1 из 22 предложений · верно с первой попытки 100%');
  await expect(page.locator('#statsList li[data-variant=question]')).toHaveText('Вопрос: 1 из 18 предложений · верно с первой попытки 0%');
  expect((await journal(page)).facts).toHaveLength(3);
});

test('a filter keeps one variant; the rule window and the explanation follow RU → EN → DE without new answers; mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await start(page, 'Вопрос');
  // Only question tasks; the first ones are the dataset's question items.
  await expect(page.getByRole('heading', { name: 'На какой вопрос отвечает выделенная группа слов?' })).toBeVisible();
  await expect(page.locator('#card .dc-prompt')).toHaveText('Ich sehe den Mann.');
  await answerByKeys(page, 'Wen?');
  await expect(status(page)).toHaveText('Правильно!');
  await page.keyboard.press('Enter');
  await expect(progress(page)).toHaveText('Задание 2 из 10');
  await expect(page.locator('#card .dc-prompt mark')).toHaveText('dem Mann');
  await answerByKeys(page, 'Wem?');
  await expect(status(page)).toHaveText('Правильно!');
  await page.getByRole('button', { name: 'Правило' }).click();
  await expect(dialog(page).getByRole('heading')).toHaveText(['Глаголы, требующие датива', 'Примеры']);
  await expect(dialog(page).locator('tr[aria-current=true] th')).toContainText('мужской (der)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await dialog(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape');

  // Language: the card, the explanation, the rule summary and the open window switch; no answer is added.
  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Which question does the highlighted phrase answer?' })).toBeVisible();
  await expect(status(page)).toHaveText('Correct!');
  await expect(page.locator('#explanationText')).toHaveText(/^«helfen» calls for the dative/);
  await expect(page.locator('#ruleSummary')).toHaveText(/^Dative/);
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  await expect(progress(page)).toHaveText('Task 2 of 10');
  await page.getByRole('button', { name: 'Rule' }).click();
  await expect(dialog(page).locator('tr[aria-current=true] th')).toContainText('masculine (der)');
  await page.locator('#language').evaluate((select: HTMLSelectElement) => { select.value = 'de'; select.dispatchEvent(new Event('change')); });
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('tr[aria-current=true] th')).toContainText('maskulin (der)');
  await expect(dialog(page).getByRole('button', { name: 'Schließen' }).last()).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Schließen' }).last().click();
  await expect(page.getByRole('heading', { name: 'Auf welche Frage antwortet die markierte Wortgruppe?' })).toBeVisible();
  await expect(status(page)).toHaveText('Richtig!');
  await expect(page.locator('#explanationTitle')).toHaveText('Warum');
  await expect(page.locator('#keyboard')).toHaveText(/^Tasten: 1–4 wählen/);
  // The translation stays in the session's answer language (RU: started in Russian).
  await expect(page.locator('#translationText')).toHaveText('Я помогаю мужчине.');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(progress(page)).toHaveText('Aufgabe 3 von 10');
  await expect(page.getByRole('heading', { name: 'Auf welche Frage antwortet die markierte Wortgruppe?' })).toBeVisible();
  expect((await journal(page)).facts.map((f: { exerciseId: string; itemId: string; outcome?: string }) => [f.exerciseId, f.itemId, f.outcome]))
    .toEqual([['kasus-question', 'ka_frg_01', 'correct'], ['kasus-question', 'ka_frg_02', 'correct']]);
});

test('the Practice hub links to Kasus; an open Kasus session leaves the other family pages alone', async ({ page }) => {
  await start(page, 'Падеж');
  await page.getByRole('radio', { name: 'Akkusativ' }).check();
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(status(page)).toHaveText('Правильно!');
  await page.goto('/v2/session.html');
  await expect(page.locator('#decks li').first()).toBeVisible();
  await expect(page.locator('#continue')).toBeHidden();
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Практика' }).click();
  await expect(page.getByRole('link', { name: /Аккузатив или датив/ })).toHaveAttribute('href', './kasus.html');
  await page.goto('/v2/gaps.html');
  await expect(page.locator('#statsList li')).toHaveCount(2);
  await expect(page.locator('#continue')).toBeHidden();
  await page.goto('/v2/practice.html');
  await page.getByRole('link', { name: /Аккузатив или датив/ }).click();
  await expect(page.locator('#continueLine')).toHaveText('Падеж · задание 1 из 10');
});
