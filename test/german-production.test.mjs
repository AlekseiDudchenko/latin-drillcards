import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordExerciseRegistry, WORD_EXERCISE_IDS, GERMAN_NORMALIZATION_VERSION,
  evaluateWordAnswer, deriveWordEvidence, createWordProgress, initializeComponent, reviewComponent,
  projectWordDay, selectNewWords, EVIDENCE_POLICY_VERSION } from '../packages/vocabulary-core/dist/index.js';
import { answer } from '../packages/vocabulary-core/build-test/test/fixtures.js';

function word(id, lemma, article, forms = []) {
  return { schemaVersion: 1, contentVersion: 1, id, lemma, partOfSpeech: article ? 'noun' : 'verb', senseId: id,
    ...(article ? { article } : {}), meanings: { ru: { preferred: id, accepted: [] }, en: { preferred: id, accepted: [] } },
    acceptedGermanForms: forms, examples: [], tags: [] };
}
const tisch = word('table', 'Tisch', 'der');
const tuer = word('door', 'Tür', 'die');
const gehen = word('go', 'gehen', undefined, ['ging']);
const words = [tisch, tuer, gehen, word('street', 'Straße', 'die'), word('chair', 'Stuhl', 'der')];
const context = { taskId: 'typed-1', seed: 'seed', answerLanguage: 'ru' };
function setup(target = tisch, exerciseId = 'german-with-article-type', catalog = words, buildContext = context) {
  const registry = createWordExerciseRegistry(catalog, 'published/1');
  const definition = registry.get(exerciseId);
  const task = definition.buildTask(target, buildContext);
  return { registry, definition, task, evaluate: raw => definition.evaluate(task, raw) };
}
function fact(raw, target = tisch, exerciseId = 'german-with-article-type', patch = {}) {
  const { registry, task } = setup(target, exerciseId, words, { ...context, taskId: patch.taskId ?? context.taskId });
  const event = { ...answer, eventId: 'typed-event', commandId: 'typed-command', attemptId: 'typed-attempt',
    target: task.target, taskId: task.id, exerciseId, taskVersion: task.taskVersion, contentVersion: task.contentVersion,
    answerLanguage: 'ru', policyVersion: EVIDENCE_POLICY_VERSION, occurredAt: '2026-10-24T10:00:00.000Z',
    intent: 'review-due', assisted: false, exposure: [], rawAnswer: raw, ...patch };
  return { event, evaluation: evaluateWordAnswer(registry, task, event) };
}

test('seven definitions keep the shared contract and pin production normalization in immutable tasks', () => {
  assert.equal(new Set(WORD_EXERCISE_IDS).size, 7);
  for (const id of ['german-type', 'article-choice', 'german-with-article-type']) {
    const { registry, definition, task } = setup(tisch, id);
    assert.equal(definition.isApplicable(tisch, context), true);
    assert.equal(task.taskVersion, definition.version);
    assert.deepEqual(task.assessedComponents, definition.assessedComponents(tisch));
    assert.deepEqual(registry.validateTask(JSON.parse(JSON.stringify(task))), task);
    assert.equal(task.input, id === 'article-choice' ? 'choice' : 'text');
    if (task.input === 'text') {
      assert.equal(task.specification.normalizationVersion, GERMAN_NORMALIZATION_VERSION);
      assert.equal(task.specification.prompt.text, 'table');
      const altered = JSON.parse(JSON.stringify(task)); altered.specification.normalizationVersion = 'future/2';
      assert.throws(() => registry.validateTask(altered), /canonical/);
    }
  }
});

