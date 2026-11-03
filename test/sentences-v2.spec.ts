import { test, expect, type Page } from '@playwright/test';

// M1 (#333) user paths on /v2/sentences.html: filters, linked tense/word-order variants,
// alternatives, retry, prev/next without lost or doubled answers, statistics, TTS, keyboard,
// interface languages and a phone screen. The dataset is a slice of the committed one.
const pick = ['s1', 's_b1_23', 's_b1_23v', 's_b1_237', 's_b1_147', 's_b1_238', 's_b1_239', 's_b1_240', 's_beruf_1'];
type Content = { target: string; tokens: string[]; alternatives: string[]; translations: Record<string, string> };
let dataset: { items: { id: string; content: Content }[] };
let byId: Map<string, { content: Content }>;
let recordings: { text: string; url: string }[];
test.beforeAll(async ({ request }) => {
  const full = await (await request.get('/data/items/sentences.json')).json();
  dataset = { ...full, items: full.items.filter((item: { id: string }) => pick.includes(item.id)) };
  byId = new Map(dataset.items.map(item => [item.id, item]));
  recordings = (await (await request.get('/data/audio/sentences-a1.json')).json()).entries;
});

test.beforeEach(async ({ page }) => {
  await page.route('**/data/items/sentences.json', route => route.fulfill({ json: dataset }));
  // Both saved clips and the German device fallback finish at once.
  await page.addInitScript(recordings => {
    const spoken: string[] = []; (window as unknown as { spoken: string[] }).spoken = spoken;
    Object.defineProperty(window, 'Audio', { configurable: true, value: class {
      onended: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play() {
        const recording = recordings.find(entry => new URL(entry.url, location.origin + '/').href === this.src);
        if (!recording) return Promise.reject(new Error('Unknown recording'));
        spoken.push(recording.text); setTimeout(() => this.onended?.(), 0); return Promise.resolve();
      }
      pause() {} removeAttribute() {} load() {}
    } });
    const voice = { lang: 'de-DE', name: 'Test', default: true, localService: true, voiceURI: 'test' };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [voice], addEventListener() {}, removeEventListener() {}, cancel() {}, pending: false, speaking: false,
      speak(u: { text: string; onend?: () => void }) { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); },
    } });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class { lang = ''; voice: unknown; onend?: () => void; onerror?: () => void; constructor(public text: string) {} };
  }, recordings);
});

const prompt = (page: Page) => page.locator('.dc-prompt');
const status = (page: Page) => page.locator('.dc-status');
async function shownId(page: Page): Promise<string> {
  const text = await prompt(page).textContent();
  return [...byId].find(([, item]) => Object.values(item.content.translations).includes(text!))![0];
}
/** Place tokens by source position (t0, t1, …), i.e. in the target's order unless `order` is given. */
async function assemble(page: Page, order?: number[]) {
  const id = await shownId(page);
  const count = byId.get(id)!.content.tokens.length;
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

test('a correct assembly is saved once, survives reload and Next/Previous, and updates the statistics', async ({ page }) => {
  await page.goto('/v2/sentences.html');
  await expect(prompt(page)).toHaveText('Меня зовут Анна.');
  await expect(page.locator('#stats')).toContainText('ещё без ответа');
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeDisabled();
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('#stats')).toContainText('ответов 1, с первой попытки 1');
  await expect(page.locator('.dc-explanation')).toContainText('Basic introduction');
  expect(await events(page)).toBe(1);
  await page.reload();
  await expect(prompt(page)).toHaveText('Меня зовут Анна.');
  await expect(status(page)).toHaveText('Верно!');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(prompt(page)).not.toHaveText('Меня зовут Анна.');
  const second = await prompt(page).textContent();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(prompt(page)).toHaveText('Меня зовут Анна.');
  await expect(page.locator('[data-token-zone=pool] [data-token-id]')).toHaveCount(3);
  expect(await events(page)).toBe(1);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(prompt(page)).not.toHaveText('Меня зовут Анна.');
  expect(await events(page), 'switching wrote no event').toBe(1);
  expect(second).toBeTruthy();
});

test('a wrong order shows the solution; Try again keeps the order and is not counted as independent', async ({ page }) => {
  await page.goto('/v2/sentences.html');
  const pool = page.locator('[data-token-zone=pool] [data-token-id]');
  const ids = () => pool.evaluateAll(n => n.map(e => (e as HTMLElement).dataset.tokenId));
  await expect(pool).toHaveCount(3);
  const shown = await ids();
  await assemble(page, [2, 1, 0]);
  await expect(status(page)).toHaveText('Не совсем. Правильно: Ich heiße Anna.');
  await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Дальше', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await expect(pool).toHaveCount(3);
  expect(await ids(), 'a retry keeps the token order').toEqual(shown);
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('#stats')).toContainText('ответов 2, с первой попытки 0');
  expect(await events(page)).toBe(2);
});

