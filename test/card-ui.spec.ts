import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { uiHarness: any; voiceHarness: any }
}

async function harness(page: Page, kind = 'text', opts: { autoSpeak?: 'start' | 'correct'; speech?: boolean; examples?: boolean } = {}) {
  await page.goto('/v2/card-ui-demo.html');
  await page.evaluate(async ({ kind, opts }) => {
    const path = '/v2/card-shell.js';
    const { createCardShell, cardLabels } = await import(path);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    window.uiHarness = { submissions: [], continuations: [], reveals: [], played: [], cancelled: 0, disposed: 0, mode: 'ok', revealMode: 'ok', speechMode: 'ok' };
    const h = window.uiHarness;
    h.presentation = { language: 'en', permissions: { reveal: true, details: true, speech: !!opts.speech } };
    const input = kind === 'introduction' ? { kind } : kind === 'choice' ? { kind, answerLang: 'la', options: [{ id: 'x', label: '<b>literal</b>' }, { id: 'y', label: 'Tisch' }] }
      : kind === 'reveal' ? { kind, answer: 'secret answer', answerLang: 'en' } : { kind: 'text', answerLang: 'la' };
    h.shell = createCardShell(host, { id: 'test-task', prompt: { text: 'A prompt', lang: 'en' }, input,
      translationLanguage: 'ru', speechText: 'der Tisch', ...(opts.autoSpeak ? { autoSpeak: opts.autoSpeak } : {}), word: { schemaVersion: 1, contentVersion: 1, id: 'word-1', lemma: '<img src=x onerror=alert(1)>', partOfSpeech: 'noun', senseId: 'sense', article: 'der', meanings: { ru: { preferred: 'стол', accepted: ['стол'] } }, acceptedForms: [], examples: opts.examples ? [{ de: 'Der Tisch ist groß.', translations: { ru: 'Стол большой.' } }, { de: 'Das Buch liegt auf dem Tisch.', translations: { ru: 'Книга лежит на столе.' } }] : [], tags: [] } }, h.presentation, {
      onChange(state: unknown) { h.state = state; },
      onContinue(id: string) { h.continuations.push(id); },
      onSubmit(answer: unknown) {
        h.submissions.push(answer);
        if (h.mode === 'fail') return Promise.reject(new Error('offline'));
        if (h.mode === 'defer') return new Promise<void>((resolve, reject) => { h.finish = resolve; h.fail = reject; });
      },
      onReveal(_id: string, reason: string) {
        h.reveals.push(reason);
        if (h.revealMode === 'defer') return new Promise<void>(resolve => { h.finishReveal = resolve; });
      },
      onSpeech() {
        if (h.speechMode === 'defer') return new Promise<void>(resolve => { h.finishSpeech = resolve; });
      },
    }, undefined, { labels: cardLabels, speech: {
      speak: async (text: string) => { h.played.push(text); if (h.holdSpeech) await new Promise<void>(resolve => { h.endSpeech = resolve; }); return 'completed'; },
      cancel: () => { h.cancelled++; }, dispose: () => { h.disposed++; },
    } });
  }, { kind, opts });
}

test('typing, option identity and submitted state survive all UI languages', async ({ page }) => {
  await page.goto('/v2/card-ui-demo.html');
  await expect(page.locator('#choice')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#text').click();
  await page.getByRole('textbox').fill('Tisch mit Ä');
  for (const language of ['en', 'de', 'ru']) {
    await page.locator('#language').selectOption(language);
    await expect(page.getByRole('textbox')).toHaveValue('Tisch mit Ä');
    await expect(page.locator('.dc-prompt')).toHaveText('стол');
  }
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('textbox')).toBeDisabled();
  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('textbox')).toHaveValue('Tisch mit Ä');
  await expect(page.getByRole('textbox')).toBeDisabled();
  await page.locator('#choice').click();
  const options = await page.locator('.dc-choice span').allTextContents();
  await page.getByRole('radio').nth(2).check();
  await page.locator('#language').selectOption('de');
  expect(await page.locator('.dc-choice span').allTextContents()).toEqual(options);
  await expect(page.getByRole('radio').nth(2)).toBeChecked();
  for (const language of ['ru', 'en']) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('.dc-card')).toHaveAttribute('lang', language);
    await expect(page.locator('.dc-choice span').first()).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('radio').first()).toHaveAttribute('lang', 'de');
  }
});

