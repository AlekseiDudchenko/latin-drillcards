import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answerTokens, arrangeTokens, becameFilled, dropIndex, initialTokenState, placeToken, resetTokens, returnToken,
  shiftToken, shuffledOrder, tokenAnswerText, toggleToken, validateTokens, validateTokenState } from '../public/v2/token-state.js';
import { konjunktivTokenCard, sentenceAssemblyCard } from '../public/v2/token-tasks.js';

// "ich" twice: identity must come from the ID, not the text.
const tokens = answerTokens('s', ['Weil', 'ich', 'heute', 'habe,', 'kann', 'ich', 'kommen']);
const ids = tokens.map(token => token.id);

function assertPermutation(state) {
  assert.deepEqual([...state.pool, ...state.answer].sort(), [...ids].sort());
}

test('duplicate texts get distinct, source-positional IDs', () => {
  assert.deepEqual(ids, ['s:0', 's:1', 's:2', 's:3', 's:4', 's:5', 's:6']);
  assert.equal(tokens[1].text, tokens[5].text);
  validateTokens(tokens);
  assert.throws(() => validateTokens([...tokens, { id: 's:0', text: 'x' }]), RangeError);
  assert.throws(() => validateTokens([{ id: 'a', text: ' ' }]), RangeError);
  assert.throws(() => validateTokens([]), RangeError);
});

test('placing and returning one duplicate leaves the other where it is', () => {
  let state = initialTokenState(tokens);
  state = placeToken(tokens, state, 's:5');
  state = placeToken(tokens, state, 's:1');
  assert.deepEqual(state.answer, ['s:5', 's:1']);
  state = returnToken(tokens, state, 's:5');
  assert.deepEqual(state.answer, ['s:1']);
  // Returned to its original slot, not appended.
  assert.deepEqual(state.pool, ['s:0', 's:2', 's:3', 's:4', 's:5', 's:6']);
  assertPermutation(state);
});

