import { test, expect, type Page } from '@playwright/test';

// M7 (#339): FC11 user paths on the v2 Redemittel page: the shared RevealInput, Runner and IndexedDB
// journal, the committed dataset, subjective self-rating, keyboard and mobile use, speech with its
// fallbacks, continue and summary, RU/EN/DE.
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
type JournalFact = { kind: string; exerciseId: string; target: string; itemId: string; rawAnswer?: unknown; outcome?: string; source?: string };
const journal = (page: Page): Promise<{ facts: JournalFact[]; projections: number; outbox: number }> => page.evaluate(async () => {
  const path = '/v2/storage/learning-db.js';
  const { LearningDatabase } = await import(path);
  const db = await LearningDatabase.open();
  const scope = await db.scope({ kind: 'guest', id: localStorage.getItem('dc_v2_preview_guest') },
    { dataEpoch: 'preview-1', epochStartedAt: '2026-10-01T00:00:00.000Z' });
  const data = await scope.snapshot(); db.close();
  return { facts: data.facts.map((f: { event: { kind: string; exerciseId: string; target: { kind: string; datasetId: string; itemId: string }; rawAnswer?: unknown }; evaluation?: { outcome: string; source: string } }) =>
    ({ kind: f.event.kind, exerciseId: f.event.exerciseId, target: f.event.target.kind, itemId: f.event.target.itemId,
      rawAnswer: f.event.rawAnswer, outcome: f.evaluation?.outcome, source: f.evaluation?.source })), projections: data.projections.length, outbox: data.outbox.length };
});
const progress = (page: Page) => page.locator('#progress');
const phrase = (page: Page) => page.locator('.dc-revealed-answer');
const status = (page: Page) => page.locator('.dc-card .dc-status');

async function start(page: Page, deck: 'beruf' | 'daily', translation: 'ru' | 'en' = 'ru') {
  await page.goto('/v2/redemittel.html');
  await expect(page.locator('#statsLine')).not.toBeEmpty();
  await page.locator('#deck').selectOption(deck);
  await page.locator('#translation').selectOption(translation);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(progress(page)).toHaveText(/^Задание 1 из \d+$/);
}

