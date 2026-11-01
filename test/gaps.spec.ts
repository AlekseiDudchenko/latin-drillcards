import { test, expect, type Page } from '@playwright/test';

// M3 (#335): FC05/FC06 user paths on the v2 gap page: the shared ClozeInput, Runner and IndexedDB journal,
// the committed datasets, keyboard and mobile use, speech with its fallbacks and RU/EN/DE.
declare global { interface Window { spoken: string[] } }

/** A German voice that records what is spoken; `voices: []` is a device without a German voice. */
async function speech(page: Page, voices: string[] | null = ['de-DE']) {
  await page.addInitScript(voices => {
    window.spoken = [];
    if (voices === null) { delete (window as { speechSynthesis?: unknown }).speechSynthesis; Object.defineProperty(window, 'speechSynthesis', { value: undefined }); return; }
    const synth = new EventTarget() as EventTarget & Record<string, unknown>;
    synth.getVoices = () => voices.map(lang => ({ lang, name: lang, default: true }));
    synth.cancel = () => {};
    synth.speak = (u: { text: string; onend?: () => void }) => { window.spoken.push(u.text); setTimeout(() => u.onend?.(), 0); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
  }, voices);
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
const slot = (page: Page, n: number, total: number) => page.getByRole('group', { name: `Пропуск ${n} из ${total}` });
const check = (page: Page) => page.getByRole('button', { name: 'Проверить' });
const status = (page: Page) => page.locator('.dc-cloze .dc-status');

async function start(page: Page, family: 'relative' | 'passiv', mode: 'select' | 'type', tense = '') {
  await page.goto('/v2/gaps.html');
  await expect(page.locator('#statsList li')).toHaveCount(2);
  await page.locator('#family').selectOption(family);
  await page.getByRole('radio', { name: mode === 'select' ? 'Выбор' : 'Ввод' }).check();
  if (family === 'passiv') await page.locator('#tense').selectOption(tense);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(progress(page)).toHaveText(/^Задание 1 из \d+$/);
}

test('Passiv in select mode: several gaps, chips, hint, rule, linked tenses, translations, speech, previous and reload', async ({ page }) => {
  await speech(page);
  await start(page, 'passiv', 'select');
  await expect(progress(page)).toHaveText('Задание 1 из 10');
  await expect(page.locator('#tenseBadge')).toHaveText('Präs.');
  await expect(page.getByRole('heading', { name: 'Вставьте вспомогательные глаголы пассива' })).toBeVisible();
  await expect(page.locator('.dc-cloze-prompt')).toHaveText('Здание полностью ремонтируется.');
  // The other translation is a toggle; the choice is kept across tasks.
  const english = page.getByRole('button', { name: 'Перевод (EN)' });
  await expect(english).toHaveAttribute('aria-pressed', 'false');
  await english.click();
  await expect(page.locator('p[data-translation=en]')).toHaveText('The building is being completely renovated.');
  // Linked tense variants are listed before answering, without their solutions.
  await expect(page.locator('#variantList li')).toHaveCount(5);
  await expect(page.locator('#variantList')).not.toContainText('wurde komplett');
  await expect(check(page)).toBeDisabled();

  // Wrong chip: graded per slot, the answer only after the hint, the tense rule.
  await slot(page, 1, 1).getByRole('radio', { name: 'wurde' }).check();
  await check(page).click();
  await expect(status(page)).toHaveText('Не совсем');
  await expect(page.locator('.dc-cloze-results li')).toHaveText(['Пропуск 1 из 1: неверно']);
  await expect(page.locator('#explanationText')).toHaveText('Präsens: werden (wird/werden) + Partizip II.');
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await expect(page.locator('#hintAnswer')).toHaveText('Ответ: wird');
  await expect(page.locator('.dc-cloze-results li')).toHaveText(['Пропуск 1 из 1: неверно · Правильный ответ: wird']);
  await expect(page.locator('#variantList')).toContainText('Prät. — Das Gebäude wurde komplett renoviert. (Здание было полностью отремонтировано.)');
  await page.getByLabel('Озвучивать автоматически').check();
  await page.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect.poll(() => page.evaluate(() => window.spoken)).toEqual(['Das Gebäude wird komplett renoviert.']);
  await expect(page.getByRole('button', { name: 'Дальше' })).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).focus();
  await page.keyboard.press('Enter');

  // Keyboard: digits pick a chip, Enter checks; a correct answer is spoken automatically.
  await expect(progress(page)).toHaveText('Задание 2 из 10');
  await expect(page.locator('#tenseBadge')).toHaveText('Prät.');
  await expect(page.locator('p[data-translation=en]')).toBeVisible();
  await slot(page, 1, 1).getByRole('radio', { name: 'wird' }).focus();
  await page.keyboard.press('2');
  await expect(slot(page, 1, 1).getByRole('radio', { name: 'wurde' })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Правильно');
  await expect.poll(() => page.evaluate(() => window.spoken[window.spoken.length - 1])).toBe('Das Gebäude wurde komplett renoviert.');
  await expect(page.getByRole('button', { name: 'Дальше' })).toBeFocused();
  await page.keyboard.press('ArrowRight');

  // Two gaps: Reset clears both; each is graded on its own.
  await expect(progress(page)).toHaveText('Задание 3 из 10');
  await expect(page.locator('#tenseBadge')).toHaveText('Perf.');
  await slot(page, 1, 2).getByRole('radio', { name: 'war' }).check();
  await expect(check(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Очистить ответы' }).click();
  await expect(slot(page, 1, 2).getByRole('radio', { name: 'war' })).not.toBeChecked();
  await expect(slot(page, 1, 2).getByRole('radio', { name: 'wird' })).toBeFocused();
  await slot(page, 1, 2).getByRole('radio', { name: 'ist' }).check();
  await slot(page, 2, 2).getByRole('radio', { name: 'werden' }).check();
  await check(page).click();
  await expect(page.locator('.dc-cloze-results li')).toHaveText(['Пропуск 1 из 2: верно', 'Пропуск 2 из 2: неверно']);

  // Previous shows the saved answers read-only; nothing new is recorded.
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.locator('#reviewing')).toHaveText('Просмотр задания 2 (ответ уже сохранён)');
  await expect(progress(page)).toHaveText('Задание 2 из 10');
  await expect(slot(page, 1, 1).getByRole('radio', { name: 'wurde' })).toBeChecked();
  await expect(slot(page, 1, 1).getByRole('radio', { name: 'wurde' })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#reviewing')).toHaveText('Просмотр задания 1 (ответ уже сохранён)');
  await expect(page.locator('#hintAnswer')).toHaveText('Ответ: wird');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#reviewing')).toHaveText('Просмотр задания 2 (ответ уже сохранён)');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#reviewing')).toBeHidden();
  await expect(progress(page)).toHaveText('Задание 3 из 10');

  const saved = await journal(page);
  expect(saved.facts).toEqual([
    { kind: 'answer', exerciseId: 'gap-select', datasetId: 'passiv-gaps', itemId: 'pg_1_pres', rawAnswer: { 'slot-1': 'wurde' }, outcome: 'incorrect' },
    { kind: 'answer', exerciseId: 'gap-select', datasetId: 'passiv-gaps', itemId: 'pg_1_prat', rawAnswer: { 'slot-1': 'wurde' }, outcome: 'correct' },
    { kind: 'answer', exerciseId: 'gap-select', datasetId: 'passiv-gaps', itemId: 'pg_1_perf', rawAnswer: { 'slot-1': 'ist', 'slot-2': 'werden' }, outcome: 'incorrect' },
  ]);
  expect(saved.projections).toBe(0);

  // Reload: the same session continues at the saved feedback.
  await page.reload();
  await expect(page.locator('#continueLine')).toHaveText('Passiv: вспомогательные глаголы · задание 3 из 10');
  await expect(page.getByRole('button', { name: 'Начать' })).toBeDisabled();
  await page.locator('#continueAction').click();
  await expect(progress(page)).toHaveText('Задание 3 из 10');
  await expect(slot(page, 2, 2).getByRole('radio', { name: 'werden' })).toBeChecked();
  await expect(page.locator('.dc-cloze-results li')).toHaveText(['Пропуск 1 из 2: верно', 'Пропуск 2 из 2: неверно']);
  await page.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('#summary')).toContainText('Верно: 1 из 10');
  await expect(page.locator('#summary li')).toHaveCount(10);
  await expect(page.locator('#summary li').first()).toHaveText('Das Gebäude wird komplett renoviert. — ошибка');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#statsList li[data-mode=select]')).toHaveText('Выбор: 3 из 50 предложений · верно с первой попытки 33%');
  await expect(page.locator('#statsList li[data-mode=type]')).toHaveText('Ввод: ответов ещё нет (50 предложений)');
  expect((await journal(page)).facts).toHaveLength(3);
});

test('relative pronouns in type mode: one typed gap, accepted forms, hint, Enter, language switch and mobile width', async ({ page }) => {
  await speech(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await start(page, 'relative', 'type');
  await expect(progress(page)).toHaveText('Задание 1 из 10');
  await expect(page.getByRole('heading', { name: 'Впишите относительное местоимение' })).toBeVisible();
  await expect(page.locator('#translations')).toBeEmpty();
  await expect(page.locator('#variants')).toBeHidden();
  const field = page.getByRole('textbox', { name: 'Пропуск 1 из 1' });
  await expect(field).toBeFocused();
  await field.fill(' Welcher ');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Правильно');
  await expect(page.locator('#explanationText')).toHaveText(/падеж — по его роли в придаточном/);
  await expect(page.getByRole('button', { name: 'Показать ответ' })).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(progress(page)).toHaveText('Задание 2 из 10');
  await page.getByRole('textbox', { name: 'Пропуск 1 из 1' }).fill('der');
  await page.getByRole('button', { name: 'Очистить ответы' }).click();
  await expect(page.getByRole('textbox', { name: 'Пропуск 1 из 1' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Пропуск 1 из 1' }).fill('der');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Не совсем');
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await expect(page.locator('#hintAnswer')).toHaveText('Ответ: die');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Type the missing relative pronoun' })).toBeVisible();
  await expect(page.locator('#hintAnswer')).toHaveText('Answer: die');
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  await expect(progress(page)).toHaveText('Task 2 of 10');
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Setze das Relativpronomen ein' })).toBeVisible();
  await expect(page.locator('.dc-cloze .dc-status')).toHaveText('Nicht ganz');
  await expect(page.locator('#explanationTitle')).toHaveText('Regel');
  expect((await journal(page)).facts.map((f: { exerciseId: string; itemId: string; outcome?: string }) => [f.exerciseId, f.itemId, f.outcome])).toEqual([['gap-type', 'rel-1', 'correct'], ['gap-type', 'rel-2', 'incorrect']]);
});

test('speech fallback: no synthesis on the device, then no German voice', async ({ page, context }) => {
  await speech(page, null);
  await start(page, 'passiv', 'type', 'Perf.');
  await expect(page.locator('#tenseBadge')).toHaveText('Perf.');
  await page.getByRole('textbox', { name: 'Пропуск 1 из 2' }).fill('ist');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Пропуск 2 из 2' })).toBeFocused();
  await page.keyboard.type('worden');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Правильно');
  await page.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect(page.locator('#speechStatus')).toHaveText('Озвучивание недоступно на этом устройстве.');

  const other = await context.newPage();
  await speech(other, ['en-US']);
  await other.goto('/v2/gaps.html');
  await other.locator('#continueAction').click();
  await other.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect(other.locator('#speechStatus')).toHaveText('Установите немецкий голос в настройках устройства.');
  await expect.poll(() => other.evaluate(() => window.spoken.length)).toBe(0);
});

test('an open gap session does not break the vocabulary page, which links to the gaps', async ({ page }) => {
  await start(page, 'relative', 'select');
  await page.getByRole('radio', { name: 'der', exact: true }).check();
  await check(page).click();
  await expect(status(page)).toHaveText('Правильно');
  await page.goto('/v2/session.html');
  await expect(page.locator('#decks li').first()).toBeVisible();
  await expect(page.locator('#continue')).toBeHidden();
  // The Practice hub lists the families; only this family's entry and M1's are asserted.
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Практика' }).click();
  await expect(page.getByRole('link', { name: /Сборка предложений/ })).toHaveAttribute('href', './sentences.html');
  await page.getByRole('link', { name: /Пропуски: относительные местоимения/ }).click();
  await expect(page.locator('#continueLine')).toHaveText('Относительные местоимения · задание 1 из 10');
});
