import { test, expect, type Page } from '@playwright/test';
import { PREVIEW_CATALOG_VERSION, PREVIEW_DECK, PREVIEW_WORDS } from '../src/client/v2/preview-catalog.js';

// The v2 scenario: home → deck → card → Runner → IndexedDB → reload → continue → summary → word card.
// The seed catalog is replaced by eight preview words; "Büro" shares two of them with "Zuhause".
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
const progress = (page: Page) => page.locator('#progress');
const learnNew = (page: Page) => page.locator('#learnNew');
async function openDeck(page: Page, deck = 'Zuhause') {
  await page.goto('/v2/session.html');
  await page.locator('#decks').getByRole('link', { name: new RegExp(deck) }).click();
  await expect(page.getByRole('heading', { name: deck, exact: true })).toBeVisible();
}
// New words are always a circuit: five words, an introduction and then every exercise for each of them.
const LEARNING_STAGES = ['meaning-choice', 'target-choice', 'article-choice', 'target-type', 'target-with-article-type', 'meaning-recall'];
const CIRCUIT_TASKS = 35;
async function startLearning(page: Page) {
  await openDeck(page);
  await expect(learnNew(page)).toHaveText('Учить новые (8)');
  await learnNew(page).click();
  await expect(progress(page)).toHaveText(`Задание 1 из ${CIRCUIT_TASKS}`);
  await expect(page.locator('#deck')).toBeHidden();
}
/** Past the five introductions and the stages before `exercise`; returns the number of its first task. */
async function reachExercise(page: Page, exercise: string): Promise<number> {
  await continueIntroductions(page, 5);
  const earlier = LEARNING_STAGES.indexOf(exercise);
  for (let i = 0; i < earlier * 5; i++) await answerCard(page);
  const first = 6 + earlier * 5;
  await expect(progress(page)).toHaveText(`Задание ${first} из ${CIRCUIT_TASKS}`);
  return first;
}
async function continueIntroductions(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const before = await progress(page).textContent();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(progress(page)).not.toHaveText(before!);
  }
}

test('a learning circuit resumes after reload in every phase with the same tasks and options', async ({ page }) => {
  await startLearning(page);
  // The introduction is saved before its details are shown, so it survives a reload as is.
  await expect(page.locator('.dc-word-details')).toBeVisible();
  const word = await page.locator('.dc-prompt').textContent();
  await page.reload();
  await expect(progress(page)).toHaveText('Задание 1 из 35');
  await expect(page.locator('.dc-prompt')).toHaveText(word!);
  await reachExercise(page, 'meaning-choice');
  const prompt = await page.locator('.dc-prompt').textContent();
  const options = await page.locator('.dc-choice span').allTextContents();
  await page.reload();
  await expect(page.locator('.dc-prompt')).toHaveText(prompt!);
  expect(await page.locator('.dc-choice span').allTextContents()).toEqual(options);

  await page.getByRole('radio', { name: options[0] }).check();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText(/^(Правильно|Не совсем)$/);
  const status = await page.locator('.dc-status').textContent();
  await expect(page.getByRole('button', { name: 'Дальше', exact: true })).toBeFocused();
  await page.reload();
  await expect(progress(page)).toHaveText('Задание 6 из 35');
  await expect(page.locator('.dc-status')).toHaveText(status!);
  await expect(page.getByRole('radio', { name: options[0] })).toBeChecked();
  await expect(page.getByRole('radio', { name: options[0] })).toBeDisabled();

  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(progress(page)).toHaveText('Задание 7 из 35');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Занятие на паузе. Ответы сохранены.');
  await expect(page.locator('.dc-card')).toHaveCount(0);
  await page.reload();
  await expect(progress(page)).toHaveText('Задание 7 из 35');
  await expect(page.locator('.dc-choice')).toHaveCount(4);

  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Занятие завершено досрочно. Ответы сохранены.');
  await page.reload();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#continue')).toBeHidden();
  await expect(page.locator('.dc-card')).toHaveCount(0);
});

