import test from 'node:test';
import assert from 'node:assert/strict';
import { planVocabularySession, VOCABULARY_PLANNER_VERSION, createWordExerciseRegistry,
  createWordProgress, initializeComponent, applicableComponents, EVIDENCE_POLICY_VERSION,
  selectPracticeWords } from '../packages/vocabulary-core/dist/index.js';

const at = '2026-10-23T12:00:00.000Z';
const before = '2026-10-20T12:00:00.000Z';
const owner = { kind: 'account', id: 'A' };
function catalog(n = 35) {
  return Array.from({ length: n }, (_, i) => ({
    schemaVersion: 1, contentVersion: 1, id: 'w' + String(i).padStart(2, '0'),
    lemma: 'Wort' + i, partOfSpeech: 'noun', article: 'der', senseId: 'sense-' + i,
    meanings: { ru: { preferred: 'слово-' + i, accepted: [] }, en: { preferred: 'word-' + i, accepted: [] } },
    acceptedGermanForms: [], tags: [i % 2 ? 'odd' : 'even', 'common'], examples: [],
  }));
}
function progress(word, components = applicableComponents(word), time = before) {
  let result = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
  for (const c of components) result = initializeComponent(result, word, c, time);
  return result;
}
function input(patch = {}) {
  const words = patch.words ?? catalog();
  return { owner, sessionId: 'session', seed: 'fixed', catalogVersion: 'catalog/1', dataEpoch: 'v2',
    studyTimezone: 'Europe/Berlin', at, words, progress: [], deck: { id: 'deck', title: 'test', wordIds: words.map(w => w.id) },
    request: { deckId: 'deck', intent: 'review-due', format: 'single', exerciseId: 'german-type', answerLanguage: 'ru' }, ...patch };
}
function ready(i) { const result = planVocabularySession(i); assert.equal(result.kind, 'ready'); return result.plan; }
function request(patch = {}) { return { deckId: 'deck', intent: 'review-due', format: 'single', exerciseId: 'german-type', answerLanguage: 'ru', ...patch }; }
function circuit(intent = 'review-due', scope = 'all-exercises') {
  return { deckId: 'deck', intent, format: 'circuit', circuitScope: scope, answerLanguage: 'ru' };
}

test('seven due words remain seven, never padded by new words or duplicated for multiple due components', () => {
  const i = input(); i.progress = i.words.slice(0, 7).map(w => progress(w));
  i.deck.wordIds.push(i.words[0].id);
  const plan = ready(i);
  assert.deepEqual(plan.batch, { capacity: 20, wordIds: i.words.slice(0, 7).map(w => w.id) });
  assert.equal(plan.tasks.length, 7);
  assert.ok(plan.tasks.every(t => t.exerciseId === 'german-type'));
  assert.equal(plan.plannerVersion, VOCABULARY_PLANNER_VERSION);
});

test('single only selects components assessed by its exercise, with no silent alternative exercise', () => {
  const i = input();
  i.progress = [progress(i.words[0], ['recall']), progress(i.words[1], ['recognition']), progress(i.words[2], ['article'])];
  i.request = request({ exerciseId: 'german-choice' });
  assert.deepEqual(ready(i).batch.wordIds, [i.words[1].id]);
  i.request = request({ exerciseId: 'article-choice' });
  assert.deepEqual(ready(i).batch.wordIds, [i.words[2].id]);
  i.request = request({ exerciseId: 'introduction' });
  assert.deepEqual(planVocabularySession(i), { kind: 'empty', reason: 'no-due-words', omissions: [] });
});

test('capacity is 20 for single review and 5 for circuit or new words, as distinct words even when circuit has many tasks', () => {
  const i = input(); i.progress = i.words.map(w => progress(w));
  assert.equal(ready(i).batch.wordIds.length, 20);
  i.request = circuit();
  const plan = ready(i);
  assert.equal(plan.batch.capacity, 5); assert.equal(plan.batch.wordIds.length, 5);
  assert.equal(new Set(plan.tasks.map(t => t.target.wordId)).size, 5);
  assert.equal(plan.tasks.length, 30);
  assert.ok(plan.tasks.every(t => plan.batch.wordIds.includes(t.target.wordId) && t.exerciseId !== 'introduction'));
  assert.equal(new Set(plan.tasks.map(t => t.id)).size, plan.tasks.length);
});

