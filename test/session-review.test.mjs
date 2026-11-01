import test from 'node:test';
import assert from 'node:assert/strict';
import { planVocabularySession, createWordExerciseRegistry, createWordProgress, initializeComponent, applicableComponents,
  EVIDENCE_POLICY_VERSION, buildCorrectionTasks, correctionTaskId, sessionTasks, summarizeVocabularySession,
  evaluateWordAnswer, replayWord } from '../packages/vocabulary-core/dist/index.js';

const at = '2026-10-23T12:00:00.000Z';
const owner = { kind: 'account', id: 'A' };
const words = Array.from({ length: 8 }, (_, i) => ({ schemaVersion: 1, contentVersion: 1, id: 'w' + i, lemma: 'Wort' + i,
  partOfSpeech: 'noun', article: ['der', 'die', 'das'][i % 3], senseId: 's' + i,
  meanings: { ru: { preferred: 'слово-' + i, accepted: [] } }, acceptedGermanForms: [], tags: [], examples: [] }));
const registry = createWordExerciseRegistry(words, 'catalog/1');
function plan(request, progress = []) {
  const result = planVocabularySession({ owner, sessionId: 's1', seed: 'seed', catalogVersion: 'catalog/1', dataEpoch: 'v2',
    studyTimezone: 'Europe/Berlin', at, words, progress, deck: { id: 'deck', title: 'd', wordIds: words.map(w => w.id) },
    request: { deckId: 'deck', answerLanguage: 'ru', ...request } });
  assert.equal(result.kind, 'ready'); return result.plan;
}
let clock = Date.parse(at);
/** Facts as the Runner stores them: event plus the trusted re-evaluation. */
function fact(p, task, kind, rawAnswer) {
  const event = { schemaVersion: 1, kind, eventId: 'e' + clock, commandId: 'c' + clock, sessionId: p.sessionId, taskId: task.id,
    target: task.target, exerciseId: task.exerciseId, intent: p.request.intent, answerLanguage: 'ru',
    occurredAt: new Date(clock += 1000).toISOString(), studyTimezone: p.studyTimezone, taskVersion: task.taskVersion,
    contentVersion: task.contentVersion, policyVersion: EVIDENCE_POLICY_VERSION, dataEpoch: p.dataEpoch, exposure: [],
    ...(kind === 'answer' ? { attemptId: 'a' + clock, rawAnswer, assisted: false } : {}) };
  return kind === 'answer' ? { event, evaluation: evaluateWordAnswer(registry, task, event) } : { event };
}
const right = task => task.input === 'choice' ? task.specification.correctOptionId : task.input === 'text' ? task.specification.answer.text : 'remembered';
const wrong = task => task.input === 'choice' ? task.specification.options.find(o => o.id !== task.specification.correctOptionId).id
  : task.input === 'text' ? 'falsch' : 'forgotten';
/** Answer every planned task; tasks listed in `mistakes` are answered wrongly. */
function play(p, mistakes = () => false) {
  return p.tasks.flatMap(source => {
    const task = registry.validateTask(source);
    if (task.exerciseId === 'introduction') return [fact(p, task, 'introduction')];
    const recall = task.input === 'reveal' ? [fact(p, task, 'reveal')] : [];
    return [...recall, fact(p, task, 'answer', mistakes(task) ? wrong(task) : right(task))];
  });
}