test('a failed save keeps the answer and can be retried without a second answer', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      const w = window as unknown as { failNextPut?: boolean };
      if (w.failNextPut) { w.failNextPut = false; throw new DOMException('Quota exceeded', 'QuotaExceededError'); }
      return put.apply(this, args);
    };
  });
  await startLearning(page);
  await reachExercise(page, 'target-type');
  const answered = (await storedAnswers(page)).answers;
  await page.getByLabel('Ваш ответ').fill('Fehler');
  await page.evaluate(() => { (window as unknown as { failNextPut: boolean }).failNextPut = true; });
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Не удалось сохранить. Ничего не потеряно: попробуйте ещё раз.');
  await expect(page.getByLabel('Ваш ответ')).toHaveValue('Fehler');
  await page.getByRole('button', { name: 'Сохранить ещё раз', exact: true }).click();
  await expect(page.locator('.dc-status')).toContainText('Правильный ответ');
  await expect(page.getByRole('button', { name: 'Сохранить ещё раз', exact: true })).toBeHidden();
  expect((await storedAnswers(page)).answers).toBe(answered + 1);
});

test('the interface language changes labels without replacing the shown task', async ({ page }) => {
  await startLearning(page);
  await reachExercise(page, 'meaning-choice');
  const options = await page.locator('.dc-choice span').allTextContents();
  await page.locator('#language').selectOption('de');
  await expect(progress(page)).toHaveText('Aufgabe 6 von 35');
  await expect(page).toHaveTitle('DrillCards · Übungseinheit');
  expect(await page.locator('.dc-choice span').allTextContents()).toEqual(options);
});

async function storedAnswers(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('drillcards-learning-v2');
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const all = db.transaction('partitions').objectStore('partitions').getAll();
    const partitions = await new Promise<{ sessions: unknown[]; facts: { event: { kind: string } }[] }[]>(resolve => { all.onsuccess = () => resolve(all.result); });
    db.close();
    return { sessions: partitions.flatMap(p => p.sessions).length,
      answers: partitions.flatMap(p => p.facts).filter(f => f.event.kind === 'answer').length };
  });
}

test('a submit that conflicts with another tab keeps the card answerable', async ({ page, context }) => {
  await startLearning(page);
  const first = await reachExercise(page, 'target-type');
  const answered = (await storedAnswers(page)).answers;
  const other = await context.newPage();
  await other.goto('/v2/session.html#session');
  await expect(progress(other)).toHaveText(`Задание ${first} из 35`);
  await other.getByRole('button', { name: 'Пауза', exact: true }).click();
  await other.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(other.locator('.dc-card')).toBeVisible();
  await other.close();

  await page.getByLabel('Ваш ответ').fill('Tisch');
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Занятие изменилось в другой вкладке. Показано сохранённое состояние.');
  await expect(page.locator('.dc-status')).not.toHaveText('Ответ принят');
  await expect(page.getByLabel('Ваш ответ')).toBeEnabled();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toContainText('Правильный ответ');
  await expect(page.locator('#notice')).toHaveText('');
  expect((await storedAnswers(page)).answers).toBe(answered + 1);
});

test('a double click on Learn new creates one session', async ({ page }) => {
  await openDeck(page);
  await learnNew(page).dblclick();
  await expect(progress(page)).toHaveText('Задание 1 из 35');
  expect((await storedAnswers(page)).sessions).toBe(1);
});

/** Answer whatever card is shown: first option, a wrong word, or "didn't remember". Returns false at the end. */
async function answerCard(page: Page): Promise<boolean> {
  const card = page.locator('.dc-card');
  if (!(await card.count())) return false;
  const status = await progress(page).textContent();
  const proceed = page.getByRole('button', { name: 'Продолжить', exact: true });
  if (await proceed.count()) await proceed.click();
  else {
    if (await page.locator('.dc-choice').count()) await page.locator('.dc-choice input').first().check();
    else if (await page.getByLabel('Ваш ответ').count()) await page.getByLabel('Ваш ответ').fill('falsch');
    else {
      await page.getByRole('button', { name: 'Показать ответ' }).click();
      await page.getByRole('button', { name: 'Не помню', exact: true }).click();
    }
    if (await page.getByRole('button', { name: 'Проверить', exact: true }).count()) await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  }
  await expect(progress(page)).not.toHaveText(status!);
  return true;
}