test('keyboard selects by number and native text Enter ignores IME composition', async ({ page }) => {
  await harness(page, 'choice');
  await page.getByRole('radio').first().focus();
  await page.keyboard.press('2');
  await expect(page.getByRole('radio').nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Check', exact: true }).press('Enter');
  await expect.poll(() => page.evaluate(() => window.uiHarness.submissions.length)).toBe(1);
  await harness(page);
  await page.getByRole('textbox').fill('Tisch');
  await page.getByRole('textbox').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(await page.evaluate(() => window.uiHarness.submissions.length)).toBe(0);
  await page.getByRole('textbox').press('Enter');
  await expect.poll(() => page.evaluate(() => window.uiHarness.submissions.length)).toBe(1);
});

test('reveal is absent from DOM until its command succeeds, and rating survives localization', async ({ page }) => {
  await harness(page, 'reveal');
  await page.evaluate(() => { window.uiHarness.revealMode = 'defer'; });
  await expect(page.locator('body')).not.toContainText('secret answer');
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await expect(page.locator('body')).not.toContainText('secret answer');
  await page.evaluate(() => window.uiHarness.finishReveal());
  await expect(page.locator('.dc-revealed-answer')).toHaveText('secret answer');
  await page.getByRole('button', { name: 'Remembered', exact: true }).click();
  await page.evaluate(() => {
    const h = window.uiHarness; h.presentation = { ...h.presentation, language: 'ru' }; h.shell.setPresentation(h.presentation);
  });
  await expect(page.getByRole('button', { name: 'Помню', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Помню', exact: true })).toBeDisabled();
});

test('introduction has continuation only and never submits an answer rating', async ({ page }) => {
  await harness(page, 'introduction');
  await expect(page.locator('.dc-word-details')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remembered', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiHarness.continuations.length)).toBe(1);
  expect(await page.evaluate(() => window.uiHarness.submissions.length)).toBe(0);
  await expect(page.locator('.dc-status')).toHaveText('Ready to continue');
});

test('submission is single-flight across rerender, and failed commands preserve drafts for retry', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => { window.uiHarness.mode = 'defer'; });
  await page.getByRole('textbox').fill('Tisch');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.evaluate(() => {
    const h = window.uiHarness; h.presentation = { ...h.presentation, language: 'de' }; h.shell.setPresentation(h.presentation);
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.uiHarness.submissions.length)).toBe(1);
  await page.evaluate(() => window.uiHarness.fail(new Error('offline')));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Tisch');
  await expect(page.getByRole('textbox')).toBeEnabled();
  await page.evaluate(() => { window.uiHarness.mode = 'ok'; });
  await page.getByRole('button', { name: 'Prüfen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiHarness.submissions.length)).toBe(2);
});

test('permitted speech waits for exposure command and revocation prevents stale playback', async ({ page }) => {
  await harness(page);
  await expect(page.getByRole('button', { name: 'Listen in German' })).toBeDisabled();
  await page.evaluate(() => {
    const h = window.uiHarness; h.speechMode = 'defer'; h.presentation.permissions = { ...h.presentation.permissions, speech: true }; h.shell.setPresentation(h.presentation);
  });
  await page.getByRole('button', { name: 'Listen in German' }).click();
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual([]);
  await page.evaluate(() => {
    const h = window.uiHarness; h.presentation.permissions = { ...h.presentation.permissions, speech: false }; h.shell.setPresentation(h.presentation); h.finishSpeech();
  });
  await expect(page.getByRole('textbox')).toBeEnabled();
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual([]);
});

test('listen is an icon-only toggle in the card corner: a second press stops the speech', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => {
    const h = window.uiHarness; h.holdSpeech = true; h.presentation.permissions = { ...h.presentation.permissions, speech: true }; h.shell.setPresentation(h.presentation);
  });
  const listen = page.getByRole('button', { name: 'Listen in German' });
  await expect(listen).toHaveText('');
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  const idleThumb = await listen.locator('.dc-speak-thumb').evaluate(node => getComputedStyle(node).transform);
  const box = await listen.boundingBox(), card = await page.locator('.dc-card').boundingBox();
  expect(card!.x + card!.width - (box!.x + box!.width)).toBeLessThan(24);
  expect(box!.y - card!.y).toBeLessThan(24);
  await listen.click();
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => listen.locator('.dc-speak-thumb').evaluate(node => getComputedStyle(node).transform)).not.toBe(idleThumb);
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual(['der Tisch']);
  const cancelled = await page.evaluate(() => window.uiHarness.cancelled);
  await listen.click();
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.uiHarness.cancelled)).toBe(cancelled + 1);
  // The stopped speech finishing late must not flip the toggle back or play again.
  await page.evaluate(() => window.uiHarness.endSpeech());
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual(['der Tisch']);
});