test('filters, tense family buttons, the word-order variant and accepted alternatives', async ({ page }) => {
  await page.goto('/v2/sentences.html#deck=b1&tag=passiv');
  await expect(page.locator('#deck')).toHaveValue('b1');
  await expect(page.locator('#tag')).toHaveValue('passiv');
  await expect(page.locator('#tag option')).toHaveText(['Все темы', 'Konzession', 'Nebensatz', 'Passiv']);
  const tenses = page.locator('.dc-tense-buttons button');
  await expect(tenses).toHaveText(['Präs.', 'Prät.', 'Perf.', 'Plusq.', 'Fut. I']);
  await page.getByRole('button', { name: 'Perf.' }).click();
  await expect(page.getByRole('button', { name: 'Perf.' })).toHaveAttribute('aria-pressed', 'true');
  await expect(prompt(page)).toHaveText(byId.get('s_b1_238')!.content.translations.ru!);
  // Another level/topic: the sentence with a word-order variant and an alternative order.
  await page.locator('#tag').selectOption('konzession');
  await expect(prompt(page)).toHaveText(byId.get('s_b1_23')!.content.translations.ru!);
  const variant = page.getByRole('button', { name: 'Другой порядок слов' });
  await variant.click();
  await expect(prompt(page)).toHaveText(byId.get('s_b1_23v')!.content.translations.ru!);
  await variant.click();
  await expect(prompt(page)).toHaveText(byId.get('s_b1_23')!.content.translations.ru!);
  // The alternative "… hat sie noch die Präsentation …" is accepted too.
  const { tokens, alternatives } = byId.get('s_b1_23')!.content;
  const used = new Set<number>();
  const order = alternatives[0]!.replace(/\.$/, '').split(' ').map(word => { const i = tokens.findIndex((t, j) => t === word && !used.has(j)); used.add(i); return i; });
  await assemble(page, order);
  await expect(status(page)).toHaveText('Верно!');
  await page.locator('#deck').selectOption('beruf');
  await expect(prompt(page)).toHaveText(byId.get('s_beruf_1')!.content.translations.ru!);
});

test('keyboard only: tokens with Enter, then → next and ← previous; speech after a correct answer', async ({ page }) => {
  await page.goto('/v2/sentences.html');
  // Auto-speech is on by default, as on the word cards.
  await expect(prompt(page)).toHaveText('Меня зовут Анна.');
  for (const i of [0, 1, 2]) { await page.locator(`[data-token-zone=pool] [data-token-id="t${i}"]`).focus(); await page.keyboard.press('Enter'); }
  await expect(status(page)).toHaveText('');
  await page.getByRole('button', { name: 'Проверить', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual(['Ich heiße Anna.']);
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(prompt(page)).not.toHaveText('Меня зовут Анна.');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowLeft');
  await expect(prompt(page)).toHaveText('Меня зовут Анна.');
  await page.keyboard.press('ArrowRight');
  await expect(prompt(page)).not.toHaveText('Меня зовут Анна.');
});

test('interface language switches labels without replacing the task; translations; phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/v2/sentences.html');
  await page.locator('[data-token-zone=pool] [data-token-id="t0"]').click();
  for (const [lang, check] of [['de', 'Prüfen'], ['en', 'Check'], ['ru', 'Проверить']] as const) {
    await page.locator('#language').selectOption(lang);
    await expect(page.getByRole('button', { name: check, exact: true })).toBeVisible();
    await expect(prompt(page)).toHaveText('Меня зовут Анна.');
    await expect(page.locator('[data-token-zone=answer] [data-token-id]')).toHaveCount(1);
  }
  await page.getByText('Другие переводы').click();
  await expect(page.locator('.dc-translations p[lang=en]')).toHaveText('EN: My name is Anna.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#translation').selectOption('en');
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(prompt(page)).toHaveText(/[A-Za-z]/);
});

test('Check and Next share the word-card action slot; an incorrect answer can advance with Enter', async ({ page }) => {
  await page.goto('/v2/sentences.html');
  const check = page.getByRole('button', { name: 'Проверить', exact: true });
  const next = page.getByRole('button', { name: 'Дальше', exact: true });
  await expect(check).toBeDisabled();
  await expect(next).toHaveCount(0);
  await page.locator('[data-token-zone=pool] [data-token-id="t2"]').click();
  await expect(check).toBeEnabled();
  await page.locator('[data-token-zone=pool] [data-token-id="t1"]').click();
  await page.locator('[data-token-zone=pool] [data-token-id="t0"]').click();
  await expect(status(page)).toHaveText('');
  expect(await events(page)).toBe(0);
  const before = await check.boundingBox();
  await check.click();
  await expect(next).toBeFocused();
  await expect(check).toHaveCount(0);
  expect((await next.boundingBox())!.y).toBe(before!.y);
  expect(await events(page)).toBe(1);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).not.toHaveText('Меня зовут Анна.');
  await expect(check).toBeDisabled();
  await expect(next).toHaveCount(0);
  expect(await events(page)).toBe(1);
});
