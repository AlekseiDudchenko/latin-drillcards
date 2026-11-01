import { test, expect, type Page } from '@playwright/test';

// M2 (#334) user paths on /v2/listening.html: the audio is the prompt (the text stays hidden until
// the answer), replay writes nothing, both answer modes, levels, hints after the answer, separate
// statistics, an unavailable voice, stopping the sound on leave, keyboard, languages and a phone screen.
const pick = ['s1', 's2', 's_a2_1', 's_b1_23', 's_b1_237', 's_beruf_1'];
type Content = { target: string; tokens: string[]; level: string; translations: Record<string, string> };
let dataset: { items: { id: string; content: Content }[] };
let byId: Map<string, { content: Content }>;
let recordings: { text: string; url: string }[];
test.beforeAll(async ({ request }) => {
  const full = await (await request.get('/data/items/sentences.json')).json();
  dataset = { ...full, items: full.items.filter((item: { id: string }) => pick.includes(item.id)) };
  byId = new Map(dataset.items.map(item => [item.id, item]));
  recordings = (await (await request.get('/data/audio/sentences-a1.json')).json()).entries;
});
test.beforeEach(async ({ page }) => { await page.route('**/data/items/sentences.json', route => route.fulfill({ json: dataset })); });

type Voice = 'german' | 'english' | 'none' | 'endless';
/** Speech stub: records what was spoken and every cancel in localStorage (kept across pages). */
async function stubSpeech(page: Page, voice: Voice = 'german') {
  await page.addInitScript(({ kind, recordings }: { kind: Voice; recordings: { text: string; url: string }[] }) => {
    const log = (entry: string) => { const all = JSON.parse(localStorage.getItem('speechLog') ?? '[]'); all.push(entry); localStorage.setItem('speechLog', JSON.stringify(all)); };
    Object.defineProperty(window, 'Audio', { configurable: true, value: class {
      onended: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play() {
        const entry = recordings.find(recording => new URL(recording.url, location.origin + '/').href === this.src);
        if (!entry) return Promise.reject(new Error('Unknown recording'));
        log(`speak:${entry.text}`); if (kind !== 'endless') setTimeout(() => this.onended?.(), 0);
        return Promise.resolve();
      }
      pause() { log('cancel'); } removeAttribute() {} load() {}
    } });
    if (kind === 'none') { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); return; }
    const voice = kind === 'english' ? { lang: 'en-US', name: 'En', default: true, localService: true, voiceURI: 'en' }
      : { lang: 'de-DE', name: 'Test', default: true, localService: true, voiceURI: 'test' };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [voice], addEventListener() {}, removeEventListener() {}, cancel() { log('cancel'); }, pending: false, speaking: false,
      speak(u: { text: string; onend?: () => void }) { log(`speak:${u.text}`); if (kind !== 'endless') setTimeout(() => u.onend?.(), 0); },
    } });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class { lang = ''; voice: unknown; onend?: () => void; onerror?: () => void; constructor(public text: string) {} };
  }, { kind: voice, recordings });
}
const spoken = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('speechLog') ?? '[]') as string[]).filter(e => e.startsWith('speak:')).map(e => e.slice(6)));
const status = (page: Page) => page.locator('.dc-status');
async function shownId(page: Page): Promise<string> {
  const meta = await page.locator('#meta').textContent();
  return meta!.split(' · ').pop()!;
}
async function assemble(page: Page, order?: number[]) {
  const count = byId.get(await shownId(page))!.content.tokens.length;
  for (const i of order ?? [...Array(count).keys()]) await page.locator(`[data-token-zone=pool] [data-token-id="t${i}"]`).click();
  await expect(status(page)).toHaveText('');
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
}
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

