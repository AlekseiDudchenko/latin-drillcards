import { test, expect } from '@playwright/test';

test('meaning-choice uses the real evaluator, preserves options and does not reveal details before answering', async ({ page }) => {
  await page.goto('/v2/word-exercises-demo.html');
  await expect(page.locator('.dc-prompt')).toHaveText('der Tisch');
  await expect(page.getByRole('button', { name: 'О слове', exact: true })).toHaveCount(0);
  const options = await page.locator('.dc-choice span').allTextContents();
  await page.getByRole('radio', { name: 'стол', exact: true }).check();
  await page.locator('#language').selectOption('en');
  expect(await page.locator('.dc-choice span').allTextContents()).toEqual(options);
  await expect(page.getByRole('radio', { name: 'стол', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText('Correct');
  await page.getByRole('button', { name: 'Word details', exact: true }).click();
  await expect(page.locator('.dc-word-details')).toContainText('стол');
});

test('reverse choice checks stable word IDs and gates German audio until feedback', async ({ page }) => {
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('german-choice');
  await expect(page.locator('.dc-prompt')).toHaveText('стол');
  await expect(page.locator('.dc-word-speech:enabled')).toHaveCount(0);
  await page.getByRole('radio', { name: 'der Stuhl', exact: true }).check();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText('Не совсем');
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeEnabled();
});

test('meaning recall reveals the fixed translation before subjective rating and supports translation changes only as new tasks', async ({ page }) => {
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('meaning-recall');
  await expect(page.locator('.dc-revealed-answer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Показать ответ' }).click();
  await expect(page.locator('.dc-revealed-answer')).toHaveText('стол');
  await page.locator('#language').selectOption('de');
  await expect(page.locator('.dc-revealed-answer')).toHaveText('стол');
  await page.getByRole('button', { name: 'Gewusst', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText('Richtig');
  await page.locator('#translation').selectOption('en');
  await expect(page.locator('.dc-revealed-answer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Antwort zeigen', exact: true }).click();
  await expect(page.locator('.dc-revealed-answer')).toHaveText('table');
});

test('introduction reuses WordDetails with no right/wrong answer or self-rating', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('introduction');
  await expect(page.locator('.dc-word-details')).toContainText('стол');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Помню', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText('Можно продолжать');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('typed German preserves the draft across locales and separates recall from spelling', async ({ page }) => {
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('german-type');
  await expect(page.locator('.dc-prompt')).toHaveText('стол');
  await expect(page.locator('.dc-word-speech:enabled')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'О слове', exact: true })).toHaveCount(0);
  await page.getByRole('textbox').fill('tisch');
  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('textbox')).toHaveValue('tisch');
  await expect(page.getByRole('textbox')).toHaveAttribute('lang', 'de');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('.dc-status')).toContainText('Word recall: Correct');
  await expect(page.locator('.dc-status')).toContainText('Spelling: Not quite');
  await expect(page.locator('.dc-status')).toContainText('Expected answer: Tisch');
  await expect(page.locator('.dc-status')).not.toContainText('Article:');
  await page.locator('#language').selectOption('de');
  await expect(page.locator('.dc-status')).toContainText('Wortabruf: Richtig');
  await expect(page.locator('.dc-status')).toContainText('Schreibweise: Nicht ganz');
});

test('combined typing reports a wrong article without losing correct word and spelling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('german-with-article-type');
  await page.getByRole('textbox').fill('die Tisch');
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toContainText('Знание слова: Правильно');
  await expect(page.locator('.dc-status')).toContainText('Написание: Правильно');
  await expect(page.locator('.dc-status')).toContainText('Артикль: Не совсем');
  await expect(page.locator('.dc-status')).toContainText('Правильный ответ: der Tisch');
  await expect(page.getByRole('textbox')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('article choice shows a bare noun and article IDs while audio remains gated until feedback', async ({ page }) => {
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('article-choice');
  await expect(page.locator('.dc-prompt')).toHaveText('Tisch');
  await expect(page.locator('.dc-word-speech:enabled')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(3);
  await page.getByRole('radio', { name: 'der', exact: true }).check();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.dc-status')).toHaveText('Артикль: Правильно. Правильный ответ: der');
  await expect(page.getByRole('button', { name: 'Прослушать по-немецки' })).toBeEnabled();
});

test('a wrong lexical answer does not show success for spelling or article', async ({ page }) => {
  await page.goto('/v2/word-exercises-demo.html');
  await page.locator('#exercise').selectOption('german-with-article-type');
  await page.getByRole('textbox').fill('der Stuhl');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('.dc-status')).toContainText('Знание слова: Не совсем');
  await expect(page.locator('.dc-status')).toContainText('Написание: Не оценено');
  await expect(page.locator('.dc-status')).toContainText('Артикль: Не оценено');
});