test('reorder, insert at index, toggle and reset never lose or duplicate tokens', () => {
  let state = initialTokenState(tokens);
  for (const id of ids) state = toggleToken(tokens, state, id);
  assert.equal(tokenAnswerText(tokens, state), 'Weil ich heute habe, kann ich kommen');
  state = shiftToken(tokens, state, 's:6', -2);
  assert.deepEqual(state.answer.slice(-3), ['s:6', 's:4', 's:5']);
  state = placeToken(tokens, state, 's:0', 99);
  assert.equal(state.answer.at(-1), 's:0');
  state = placeToken(tokens, state, 's:0', -5);
  assert.equal(state.answer[0], 's:0');
  assert.equal(shiftToken(tokens, state, 's:0', -1), state, 'moving the first token left is a no-op');
  assert.equal(shiftToken(tokens, initialTokenState(tokens), 's:0', 1).answer.length, 0, 'pool tokens do not shift');
  state = toggleToken(tokens, state, 's:3');
  assertPermutation(state);
  state = resetTokens(tokens);
  assert.deepEqual(state, { pool: ids, answer: [] });
  // Randomised walk: the invariant holds after any operation sequence.
  let random = 7;
  const next = () => (random = (random * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const id = ids[Math.floor(next() * ids.length)];
    const op = Math.floor(next() * 4);
    state = op === 0 ? toggleToken(tokens, state, id) : op === 1 ? placeToken(tokens, state, id, Math.floor(next() * 9) - 1)
      : op === 2 ? shiftToken(tokens, state, id, next() < 0.5 ? -1 : 1) : returnToken(tokens, state, id);
    assertPermutation(state);
  }
});

test('no-op moves return the same state object so the shell skips a rerender', () => {
  const state = placeToken(tokens, initialTokenState(tokens), 's:2');
  assert.equal(placeToken(tokens, state, 's:2'), state);
  assert.equal(returnToken(tokens, state, 's:3'), state);
  assert.throws(() => placeToken(tokens, state, 'nope'), RangeError);
});

test('autocheck fires only on the transition into a full answer', () => {
  let state = initialTokenState(tokens);
  for (const id of ids.slice(0, -1)) state = placeToken(tokens, state, id);
  const full = placeToken(tokens, state, 's:6');
  assert.equal(becameFilled(state, full), true);
  assert.equal(becameFilled(full, shiftToken(tokens, full, 's:6', -1)), false, 'reordering a full answer');
  assert.equal(becameFilled(full, full), false, 'rerender');
  const one = answerTokens('k', ['käme']);
  assert.equal(becameFilled(initialTokenState(one), placeToken(one, initialTokenState(one), 'k:0')), true);
});

test('snapshots are validated and the pool is canonicalised', () => {
  const restored = validateTokenState(tokens, { pool: ['s:6', 's:0', 's:2', 's:3', 's:4', 's:5'], answer: ['s:1'] });
  assert.deepEqual(restored.pool, ['s:0', 's:2', 's:3', 's:4', 's:5', 's:6']);
  assert.throws(() => validateTokenState(tokens, { pool: ids.slice(1), answer: [] }), RangeError, 'lost token');
  assert.throws(() => validateTokenState(tokens, { pool: ids, answer: ['s:0'] }), RangeError, 'duplicated token');
  assert.throws(() => validateTokenState(tokens, { pool: [...ids.slice(1), 'x'], answer: [] }), RangeError, 'unknown token');
  assert.throws(() => validateTokenState(tokens, null), RangeError);
});

test('display order is a validated permutation and shuffles are permutations', () => {
  assert.deepEqual(arrangeTokens(tokens.slice(0, 3), [2, 0, 1]).map(token => token.id), ['s:2', 's:0', 's:1']);
  assert.throws(() => arrangeTokens(tokens.slice(0, 3), [0, 0, 1]), RangeError);
  assert.throws(() => arrangeTokens(tokens.slice(0, 3), [0, 1]), RangeError);
  assert.throws(() => arrangeTokens(tokens.slice(0, 3), [0, 1, 3]), RangeError);
  for (let n = 0; n < 12; n++) assert.deepEqual(shuffledOrder(n).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
  assert.deepEqual(shuffledOrder(4, () => 0), [1, 2, 3, 0]);
});

test('drop index follows reading order across wrapped rows', () => {
  const rects = [
    { left: 0, right: 40, top: 0, bottom: 20 }, { left: 50, right: 90, top: 0, bottom: 20 },
    { left: 0, right: 40, top: 30, bottom: 50 },
  ];
  assert.equal(dropIndex(rects, 5, 10), 0);
  assert.equal(dropIndex(rects, 30, 10), 1);
  assert.equal(dropIndex(rects, 200, 10), 2, 'past the end of row one goes before row two');
  assert.equal(dropIndex(rects, 5, 40), 2);
  assert.equal(dropIndex(rects, 200, 40), 3);
  assert.equal(dropIndex(rects, 0, 100), 3);
  assert.equal(dropIndex([], 0, 0), 0);
});

test('two families map published content onto the same token input', () => {
  const sentences = JSON.parse(readFileSync(new URL('../public/data/sentences-a2.json', import.meta.url), 'utf8'));
  const k2 = JSON.parse(readFileSync(new URL('../public/data/konjunktiv2-transformation.json', import.meta.url), 'utf8'));
  const sentence = sentenceAssemblyCard(sentences.find(item => item.id === 's_a2_1'), 'ru', [1, 0, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(sentence.input.kind, 'tokens');
  assert.equal(sentence.input.autoSubmit, true);
  assert.equal(sentence.prompt.lang, 'ru');
  assert.equal(sentence.speechText, 'Weil ich heute Spätdienst habe, kann ich nicht kommen.');
  assert.deepEqual(sentence.input.tokens.slice(0, 2), [{ id: 's_a2_1:1', text: 'ich' }, { id: 's_a2_1:0', text: 'Weil' }]);
  assert.equal(new Set(sentence.input.tokens.map(token => token.id)).size, 9);
  assert.equal(sentenceAssemblyCard(sentences[0], 'en').prompt.text, sentences[0].translation_en);
  assert.throws(() => sentenceAssemblyCard({ ...sentences[0], translation_en: '' }, 'en'), RangeError);
  assert.deepEqual(Object.keys(sentence.title).sort(), ['de', 'en', 'ru']);

  const konjunktiv = konjunktivTokenCard(k2[0], 'ru');
  assert.equal(konjunktiv.input.kind, 'tokens');
  assert.equal(konjunktiv.input.autoSubmit, false, 'distractors: the learner checks explicitly');
  assert.equal(konjunktiv.prompt.lang, 'de');
  assert.equal(konjunktiv.speechText, undefined);
  assert.deepEqual(konjunktiv.input.tokens.map(token => token.text).sort(), [...k2[0].tokens].sort());
  assert.throws(() => konjunktivTokenCard({ id: 'x', sentence: 'y' }, 'ru'), RangeError);

  // Every published record of both families maps onto valid tokens.
  for (const file of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'arch', 'beruf']) {
    for (const item of JSON.parse(readFileSync(new URL(`../public/data/sentences-${file}.json`, import.meta.url), 'utf8'))) {
      validateTokens(sentenceAssemblyCard(item, 'ru').input.tokens);
    }
  }
  for (const file of ['transformation', 'conditional', 'polite', 'past']) {
    for (const item of JSON.parse(readFileSync(new URL(`../public/data/konjunktiv2-${file}.json`, import.meta.url), 'utf8'))) {
      validateTokens(konjunktivTokenCard(item, 'ru').input.tokens);
    }
  }
});