test('a five-word circuit goes through all stages, a mistake review and a summary of the same words', async ({ page }) => {
  await openDeck(page);
  await page.locator('#format').selectOption('circuit');
  await expect(page.locator('#exerciseField')).toBeHidden();
  await learnNew(page).click();
  await expect(progress(page)).toHaveText('Задание 1 из 35');
  const introduced = new Set<string>();
  for (let i = 0; i < 5; i++) {
    introduced.add((await page.locator('.dc-prompt').textContent())!);
    await answerCard(page);
  }
  for (let i = 5; i < 35; i++) await answerCard(page);
  await expect(progress(page)).toHaveText(/^Разбор ошибок · Задание 36 из \d+$/);
  const prompt = await page.locator('.dc-prompt').textContent();
  await page.reload();
  await expect(progress(page)).toHaveText(/^Разбор ошибок · Задание 36 из \d+$/);
  await expect(page.locator('.dc-prompt')).toHaveText(prompt!);
  while (await answerCard(page)) { /* every correction */ }
  await expect(page.locator('#notice')).toHaveText('Занятие завершено. Все ответы сохранены.');
  await expect(page.getByRole('heading', { name: 'Итоги занятия' })).toBeVisible();
  const words = await page.locator('#summary h3').allTextContents();
  expect(new Set(words)).toEqual(introduced);
  await expect(page.locator('#summary')).toContainText('Ваш ответ: falsch');
  await expect(page.locator('#summary')).toContainText('пока не исправлено');

  // Back to the deck: the five words are started, three are still new, none is due yet.
  await page.getByRole('button', { name: 'К колоде', exact: true }).click();
  await expect(page.locator('#deckStats')).toHaveText('Слов: 8 · начато: 5 · новых: 3 · к повторению: 0');
  await expect(learnNew(page)).toHaveText('Учить новые (3)');
  await expect(page.locator('#reviewDue')).toBeDisabled();
  await expect(page.locator('#reviewDueEmpty')).toHaveText(/^Сейчас нечего повторять\. Ближайшее повторение: .+\.$/);
});

test('review is disabled with a reason until words are started; a full set through every exercise is the default', async ({ page }) => {
  await openDeck(page);
  await expect(page.locator('#reviewDue')).toHaveText('Повторить созревшие (0)');
  await expect(page.locator('#reviewDue')).toBeDisabled();
  await expect(page.locator('#reviewDueEmpty')).toHaveText('Повторять пока нечего: сначала выучите новые слова.');
  await expect(page.locator('#format')).toHaveValue('circuit');
  await expect(page.locator('#scope')).toHaveValue('all-exercises');
  await expect(page.locator('#scopeField')).toBeVisible();
  await expect(page.locator('#exerciseField')).toBeHidden();
  await page.locator('#format').selectOption('single');
  await expect(page.locator('#scopeField')).toBeHidden();
  await expect(page.locator('#exerciseField')).toBeVisible();
  await page.locator('#format').selectOption('circuit');
  await page.locator('#scope').selectOption('due-components');
  await expect(page.locator('#scopeField')).toBeVisible();
  // The review format and exercise never change the new-word count: new words are always a full circuit.
  await page.locator('#format').selectOption('single');
  await page.locator('#exercise').selectOption('article-choice');
  await expect(learnNew(page)).toHaveText('Учить новые (8)');
});