test('wrong or omitted article does not lose correct lexical recall and spelling', () => {
  const { evaluate } = setup();
  for (const raw of ['die Tisch', 'den Tisch', 'dem Tisch', 'ein Tisch', 'Tisch']) assert.deepEqual(evaluate(raw), { outcome: 'incorrect', source: 'automatic',
    components: { recall: 'correct', spelling: 'correct', article: 'incorrect' } });
  assert.equal(evaluate('Der Tisch').outcome, 'correct');
  assert.equal(evaluate('  der\u00a0 Tisch  ').outcome, 'correct');
  assert.deepEqual(setup(tisch, 'german-type').evaluate('Tisch').components, { recall: 'correct', spelling: 'correct' });
  // The bare-word mode deliberately requests no article.
  assert.equal(setup(tisch, 'german-type').evaluate('der Tisch').components.recall, 'incorrect');
});

test('case, umlaut transliteration and sharp-s separate recall from strict spelling', () => {
  for (const [target, raw] of [[tisch, 'tisch'], [tisch, 'TISCH'], [tuer, 'Tuer'], [tuer, 'tuer'],
    [words[3], 'Strasse'], [words[3], 'STRASSE']]) {
    assert.deepEqual(setup(target, 'german-type').evaluate(raw).components, { recall: 'correct', spelling: 'incorrect' });
  }
  assert.equal(setup(tuer, 'german-type').evaluate('Tu\u0308r').outcome, 'correct');
  assert.equal(setup(tuer, 'german-type').evaluate('Tur').components.recall, 'incorrect');
  for (const raw of ['Tish', 'Stuhl', 'Tisch!', 'Tische', 'Тisch', 'table']) {
    assert.deepEqual(setup(tisch, 'german-type').evaluate(raw).components, { recall: 'incorrect', spelling: 'unobserved' });
  }
});

test('only explicit published German aliases establish productive recall', () => {
  assert.deepEqual(setup(gehen, 'german-type').evaluate('ging').components, { recall: 'correct', spelling: 'correct' });
  assert.deepEqual(setup(gehen, 'german-type').evaluate('GING').components, { recall: 'correct', spelling: 'incorrect' });
  assert.equal(setup(gehen, 'german-type').evaluate('gegangen').components.recall, 'incorrect');
  const withAlias = { ...tisch, acceptedGermanForms: ['der Esstisch'] };
  assert.equal(setup(withAlias, 'german-type', [withAlias]).evaluate('Esstisch').outcome, 'correct');
});

test('normalization never accepts an exact spelling belonging to another published lexeme', () => {
  const measures = word('measures', 'Maße', 'die'); const mass = word('mass', 'Masse', 'die');
  const evaluate = setup(measures, 'german-type', [measures, mass]).evaluate;
  assert.equal(evaluate('Maße').outcome, 'correct');
  for (const raw of ['Masse', 'MASSE', 'masse']) assert.deepEqual(evaluate(raw).components, { recall: 'incorrect', spelling: 'unobserved' });
  assert.equal(setup(measures, 'german-type', [measures]).evaluate('Masse').components.recall, 'correct');
});

test('a different lexical answer cannot manufacture target spelling or article success', () => {
  assert.deepEqual(setup().evaluate('der Stuhl').components, { recall: 'incorrect', spelling: 'unobserved', article: 'unobserved' });
  const evidence = deriveWordEvidence(tisch, [fact('der Stuhl')]);
  assert.deepEqual(evidence.map(e => [e.component, e.rating]), [['recall', 'again'], ['spelling', null], ['article', null]]);
});