test('newness is per word; introductions precede the fixed batch, never rerun selection per stage', () => {
  const i = input({ request: circuit('learn-new') });
  i.progress = [progress(i.words[0], ['recognition'])];
  const plan = ready(i);
  assert.ok(!plan.batch.wordIds.includes(i.words[0].id));
  assert.equal(plan.tasks.slice(0, 5).every(t => t.exerciseId === 'introduction'), true);
  assert.equal(plan.tasks.length, 35);
  for (const exercise of new Set(plan.tasks.map(t => t.exerciseId))) {
    assert.deepEqual(plan.tasks.filter(t => t.exerciseId === exercise).map(t => t.target.wordId).sort(), [...plan.batch.wordIds].sort());
  }
  i.request = request({ intent: 'learn-new', exerciseId: 'german-type' });
  const single = ready(i);
  assert.equal(single.batch.capacity, 5);
  assert.equal(single.tasks.length, 10);
  assert.ok(single.tasks.slice(0, 5).every(t => t.exerciseId === 'introduction'));
  i.request = request({ intent: 'learn-new', exerciseId: 'introduction' });
  assert.equal(ready(i).tasks.length, 5);
});

test('filters apply before capacity; availability does not consume a slot or pad unsafe choices', () => {
  const words = catalog(30);
  words[0] = { ...words[0], partOfSpeech: 'verb', article: undefined };
  const i = input({ words, request: request({ intent: 'learn-new', exerciseId: 'meaning-choice',
    filter: { partOfSpeech: ['verb', 'noun'], tags: ['common'] } }) });
  const result = planVocabularySession(i); assert.equal(result.kind, 'ready');
  assert.equal(result.plan.batch.wordIds.length, 5);
  assert.ok(!result.plan.batch.wordIds.includes(words[0].id));
  assert.deepEqual(result.omissions, [{ wordId: words[0].id, exerciseId: 'meaning-choice', reason: 'insufficient-options' }]);
  i.request.filter = { partOfSpeech: ['noun'], tags: ['common', 'even'] };
  const plan = ready(i); assert.equal(plan.batch.wordIds.length, 5);
  assert.ok(plan.batch.wordIds.every(id => words.find(w => w.id === id).tags.includes('even')));
});

test('small pools return explicit unavailability; circuit skips inapplicable stages', () => {
  const words = catalog(1);
  const i = input({ words, request: request({ intent: 'learn-new', exerciseId: 'meaning-choice' }) });
  const result = planVocabularySession(i);
  assert.equal(result.kind, 'empty'); assert.equal(result.reason, 'no-applicable-tasks');
  assert.equal(result.omissions[0].reason, 'insufficient-options');
  words[0] = { ...words[0], partOfSpeech: 'verb', article: undefined };
  i.request = circuit('learn-new');
  const plan = ready(i);
  assert.deepEqual(plan.tasks.map(t => t.exerciseId), ['introduction', 'german-type', 'meaning-recall']);
  const skipped = planVocabularySession(i).omissions;
  assert.ok(skipped.some(s => s.exerciseId === 'article-choice' && s.reason === 'article-not-applicable'));
  assert.ok(skipped.some(s => s.exerciseId === 'meaning-choice' && s.reason === 'insufficient-options'));
});

test('due-components circuit only builds exercises assessing due components, including untranslated article work', () => {
  const words = catalog(5); words[0].meanings = {};
  const i = input({ words, request: circuit('review-due', 'due-components') });
  i.progress = [progress(words[0], ['article']), progress(words[1], ['recall'])];
  const plan = ready(i);
  assert.equal(plan.batch.wordIds.length, 2);
  assert.deepEqual(plan.tasks.filter(t => t.target.wordId === words[0].id).map(t => t.exerciseId), ['article-choice']);
  assert.deepEqual(plan.tasks.filter(t => t.target.wordId === words[1].id).map(t => t.exerciseId), ['german-with-article-type', 'german-type']);
});

test('single article review works without translation while new words require a real introduction', () => {
  const words = catalog(1); words[0].meanings = {};
  const i = input({ words, progress: [progress(words[0], ['article'])], request: request({ exerciseId: 'article-choice' }) });
  assert.deepEqual(ready(i).batch.wordIds, [words[0].id]);
  i.progress = []; i.request = request({ intent: 'learn-new', exerciseId: 'article-choice' });
  const result = planVocabularySession(i); assert.equal(result.kind, 'empty');
  assert.equal(result.omissions[0].reason, 'missing-translation');
});

