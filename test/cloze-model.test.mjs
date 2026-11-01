import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClozeTemplate, validateClozeDefinition, emptyClozeState, validateClozeState, setSlotValue, resetCloze,
  isClozeComplete, hasClozeDraft, nextEmptySlot, normalizeClozeText, evaluateCloze } from '../public/v2/cloze-model.js';

const bank = ['wird', 'wurde', 'ist', 'war', 'worden', 'werden'].map(label => ({ id: label, label }));
function cloze(template, input = 'text', id = 'task', options = bank) {
  const { segments, slotIds } = parseClozeTemplate(template);
  return validateClozeDefinition({ id, answerLang: 'de', segments,
    slots: slotIds.map(slotId => input === 'choice' ? { slotId, input, options } : { slotId, input }) });
}
const keyOf = answers => ({ accepted: Object.fromEntries(answers.map((accepted, index) => [`slot-${index + 1}`, accepted])) });

test('templates produce stable positional slot IDs and keep surrounding text', () => {
  const { segments, slotIds } = parseClozeTemplate('Das Gebäude ___ komplett renoviert ___.');
  assert.deepEqual(slotIds, ['slot-1', 'slot-2']);
  assert.deepEqual(segments, [{ kind: 'text', text: 'Das Gebäude ' }, { kind: 'slot', slotId: 'slot-1' },
    { kind: 'text', text: ' komplett renoviert ' }, { kind: 'slot', slotId: 'slot-2' }, { kind: 'text', text: '.' }]);
  assert.deepEqual(parseClozeTemplate('___ und ___').slotIds, parseClozeTemplate('___ und ___').slotIds);
  assert.deepEqual(parseClozeTemplate('___').segments, [{ kind: 'slot', slotId: 'slot-1' }]);
  assert.throws(() => parseClozeTemplate('Kein Platzhalter.'), RangeError);
});

test('definitions are copied and validated: unique slots, each placed once in order, usable options', () => {
  const source = { id: 't', answerLang: 'de', segments: [{ kind: 'slot', slotId: 'a' }], slots: [{ slotId: 'a', input: 'choice', options: bank }] };
  const copy = validateClozeDefinition(source);
  source.slots[0].options = [];
  assert.equal(copy.slots[0].options.length, 6);
  const bad = [
    { id: 't', answerLang: 'de', segments: [], slots: [] },
    { id: 't', answerLang: 'de', segments: [{ kind: 'slot', slotId: 'a' }, { kind: 'slot', slotId: 'a' }], slots: [{ slotId: 'a', input: 'text' }, { slotId: 'a', input: 'text' }] },
    { id: 't', answerLang: 'de', segments: [{ kind: 'slot', slotId: 'b' }, { kind: 'slot', slotId: 'a' }], slots: [{ slotId: 'a', input: 'text' }, { slotId: 'b', input: 'text' }] },
    { id: 't', answerLang: 'de', segments: [], slots: [{ slotId: 'a', input: 'text' }] },
    { id: 't', answerLang: 'de', segments: [{ kind: 'slot', slotId: 'a' }], slots: [{ slotId: 'a', input: 'choice', options: [] }] },
    { id: 't', answerLang: 'de', segments: [{ kind: 'slot', slotId: 'a' }], slots: [{ slotId: 'a', input: 'choice', options: [{ id: 'x', label: 'x' }, { id: 'x', label: 'y' }] }] },
  ];
  for (const definition of bad) assert.throws(() => validateClozeDefinition(definition), RangeError);
});

test('slot state: per-slot writes, completeness, next empty slot and reset', () => {
  const definition = cloze('___ und ___ oder ___');
  let state = emptyClozeState(definition);
  assert.deepEqual(state, { values: { 'slot-1': '', 'slot-2': '', 'slot-3': '' }, submitted: false });
  assert.equal(nextEmptySlot(definition, state), 'slot-1');
  state = setSlotValue(definition, state, 'slot-2', 'Brot');
  assert.equal(hasClozeDraft(state), true);
  assert.equal(nextEmptySlot(definition, state, 'slot-2'), 'slot-3');
  assert.equal(nextEmptySlot(definition, state, 'slot-3'), 'slot-1', 'wraps to the first empty slot');
  state = setSlotValue(definition, setSlotValue(definition, state, 'slot-1', '  '), 'slot-3', 'Käse');
  assert.equal(isClozeComplete(definition, state), false, 'whitespace does not fill a slot');
  state = setSlotValue(definition, state, 'slot-1', 'Milch');
  assert.equal(isClozeComplete(definition, state), true);
  assert.equal(nextEmptySlot(definition, state, 'slot-1'), null);
  assert.throws(() => setSlotValue(definition, state, 'slot-9', 'x'), RangeError);
  const cleared = resetCloze(definition, state);
  assert.deepEqual(cleared, emptyClozeState(definition));
  assert.equal(hasClozeDraft(cleared), false);
});

test('a submitted cloze refuses second writes and reset', () => {
  const definition = cloze('Er ___ müde.', 'choice');
  const submitted = { values: { 'slot-1': 'ist' }, submitted: true };
  assert.equal(setSlotValue(definition, submitted, 'slot-1', 'war'), submitted);
  assert.equal(resetCloze(definition, submitted), submitted);
  assert.throws(() => setSlotValue(definition, emptyClozeState(definition), 'slot-1', 'unknown'), RangeError);
});

