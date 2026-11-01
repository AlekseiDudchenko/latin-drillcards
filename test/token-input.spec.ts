import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { tokenHarness: any }
}

// Sentence s_a2_1 in a fixed display order; "ich" is s_a2_1:1 and s_a2_1:6.
const SENTENCE_ORDER = [6, 3, 0, 8, 1, 5, 2, 7, 4];
const SENTENCE_IDS = SENTENCE_ORDER.map(index => `s_a2_1:${index}`);

async function harness(page: Page, family: 'sentence' | 'konjunktiv' = 'sentence') {
  await page.goto('/v2/card-ui-demo.html');
  await page.evaluate(async ({ family, order }) => {
    const shellPath = '/v2/card-shell.js'; const tasksPath = '/v2/token-tasks.js';
    const { createCardShell } = await import(shellPath);
    const { sentenceAssemblyCard, konjunktivTokenCard } = await import(tasksPath);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const definition = family === 'sentence'
      ? sentenceAssemblyCard({ id: 's_a2_1', target: 'Weil ich heute Spätdienst habe, kann ich nicht kommen.',
        tokens: ['Weil', 'ich', 'heute', 'Spätdienst', 'habe,', 'kann', 'ich', 'nicht', 'kommen'], translation_ru: 'Так как у меня сегодня поздняя смена, я не могу прийти.' }, 'ru', order)
      : konjunktivTokenCard({ id: 'k2t_002', sentence: 'Wenn er (kommen) ___, wäre ich froh.', tokens: ['käme', 'kommen', 'würde', 'kämen', 'kommt'] }, 'ru', [0, 1, 2, 3, 4]);
    window.tokenHarness = { submissions: [], changes: 0, mode: 'ok' };
    const h = window.tokenHarness;
    h.presentation = { language: 'en', permissions: { reveal: false, details: false, speech: false } };
    h.shell = createCardShell(host, definition, h.presentation, {
      onChange(state: unknown) { h.changes++; h.state = state; },
      onSubmit(answer: unknown) {
        h.submissions.push(answer);
        if (h.mode === 'fail') return Promise.reject(new Error('offline'));
        if (h.mode === 'defer') return new Promise<void>((resolve, reject) => { h.finish = resolve; h.fail = reject; });
      },
      onReveal() {}, onSpeech() {},
    });
  }, { family, order: SENTENCE_ORDER });
}