test('home lists and searches decks; an unfinished session is continued, never mixed with a new one', async ({ page }) => {
  await page.goto('/v2/session.html');
  await expect(page.locator('#decks li')).toHaveCount(2);
  await expect(page.locator('#decks')).toContainText('Zuhause8 слов · начато 0');
  await page.getByLabel('Найти колоду').fill('bü');
  await expect(page.locator('#decks li')).toHaveCount(1);
  await expect(page.locator('#decks')).toContainText('Büro');
  await page.getByLabel('Найти колоду').fill('xyz');
  await expect(page.locator('#decks')).toHaveText('Колоды не найдены.');

  await startLearning(page);
  await continueIntroductions(page, 3);
  const prompt = await page.locator('.dc-prompt').textContent();
  await page.goBack();
  await expect(page.locator('#deck')).toBeVisible();
  await expect(page.locator('#continue')).toBeVisible();
  await expect(page.locator('#continueLine')).toHaveText('Zuhause · задание 4 из 35');
  await expect(learnNew(page)).toBeDisabled();
  await expect(page.locator('#blocked')).toHaveText('Сначала продолжите или завершите незаконченное занятие.');
  await page.getByRole('button', { name: 'Продолжить занятие', exact: true }).click();
  await expect(progress(page)).toHaveText('Задание 4 из 35');
  await expect(page.locator('#continue')).toBeHidden();
  await expect(page.locator('.dc-prompt')).toHaveText(prompt!);

  await page.goto('/v2/session.html');
  await expect(page.locator('#continue')).toBeVisible();
  await page.locator('#continue').getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Занятие завершено досрочно. Ответы сохранены.');
  await expect(page.getByRole('heading', { name: 'Итоги занятия' })).toBeVisible();
  await expect(page.locator('#continue')).toBeHidden();
  await page.getByRole('button', { name: 'К колоде', exact: true }).click();
  await expect(page.locator('#continue')).toBeHidden();
  // Four introductions were saved (the fourth when it became current); their words are no longer new.
  await expect(learnNew(page)).toHaveText('Учить новые (4)');
  await expect(learnNew(page)).toBeEnabled();
});

test("a word card shows the same progress from every deck and links to the word's decks", async ({ page }) => {
  await startLearning(page);
  await continueIntroductions(page, 5);
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.locator('#summary').getByRole('link', { name: 'der Tisch' }).click();
  await expect(page.getByRole('heading', { name: /der Tisch/ })).toBeVisible();
  await expect(page.locator('#wordCard')).toContainText('Узнавание: изучается');
  await expect(page.locator('#wordCard')).toContainText('Прогресс слова общий для всех колод');
  await expect(page.locator('#wordCard')).not.toContainText(/выучено навсегда/i);
  const fromHome = await page.locator('.dc-components').innerText();

  await page.locator('#wordCard').getByRole('link', { name: 'Büro' }).click();
  await expect(page.locator('#deckStats')).toHaveText('Слов: 2 · начато: 2 · новых: 0 · к повторению: 0');
  await expect(learnNew(page)).toBeDisabled();
  await expect(page.locator('#learnNewEmpty')).toHaveText(/^Все слова колоды уже начаты/);
  const tischRow = page.locator('#words > li').filter({ hasText: 'der Tisch' });
  await tischRow.locator('summary').click();
  await tischRow.getByRole('link', { name: /Открыть карточку/ }).click();
  await expect.poll(() => page.locator('.dc-components').innerText()).toBe(fromHome);
  await page.getByRole('link', { name: '← К колоде' }).click();
  await expect(page.getByRole('heading', { name: 'Büro', exact: true })).toBeVisible();
  await page.getByLabel('Найти слово').fill('лампа');
  await expect(page.locator('#words li')).toHaveCount(1);
});

test('home, deck, session, summary and word card fit a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.goto('/v2/session.html');
  await expect(page.locator('#decks li')).toHaveCount(2); await fits();
  await startLearning(page); await fits();
  await reachExercise(page, 'target-with-article-type');
  await expect(page.getByLabel('Ваш ответ')).toBeVisible(); await fits();
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Итоги занятия' })).toBeVisible(); await fits();
  await page.locator('#summary h3 a').first().click();
  await expect(page.locator('.dc-components')).toBeVisible(); await fits();
});

