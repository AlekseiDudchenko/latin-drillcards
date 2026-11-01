import { test, expect, type Page } from '@playwright/test';

// M6 (#338) user paths on /v2/video.html with a fake YouTube IFrame API: clips stop at their
// pause point, replay, text/tokens, saved position after reload, the same segment as standalone
// assembly, shorts/full, translations, player errors, releasing the player, keyboard and phone.
const FAKE_YT = `(() => {
  const log = entry => { const all = JSON.parse(localStorage.getItem('ytLog') ?? '[]'); all.push(entry); localStorage.setItem('ytLog', JSON.stringify(all)); };
  class Player {
    constructor(element, options) {
      this.time = 0; this.state = -1; this.options = options; this.timer = undefined;
      const frame = document.createElement('iframe'); frame.title = 'YouTube ' + options.videoId; element.replaceWith(frame);
      log('create:' + options.videoId); setTimeout(() => options.events.onReady(), 0);
    }
    setState(state) { if (this.state !== state) { this.state = state; this.options.events.onStateChange({ data: state }); } }
    playVideo() { clearInterval(this.timer); log('play@' + this.time); this.setState(1); this.timer = setInterval(() => { this.time = Math.round((this.time + 0.2) * 10) / 10; }, 20); }
    pauseVideo() { clearInterval(this.timer); if (this.state === 1) log('pause@' + this.time); this.setState(2); }
    seekTo(seconds) { this.time = seconds; log('seek:' + seconds); }
    getCurrentTime() { return this.time; }
    destroy() { clearInterval(this.timer); log('destroy'); }
  }
  window.YT = { Player };
  window.onYouTubeIframeAPIReady?.();
})();`;

type Content = { target: string; tokens: string[]; translations: Record<string, string>; video: { start: number; end: number } };
type Dataset = { id: string; items: { id: string; content: Content }[] };
const sets = new Map<string, Dataset>();
test.beforeAll(async ({ request }) => {
  for (const id of ['4JTUflVw1v4', 'z_ujBh2lLGg', 'd2hv-koUGwg']) sets.set(id, await (await request.get(`/data/items/video-${id}.json`)).json());
});
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
  await page.addInitScript(() => {
    const voice = { lang: 'de-DE', name: 'Test', default: true, localService: true, voiceURI: 'test' };
    const spoken: string[] = []; (window as unknown as { spoken: string[] }).spoken = spoken;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [voice], addEventListener() {}, removeEventListener() {}, cancel() {}, pending: false, speaking: false,
      speak(u: { text: string; onend?: () => void }) { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); },
    } });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class { lang = ''; voice: unknown; onend?: () => void; onerror?: () => void; constructor(public text: string) {} };
  });
});

const short = () => sets.get('4JTUflVw1v4')!;
const ytLog = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ytLog') ?? '[]') as string[]);
const status = (page: Page) => page.locator('.dc-status').first();
const meta = (page: Page) => page.locator('#meta');
async function shownSegment(page: Page, dataset = short()) {
  // #meta is empty between renders (view switch, next segment); wait for it instead of reading null.
  await expect(meta(page)).toHaveText(/\d+ (?:из|of|von) /);
  const text = await meta(page).textContent();
  const n = Number(/(\d+) (?:из|of|von) /.exec(text!)![1]);
  return dataset.items[n - 1]!.content;
}
async function assemble(page: Page, order?: number[], dataset = short()) {
  const { tokens } = await shownSegment(page, dataset);
  for (const i of order ?? [...tokens.keys()]) await page.locator(`[data-token-zone=pool] [data-token-id="t${i}"]`).click();
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

test('dictation: the clip stops at its pause point, replay writes nothing, the answer reveals text and translation', async ({ page }) => {
  await page.goto('/v2/video.html#v=4JTUflVw1v4');
  await expect(meta(page)).toHaveText('Уровень B1 · Фрагмент 1 из 20');
  await expect(page.locator('#player')).toHaveClass(/dc-video-portrait/);
  await expect(page.locator('#player iframe')).toHaveAttribute('title', 'YouTube 4JTUflVw1v4');
  await expect(page.locator('.dc-prompt')).toHaveText('Посмотрите фрагмент и соберите фразу');
  const main = page.locator('main');
  await expect(main).not.toContainText('Was machst du da?');
  await expect(main).not.toContainText('Что ты там делаешь?');
  const replay = page.getByRole('button', { name: 'Повторить фрагмент' });
  await replay.click();
  await expect.poll(async () => (await ytLog(page)).filter(e => e.startsWith('pause@')).length).toBe(1);
  const log = await ytLog(page);
  expect(log).toContain('seek:0');
  expect(Number(log.find(e => e.startsWith('pause@'))!.slice(6)), 'pauses at the segment end').toBeGreaterThanOrEqual(3.7);
  expect(Number(log.find(e => e.startsWith('pause@'))!.slice(6))).toBeLessThan(4.6);
  await replay.click();
  await expect.poll(async () => (await ytLog(page)).filter(e => e.startsWith('pause@')).length).toBe(2);
  expect(await events(page), 'replaying is never an answer').toBe(0);
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('.dc-listening-target')).toHaveText('Was machst du da?');
  await expect(page.locator('.dc-listening-translation')).toHaveText('Перевод: Что ты там делаешь?');
  await page.getByText('Другие переводы').click();
  await expect(page.locator('.dc-translations p[lang=es]')).toHaveText('ES: ¿Qué estás haciendo ahí?');
  await expect(page.locator('#stats')).toContainText('Этот фрагмент: ответов 1, с первой попытки 1');
  expect(await events(page)).toBe(1);
  // Next plays the next clip from the previous pause point.
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(meta(page)).toHaveText('Уровень B1 · Фрагмент 2 из 20');
  await expect.poll(async () => (await ytLog(page)).includes('seek:3.7')).toBe(true);
  expect(await events(page)).toBe(1);
});