const answerIds = (page: Page) => page.locator('[data-token-zone=answer] [data-token-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.tokenId));
const poolIds = (page: Page) => page.locator('[data-token-zone=pool] [data-token-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.tokenId));
const token = (page: Page, id: string) => page.locator(`[data-token-id="${id}"]`);
const submissions = (page: Page) => page.evaluate(() => window.tokenHarness.submissions);

test('click places and returns tokens; duplicates are distinct by ID', async ({ page }) => {
  await harness(page);
  await expect(page.locator('.dc-token-empty')).toHaveText('Tap or drag words here');
  // Both "ich" buttons share a label but not an identity.
  await expect(page.getByRole('button', { name: 'ich', exact: true })).toHaveCount(2);
  await token(page, 's_a2_1:6').click();
  await token(page, 's_a2_1:0').click();
  await token(page, 's_a2_1:1').click();
  expect(await answerIds(page)).toEqual(['s_a2_1:6', 's_a2_1:0', 's_a2_1:1']);
  await token(page, 's_a2_1:6').click();
  expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:1']);
  // Returned to its original slot (first), not appended to the pool.
  expect((await poolIds(page))[0]).toBe('s_a2_1:6');
  expect(await page.evaluate(() => window.tokenHarness.state)).toMatchObject({ value: 'Weil ich', tokens: { answer: ['s_a2_1:0', 's_a2_1:1'] } });
  expect([...await answerIds(page), ...await poolIds(page)].sort()).toEqual([...SENTENCE_IDS].sort());
  await expect(token(page, 's_a2_1:1')).toHaveAttribute('lang', 'de');
});

test('keyboard builds, reorders and returns tokens with focus kept on the work', async ({ page }) => {
  await harness(page);
  await token(page, 's_a2_1:6').focus();
  await page.keyboard.press('Enter');
  // Focus moves to the next pool token so the learner can keep going.
  await expect(token(page, 's_a2_1:3')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(token(page, 's_a2_1:0')).toBeFocused();
  await page.keyboard.press(' ');
  expect(await answerIds(page)).toEqual(['s_a2_1:6', 's_a2_1:0']);
  await token(page, 's_a2_1:0').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:6']);
  await expect(token(page, 's_a2_1:0')).toBeFocused();
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:6']);
  await page.keyboard.press('Backspace');
  expect(await answerIds(page)).toEqual(['s_a2_1:6']);
  await expect(token(page, 's_a2_1:6')).toBeFocused();
  await page.keyboard.press('Delete');
  expect(await answerIds(page)).toEqual([]);
  expect(await poolIds(page)).toEqual(SENTENCE_IDS);
  await expect(token(page, 's_a2_1:6')).toBeFocused();
  expect(await submissions(page)).toEqual([]);
});

test('drag inserts at the drop position, reorders and drags back to the pool', async ({ page }) => {
  await harness(page);
  await token(page, 's_a2_1:0').click();
  await token(page, 's_a2_1:1').click();
  // Drop the second "ich" on the left half of "Weil": it goes first.
  await token(page, 's_a2_1:6').dragTo(token(page, 's_a2_1:0'), { targetPosition: { x: 2, y: 10 } });
  expect(await answerIds(page)).toEqual(['s_a2_1:6', 's_a2_1:0', 's_a2_1:1']);
  // Reorder within the answer: drop "ich" (6) after the first "ich" (1).
  const last = await token(page, 's_a2_1:1').boundingBox();
  await token(page, 's_a2_1:6').dragTo(page.locator('[data-token-zone=answer]'), { targetPosition: await page.locator('[data-token-zone=answer]').evaluate((zone, box) => {
    const rect = zone.getBoundingClientRect(); return { x: box!.x + box!.width + 4 - rect.x, y: box!.y + box!.height / 2 - rect.y };
  }, last) });
  expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:1', 's_a2_1:6']);
  // Drag back to the pool.
  await token(page, 's_a2_1:0').dragTo(page.locator('[data-token-zone=pool]'));
  expect(await answerIds(page)).toEqual(['s_a2_1:1', 's_a2_1:6']);
  // Dropping outside both zones snaps back without change or a stray click toggle.
  await token(page, 's_a2_1:1').dragTo(page.locator('.dc-prompt'));
  expect(await answerIds(page)).toEqual(['s_a2_1:1', 's_a2_1:6']);
  await expect(page.locator('.dc-dragging')).toHaveCount(0);
  expect([...await answerIds(page), ...await poolIds(page)].sort()).toEqual([...SENTENCE_IDS].sort());
});

test('reset returns every token to the original pool order', async ({ page }) => {
  await harness(page, 'konjunktiv');
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
  await token(page, 'k2t_002:2').click();
  await token(page, 'k2t_002:1').click();
  await token(page, 'k2t_002:4').click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  expect(await answerIds(page)).toEqual([]);
  expect(await poolIds(page)).toEqual(['k2t_002:0', 'k2t_002:1', 'k2t_002:2', 'k2t_002:3', 'k2t_002:4']);
  await expect(token(page, 'k2t_002:0')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeDisabled();
});

test('rerender and language switch keep order, focus and state; snapshots restore', async ({ page }) => {
  await harness(page);
  for (const id of ['s_a2_1:0', 's_a2_1:6', 's_a2_1:1']) await token(page, id).click();
  await token(page, 's_a2_1:6').focus();
  for (const language of ['de', 'ru', 'en']) {
    await page.evaluate(language => {
      const h = window.tokenHarness; h.presentation = { ...h.presentation, language }; h.shell.setPresentation(h.presentation);
    }, language);
    expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:6', 's_a2_1:1']);
    expect(await poolIds(page)).toEqual(['s_a2_1:3', 's_a2_1:8', 's_a2_1:5', 's_a2_1:2', 's_a2_1:7', 's_a2_1:4']);
    await expect(token(page, 's_a2_1:6')).toBeFocused();
  }
  await expect(page.getByRole('heading')).toHaveText('Build the sentence');
  const snapshot = await page.evaluate(() => window.tokenHarness.shell.getState());
  expect(snapshot.value).toBe('Weil ich ich');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.evaluate(snapshot => window.tokenHarness.shell.restoreState(snapshot), snapshot);
  expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:6', 's_a2_1:1']);
  // A snapshot that loses a token or disagrees with its text is refused.
  const refused = await page.evaluate(snapshot => {
    const h = window.tokenHarness; const errors: string[] = [];
    for (const bad of [{ ...snapshot, tokens: { ...snapshot.tokens, pool: snapshot.tokens.pool.slice(1) } }, { ...snapshot, value: 'Weil' },
      { ...snapshot, value: '', submitted: true, tokens: { pool: [...snapshot.tokens.pool, ...snapshot.tokens.answer], answer: [] } }]) {
      try { h.shell.restoreState(bad); } catch (error) { errors.push((error as Error).name); }
    }
    return errors;
  }, snapshot);
  expect(refused).toEqual(['RangeError', 'RangeError', 'RangeError']);
  expect(await answerIds(page)).toEqual(['s_a2_1:0', 's_a2_1:6', 's_a2_1:1']);
});

test('demo page: both families switch UI language without losing the answer', async ({ page }) => {
  await page.goto('/v2/card-ui-demo.html');
  await page.locator('#sentence').click();
  await expect(page.getByRole('heading')).toHaveText('Соберите предложение');
  await token(page, 's_a2_1:1').click(); await token(page, 's_a2_1:6').click();
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('heading')).toHaveText('Bilde den Satz');
  expect(await answerIds(page)).toEqual(['s_a2_1:1', 's_a2_1:6']);
  await page.locator('#konjunktiv').click();
  await expect(page.getByRole('heading')).toHaveText('Ergänze die Lücke im Konjunktiv II');
  await token(page, 'k2t_002:1').click(); await token(page, 'k2t_002:2').click();
  await page.locator('#language').selectOption('en');
  expect(await answerIds(page)).toEqual(['k2t_002:1', 'k2t_002:2']);
  await expect(page.locator('.dc-prompt')).toHaveText('Wenn er (kommen) ___, wäre ich froh.');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText('Answer accepted');
  await expect(token(page, 'k2t_002:1')).toBeDisabled();
});

test('autocheck on fill submits exactly once, even with Check, Enter and rerender racing it', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => { window.tokenHarness.mode = 'defer'; });
  for (const id of SENTENCE_IDS.slice(0, -1)) await token(page, id).click();
  expect(await submissions(page)).toEqual([]);
  await token(page, SENTENCE_IDS[SENTENCE_IDS.length - 1]!).click();
  await expect.poll(async () => (await submissions(page)).length).toBe(1);
  await page.evaluate(() => {
    const h = window.tokenHarness; h.presentation = { ...h.presentation, language: 'de' }; h.shell.setPresentation(h.presentation);
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    (document.querySelector('button[type=submit]') as HTMLButtonElement).click();
  });
  await page.keyboard.press('Enter');
  expect(await submissions(page)).toEqual([{ taskId: 'sentence:s_a2_1', kind: 'tokens', value: 'ich Spätdienst Weil kommen ich kann heute nicht habe,', tokens: SENTENCE_IDS }]);
  await page.evaluate(() => window.tokenHarness.finish());
  await expect(page.locator('.dc-status')).toHaveText('Antwort angenommen');
  await expect(token(page, 's_a2_1:6')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Zurücksetzen', exact: true })).toBeDisabled();
  await page.evaluate(() => { const h = window.tokenHarness; h.shell.setPresentation({ ...h.presentation, language: 'en' }); });
  expect((await submissions(page)).length).toBe(1);
});

test('a failed autocheck keeps the answer, never resubmits by itself, and Check retries', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => { window.tokenHarness.mode = 'fail'; });
  for (const id of SENTENCE_IDS) await token(page, id).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await answerIds(page)).toEqual(SENTENCE_IDS);
  // Reordering a full answer is not a new "fill" transition.
  await token(page, SENTENCE_IDS[1]!).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  expect((await submissions(page)).length).toBe(1);
  await page.evaluate(() => { window.tokenHarness.mode = 'ok'; });
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect.poll(async () => (await submissions(page)).length).toBe(2);
  expect((await submissions(page))[1].tokens.slice(0, 2)).toEqual([SENTENCE_IDS[1], SENTENCE_IDS[0]]);
});

