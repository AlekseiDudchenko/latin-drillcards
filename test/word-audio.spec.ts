import { test, expect } from '@playwright/test';

test('the initial B2 batch has 105 recordings and plays a real MP3 through the card speaker', async ({ page }) => {
  await page.goto('/v2/card-ui-demo.html');
  const count = await page.evaluate(async () => {
    const response = await fetch('/data/audio/words-b2.json');
    const data = await response.json();
    return data.entries.length;
  });
  expect(count).toBe(105);
  await page.evaluate(async () => {
    const path = '/v2/card-speech.js'; const { createCardSpeech } = await import(path);
    const button = document.createElement('button'); button.id = 'recorded-audio-test'; button.textContent = 'Play recorded B2';
    const synth = new EventTarget() as any;
    synth.getVoices = () => []; synth.cancel = () => {};
    synth.speak = () => { throw new Error('This word must use the recording'); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    const speaker = createCardSpeech();
    button.onclick = () => { (window as any).recordedResult = speaker.speak('wesentlich'); };
    document.body.append(button);
  });
  await page.locator('#recorded-audio-test').click();
  expect(await page.evaluate(async () => await (window as any).recordedResult)).toBe('completed');
});

test('recording paths follow the configured site base and missing words keep the device fallback', async ({ page }) => {
  await page.route('**/audio-base-test.html', route => route.fulfill({ contentType: 'text/html', body: '<html><head><base href="/de-trainer/"></head><body></body></html>' }));
  await page.goto('/audio-base-test.html');
  const result = await page.evaluate(async () => {
    const path = '/v2/recorded-audio.js'; const { recordedSpeechUrl } = await import(path);
    return { known: await recordedSpeechUrl('  die   Maßnahme  '), sentence: await recordedSpeechUrl('Ich heiße Anna.'), missing: await recordedSpeechUrl('ein nicht aufgenommenes Wort') };
  });
  expect(result.known).toMatch(/\/de-trainer\/audio\/words\/b2\/[a-f0-9]{64}\.mp3$/);
  expect(result.sentence).toMatch(/\/de-trainer\/audio\/sentences\/a1\/[a-f0-9]{64}\.mp3$/);
  expect(result.missing).toBeUndefined();
});