async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = []; (window as unknown as { spoken: string[] }).spoken = spoken;
    const synth = { speaking: false, pending: false, getVoices: () => [{ lang: 'de-DE', name: 'de', default: true }], cancel() {},
      speak(u: { text: string; onend?: () => void }) { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); }, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
  });
}
const spokenWords = (page: Page) => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);

test('auto-speech is a saved preference for following cards, independent of playback', async ({ page }) => {
  await stubSpeech(page);
  await startLearning(page);
  const toggle = page.getByRole('switch', { name: 'Озвучивать слова автоматически' });
  await expect.poll(async () => (await spokenWords(page)).length).toBe(1);
  await expect(toggle).toBeChecked();
  await expect(page.locator('.dc-word-speech').first()).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await continueIntroductions(page, 1);
  await page.waitForTimeout(200);
  expect((await spokenWords(page)).length).toBe(1);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.waitForTimeout(200);
  expect(await spokenWords(page)).toEqual([]);
  await expect(page.locator('.dc-listen')).toHaveCount(0);
  await expect(page.locator('.dc-word-speech')).toHaveText((await page.locator('.dc-prompt').textContent())!);
  await page.locator('.dc-word-speech').first().click();
  await expect.poll(async () => (await spokenWords(page)).length).toBe(1);
  await expect(toggle).not.toBeChecked();
  await page.locator('.dc-word-speech').first().press('Enter');
  await expect.poll(async () => (await spokenWords(page)).length).toBe(2);
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.waitForTimeout(200);
  expect((await spokenWords(page)).length).toBe(2);
  await continueIntroductions(page, 1);
  await expect.poll(async () => (await spokenWords(page)).length).toBe(3);
  await expect(toggle).toBeChecked();
});

test('disabled auto-speech also stays silent after a correct German answer', async ({ page }) => {
  await stubSpeech(page);
  await page.addInitScript(() => localStorage.setItem('dc_v2_word_auto_speak', '0'));
  await startLearning(page);
  await reachExercise(page, 'target-type');
  const prompt = (await page.locator('.dc-prompt').textContent())!.trim();
  const word = PREVIEW_WORDS.find(candidate => candidate.meanings.ru?.preferred === prompt)!;
  const toggle = page.getByRole('switch', { name: 'Озвучивать слова автоматически' });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await page.getByLabel('Ваш ответ').fill(word.lemma);
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toContainText('Правильно');
  await page.waitForTimeout(200);
  expect(await spokenWords(page)).toEqual([]);
});

test('introductions read the word automatically and the speaker can stop and restart it', async ({ page }) => {
  await stubSpeech(page);
  await page.route('**/audio/words/**', route => route.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    window.speechSynthesis.speak = utterance => {
      (window as unknown as { spoken: string[] }).spoken.push(utterance.text);
    };
    Object.defineProperty(window.speechSynthesis, 'speaking', { value: true });
  });
  await startLearning(page);
  const word = (await page.locator('.dc-prompt').textContent())!.trim();
  const speaker = page.locator('.dc-word-speech').first();
  await expect.poll(() => spokenWords(page)).toEqual([word]);
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  await speaker.click();
  await expect.poll(() => spokenWords(page)).toEqual([word, word]);
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(progress(page)).toHaveText('Задание 2 из 35');
  const nextWord = (await page.locator('.dc-prompt').textContent())!.trim();
  await expect.poll(() => spokenWords(page)).toEqual([word, word, nextWord]);
});

test('from German the word is read when the question appears, not again on the feedback card', async ({ page }) => {
  await stubSpeech(page);
  await startLearning(page);
  await reachExercise(page, 'meaning-choice');
  const word = (await page.locator('.dc-prompt').textContent())!.trim();
  // The introductions are read too; the question adds exactly one more reading.
  await expect.poll(async () => { const spoken = await spokenWords(page); return spoken[spoken.length - 1]; }).toBe(word);
  const asked = await spokenWords(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).not.toBeEmpty();
  await page.waitForTimeout(300);
  expect(await spokenWords(page)).toEqual(asked);
});

