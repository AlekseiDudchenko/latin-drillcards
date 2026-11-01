import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordExerciseRegistry, evaluateWordAnswer, ExerciseUnavailable, WORD_EXERCISE_IDS,
  createWordProgress, projectWordDay, EVIDENCE_POLICY_VERSION } from '../packages/vocabulary-core/dist/index.js';
import { answer } from '../packages/vocabulary-core/build-test/test/fixtures.js';

function noun(id, de, ru, en = ru) {
  return { schemaVersion: 1, contentVersion: 1, id, lemma: de, article: 'der', partOfSpeech: 'noun', senseId: id,
    meanings: { ru: { preferred: ru, accepted: [ru] }, en: { preferred: en, accepted: [en] } },
    acceptedForms: [de], examples: [], tags: ['home'] };
}
const words = [noun('tisch', 'Tisch', 'стол', 'table'), noun('stuhl', 'Stuhl', 'стул', 'chair'),
  noun('fenster', 'Fenster', 'окно', 'window'), noun('tuer', 'Tür', 'дверь', 'door'), noun('haus', 'Haus', 'дом', 'house')];
const context = { answerLanguage: 'ru', taskId: 'task-1', seed: 'seed-1' };
const registry = () => createWordExerciseRegistry(words, 'catalog/1');

test('all four exercises use build/evaluate/applicability contracts with distinct evidence semantics', () => {
  const r = registry();
  for (const id of WORD_EXERCISE_IDS.slice(0, 4)) {
    const exercise = r.get(id);
    assert.equal(exercise.isApplicable(words[0], context), true);
    const task = exercise.buildTask(words[0], context);
    assert.equal(task.taskVersion, exercise.version);
    const raw = id === 'introduction' ? 'continue' : id === 'meaning-recall' ? 'remembered' : task.specification.correctOptionId;
    const evaluation = exercise.evaluate(task, raw);
    assert.equal(evaluation.outcome, id === 'introduction' ? 'unobserved' : 'correct');
    assert.equal(evaluation.source, id === 'meaning-recall' ? 'self-assessment' : 'automatic');
    assert.deepEqual(evaluation.components, id === 'introduction' ? {} : { recognition: 'correct' });
    assert.deepEqual(exercise.assessedComponents(words[0]), id === 'introduction' ? [] : ['recognition']);
  }
  const reverse = r.get('target-choice').buildTask(words[0], context);
  assert.equal(reverse.specification.prompt.text, 'стол');
  assert.equal(reverse.specification.answer.lang, 'de');
  assert.equal(reverse.specification.answer.text, 'der Tisch');
  assert.deepEqual(reverse.assessedComponents, ['recognition']);
});

test('options and labels are reproducible under catalog order, serialization and repeated builds', () => {
  const first = registry().get('meaning-choice').buildTask(words[0], context);
  const second = createWordExerciseRegistry([...words].reverse(), 'catalog/1').get('meaning-choice').buildTask(words[0], context);
  assert.deepEqual(first, second);
  assert.deepEqual(registry().validateTask(JSON.parse(JSON.stringify(first))), first);
  assert.equal(first.specification.options.length, 4);
  assert.equal(new Set(first.specification.options.map(o => o.id)).size, 4);
  assert.ok(Object.isFrozen(first.specification.options));
  const layouts = new Set(Array.from({ length: 20 }, (_, i) => registry().get('target-choice').buildTask(words[0], { ...context, seed: `s-${i}` }).specification.options.map(o => o.id).join(',')));
  assert.ok(layouts.size > 1);
});

test('verified alias overlap and identical German forms cannot be distractors', () => {
  const translationAlias = noun('alias', 'Esstisch', 'обеденный стол'); translationAlias.meanings.ru.accepted.push('стол');
  const formAlias = noun('form-alias', 'Tafel', 'доска'); formAlias.acceptedForms.push('Tisch');
  const r = createWordExerciseRegistry([...words, translationAlias, formAlias], 'catalog/1');
  for (const id of ['meaning-choice', 'target-choice']) {
    const task = r.get(id).buildTask(words[0], context);
    assert.ok(!task.specification.options.some(o => ['alias', 'form-alias'].includes(o.id)));
    const wrong = task.specification.options.find(o => o.id !== 'tisch');
    assert.equal(r.get(id).evaluate(task, wrong.id).outcome, 'incorrect');
  }
});

test('distractors also cannot overlap each other, including split preferred senses', () => {
  const a = noun('a', 'Lampe', 'лампа; светильник');
  const b = noun('b', 'Leuchte', 'светильник');
  const r = createWordExerciseRegistry([words[0], words[1], a, b], 'catalog/1');
  assert.deepEqual(r.availability('meaning-choice', words[0], context), { available: false, reason: 'insufficient-options' });
  assert.throws(() => r.get('meaning-choice').buildTask(words[0], context), error => error instanceof ExerciseUnavailable && error.reason === 'insufficient-options');
  assert.equal(r.get('meaning-recall').isApplicable(words[0], context), true);
});

test('same-part-of-speech options prefer common topics without mixing unrelated input types', () => {
  const unrelated = noun('unrelated', 'Mond', 'луна'); unrelated.tags = ['astronomy'];
  const verb = { ...noun('gehen', 'gehen', 'идти'), partOfSpeech: 'verb', article: undefined };
  const r = createWordExerciseRegistry([...words.slice(0, 4), unrelated, verb], 'catalog/1');
  const ids = r.get('meaning-choice').buildTask(words[0], context).specification.options.map(o => o.id);
  assert.deepEqual(new Set(ids), new Set(words.slice(0, 4).map(w => w.id)));
  assert.equal(r.get('target-choice').isApplicable(verb, context), false);
});