test('the audio is the prompt: hidden text, replay writes nothing, assembly is saved once with hints after it', async ({ page }) => {
  await stubSpeech(page);
  await page.goto('/v2/listening.html');
  await expect(page.locator('#meta')).toHaveText('Уровень A1 · s1');
  await expect(page.locator('.dc-prompt')).toHaveText('Прослушайте и соберите предложение');
  await expect.poll(() => spoken(page), 'a new sentence plays at once').toEqual(['Ich heiße Anna.']);
  const main = page.locator('main');
  await expect(main).not.toContainText('Ich heiße Anna');
  await expect(main).not.toContainText('Меня зовут Анна');
  await expect(page.locator('#extra')).toBeEmpty();
  await page.getByRole('button', { name: 'Прослушать ещё раз' }).click();
  await page.getByRole('button', { name: 'Прослушать ещё раз' }).click();
  await expect.poll(() => spoken(page)).toHaveLength(3);
  expect(await events(page), 'replaying is never an answer').toBe(0);
  await expect(status(page)).toBeEmpty();
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('.dc-listening-target')).toHaveText('Ich heiße Anna.');
  await expect(page.locator('.dc-listening-translation')).toHaveText('Перевод: Меня зовут Анна.');
  await expect(page.locator('.dc-explanation')).toBeVisible();
  await expect(page.locator('#stats')).toContainText('Аудирование этого предложения: ответов 1, с первой попытки 1');
  await page.getByRole('button', { name: 'Прослушать ещё раз' }).click();
  await expect.poll(() => spoken(page)).toHaveLength(4);
  expect(await events(page), 'replay after the answer changes nothing').toBe(1);
  await expect(status(page)).toHaveText('Верно!');
  // A reload keeps the answered sentence and does not play by itself.
  await page.reload();
  await expect(status(page)).toHaveText('Верно!');
  await page.waitForTimeout(100);
  expect(await spoken(page)).toHaveLength(4);
  // The builder has its own statistics for the same sentence.
  await page.goto('/v2/sentences.html');
  await expect(page.locator('.dc-prompt')).toHaveText('Меня зовут Анна.');
  await expect(page.locator('#stats')).toContainText('ещё без ответа');
});