test('a circuit keeps its five words through every applicable stage; corrections never add words', () => {
  const p = plan({ intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises' });
  assert.equal(p.batch.wordIds.length, 5);
  assert.equal(p.tasks.length, 5 * 7, 'introduction plus six exercises per noun');
  const [first, second] = p.batch.wordIds;
  const failed = task => task.exerciseId === 'german-type' && task.target.wordId === first ||
    task.exerciseId === 'article-choice' && task.target.wordId === second;
  const facts = play(p, failed);
  const corrections = buildCorrectionTasks(p, registry, facts);
  // Same word and exercise, in planned (stage) order.
  assert.deepEqual(corrections.map(t => [t.target.wordId, t.exerciseId]),
    p.tasks.filter(failed).map(t => [t.target.wordId, t.exerciseId]));
  for (const task of corrections) {
    assert.equal(registry.validateTask(task).id, correctionTaskId('s1', task.target.wordId, task.exerciseId));
    assert.ok(p.batch.wordIds.includes(task.target.wordId));
  }
  assert.deepEqual(buildCorrectionTasks(p, registry, [...facts].reverse()), corrections, 'deterministic');
  const state = { plan: p, status: 'presenting', taskIndex: p.tasks.length, revision: 1, corrections };
  assert.equal(sessionTasks(state).length, 37);
  assert.deepEqual(buildCorrectionTasks(p, registry, play(p)), [], 'no mistakes, no round');
  const single = plan({ intent: 'learn-new', format: 'single', exerciseId: 'german-type' });
  assert.deepEqual(buildCorrectionTasks(single, registry, play(single, () => true)), [], 'single has no round');
});

test('summary shows components and mistakes; a later correct answer marks the mistake corrected', () => {
  const p = plan({ intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises' });
  const target = p.batch.wordIds[2];
  const facts = play(p, task => task.target.wordId === target && task.exerciseId === 'german-choice');
  const [correction] = buildCorrectionTasks(p, registry, facts);
  const state = { plan: p, status: 'completed', taskIndex: 36, revision: 99, corrections: [correction] };
  const before = summarizeVocabularySession({ ...state, status: 'presenting', taskIndex: 35 }, registry, facts);
  const word = before.words.find(w => w.wordId === target);
  assert.equal(word.mistakes.length, 1);
  assert.equal(word.mistakes[0].corrected, false);
  assert.equal(word.mistakes[0].expected, registry.validateTask(p.tasks.find(t => t.target.wordId === target && t.exerciseId === 'german-choice')).specification.answer.text);
  // Component level: the later meaning-recall stage already confirmed recognition after the error.
  assert.equal(word.components.find(c => c.component === 'recognition').result, 'corrected');
  const after = summarizeVocabularySession(state, registry, [...facts, fact(p, registry.validateTask(correction), 'answer', right(correction))]);
  const fixed = after.words.find(w => w.wordId === target);
  assert.equal(fixed.mistakes[0].corrected, true);
  assert.equal(fixed.components.find(c => c.component === 'recognition').result, 'corrected');
  assert.deepEqual(after.words.map(w => w.wordId), p.batch.wordIds);
  assert.equal(after.tasks, 36); assert.equal(after.mistakes, 1);
  for (const other of after.words.filter(w => w.wordId !== target))
    assert.ok(other.components.every(c => c.result === 'correct'), other.wordId);
});

test('review circuit: each word starts with its own diagnostic; later stages are aided', () => {
  const progress = words.slice(0, 5).map(word => {
    let result = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
    for (const c of applicableComponents(word)) result = initializeComponent(result, word, c, '2026-10-20T12:00:00.000Z');
    return result;
  });
  for (const scope of ['all-exercises', 'due-components']) {
    const p = plan({ intent: 'review-due', format: 'circuit', circuitScope: scope }, progress);
    // The first five tasks are one diagnostic per word; nothing of that word was shown before.
    assert.deepEqual(new Set(p.tasks.slice(0, 5).map(t => t.target.wordId)), new Set(p.batch.wordIds), scope);
    const summary = summarizeVocabularySession({ plan: p, status: 'completed', taskIndex: p.tasks.length, revision: 1 }, registry, play(p));
    for (const word of summary.words) {
      const diagnostic = p.tasks.find(t => t.target.wordId === word.wordId);
      const assessed = { 'german-with-article-type': ['recall', 'spelling', 'article'], 'meaning-choice': ['recognition'] }[diagnostic.exerciseId];
      assert.ok(assessed, diagnostic.exerciseId);
      for (const c of word.components) assert.equal(c.first, assessed.includes(c.component) ? 'independent' : 'aided', `${scope} ${c.component}`);
    }
  }
});

test('repeated review circuits alternate diagnostics, so no component stays due forever', () => {
  const ids = words.slice(0, 5).map(w => w.id);
  const records = new Map(ids.map(id => [id, []]));
  const progressAt = asOf => ids.map(id => replayWord(words.find(w => w.id === id), records.get(id),
    { owner, dataEpoch: 'v2', epochStartedAt: '2026-01-01T00:00:00.000Z', asOf }).progress);
  function session(intent, when, sessionId) {
    clock = Date.parse(when);
    const result = planVocabularySession({ owner, sessionId, seed: sessionId, catalogVersion: 'catalog/1', dataEpoch: 'v2',
      studyTimezone: 'Europe/Berlin', at: when, words, progress: progressAt(when), deck: { id: 'deck', title: 'd', wordIds: ids },
      request: { deckId: 'deck', answerLanguage: 'ru', intent, format: 'circuit', circuitScope: intent === 'learn-new' ? 'all-exercises' : 'due-components' } });
    assert.equal(result.kind, 'ready', when);
    for (const f of play(result.plan)) records.get(f.event.target.wordId).push({ ...f, owner, receivedAt: f.event.occurredAt });
    return result.plan;
  }
  session('learn-new', '2026-10-01T09:00:00.000Z', 'learn');
  const firsts = [];
  for (const [i, when] of ['2026-12-20T09:00:00.000Z', '2027-06-01T09:00:00.000Z', '2027-12-01T09:00:00.000Z', '2028-06-01T09:00:00.000Z'].entries())
    firsts.push(session('review-due', when, 'review-' + i).tasks[0].exerciseId);
  assert.ok(firsts.includes('meaning-choice') && firsts.includes('german-with-article-type'), firsts.join());
  for (const p of progressAt('2028-06-02T09:00:00.000Z'))
    for (const [c, value] of Object.entries(p.components)) assert.ok(value.reviewCount >= 1, `${p.wordId} ${c} never reviewed`);
});

test('a circuit skips stages a word cannot take and keeps the batch', () => {
  const verb = { ...words[0], id: 'verb', lemma: 'gehen', partOfSpeech: 'verb', article: undefined, senseId: 'go',
    meanings: { ru: { preferred: 'идти', accepted: [] } } };
  delete verb.article;
  const all = [verb, ...words];
  const result = planVocabularySession({ owner, sessionId: 'v', seed: 'v', catalogVersion: 'catalog/v', dataEpoch: 'v2',
    studyTimezone: 'Europe/Berlin', at, words: all, progress: [], deck: { id: 'deck', title: 'd', wordIds: all.map(w => w.id) },
    request: { deckId: 'deck', answerLanguage: 'ru', intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises' } });
  assert.equal(result.kind, 'ready');
  const p = result.plan;
  assert.equal(p.batch.wordIds.length, 5);
  assert.ok(p.batch.wordIds.includes('verb'));
  // Every stage is either planned for the verb or reported with its reason; article stages never apply.
  const planned = p.tasks.filter(t => t.target.wordId === 'verb').map(t => t.exerciseId);
  const skipped = Object.fromEntries(p.skippedExercises.filter(x => x.wordId === 'verb').map(x => [x.exerciseId, x.reason]));
  for (const id of ['introduction', 'meaning-choice', 'german-choice', 'article-choice', 'german-type', 'german-with-article-type', 'meaning-recall'])
    assert.ok(planned.includes(id) !== (id in skipped), id);
  assert.equal(skipped['article-choice'], 'article-not-applicable');
  assert.equal(skipped['german-with-article-type'], 'article-not-applicable');
  assert.ok(planned.includes('introduction') && planned.includes('german-type'));
  assert.equal(p.tasks.length, 4 * 7 + planned.length);
});
