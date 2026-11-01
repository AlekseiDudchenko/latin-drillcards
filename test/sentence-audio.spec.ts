import { test, expect } from '@playwright/test';

for (const [text, voice] of [['Ich heiße Anna.', 'de-DE-KatjaNeural'], ['Ich komme aus Deutschland.', 'de-DE-ConradNeural']]) {
  test(`A1 plays a real recording with ${voice} even without a system German voice`, async ({ page }) => {
    await page.goto('/v2/card-ui-demo.html');
    const entry = await page.evaluate(async text => {
      const manifest = await (await fetch('/data/audio/sentences-a1.json')).json();
      return manifest.entries.find((entry: { text: string }) => entry.text === text);
    }, text);
    expect(entry.voice).toBe(voice);
    await page.evaluate(async text => {
      const synth = new EventTarget() as any;
      synth.getVoices = () => []; synth.cancel = () => {};
      synth.speak = () => { throw new Error('The saved sentence must not use system speech'); };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
      const path = '/v2/card-speech.js'; const { createCardSpeech } = await import(path);
      const speaker = createCardSpeech(); const button = document.createElement('button');
      button.id = 'sentence-recording-test'; button.textContent = 'Play saved A1 sentence';
      button.onclick = () => { (window as any).sentenceRecording = speaker.speak(text); };
      document.body.append(button);
    }, text);
    await page.locator('#sentence-recording-test').click();
    expect(await page.evaluate(() => (window as any).sentenceRecording)).toBe('completed');
  });
}

test('A1 manifest covers all 130 source sentences, alternating two voices', async ({ request }) => {
  const source = await (await request.get('/data/sentences-a1.json')).json();
  const manifest = await (await request.get('/data/audio/sentences-a1.json')).json();
  expect(manifest.entries).toHaveLength(130);
  expect(manifest.entries.map((entry: { text: string }) => entry.text)).toEqual(source.map((row: { target: string }) => row.target));
  const counts: Record<string, number> = {};
  for (const [index, entry] of manifest.entries.entries()) {
    expect(entry.voice).toBe(index % 2 === 0 ? 'de-DE-KatjaNeural' : 'de-DE-ConradNeural');
    expect(entry.url).toMatch(/^audio\/sentences\/a1\/[a-f0-9]{64}\.mp3$/);
    counts[entry.voice] = (counts[entry.voice] ?? 0) + 1;
  }
  expect(counts).toEqual({ 'de-DE-KatjaNeural': 65, 'de-DE-ConradNeural': 65 });
});

test('a failed word manifest does not suppress A1 recordings, malformed entries are ignored', async ({ page }) => {
  await page.route('**/data/audio/words-b2.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.route('**/data/audio/sentences-a1.json', route => route.fulfill({ json: { schemaVersion: 1, entries: [
    { text: 'invalid', url: 'https://[' }, { text: 'unsafe', url: 'javascript:alert(1)' },
    { text: 'Ich heiße Anna.', url: 'audio/sentences/a1/anna.mp3' },
  ] } }));
  await page.goto('/v2/card-ui-demo.html');
  const result = await page.evaluate(async () => {
    const path = '/v2/recorded-audio.js'; const { recordedSpeechUrl } = await import(path);
    return { known: await recordedSpeechUrl('  Ich   heiße Anna.  '), unsafe: await recordedSpeechUrl('unsafe'), missing: await recordedSpeechUrl('No such sentence') };
  });
  expect(result.known).toMatch(/\/audio\/sentences\/a1\/anna\.mp3$/);
  expect(result.unsafe).toBeUndefined(); expect(result.missing).toBeUndefined();
});

test('a failed A1 manifest keeps the existing B2 recordings available', async ({ page }) => {
  await page.route('**/data/audio/sentences-a1.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/v2/card-ui-demo.html');
  const url = await page.evaluate(async () => {
    const path = '/v2/recorded-audio.js'; const { recordedSpeechUrl } = await import(path);
    return recordedSpeechUrl('wesentlich');
  });
  expect(url).toMatch(/\/audio\/words\/b2\/[a-f0-9]{64}\.mp3$/);
});