test('details record disclosure before mounting and render catalog text without HTML injection', async ({ page }) => {
  await harness(page);
  await page.getByRole('button', { name: 'Word details', exact: true }).click();
  await expect(page.locator('.dc-word-details')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.dc-word-details img')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiHarness.reveals)).toEqual(['word-details']);
  await page.evaluate(() => {
    const h = window.uiHarness; h.presentation = { ...h.presentation, language: 'de' }; h.shell.setPresentation(h.presentation);
  });
  await expect(page.locator('.dc-word-details')).toContainText('стол');
  await page.getByRole('button', { name: 'Details ausblenden' }).click();
  await expect(page.locator('.dc-word-details')).toHaveCount(0);
});

test('German examples play on click, switch playback, stop on a second click and keep auto-speech unchanged', async ({ page }) => {
  await harness(page, 'introduction', { speech: true, autoSpeak: 'start', examples: true });
  const toggle = page.getByRole('switch');
  await toggle.click();
  await page.evaluate(() => { window.uiHarness.holdSpeech = true; });
  const examples = page.locator('.dc-example-speech');
  await expect(examples).toHaveCount(2);
  await expect(page.locator('.dc-word-details blockquote').first()).toContainText('Стол большой.');
  await examples.first().click();
  await expect(examples.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dc-pronunciation .dc-word-speech')).toHaveAttribute('aria-pressed', 'false');
  await examples.nth(1).click();
  await expect(examples.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(examples.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await examples.nth(1).click();
  await expect(examples.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await examples.first().press('Space');
  await expect(examples.first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.dc-pronunciation .dc-word-speech').click();
  await expect(examples.first()).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.uiHarness.played)).toEqual([
    'der Tisch', 'Der Tisch ist groß.', 'Das Buch liegt auf dem Tisch.', 'Der Tisch ist groß.', 'der Tisch',
  ]);
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => window.uiHarness.submissions)).toEqual([]);
});

test('dispose removes handlers and ignores completion of an in-flight command', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => { window.uiHarness.mode = 'defer'; });
  await page.getByRole('textbox').fill('Tisch');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.evaluate(() => {
    const h = window.uiHarness; const detached = document.querySelector('form')!;
    h.shell.dispose(); detached.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); h.finish();
  });
  await expect(page.locator('.dc-card')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiHarness.submissions.length)).toBe(1);
  expect(await page.evaluate(() => window.uiHarness.disposed)).toBe(1);
});

for (const width of [360, 768, 1280]) test(`card fits ${width}px and keeps selection through theme changes`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/v2/card-ui-demo.html');
  await page.getByRole('radio').nth(1).check();
  await page.locator('#theme').click();
  await expect(page.getByRole('radio').nth(1)).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (width === 360) await page.screenshot({ path: testInfo.outputPath('card-mobile.png'), fullPage: true });
});

