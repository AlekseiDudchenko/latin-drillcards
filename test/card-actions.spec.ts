import { test, expect } from '@playwright/test';

for (const kind of ['regular', 'cloze'] as const) {
  test(`${kind}: Check waits for acceptance; Next shares its slot, locks pending commands and retries failures`, async ({ page }) => {
    await page.goto('/v2/cloze-demo.html');
    await expect(page.locator('.dc-cloze')).toBeVisible();
    await page.evaluate(async kind => {
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const h: any = (window as any).actionsHarness = { submits: 0, advances: 0 };
      const actions = {
        onSubmit() { h.submits++; return new Promise<void>((resolve, reject) => { h.accept = resolve; h.reject = reject; }); },
        onNext() { h.advances++; return new Promise<void>((resolve, reject) => { h.nextDone = resolve; h.nextFail = reject; }); },
        onReveal() {}, onSpeech() {},
      };
      if (kind === 'regular') {
        const path = '/v2/card-shell.js'; const { createCardShell } = await import(path);
        createCardShell(host, { id: 'regular', prompt: { text: 'Translate', lang: 'en' },
          input: { kind: 'text', answerLang: 'de' }, translationLanguage: 'en' },
        { language: 'en', permissions: { reveal: false, details: false, speech: false } }, actions);
      } else {
        const path = '/v2/cloze-input.js'; const { createClozeCard } = await import(path);
        createClozeCard(host, { id: 'cloze', answerLang: 'de', segments: [{ kind: 'slot', slotId: 'a' }],
          slots: [{ slotId: 'a', input: 'text' }] }, { language: 'en' }, actions);
      }
    }, kind);
    const check = page.getByRole('button', { name: 'Check', exact: true });
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(check).toBeDisabled();
    await expect(next).toHaveCount(0);
    await page.getByRole('textbox').fill('Antwort');
    const before = await check.boundingBox();
    await check.click();
    await expect(check).toBeDisabled();
    await expect(next).toHaveCount(0);
    await page.evaluate(() => (window as any).actionsHarness.reject(new Error('offline')));
    await expect(check).toBeEnabled();
    await expect(page.getByRole('textbox')).toHaveValue('Antwort');
    await check.click();
    await page.evaluate(() => (window as any).actionsHarness.accept());
    await expect(next).toBeFocused();
    await expect(check).toHaveCount(0);
    await expect(page.getByRole('textbox')).toBeDisabled();
    expect((await next.boundingBox())!.y).toBe(before!.y);
    await next.click();
    await expect(next).toBeDisabled();
    await page.evaluate(() => (window as any).actionsHarness.nextFail(new Error('offline')));
    await expect(next).toBeEnabled();
    await expect(page.getByRole('textbox')).toHaveValue('Antwort');
    await next.click();
    await page.evaluate(() => (window as any).actionsHarness.nextDone());
    await expect(next).toBeEnabled();
    expect(await page.evaluate(() => {
      const h = (window as any).actionsHarness; return { submits: h.submits, advances: h.advances };
    })).toEqual({ submits: 2, advances: 2 });
  });
}