test('explicit practice uses the requested IDs/order, includes scheduled words and never replaces an empty due queue', () => {
  const i = input(); i.progress = [progress(i.words[2], ['recall'], at)];
  assert.equal(planVocabularySession(i).kind, 'empty');
  i.request = request({ intent: 'practice', wordIds: [i.words[2].id, i.words[0].id, i.words[2].id] });
  const plan = ready(i);
  assert.deepEqual(plan.batch.wordIds, [i.words[2].id, i.words[0].id]);
  assert.equal(plan.request.intent, 'practice'); assert.equal(plan.tasks.length, 2);
  assert.ok(plan.tasks.every(t => t.exerciseId !== 'introduction'));
  i.request.wordIds = [];
  assert.equal(planVocabularySession(i).reason, 'empty-practice');
  i.request.wordIds = ['outside'];
  assert.throws(() => planVocabularySession(i), /outside deck/);
  const all = selectPracticeWords(i.deck, { ...i, answerLanguage: 'ru' });
  assert.equal(all.length, 20);
});

test('plans are reproducible, immutable snapshots; original requests/catalog/progress remain untouched', () => {
  const i = input({ request: circuit('learn-new') }); const before = JSON.stringify(i);
  const plan = ready(i); assert.equal(JSON.stringify(i), before);
  assert.deepEqual(plan, ready(i));
  const reversed = { ...i, words: [...i.words].reverse() };
  assert.deepEqual(plan, ready(reversed));
  assert.throws(() => plan.batch.wordIds.push('extra'), TypeError);
  assert.throws(() => { plan.request.answerLanguage = 'en'; }, TypeError);
  assert.throws(() => { plan.tasks[0].specification.prompt.text = 'tampered'; }, TypeError);
  const saved = JSON.parse(JSON.stringify(plan));
  const registry = createWordExerciseRegistry(i.words, i.catalogVersion);
  for (const task of saved.tasks) registry.validateTask(task);
  i.words[1].lemma = 'Changed'; i.words.push({ ...i.words[0], id: 'new' }); i.request.answerLanguage = 'en'; i.deck.wordIds.push('new');
  assert.deepEqual(plan, saved);
  assert.ok(saved.tasks.every(t => t.specification.answerLanguage === 'ru'));
  assert.deepEqual(saved.wordVersions.map(v => v.wordId), saved.batch.wordIds);
});

test('seed pins options and deterministic circuit ordering; another session has disjoint task IDs', () => {
  const i = input({ request: circuit('learn-new') });
  const a = ready(i); const b = ready({ ...i, seed: 'other-seed' });
  assert.deepEqual(a.batch.wordIds, b.batch.wordIds);
  assert.notDeepEqual(a.tasks.map(t => t.target.wordId), b.tasks.map(t => t.target.wordId));
  const c = ready({ ...i, sessionId: 'another-session' });
  const ids = new Set(a.tasks.map(t => t.id));
  assert.ok(c.tasks.every(t => !ids.has(t.id)));
  assert.ok(a.tasks.every(t => t.taskVersion.endsWith('/1') && t.contentVersion === 1));
});

test('request language is pinned independently of UI and changing request creates a separate plan', () => {
  const i = input({ request: request({ intent: 'learn-new' }) });
  const ru = ready(i); const en = ready({ ...i, request: { ...i.request, answerLanguage: 'en' }, sessionId: 'en-session' });
  assert.ok(ru.tasks.every(t => t.specification.answerLanguage === 'ru'));
  assert.ok(en.tasks.every(t => t.specification.answerLanguage === 'en'));
  assert.notEqual(ru.tasks[0].specification.answer.text, en.tasks[0].specification.answer.text);
});

test('invalid owner, projections, identity, request enums and filters fail rather than inventing a plan', () => {
  const i = input();
  for (const patch of [{ sessionId: '' }, { seed: '' }, { dataEpoch: '' }, { catalogVersion: '' }, { at: 'yesterday' },
    { owner: { kind: 'account', id: '' } }, { studyTimezone: undefined }, { studyTimezone: 'Mars/Olympus' }]) assert.throws(() => planVocabularySession({ ...i, ...patch }));
  for (const patch of [{ intent: 'bogus' }, { format: 'bogus' }, { answerLanguage: 'de' }, { exerciseId: 'bogus' },
    { intent: 'practice' }, { filter: { tags: [''] } }, { filter: { partOfSpeech: ['bogus'] } }, { deckId: 'other' }]) {
    assert.throws(() => planVocabularySession({ ...i, request: request(patch) }));
  }
  assert.throws(() => planVocabularySession({ ...i, request: circuit('learn-new', 'due-components') }), /review-due/);
  assert.throws(() => planVocabularySession({ ...i, progress: [{ ...progress(i.words[0]), owner: { kind: 'account', id: 'B' } }] }), /owner/);
  assert.throws(() => planVocabularySession({ ...i, deck: { ...i.deck, wordIds: ['missing'] } }), /unknown/);
});