test('into German the word is read after a correct answer, on the feedback card', async ({ page }) => {
  await stubSpeech(page);
  await startLearning(page);
  await reachExercise(page, 'target-type');
  await page.waitForTimeout(300);
  const before = await spokenWords(page);
  const prompt = (await page.locator('.dc-prompt').textContent())!.trim();
  const word = PREVIEW_WORDS.find(candidate => candidate.meanings.ru?.preferred === prompt)!;
  await page.getByLabel('Ваш ответ').fill(word.lemma);
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect.poll(() => spokenWords(page)).toEqual([...before, [word.article, word.lemma].filter(Boolean).join(' ')]);
});

test('into German a wrong answer is not read', async ({ page }) => {
  await stubSpeech(page);
  await startLearning(page);
  await reachExercise(page, 'target-type');
  await page.waitForTimeout(300);
  const before = await spokenWords(page);
  await page.getByLabel('Ваш ответ').fill('Fehlerhaft');
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).not.toBeEmpty();
  await page.waitForTimeout(300);
  expect(await spokenWords(page)).toEqual(before);
});

test('a deck word expands into per-exercise progress that is the same in every deck', async ({ page }) => {
  await openDeck(page);
  const tisch = page.locator('#words li').filter({ hasText: 'der Tisch' });
  await expect(tisch.locator('.dc-wstatus')).not.toHaveAttribute('open', '');
  await tisch.locator('.dc-wstatus > summary').click();
  const rows = tisch.locator('.dc-wstatus-row');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText('0 / 3');
  await expect(tisch.locator('.dc-wstatus-row[data-exercise=article-choice]')).toContainText('0 / 3');
  await expect(tisch.locator('.dc-note')).toContainText('не меньше 3 повторений');
  await expect(tisch.locator('.dc-wstatus > summary .dc-state')).toHaveAttribute('data-state', 'new');

  // The answer language is part of the status: the same word stays available in EN.
  await page.locator('#translation').selectOption('en');
  await expect(page.locator('#words li').filter({ hasText: 'der Tisch' }).locator('.dc-wstatus-row')).toHaveCount(6);

  // One wordId, one progress: the shared word shows the same rows from the other deck.
  const before = await rows.allTextContents();
  await page.getByRole('link', { name: '← Все колоды' }).click();
  await page.locator('#decks').getByRole('link', { name: /Büro/ }).click();
  const shared = page.locator('#words li').filter({ hasText: 'der Tisch' });
  await expect(shared.locator('.dc-wstatus-row')).toHaveCount(6);
  expect(await shared.locator('.dc-wstatus-row').allTextContents()).toEqual(before);
});


test('deck filters combine with search and part of speech; sorting preserves open progress', async ({ page }) => {
  await openDeck(page);
  await expect(page.locator('#words > li')).toHaveCount(8);
  await page.locator('#wordFilters').getByRole('button', { name: /^Пора повторить/ }).click();
  await expect(page.locator('#words')).toContainText('Ничего не найдено.');
  await page.locator('#wordFilters').getByRole('button', { name: /^Все ·/ }).click();
  await page.locator('#wordPart').selectOption('verb');
  await expect(page.locator('#wordResults')).toHaveText('Показано 0 из 8 слов');
  await page.locator('#wordPart').selectOption('noun');
  await page.locator('#wordSearch').fill('стол');
  await expect(page.locator('#words > li')).toHaveCount(1);
  await expect(page.locator('#words summary')).toContainText('der Tisch');
  await page.locator('#wordSearch').fill('');
  const tisch = page.locator('#words > li').filter({ hasText: 'der Tisch' });
  await tisch.locator('summary').click();
  await page.locator('#wordSort').selectOption('az');
  await expect(page.locator('#words summary').first()).toContainText('das Bett');
  await expect(tisch.locator('details')).toHaveAttribute('open', '');
  await page.locator('#wordSort').selectOption('deck');
  await expect(page.locator('#words summary').first()).toContainText('der Tisch');
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
