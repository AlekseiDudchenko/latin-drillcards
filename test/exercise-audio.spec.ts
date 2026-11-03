import { test, expect } from '@playwright/test';

// #424: one audio behavior for every exercise — the word card's switch (shared, on by default),
// listen button that a second press stops, and messages only for a manual press.
async function mount(page: import('@playwright/test').Page, speakResult: string) {
  await page.goto('/v2/card-ui-demo.html');
  await page.evaluate(async result => {
    const w = window as any; w.calls = []; w.finish = [];
    const speech = {
      speak(text: string) { w.calls.push(text); return new Promise(resolve => { w.finish.push(() => resolve(result)); }); },
      cancel() { w.calls.push('cancel'); }, dispose() {},
    };
    const control = '/v2/speech-control.js'; const { createSpeechControl } = await import(control);
    const host = document.createElement('div'); host.id = 'bar'; document.body.append(host);
    w.control = createSpeechControl(host, speech, () => 'en');
  }, speakResult);
}

test('hidden until there is text; the shared switch is on by default and is saved', async ({ page }) => {
  await mount(page, 'completed');
  await expect(page.locator('#bar')).toBeHidden();
  await page.evaluate(() => (window as any).control.setText('Salve, Marce.'));
  await expect(page.locator('#bar')).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Read aloud automatically' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('dc_v2_word_auto_speak'))).toBe('0');
  await page.evaluate(() => (window as any).control.autoRead());
  expect(await page.evaluate(() => (window as any).calls.filter((c: string) => c !== 'cancel')), 'switched off: nothing is read by itself').toEqual([]);
});

test('auto-read speaks once; the listen button toggles: a second press stops', async ({ page }) => {
  await mount(page, 'completed');
  await page.evaluate(() => { const c = (window as any).control; c.setText('Salve, Marce.'); c.autoRead(); });
  const listen = page.getByRole('button', { name: 'Listen in Latin' });
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).calls.filter((c: string) => c !== 'cancel'))).toEqual(['Salve, Marce.']);
  await listen.click();
  await expect(listen).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).calls.at(-1))).toBe('cancel');
});

test('a failure is reported after a press, not after automatic reading', async ({ page }) => {
  await mount(page, 'no-voice');
  await page.evaluate(() => { const c = (window as any).control; c.setText('Salve, Marce.'); c.autoRead(); });
  await page.evaluate(() => (window as any).finish.shift()());
  await expect(page.locator('#speechStatus')).toHaveText('');
  await page.getByRole('button', { name: 'Listen in Latin' }).click();
  await page.evaluate(() => (window as any).finish.shift()());
  await expect(page.locator('#speechStatus')).toHaveText('No Latin or Italian voice found. Install one in your device settings.');
  await page.evaluate(() => (window as any).control.setText('Puella rosam amat.'));
  await expect(page.locator('#speechStatus'), 'a new text clears the old message').toHaveText('');
});