test('homonymous words keep separate identity and are excluded as ambiguous German distractors', () => {
  const volume = noun('band-volume', 'Band', 'том');
  const ribbon = { ...noun('band-ribbon', 'Band', 'лента'), article: 'das' };
  const r = createWordExerciseRegistry([...words, volume, ribbon], 'catalog/1');
  const task = r.get('target-choice').buildTask(volume, context);
  assert.equal(r.getWord('band-ribbon', 1).article, 'das');
  assert.equal(r.getWord('band-volume', 1).article, 'der');
  assert.ok(!task.specification.options.some(o => o.id === 'band-ribbon'));
});

test('missing translations, insufficient pools and stale revisions are explicit unavailable reasons', () => {
  const partial = { ...words[0], meanings: { ru: words[0].meanings.ru } };
  const r = createWordExerciseRegistry([partial], 'catalog/1');
  assert.deepEqual(r.availability('introduction', partial, { ...context, answerLanguage: 'en' }), { available: false, reason: 'missing-translation' });
  assert.equal(r.get('introduction').isApplicable(partial, context), true);
  assert.equal(r.get('meaning-choice').isApplicable(partial, context), false);
  assert.deepEqual(r.availability('introduction', { ...partial, contentVersion: 2 }, context), { available: false, reason: 'content-version' });
  assert.deepEqual(r.availability('introduction', { ...partial, id: 'unknown' }, context), { available: false, reason: 'unknown-word' });
});

test('catalog snapshot ownership prevents source mutation from changing a fixed task', () => {
  const mutable = JSON.parse(JSON.stringify(words));
  const r = createWordExerciseRegistry(mutable, 'catalog/1');
  const original = r.get('meaning-choice').buildTask(words[0], context);
  mutable[0].meanings.ru.preferred = 'changed'; mutable.reverse();
  assert.deepEqual(r.get('meaning-choice').buildTask(words[0], context), original);
  assert.ok(Object.isFrozen(r.getWord('tisch', 1).meanings.ru.accepted));
});

test('canonical validation rejects forged solutions, changed labels/options, languages and task versions', () => {
  const r = registry(); const task = r.get('meaning-choice').buildTask(words[0], context);
  const copy = () => JSON.parse(JSON.stringify(task));
  const mutations = [t => { t.specification.correctOptionId = 'stuhl'; }, t => { t.specification.options.pop(); },
    t => { t.specification.options[0].label = 'forged'; }, t => { t.specification.answerLanguage = 'en'; },
    t => { t.taskVersion = 'meaning-choice/2'; }, t => { t.specification.schemaVersion = 2; },
    t => { t.specification.catalogVersion = 'other'; }];
  for (const mutate of mutations) { const t = copy(); mutate(t); assert.throws(() => r.validateTask(t), RangeError); }
  assert.throws(() => r.get('meaning-choice').evaluate(task, 'not-an-option'), /Unknown answer/);
  assert.throws(() => r.get('target-choice').evaluate(task, 'tisch'), /mismatch/);
  assert.throws(() => createWordExerciseRegistry([...words, words[0]], 'catalog/1'), /duplicate/);
});

test('trusted answer evaluation binds event metadata to the pinned task instead of trusting the client language or target', () => {
  const r = registry(); const task = r.get('target-choice').buildTask(words[0], context);
  const event = { ...answer, target: task.target, taskId: task.id, exerciseId: task.exerciseId, taskVersion: task.taskVersion,
    contentVersion: task.contentVersion, answerLanguage: task.specification.answerLanguage, rawAnswer: task.specification.correctOptionId };
  assert.equal(evaluateWordAnswer(r, task, event).outcome, 'correct');
  for (const patch of [{ answerLanguage: 'en' }, { taskId: 'other' }, { contentVersion: 2 },
    { target: { kind: 'word', wordId: 'other' } }, { exerciseId: 'meaning-choice' }]) {
    assert.throws(() => evaluateWordAnswer(r, task, { ...event, ...patch }), /context mismatch/);
  }
});

test('self-assessment never masquerades as automatic translation checking or recall', () => {
  const r = registry(); const e = r.get('meaning-recall'); const task = e.buildTask(words[0], context);
  assert.deepEqual(e.evaluate(task, 'forgotten'), { outcome: 'incorrect', source: 'self-assessment', components: { recognition: 'incorrect' } });
  assert.throws(() => e.evaluate(task, 'стол'), /Invalid self/);
  assert.throws(() => r.get('introduction').evaluate(r.get('introduction').buildTask(words[0], context), 'remembered'), /not|no answer/);
});

test('introduction completion is unobserved; its learning event initializes with no successful review', () => {
  const r = registry(); const task = r.get('introduction').buildTask(words[0], context);
  assert.deepEqual(r.get('introduction').evaluate(task, 'continue'), { outcome: 'unobserved', source: 'automatic', components: {} });
  const { rawAnswer, attemptId, assisted, ...base } = answer;
  const event = { ...base, kind: 'introduction', target: task.target, exerciseId: task.exerciseId, taskVersion: task.taskVersion,
    contentVersion: task.contentVersion, intent: 'learn-new', policyVersion: EVIDENCE_POLICY_VERSION };
  const result = projectWordDay(createWordProgress(words[0], { kind: 'account', id: 'u' }, EVIDENCE_POLICY_VERSION), words[0],
    { date: '2026-10-23', timezone: 'Europe/Berlin' }, [{ event }]);
  assert.equal(result.progress.components.recognition.reviewCount, 0);
  assert.equal(result.progress.components.recognition.stage, 'learning');
  assert.equal(result.progress.components.recall.stage, 'unintroduced');
});