test('distractor family never autochecks; Check submits the token IDs once', async ({ page }) => {
  await harness(page, 'konjunktiv');
  await page.evaluate(() => { window.tokenHarness.mode = 'defer'; });
  for (const id of ['k2t_002:1', 'k2t_002:2']) await token(page, id).click();
  expect(await submissions(page)).toEqual([]);
  await page.getByRole('button', { name: 'Check', exact: true }).dblclick();
  expect(await submissions(page)).toEqual([{ taskId: 'konjunktiv2:k2t_002', kind: 'tokens', value: 'kommen würde', tokens: ['k2t_002:1', 'k2t_002:2'] }]);
});

test('dispose aborts an active drag and removes all handlers', async ({ page }) => {
  await harness(page);
  const box = (await token(page, 's_a2_1:0').boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
  await expect(token(page, 's_a2_1:0')).toHaveClass(/dc-dragging/);
  const detached = await page.evaluate(() => {
    const h = window.tokenHarness; const before = h.changes;
    const dragged = document.querySelector('[data-token-id="s_a2_1:0"]') as HTMLButtonElement;
    const other = document.querySelector('[data-token-id="s_a2_1:3"]') as HTMLButtonElement;
    h.shell.dispose();
    other.click();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, isPrimary: true, clientX: 0, clientY: 0 }));
    return { changed: h.changes !== before, dragging: dragged.classList.contains('dc-dragging') || dragged.style.transform !== '' };
  });
  await page.mouse.up();
  expect(detached).toEqual({ changed: false, dragging: false });
  await expect(page.locator('.dc-card')).toHaveCount(0);
  expect(await submissions(page)).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('fits 360px, tokens are touch-sized, and tapping builds the answer', async ({ page }, testInfo) => {
    await page.goto('/v2/card-ui-demo.html');
    await page.locator('#sentence').tap();
    for (const id of SENTENCE_IDS.slice(0, 5)) await token(page, id).tap();
    expect(await answerIds(page)).toEqual(SENTENCE_IDS.slice(0, 5));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const heights = await page.locator('[data-token-id]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    await page.locator('#theme').tap();
    expect(await answerIds(page)).toEqual(SENTENCE_IDS.slice(0, 5));
    await page.screenshot({ path: testInfo.outputPath('tokens-mobile.png'), fullPage: true });
    for (const id of SENTENCE_IDS.slice(5)) await token(page, id).tap();
    await expect(page.locator('.dc-status')).toHaveText('Ответ принят');
    await expect(token(page, SENTENCE_IDS[0]!)).toBeDisabled();
  });
});