async function speechHarness(page: Page, voices: string[] = []) {
  await page.route('**/data/audio/words-b2.json', route => route.fulfill({ json: { schemaVersion: 1, entries: [] } }));
  await page.goto('/v2/card-ui-demo.html');
  await page.evaluate(async voices => {
    const synth = new EventTarget() as any;
    window.voiceHarness = { synth, voices, spoken: [], cancelled: 0 };
    const h = window.voiceHarness;
    synth.getVoices = () => h.voices.map((lang: string) => ({ lang, name: lang, default: true }));
    synth.cancel = () => { h.cancelled++; };
    synth.speak = (u: any) => { h.spoken.push(u); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
    const audioPath = '/v2/recorded-audio.js'; const { recordedSpeechUrl } = await import(audioPath); await recordedSpeechUrl('');
    const path = '/v2/card-speech.js'; const { createCardSpeech } = await import(path);
    h.first = createCardSpeech(); h.second = createCardSpeech();
  }, voices);
}

test('speech waiting for voices cannot start after disposal, and English fallback is refused', async ({ page }) => {
  await speechHarness(page);
  const result = await page.evaluate(async () => {
    const h = window.voiceHarness; const pending = h.first.speak('Tisch'); h.first.dispose();
    h.voices = ['de-DE']; h.synth.dispatchEvent(new Event('voiceschanged')); return await pending;
  });
  expect(result).toBe('cancelled');
  expect(await page.evaluate(() => window.voiceHarness.spoken.length)).toBe(0);
  await speechHarness(page, ['en-US']);
  expect(await page.evaluate(() => window.voiceHarness.first.speak('Tisch'))).toBe('no-voice');
  expect(await page.evaluate(() => window.voiceHarness.spoken.length)).toBe(0);
});

test('disposing an old speaker does not cancel a newer card playback', async ({ page }) => {
  await speechHarness(page, ['de-DE']);
  const result = await page.evaluate(async () => {
    const h = window.voiceHarness;
    const first = h.first.speak('eins'); await new Promise(resolve => setTimeout(resolve, 20));
    const pending = h.second.speak('zwei'); await new Promise(resolve => setTimeout(resolve, 20));
    const cancelled = h.cancelled; h.first.dispose();
    const oldDidNotCancel = h.cancelled === cancelled;
    h.spoken[1].onend();
    return { oldDidNotCancel, previousResult: await first, result: await pending, lang: h.spoken[1].lang };
  });
  expect(result).toEqual({ oldDidNotCancel: true, previousResult: 'cancelled', result: 'completed', lang: 'de-DE' });
});

test('a newer request cancels an old voice wait before late voiceschanged can start it', async ({ page }) => {
  await speechHarness(page);
  const result = await page.evaluate(async () => {
    const h = window.voiceHarness;
    const older = h.first.speak('older');
    h.voices = ['de-DE'];
    const newer = h.second.speak('newer'); await new Promise(resolve => setTimeout(resolve, 20));
    const cancellations = h.cancelled;
    h.synth.dispatchEvent(new Event('voiceschanged'));
    const unchanged = h.cancelled === cancellations;
    const texts = h.spoken.map((u: any) => u.text);
    h.spoken[0].onend();
    return { oldResult: await older, newResult: await newer, unchanged, texts };
  });
  expect(result).toEqual({ oldResult: 'cancelled', newResult: 'completed', unchanged: true, texts: ['newer'] });
});

test('autoSpeak start: the word is read as soon as the card appears, and a click still stops it', async ({ page }) => {
  await page.goto('/v2/card-ui-demo.html');
  await page.evaluate(() => { window.uiHarness = undefined; });
  await harness(page, 'choice', { autoSpeak: 'start', speech: true });
  const listen = page.getByRole('button', { name: 'Listen in German' });
  await expect.poll(() => page.evaluate(() => window.uiHarness.played)).toEqual(['der Tisch']);
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('.dc-speech-warning').count()).toBe(0);
});

test('autoSpeak start is silent when speech is not allowed yet', async ({ page }) => {
  await harness(page, 'choice', { autoSpeak: 'start' });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual([]);
});

test('autoSpeak correct: read once the answer is accepted as correct', async ({ page }) => {
  await harness(page, 'text', { autoSpeak: 'correct', speech: true });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual([]);
  await page.evaluate(() => { const h = window.uiHarness; h.presentation = { ...h.presentation, feedback: { kind: 'correct' } }; h.shell.setPresentation(h.presentation); });
  await expect.poll(() => page.evaluate(() => window.uiHarness.played)).toEqual(['der Tisch']);
  // Presenting the same feedback again is not a new answer.
  await page.evaluate(() => { const h = window.uiHarness; h.shell.setPresentation({ ...h.presentation }); });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual(['der Tisch']);
});