test('typing: the dictation rule, a wrong answer, Try again (assisted), the mode is remembered', async ({ page }) => {
  await stubSpeech(page);
  await page.goto('/v2/listening.html');
  await expect(page.locator('#meta')).toHaveText('Уровень A1 · s1');
  await page.getByRole('button', { name: 'Ввод' }).click();
  await expect(page.getByRole('button', { name: 'Ввод' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dc-prompt')).toHaveText('Прослушайте и напишите предложение');
  await expect(page.locator('#meta'), 'switching keeps the sentence').toHaveText('Уровень A1 · s1');
  expect(await events(page), 'switching an unanswered sentence writes nothing').toBe(0);
  const input = page.locator('.dc-card input[type=text]');
  await input.fill('Ich heisse Anna');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(status(page)).toHaveText('Не совсем. Правильно: Ich heiße Anna.');
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('ich heiße anna');
  await input.press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('#stats')).toContainText('ответов 2, с первой попытки 0');
  await expect(page.locator('#stats')).toContainText('Этот набор (Ввод)');
  expect(await events(page)).toBe(2);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ввод' })).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toHaveValue('ich heiße anna');
  // Assembly of the same sentence keeps its own listening statistics.
  await page.getByRole('button', { name: 'Сборка' }).click();
  await expect(page.locator('#meta')).toHaveText('Уровень A1 · s1');
  await expect(page.locator('#stats')).toContainText('Аудирование этого предложения: ещё без ответа');
});

test('levels: all A1–C2 or one level from the hash; themed decks are not offered', async ({ page }) => {
  await stubSpeech(page);
  await page.goto('/v2/listening.html#deck=b1');
  await expect(page.locator('#deck')).toHaveValue('b1');
  await expect(page.locator('#meta')).toContainText('Уровень B1');
  await expect(page.locator('#deck option')).toHaveText(['Все уровни A1–C2', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  await page.locator('#deck').selectOption('a2');
  await expect(page.locator('#meta')).toHaveText('Уровень A2 · s_a2_1');
  expect(page.url()).toContain('#deck=a2');
  await page.goto('/v2/listening.html#deck=beruf');
  await page.reload();
  await expect(page.locator('#deck')).toHaveValue('all');
});

for (const [voice, message] of [
  ['english', 'Немецкий голос не установлен'],
  ['none', 'Этот браузер не умеет озвучивать текст'],
] as const) test(`no usable voice (${voice}): a clear action, and the task still works`, async ({ page }) => {
  await stubSpeech(page, voice);
  await page.route('**/data/audio/sentences-a1.json', route => route.fulfill({ json: { schemaVersion: 1, entries: [] } }));
  await page.goto('/v2/listening.html');
  const notice = page.locator('#speechNotice');
  await expect(notice).toContainText(message);
  await expect(notice.getByRole('link', { name: 'Как настроить озвучивание' })).toHaveAttribute('href', '../hilfe/vorlesen');
  await expect(page.getByRole('button', { name: 'Прослушать ещё раз' })).toBeEnabled();
  await page.getByRole('button', { name: 'Прослушать ещё раз' }).click();
  await expect(notice).toBeVisible();
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  expect(await events(page)).toBe(1);
});

test('leaving the page stops the sound', async ({ page }) => {
  await stubSpeech(page, 'endless');
  await page.goto('/v2/listening.html');
  await expect(page.getByRole('button', { name: 'Звучит…' })).toBeVisible();
  const log = () => page.evaluate(() => JSON.parse(localStorage.getItem('speechLog') ?? '[]') as string[]);
  expect((await log()).pop()).toBe('speak:Ich heiße Anna.');
  await page.goto('/v2/session.html');
  expect((await log()).pop(), 'pagehide cancelled the playback').toBe('cancel');
  // Moving to the next sentence stops the current one as well.
  await page.goto('/v2/listening.html');
  await expect(page.locator('#meta')).toHaveText('Уровень A1 · s1');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#meta')).not.toHaveText('Уровень A1 · s1');
  const entries = await log();
  expect(entries.lastIndexOf('cancel')).toBeGreaterThan(entries.indexOf('speak:Ich heiße Anna.', entries.indexOf('cancel')));
});

test('keyboard only, interface languages and a phone screen', async ({ page }) => {
  await stubSpeech(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/v2/listening.html');
  await expect(page.locator('#meta')).toHaveText('Уровень A1 · s1');
  for (const [lang, play, title] of [['de', 'Noch einmal hören', 'Hörverstehen'], ['en', 'Play again', 'Listening'], ['ru', 'Прослушать ещё раз', 'Аудирование']] as const) {
    await page.locator('#language').selectOption(lang);
    await expect(page.getByRole('button', { name: play })).toBeVisible();
    await expect(page.locator('#title')).toHaveText(title);
    await expect(page.locator('#meta')).toContainText('s1');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ввод' }).click();
  await page.locator('.dc-card input[type=text]').focus();
  await page.keyboard.type('Ich heiße Anna');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.getByRole('button', { name: 'Дальше', exact: true })).toBeFocused();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Enter');
  await expect(page.locator('#meta')).not.toHaveText('Уровень A1 · s1');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#meta')).toHaveText('Уровень A1 · s1');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#meta')).not.toHaveText('Уровень A1 · s1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


for (const voice of ['english', 'none'] as const) test(`saved A1 audio works without a usable device voice (${voice})`, async ({ page }) => {
  await stubSpeech(page, voice);
  await page.goto('/v2/listening.html');
  await expect.poll(() => spoken(page)).toEqual(['Ich heiße Anna.']);
  await expect(page.locator('#speechNotice')).toBeHidden();
  await expect(page.locator('main')).not.toContainText('Ich heiße Anna');
  expect(await events(page)).toBe(0);
});