test('interview phrases: meaning, reveal, details, speech, subjective rating once, keyboard, continue, summary and statistics', async ({ page }) => {
  await speech(page);
  await page.goto('/v2/redemittel.html');
  await expect(page.locator('#statsLine')).toHaveText('Оценок ещё нет (7 фраз)');
  await expect(page.locator('#statsNote')).toHaveText('Самооценка: вы оцениваете себя сами, автоматической проверки нет.');
  await start(page, 'beruf');
  await expect(progress(page)).toHaveText('Задание 1 из 7');
  await expect(page.getByRole('heading', { name: 'Вспомните фразу по-немецки' })).toBeVisible();
  await expect(page.locator('.dc-prompt')).toHaveText('Хороший вопрос — дайте мне немного подумать.');
  await expect(page.locator('#subjective')).toBeVisible();
  // Before the reveal: no phrase, no ratings, no speech (it would read the answer), no details.
  await expect(phrase(page)).toHaveCount(0);
  await expect(page.locator('.dc-ratings')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeDisabled();
  await expect(page.locator('#details')).toBeHidden();
  const show = page.getByRole('button', { name: 'Показать ответ' });
  await expect(show).toBeFocused();

  // A double click on the reveal stores one reveal event and no answer (the ratings appear under the pointer).
  await show.dblclick();
  await expect(phrase(page)).toHaveText('Das ist eine gute Frage — lassen Sie mich kurz überlegen.');
  await expect(phrase(page)).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('button', { name: 'Не помню' })).toBeFocused();
  await expect(page.locator('.dc-card .dc-status')).toBeEmpty();
  await expect(page.locator('#details dd[data-translation=en]')).toHaveText("That's a good question — let me think for a moment.");
  await expect(page.locator('#details')).toContainText('Речевые клише');
  expect((await journal(page)).facts.map(f => f.kind)).toEqual(['reveal']);
  await page.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect.poll(() => page.evaluate(() => window.spoken)).toEqual(['Das ist eine gute Frage — lassen Sie mich kurz überlegen.']);

  // A double click on a rating stores one answer; the feedback is the learner's own rating, not "correct".
  await page.getByRole('button', { name: 'Помню', exact: true }).dblclick();
  await expect(status(page)).toHaveText('Ваша оценка: помню (самооценка)');
  await expect(page.getByRole('button', { name: 'Помню', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Помню', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Дальше' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Keyboard as in v1: Space shows the phrase, 1 = didn't remember, → goes on.
  await expect(progress(page)).toHaveText('Задание 2 из 7');
  await page.locator('body').focus();
  await page.locator('#progress').click();
  await page.keyboard.press(' ');
  await expect(phrase(page)).toHaveText('Aus meiner Erfahrung bei … kann ich ein konkretes Beispiel nennen.');
  await page.locator('#progress').click();
  await page.keyboard.press('1');
  await expect(status(page)).toHaveText('Ваша оценка: не помню (самооценка)');
  await page.keyboard.press('2');
  await expect(status(page)).toHaveText('Ваша оценка: не помню (самооценка)', { timeout: 500 });
  await page.keyboard.press('ArrowRight');
  await expect(progress(page)).toHaveText('Задание 3 из 7');
  await page.keyboard.press('Enter');
  await expect(phrase(page)).toHaveText('Der Trade-off dabei ist folgender: …');

  const saved = await journal(page);
  expect(saved.facts).toEqual([
    { kind: 'reveal', exerciseId: 'phrase-recall', target: 'phrase', itemId: 'p_beruf_1' },
    { kind: 'answer', exerciseId: 'phrase-recall', target: 'phrase', itemId: 'p_beruf_1', rawAnswer: 'remembered', outcome: 'correct', source: 'self-assessment' },
    { kind: 'reveal', exerciseId: 'phrase-recall', target: 'phrase', itemId: 'p_beruf_2' },
    { kind: 'answer', exerciseId: 'phrase-recall', target: 'phrase', itemId: 'p_beruf_2', rawAnswer: 'forgotten', outcome: 'incorrect', source: 'self-assessment' },
    { kind: 'reveal', exerciseId: 'phrase-recall', target: 'phrase', itemId: 'p_beruf_3' },
  ]);
  expect([saved.projections, saved.outbox]).toEqual([0, 5]);

  // Reload: the same session continues on the revealed third phrase.
  await page.reload();
  await expect(page.locator('#continueLine')).toHaveText('Речевые клише · фраза 3 из 7');
  await expect(page.getByRole('button', { name: 'Начать' })).toBeDisabled();
  await page.locator('#continueAction').click();
  await expect(progress(page)).toHaveText('Задание 3 из 7');
  await expect(phrase(page)).toHaveText('Der Trade-off dabei ist folgender: …');
  await page.getByRole('button', { name: 'Помню', exact: true }).click();
  await expect(status(page)).toHaveText('Ваша оценка: помню (самооценка)');
  await page.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('#summary')).toContainText('Помню (самооценка): 2 из 7');
  await expect(page.locator('#summary li')).toHaveCount(7);
  await expect(page.locator('#summary li').nth(1)).toHaveText('Aus meiner Erfahrung bei … kann ich ein konkretes Beispiel nennen. — Не помню');
  await expect(page.locator('#summary li').nth(3)).toHaveText(/— без оценки$/);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#statsLine')).toHaveText('Оценено 3 из 7 фраз · последняя оценка: помню 2, не помню 1');
  // The next session starts with the unrated phrases, then the forgotten one.
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.dc-prompt')).toHaveText('Если сформулировать суть: …');
  expect((await journal(page)).facts.filter(f => f.kind === 'answer')).toHaveLength(3);
});

test('daily stand-up phrases with English meanings on a phone: auto-speak on reveal and RU/EN/DE', async ({ page }) => {
  await speech(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await start(page, 'daily', 'en');
  await expect(progress(page)).toHaveText('Задание 1 из 10');
  await expect(page.locator('.dc-prompt')).toHaveText("I'll start: yesterday I worked on the login bug.");
  await expect(page.locator('.dc-prompt')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Озвучивать фразу при показе').check();
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await expect(phrase(page)).toHaveText('Ich fange an: Gestern habe ich am Login-Bug gearbeitet.');
  await expect.poll(() => page.evaluate(() => window.spoken)).toEqual(['Ich fange an: Gestern habe ich am Login-Bug gearbeitet.']);
  await expect(page.locator('#details dd[data-translation=ru]')).toHaveText('Я начну: вчера я работал над багом в логине.');
  await expect(page.locator('#details')).toContainText('Фразы для дейли');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Recall the German phrase' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remembered', exact: true })).toBeVisible();
  await expect(page.locator('#subjective')).toHaveText('Self-assessment: you rate yourself; nothing is checked automatically.');
  await expect(progress(page)).toHaveText('Task 1 of 10');
  await page.getByRole('button', { name: "Didn't remember" }).click();
  await expect(status(page)).toHaveText("Your rating: didn't remember (self-assessment)");
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Erinnere dich an die deutsche Wendung' })).toBeVisible();
  await expect(status(page)).toHaveText('Deine Bewertung: nicht gewusst (Selbsteinschätzung)');
  await expect(page.locator('#details')).toContainText('Redemittel fürs Daily');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(progress(page)).toHaveText('Aufgabe 2 von 10');
  await expect(page.locator('.dc-prompt')).toHaveText('Yesterday I finished the ticket and opened the pull request.');
  expect((await journal(page)).facts.map(f => [f.kind, f.itemId, f.outcome])).toEqual([['reveal', 'p_daily_1', undefined], ['answer', 'p_daily_1', 'incorrect']]);
});

test('speech fallback: no synthesis on the device, then no German voice', async ({ page, context }) => {
  await speech(page, null);
  await start(page, 'beruf');
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await page.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect(page.locator('.dc-card .dc-speech-warning')).toHaveText('Озвучивание недоступно на этом устройстве.');
  // Auto-speak reports the same fallback outside the card.
  await page.getByLabel('Озвучивать фразу при показе').check();
  await page.getByRole('button', { name: 'Помню', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await expect(page.locator('#speechStatus')).toHaveText('Озвучивание недоступно на этом устройстве.');

  const other = await context.newPage();
  await speech(other, ['en-US']);
  await other.goto('/v2/redemittel.html');
  await other.locator('#continueAction').click();
  await other.getByRole('button', { name: 'Прослушать по-немецки' }).click();
  await expect(other.locator('.dc-card .dc-speech-warning')).toHaveText('Установите немецкий голос в настройках устройства.');
  await expect.poll(() => other.evaluate(() => window.spoken.length)).toBe(0);
});

test('an open phrase session does not break the vocabulary page, whose Practice hub links to Redemittel', async ({ page }) => {
  await start(page, 'beruf');
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await page.getByRole('button', { name: 'Помню', exact: true }).click();
  await page.goto('/v2/session.html');
  await expect(page.locator('#decks li').first()).toBeVisible();
  await expect(page.locator('#continue')).toBeHidden();
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Практика' }).click();
  await page.locator('.dc-hub-list').getByRole('link', { name: 'Redemittel' }).click();
  await expect(page.locator('#continueLine')).toHaveText('Речевые клише · фраза 1 из 7');
});