test('autoSpeak correct: a wrong answer is not read', async ({ page }) => {
  await harness(page, 'text', { autoSpeak: 'correct', speech: true });
  await page.evaluate(() => { const h = window.uiHarness; h.presentation = { ...h.presentation, feedback: { kind: 'incorrect' } }; h.shell.setPresentation(h.presentation); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.uiHarness.played)).toEqual([]);
});

test('while it reads, the listen button shows a stop icon that stays visible under the mouse', async ({ page }) => {
  await harness(page, 'text', { speech: true });
  await page.evaluate(() => { window.uiHarness.holdSpeech = true; });
  const listen = page.getByRole('button', { name: 'Listen in German' });
  await listen.click();
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
  await expect(listen.locator('svg rect')).toHaveCount(1);
  await listen.hover();
  const [background, accent] = await listen.evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(document.querySelector('.dc-card')!).getPropertyValue('--dc-accent').trim()]);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  expect(accent).not.toBe('');
  await listen.click();
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  await expect(listen.locator('svg rect')).toHaveCount(0);
});

test('a reading that ends without an end event does not leave the card playing', async ({ page }) => {
  await speechHarness(page, ['de-DE']);
  const result = await page.evaluate(async () => {
    const h = window.voiceHarness; h.synth.speaking = true; h.synth.pending = false;
    const reading = h.first.speak('Tisch'); setTimeout(() => { h.synth.speaking = false; }, 100); return await reading;
  });
  expect(result).toBe('completed');
});


test('B2 recordings work without a device voice, cancellation prevents late audio, failures fall back', async ({ page }) => {
  await speechHarness(page, ['de-DE']);
  // Reload clears the cached empty manifest from the generic speech harness.
  await page.unroute('**/data/audio/words-b2.json');
  await page.route('**/data/audio/words-b2.json', route => route.fulfill({ json: {
    schemaVersion: 1, entries: [{ text: 'die Voraussetzung', url: 'https://audio.example/b2.mp3' }],
  } }));
  await page.reload();
  const result = await page.evaluate(async () => {
    const played: any[] = []; const spoken: any[] = [];
    const synth = new EventTarget() as any;
    synth.getVoices = () => [{ lang: 'de-DE', name: 'German' }]; synth.cancel = () => {};
    synth.speak = (u: any) => { spoken.push(u); queueMicrotask(() => u.onend?.()); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(public text: string) {} } });
    let fail = false;
    Object.defineProperty(window, 'Audio', { configurable: true, value: class {
      onended: (() => void) | null = null; onerror: (() => void) | null = null;
      paused = false; constructor(public src: string) { played.push(this); }
      play() { if (fail) return Promise.reject(new Error('offline')); return Promise.resolve(); }
      pause() { this.paused = true; } removeAttribute() {} load() {}
    } });
    const path = '/v2/card-speech.js'; const { createCardSpeech } = await import(path);
    const speaker = createCardSpeech();
    const wait = () => new Promise(resolve => setTimeout(resolve, 20));
    const cancelled = speaker.speak('die Voraussetzung'); speaker.cancel();
    await wait(); const cancelledDidNotPlay = played.length === 0;
    const first = speaker.speak('die Voraussetzung'); await wait();
    const firstFile = played[0]?.src; played[0].onended();
    const completed = await first;
    const stopped = speaker.speak('die Voraussetzung'); await wait(); speaker.cancel();
    const paused = played[1].paused;
    fail = true; const fallback = await speaker.speak('die Voraussetzung');
    const other = await speaker.speak('anderes Wort');
    speaker.dispose();
    return { cancelled: await cancelled, cancelledDidNotPlay, firstFile, completed, stopped: await stopped, paused, fallback, other, spoken: spoken.map(u => u.text) };
  });
  expect(result).toEqual({ cancelled: 'cancelled', cancelledDidNotPlay: true, firstFile: 'https://audio.example/b2.mp3', completed: 'completed', stopped: 'cancelled', paused: true, fallback: 'completed', other: 'completed', spoken: ['die Voraussetzung', 'anderes Wort'] });
});