test('reload keeps the segment, the mode and the answer; typing uses the dictation rule', async ({ page }) => {
  await page.goto('/v2/video.html#v=4JTUflVw1v4');
  await expect(meta(page)).toContainText('Фрагмент 1 из 20');
  await assemble(page);
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(meta(page)).toContainText('Фрагмент 2 из 20');
  await page.getByRole('button', { name: 'Ввод' }).click();
  await expect(page.locator('.dc-prompt')).toHaveText('Посмотрите фрагмент и напишите фразу');
  await expect(meta(page), 'the mode switch keeps the segment').toContainText('Фрагмент 2 из 20');
  await page.reload();
  await expect(meta(page)).toContainText('Фрагмент 2 из 20');
  await expect(page.getByRole('button', { name: 'Ввод' })).toHaveAttribute('aria-pressed', 'true');
  const input = page.locator('.dc-card input[type=text]');
  await input.fill('ich schneide meine spitzen');
  await input.press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await page.reload();
  await expect(meta(page)).toContainText('Фрагмент 2 из 20');
  await expect(status(page)).toHaveText('Верно!');
  await expect(input).toHaveValue('ich schneide meine spitzen');
  expect(await events(page)).toBe(2);
  // Previous returns to clip 1 and seeks back to its start.
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(meta(page)).toContainText('Фрагмент 1 из 20');
  await expect.poll(async () => (await ytLog(page)).filter(e => e === 'seek:0').length).toBeGreaterThan(0);
});

test('the same segment as standalone assembly, with its own statistics; back to the dictation position', async ({ page }) => {
  await page.goto('/v2/video.html#v=4JTUflVw1v4');
  await expect(meta(page)).toContainText('Фрагмент 1 из 20');
  await assemble(page);
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(meta(page)).toContainText('Фрагмент 2 из 20');
  await page.getByRole('button', { name: 'Предложения' }).click();
  await expect(page.locator('#player')).toBeHidden();
  expect(await ytLog(page)).toContain('destroy');
  await expect(meta(page), 'assembly starts on the same segment').toContainText('Фрагмент 2 из 20');
  await expect(page.locator('.dc-prompt')).toHaveText('Я подстригаю кончики волос.');
  await expect(page.locator('#stats')).toContainText('Этот фрагмент: ещё без ответа');
  await expect(page.locator('#stats')).toContainText('Это видео (Предложения)');
  await assemble(page, [3, 2, 1, 0]);
  await expect(status(page)).toHaveText('Не совсем. Правильно: Ich schneide meine Spitzen.');
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.locator('#stats')).toContainText('ответов 2, с первой попытки 0');
  expect(page.url()).toContain('view=sentences');
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expect(page.locator('.dc-prompt')).not.toHaveText('Я подстригаю кончики волос.');
  expect(await events(page)).toBe(3);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Предложения' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Диктант' }).click();
  await expect(meta(page), 'the saved dictation position').toContainText('Фрагмент 2 из 20');
  await expect(page.locator('.dc-prompt')).toHaveText('Посмотрите фрагмент и соберите фразу');
  await expect(page.locator('#stats')).toContainText('Этот фрагмент: ещё без ответа');
});