test('article choice uses article IDs, hides the solution in its prompt and needs no distractor pool', () => {
  const { task, evaluate } = setup(tisch, 'article-choice', [tisch]);
  assert.equal(task.specification.prompt.text, 'Tisch');
  assert.equal(task.specification.answer.text, 'der');
  assert.deepEqual(task.specification.options.map(o => o.id), ['der', 'die', 'das']);
  assert.deepEqual(evaluate('der'), { outcome: 'correct', source: 'automatic', components: { article: 'correct' } });
  assert.deepEqual(evaluate('die').components, { article: 'incorrect' });
  const untranslated = { ...tisch, meanings: {} };
  const r = createWordExerciseRegistry([untranslated], 'published/1');
  const selected = selectNewWords({ id: 'deck', title: 'test', wordIds: [untranslated.id] }, {
    words: [untranslated], progress: [], owner: { kind: 'guest', id: 'g' }, at: '2026-10-24T10:00:00.000Z',
    answerLanguage: 'ru', exerciseId: 'article-choice' });
  assert.equal(selected.length, 1);
  assert.equal(r.get('article-choice').isApplicable(selected[0], context), true);
  assert.equal(r.get('article-choice').buildTask(untranslated, context).specification.prompt.text, 'Tisch');
  assert.throws(() => evaluate('den'), /Unknown answer/);
  assert.deepEqual(deriveWordEvidence(tisch, [fact('der', tisch, 'article-choice')]).map(e => [e.component, e.rating]), [['article', 'good']]);
});

test('article exercises are unavailable for verbs and nouns without a known article', () => {
  const unknown = { ...tisch, id: 'unknown', article: undefined };
  const registry = createWordExerciseRegistry([...words, unknown], 'published/1');
  for (const target of [gehen, unknown]) for (const id of ['article-choice', 'german-with-article-type']) {
    assert.deepEqual(registry.availability(id, target, context), { available: false, reason: 'article-not-applicable' });
    assert.equal(registry.get(id).isApplicable(target, context), false);
    assert.throws(() => registry.get(id).buildTask(target, context), /article-not-applicable/);
  }
  assert.deepEqual(registry.get('german-type').assessedComponents(gehen), ['recall', 'spelling']);
  assert.equal(registry.get('german-type').buildTask(gehen, context).specification.answer.text, 'gehen');
});

test('malformed production payloads are rejected rather than graded or converted into strings', () => {
  for (const raw of [null, true, 42, [], {}, '', '   ', 'a'.repeat(257), 'Tisch\n', 'Tisch\u0000']) {
    assert.throws(() => setup().evaluate(raw), /Invalid German text answer/);
  }
  const partial = { ...gehen, meanings: {} };
  const r = createWordExerciseRegistry([partial], 'published/1');
  assert.deepEqual(r.availability('german-type', partial, context), { available: false, reason: 'missing-translation' });
});

test('real evaluator projects split grades into one word progress and practice never updates SRS', () => {
  let before = createWordProgress(tisch, { kind: 'account', id: 'u' }, EVIDENCE_POLICY_VERSION);
  for (const c of Object.keys(before.components)) before = initializeComponent(before, tisch, c, '2026-10-20T10:00:00.000Z');
  for (const c of Object.keys(before.components)) before = reviewComponent(before, tisch, c, 'good', '2026-10-21T10:00:00.000Z');
  const day = { date: '2026-10-24', timezone: 'Europe/Berlin' };
  const result = projectWordDay(before, tisch, day, [fact('die Tisch')]);
  assert.deepEqual(result.transitions.map(t => [t.component, t.rating]), [['recall', 'good'], ['spelling', 'good'], ['article', 'again']]);
  assert.equal(result.progress.components.article.stage, 'relearning');
  assert.equal(result.progress.components.recognition, before.components.recognition);
  assert.deepEqual(projectWordDay(before, tisch, day, [fact('der Tisch', tisch, 'german-with-article-type', { intent: 'practice' })]).progress, before);
});

test('earlier exercise feedback prevents a later correct production from being independent evidence', () => {
  const first = fact('die Tisch');
  const second = fact('der Tisch', tisch, 'german-with-article-type', { eventId: 'second', commandId: 'c2', attemptId: 'a2', taskId: 'second-task', occurredAt: '2026-10-24T10:01:00.000Z' });
  const evidence = deriveWordEvidence(tisch, [second, first]);
  assert.deepEqual(evidence.filter(e => e.eventId === 'second').map(e => [e.strength, e.rating]), [['aided', null], ['aided', null], ['aided', null]]);
});