test('snapshots are normalized to the definition and rejected when foreign or inconsistent', () => {
  const definition = cloze('Das ___ ist ___.', 'choice');
  assert.deepEqual(validateClozeState(definition, { values: { 'slot-2': 'war' }, submitted: false }),
    { values: { 'slot-1': '', 'slot-2': 'war' }, submitted: false });
  assert.throws(() => validateClozeState(definition, { values: { other: 'x' }, submitted: false }), RangeError);
  assert.throws(() => validateClozeState(definition, { values: { 'slot-1': 'nope' }, submitted: false }), RangeError);
  assert.throws(() => validateClozeState(definition, { values: { 'slot-1': 'ist' }, submitted: true }), RangeError);
  assert.throws(() => validateClozeState(definition, { values: { 'slot-1': 3 }, submitted: false }), RangeError);
  assert.throws(() => validateClozeState(definition, null), RangeError);
});

test('evaluation reports each slot separately', () => {
  const definition = cloze('Das Gebäude ___ komplett renoviert ___.', 'choice');
  const key = keyOf([['ist'], ['worden']]);
  assert.deepEqual(evaluateCloze(definition, key, { 'slot-1': 'ist', 'slot-2': 'worden' }),
    { slots: { 'slot-1': 'correct', 'slot-2': 'correct' }, correct: true, correctCount: 2, total: 2 });
  assert.deepEqual(evaluateCloze(definition, key, { 'slot-1': 'ist', 'slot-2': 'wurde' }),
    { slots: { 'slot-1': 'correct', 'slot-2': 'incorrect' }, correct: false, correctCount: 1, total: 2 });
  assert.equal(evaluateCloze(definition, key, { 'slot-1': 'ist' }).slots['slot-2'], 'incorrect', 'an empty slot is incorrect');
  assert.throws(() => evaluateCloze(definition, keyOf([['ist']]), {}), RangeError, 'every slot needs an accepted answer');
});

test('repeated options: one option may fill several slots', () => {
  const definition = cloze('Die Fenster ___ geputzt, die Türen ___ gestrichen.', 'choice');
  const evaluation = evaluateCloze(definition, keyOf([['wurde'], ['wurde']]), { 'slot-1': 'wurde', 'slot-2': 'wurde' });
  assert.equal(evaluation.correct, true);
});

test('alternatives: accepted forms, case/whitespace/NFC rules, choice IDs compared exactly', () => {
  const text = cloze('Der Mann, ___ neben uns wohnt.');
  const key = keyOf([['der', 'welcher']]);
  for (const typed of ['der', 'Welcher', '  der ', 'WELCHER']) assert.equal(evaluateCloze(text, key, { 'slot-1': typed }).correct, true, typed);
  assert.equal(evaluateCloze(text, key, { 'slot-1': 'die' }).correct, false);
  assert.equal(evaluateCloze(text, { ...key, caseSensitive: true }, { 'slot-1': 'Der' }).correct, false);
  assert.equal(normalizeClozeText('Tür  zu'), normalizeClozeText('Tür zu'));
  const choice = cloze('Er ___ müde.', 'choice');
  assert.equal(evaluateCloze(choice, keyOf([['ist', 'war']]), { 'slot-1': 'war' }).correct, true);
  assert.equal(evaluateCloze(choice, keyOf([['ist']]), { 'slot-1': 'IST' }).correct, false, 'choice values are option IDs');
});

test('interchangeable slots accept any order but use each answer once', () => {
  const definition = cloze('Wir kaufen ___ und ___.');
  const key = { ...keyOf([['Äpfel'], ['Birnen']]), interchangeable: [['slot-1', 'slot-2']] };
  assert.equal(evaluateCloze(definition, key, { 'slot-1': 'Birnen', 'slot-2': 'Äpfel' }).correct, true);
  assert.deepEqual(evaluateCloze(definition, key, { 'slot-1': 'Äpfel', 'slot-2': 'Äpfel' }).slots, { 'slot-1': 'correct', 'slot-2': 'incorrect' });
  assert.deepEqual(evaluateCloze(definition, key, { 'slot-1': 'Kirschen', 'slot-2': 'Äpfel' }).slots, { 'slot-1': 'incorrect', 'slot-2': 'correct' });
  assert.throws(() => evaluateCloze(definition, { ...key, interchangeable: [['slot-1', 'slot-9']] }, {}), RangeError);
  assert.throws(() => evaluateCloze(definition, { ...key, interchangeable: [['slot-1'], ['slot-1', 'slot-2']] }, {}), RangeError);
});

test('every v1 gaps.json and passiv-gaps.json item maps onto the same mechanism in both modes', () => {
  const gaps = JSON.parse(readFileSync(new URL('../public/data/gaps.json', import.meta.url), 'utf8'));
  const passiv = JSON.parse(readFileSync(new URL('../public/data/passiv-gaps.json', import.meta.url), 'utf8'));
  const items = [...gaps.map(g => ({ id: `gap-${g.id}`, template: g.sentence, answers: [g.answer] })),
    ...passiv.map(p => ({ id: p.id, template: p.template, answers: p.answers }))];
  assert.ok(items.length > 50);
  for (const item of items) for (const input of ['text', 'choice']) {
    const options = [...new Set([...bank.map(option => option.id), ...item.answers])].map(label => ({ id: label, label }));
    const definition = cloze(item.template, input, item.id, options);
    assert.equal(definition.slots.length, item.answers.length, item.id);
    const key = keyOf(item.answers.map(answer => [answer]));
    const values = Object.fromEntries(definition.slots.map((slot, index) => [slot.slotId, item.answers[index]]));
    assert.equal(evaluateCloze(definition, key, values).correct, true, item.id);
  }
});