test('full-length video without translations: dictation only; the end of a video and Start over', async ({ page }) => {
  await page.goto('/v2/video.html#v=z_ujBh2lLGg&view=sentences');
  await expect(page.locator('#noAssembly')).toHaveText('У этого видео нет переводов, поэтому доступен только диктант.');
  await expect(page.getByRole('button', { name: 'Предложения' })).toBeDisabled();
  await expect(page.locator('#player')).not.toHaveClass(/dc-video-portrait/);
  await expect(meta(page)).toHaveText('Уровень B2 · Фрагмент 1 из 221');
  // A two-clip video reaches its end.
  const two = { ...sets.get('d2hv-koUGwg')!, items: sets.get('d2hv-koUGwg')!.items.slice(0, 2) };
  await page.route('**/data/items/video-d2hv-koUGwg.json', route => route.fulfill({ json: two }));
  await page.locator('#video').selectOption('d2hv-koUGwg');
  await expect(meta(page)).toHaveText('Уровень B2 · Фрагмент 1 из 2');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(meta(page)).toHaveText('Уровень B2 · Фрагмент 2 из 2');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#finishedText')).toHaveText('Все фрагменты пройдены!');
  await expect(page.locator('.dc-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать заново' }).click();
  await expect(meta(page)).toHaveText('Уровень B2 · Фрагмент 1 из 2');
  expect(await events(page), 'skipping clips is no answer').toBe(0);
});

test('player errors are explicit: retry, a speech fallback, and the task still works', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.abort());
  await page.goto('/v2/video.html#v=4JTUflVw1v4');
  const notice = page.locator('#mediaNotice');
  await expect(notice).toContainText('Не удалось загрузить плеер YouTube.');
  await expect(page.getByRole('button', { name: 'Повторить фрагмент' })).toBeDisabled();
  await page.getByRole('button', { name: 'Прослушать синтезатором речи' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual(['Was machst du da?']);
  await expect(page.locator('main')).not.toContainText('Was machst du da?');
  await assemble(page);
  await expect(status(page)).toHaveText('Верно!');
  await page.unroute('https://www.youtube.com/iframe_api');
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
  await page.getByRole('button', { name: 'Загрузить видео снова' }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole('button', { name: 'Повторить фрагмент' })).toBeEnabled();
});

test('offline: no promise of offline playback; leaving releases the player', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.goto('/v2/video.html#v=4JTUflVw1v4');
  await expect(page.locator('#mediaNotice')).toContainText('Нет соединения. Видео YouTube воспроизводится только онлайн');
  await page.evaluate(() => localStorage.removeItem('ytLog'));
  // Online again: the player loads; leaving the page destroys it.
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }));
  await page.reload();
  await expect(page.locator('#player iframe')).toBeVisible();
  await page.goto('/v2/session.html');
  expect(await ytLog(page)).toContain('destroy');
});

test('keyboard only, interface languages and a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/v2/video.html#v=4JTUflVw1v4');
  await expect(meta(page)).toHaveText('Уровень B1 · Фрагмент 1 из 20');
  for (const [lang, replay, segment] of [['de', 'Ausschnitt wiederholen', 'Ausschnitt 1 von 20'], ['en', 'Replay clip', 'Clip 1 of 20'], ['ru', 'Повторить фрагмент', 'Фрагмент 1 из 20']] as const) {
    await page.locator('#language').selectOption(lang);
    await expect(page.getByRole('button', { name: replay })).toBeVisible();
    await expect(meta(page)).toContainText(segment);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('r');
  await expect.poll(async () => (await ytLog(page)).some(e => e.startsWith('play@'))).toBe(true);
  await page.getByRole('button', { name: 'Ввод' }).click();
  await page.locator('.dc-card input[type=text]').focus();
  await page.keyboard.type('Was machst du da');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Верно!');
  await expect(page.getByRole('button', { name: 'Дальше', exact: true })).toBeFocused();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Enter');
  await expect(meta(page)).toContainText('Фрагмент 2 из 20');
  await page.keyboard.press('ArrowLeft');
  await expect(meta(page)).toContainText('Фрагмент 1 из 20');
  await page.keyboard.press('ArrowRight');
  await expect(meta(page)).toContainText('Фрагмент 2 из 20');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
