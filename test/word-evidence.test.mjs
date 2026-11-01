import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordProgress, initializeComponent, reviewComponent, deriveWordEvidence,
  projectWordDay, studyDate, EVIDENCE_POLICY_VERSION, WORD_EXERCISE_RULES } from '../packages/vocabulary-core/dist/index.js';
import { words, answer } from '../packages/vocabulary-core/build-test/test/fixtures.js';

const word = words[0];
const owner = { kind: 'account', id: 'user-1' };
const day = { date: '2026-10-24', timezone: 'Europe/Berlin' };
let next = 0;
function fact(exerciseId, components = {}, overrides = {}, source = 'automatic') {
  const n = ++next;
  return { event: { ...answer, eventId: `e-${n}`, commandId: `c-${n}`, attemptId: `a-${n}`,
    taskId: `task-${n}`, exerciseId, taskVersion: `${exerciseId}/1`, occurredAt: '2026-10-24T10:00:00.000Z',
    policyVersion: EVIDENCE_POLICY_VERSION, ...overrides },
    evaluation: { source, outcome: Object.values(components).includes('incorrect') ? 'incorrect' : 'correct', components } };
}
function nonAnswer(kind, exerciseId, overrides = {}) {
  const { attemptId, rawAnswer, assisted, ...event } = fact(exerciseId, {}, overrides).event;
  return { event: { ...event, kind } };
}
function baseline() {
  let progress = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
  for (const component of Object.keys(progress.components)) progress = initializeComponent(progress, word, component, '2026-10-20T10:00:00.000Z');
  for (const component of Object.keys(progress.components)) progress = reviewComponent(progress, word, component, 'good', '2026-10-21T10:00:00.000Z');
  return progress;
}
const project = (facts, before = baseline(), studyDay = day) => projectWordDay(before, word, studyDay, facts);

test('reverse choice assesses recognition only and rejects an evaluator claiming free recall', () => {
  const f = fact('target-choice', { recognition: 'correct' });
  const before = baseline();
  const result = project([f], before);
  assert.deepEqual(result.evidence.map(e => [e.component, e.strength, e.rating]), [['recognition', 'independent', 'good']]);
  assert.equal(result.progress.components.recall, before.components.recall);
  assert.equal(result.progress.components.spelling, before.components.spelling);
  assert.equal(result.transitions.length, 1);
  assert.throws(() => project([fact('target-choice', { recall: 'correct' })]), /Unsupported component/);
});

test('wrong article preserves successful recall and spelling of the correct word', () => {
  const result = project([fact('target-with-article-type', { recall: 'correct', spelling: 'correct', article: 'incorrect' }, { rawAnswer: 'die Tisch' })]);
  assert.equal(result.progress.components.recall.stage, 'review');
  assert.equal(result.progress.components.spelling.stage, 'review');
  assert.equal(result.progress.components.article.stage, 'relearning');
  assert.deepEqual(result.transitions.map(t => [t.component, t.rating]), [['recall', 'good'], ['spelling', 'good'], ['article', 'again']]);
});

test('another lexical word does not establish spelling or article of the target', () => {
  const before = baseline();
  const result = project([fact('target-with-article-type', { recall: 'incorrect', spelling: 'correct', article: 'correct' }, { rawAnswer: 'der Stuhl' })], before);
  assert.equal(result.progress.components.spelling, before.components.spelling);
  assert.equal(result.progress.components.article, before.components.article);
  assert.equal(result.evidence.find(e => e.component === 'spelling').outcome, 'unobserved');
  assert.deepEqual(result.transitions.map(t => t.component), ['recall']);
  for (const recall of [undefined, 'unobserved']) {
    const components = { spelling: 'correct' };
    if (recall) components.recall = recall;
    assert.equal(project([fact('target-type', components)], before).transitions.length, 0);
  }
});

test('earlier choice exposes German for subsequent typing even if client exposure is empty', () => {
  const choice = fact('meaning-choice', { recognition: 'correct' });
  const typed = fact('target-type', { recall: 'correct', spelling: 'correct' }, { occurredAt: '2026-10-24T10:01:00.000Z' });
  const result = project([typed, choice]);
  assert.deepEqual(result.evidence.filter(e => e.eventId === typed.event.eventId).map(e => e.strength), ['aided', 'aided']);
  assert.deepEqual(result.transitions.map(t => t.component), ['recognition']);
});

test('component-specific hint and global assistance prevent positive SRS evidence', () => {
  const result = project([fact('target-type', { recall: 'correct', spelling: 'correct' }, { exposure: ['spelling'] })]);
  assert.deepEqual(result.transitions.map(t => t.component), ['recall']);
  assert.equal(result.evidence.find(e => e.component === 'spelling').strength, 'aided');
  assert.equal(project([fact('target-type', { recall: 'correct', spelling: 'correct' }, { assisted: true })]).transitions.length, 0);
});

test('an independent error survives reveal, retry and successful correction in the same circuit', () => {
  const error = fact('target-type', { recall: 'incorrect', spelling: 'unobserved' });
  const reveal = nonAnswer('reveal', 'target-type', { taskId: error.event.taskId, occurredAt: '2026-10-24T10:01:00.000Z' });
  const correction = fact('target-type', { recall: 'correct', spelling: 'correct' }, { taskId: error.event.taskId, occurredAt: '2026-10-24T10:02:00.000Z' });
  const before = baseline();
  const result = project([correction, reveal, error], before);
  assert.equal(result.progress.components.recall.reviewCount, before.components.recall.reviewCount + 1);
  assert.equal(result.progress.components.recall.stage, 'relearning');
  assert.equal(result.transitions[0].rating, 'again');
  assert.ok(result.evidence.filter(e => e.eventId === correction.event.eventId).every(e => e.strength === 'aided'));
});

test('many sessions on the same date produce one conservative transition from the original baseline', () => {
  const good = fact('target-type', { recall: 'correct' }, { sessionId: 's1' });
  const bad = fact('target-type', { recall: 'incorrect' }, { sessionId: 's2', occurredAt: '2026-10-24T12:00:00.000Z' });
  const later = fact('target-type', { recall: 'correct' }, { sessionId: 's3', occurredAt: '2026-10-24T13:00:00.000Z' });
  const before = baseline();
  const result = project([later, good, bad], before);
  assert.equal(result.progress.components.recall.reviewCount, before.components.recall.reviewCount + 1);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].rating, 'again');
  assert.equal(result.transitions[0].at, bad.event.occurredAt);
  assert.equal(result.progress.components.recall.dueAt, '2026-10-24T12:10:00.000Z');
  assert.deepEqual(result, project([bad, good, later], before));
  assert.throws(() => project([good], result.progress), /pre-day/);
});

test('self-assessment after its own reveal is marked subjective and capped at Hard', () => {
  const rated = fact('meaning-recall', { recognition: 'correct' }, { occurredAt: '2026-10-24T10:02:00.000Z' }, 'self-assessment');
  const reveal = nonAnswer('reveal', 'meaning-recall', { taskId: rated.event.taskId, occurredAt: '2026-10-24T10:01:00.000Z' });
  const result = project([rated, reveal]);
  assert.equal(result.evidence[0].source, 'self-assessment');
  assert.equal(result.evidence[0].strength, 'subjective');
  assert.equal(result.transitions[0].rating, 'hard');
  const otherReveal = nonAnswer('reveal', 'meaning-recall', { occurredAt: '2026-10-24T10:00:00.000Z' });
  assert.equal(project([otherReveal, reveal, rated]).transitions.length, 0);
  assert.equal(project([reveal, { ...rated, event: { ...rated.event, exposure: ['recognition'] } }]).transitions.length, 0);
  assert.throws(() => project([fact('meaning-recall', { recognition: 'correct' })]), /evaluation/);
});

test('self-assessment requires an own-task reveal before rating, including late delivery', () => {
  const rated = fact('meaning-recall', { recognition: 'correct' }, { occurredAt: '2026-10-24T10:02:00.000Z' }, 'self-assessment');
  const missing = project([rated]);
  assert.equal(missing.transitions.length, 0);
  assert.equal(missing.evidence[0].outcome, 'unobserved');
  const wrong = nonAnswer('reveal', 'meaning-recall', { occurredAt: '2026-10-24T10:01:00.000Z' });
  assert.equal(project([wrong, rated]).transitions.length, 0);
  const future = nonAnswer('reveal', 'meaning-recall', { taskId: rated.event.taskId, occurredAt: '2026-10-24T10:03:00.000Z' });
  assert.equal(project([future, rated]).transitions.length, 0);
  const otherSession = nonAnswer('reveal', 'meaning-recall', { sessionId: 'other', taskId: rated.event.taskId, occurredAt: '2026-10-24T10:01:00.000Z' });
  assert.equal(project([otherSession, rated]).transitions.length, 0);
  const own = nonAnswer('reveal', 'meaning-recall', { taskId: rated.event.taskId, occurredAt: '2026-10-24T10:01:00.000Z' });
  assert.equal(project([rated, own]).transitions[0].rating, 'hard');
});

test('learning initializes observed components without a successful review, including aided training', () => {
  const fresh = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
  const intro = nonAnswer('introduction', 'introduction', { intent: 'learn-new' });
  const typed = fact('target-type', { recall: 'correct', spelling: 'correct' }, { intent: 'learn-new', occurredAt: '2026-10-24T10:01:00.000Z' });
  const before = JSON.stringify(fresh);
  const result = project([typed, intro], fresh);
  for (const component of ['recognition', 'recall', 'spelling']) {
    assert.equal(result.progress.components[component].stage, 'learning');
    assert.equal(result.progress.components[component].reviewCount, 0);
    assert.equal(result.progress.components[component].lastReviewedAt, null);
  }
  assert.equal(result.progress.components.article.stage, 'unintroduced');
  assert.equal(result.progress.introducedAt, intro.event.occurredAt);
  assert.equal(JSON.stringify(fresh), before);
  assert.ok(result.evidence.filter(e => e.eventId === typed.event.eventId).every(e => e.strength === 'aided'));
});

test('practice and assessment preserve all schedules; a reveal alone never updates progress', () => {
  const before = baseline();
  for (const intent of ['practice', 'assessment']) {
    const result = project([fact('target-type', { recall: 'correct', spelling: 'correct' }, { intent })], before);
    assert.equal(result.progress, before);
    assert.equal(result.transitions.length, 0);
    const fresh = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
    assert.equal(project([nonAnswer('introduction', 'introduction', { intent })], fresh).progress, fresh);
  }
  assert.equal(project([nonAnswer('reveal', 'target-type')], before).progress, before);
});

test('early review and unintroduced review components cannot silently advance SRS', () => {
  const before = baseline();
  const f = fact('target-type', { recall: 'correct' }, { occurredAt: '2026-10-22T10:00:00.000Z' });
  assert.equal(project([f], before, { ...day, date: '2026-10-22' }).progress, before);
  const fresh = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
  assert.equal(project([fact('target-type', { recall: 'correct' })], fresh).progress, fresh);
});

test('session exposure survives midnight and does not leak into a different session', () => {
  const choice = fact('meaning-choice', { recognition: 'correct' }, { occurredAt: '2026-10-23T21:59:00.000Z' });
  const typed = fact('target-type', { recall: 'correct' }, { occurredAt: '2026-10-23T22:01:00.000Z' });
  const exposed = project([choice, typed]);
  assert.equal(exposed.transitions.length, 0);
  assert.equal(exposed.evidence[0].strength, 'aided');
  assert.equal(project([choice, { ...typed, event: { ...typed.event, sessionId: 'new-session' } }]).transitions.length, 1);
});

test('equal-time exposures precede answers, regardless of event IDs or input order', () => {
  const typed = fact('target-type', { recall: 'correct' }, { eventId: 'aaa' });
  const choice = fact('meaning-choice', { recognition: 'correct' }, { eventId: 'zzz' });
  const result = project([typed, choice]);
  assert.equal(result.evidence.find(e => e.eventId === 'aaa' && e.component === 'recall').strength, 'aided');
  assert.deepEqual(result, project([choice, typed]));
  const bad = fact('target-type', { recall: 'incorrect' }, { taskId: typed.event.taskId, eventId: 'bbb' });
  assert.equal(project([typed, bad]).transitions[0].rating, 'again');
});

test('duplicate delivery is idempotent and conflicting identities fail rather than double count', () => {
  const f = fact('target-type', { recall: 'correct' });
  assert.deepEqual(project([f, JSON.parse(JSON.stringify(f))]), project([f]));
  assert.throws(() => project([f, { ...f, event: { ...f.event, rawAnswer: 'different' } }]), /Conflicting event/);
  assert.throws(() => project([f, fact('target-type', { recall: 'correct' }, { commandId: f.event.commandId })]), /Command reused/);
  assert.throws(() => project([f, fact('target-type', { recall: 'correct' }, { attemptId: f.event.attemptId })]), /Attempt reused/);
});

test('study dates use the pinned zone, including DST and midnight', () => {
  assert.equal(studyDate('2026-10-23T22:30:00.000Z', 'Europe/Berlin'), '2026-10-24');
  assert.equal(studyDate('2026-10-25T00:30:00.000Z', 'Europe/Berlin'), '2026-10-25');
  assert.equal(studyDate('2026-10-25T01:30:00.000Z', 'Europe/Berlin'), '2026-10-25');
  assert.equal(studyDate('2026-10-24T00:30:00.000Z', 'America/New_York'), '2026-10-23');
  assert.throws(() => project([], baseline(), { ...day, date: '2026-02-30' }), RangeError);
  assert.throws(() => project([], baseline(), { ...day, timezone: 'invalid' }), RangeError);
});

test('reject unsupported versions, mixed epochs/timezones, non-word facts and changed task context', () => {
  const f = fact('target-type', { recall: 'correct' });
  for (const patch of [{ policyVersion: 'future' }, { target: { kind: 'word', wordId: 'other' } },
    { target: { kind: 'assessment', datasetId: 'd', itemId: 'i' } }, { exerciseId: 'unknown' }]) {
    assert.throws(() => project([{ ...f, event: { ...f.event, ...patch } }]), RangeError);
  }
  assert.throws(() => project([f, fact('target-type', { recall: 'correct' }, { dataEpoch: 'different' })]), /epochs/);
  assert.throws(() => project([fact('target-type', { recall: 'correct' }, { studyTimezone: 'UTC' })]), /timezone/);
  assert.throws(() => project([nonAnswer('reveal', 'target-type', { studyTimezone: 'UTC' })]), /timezone/);
  assert.throws(() => project([f, fact('article-choice', { article: 'correct' }, { taskId: f.event.taskId })]), /context changed/);
  const broken = { ...baseline(), introducedAt: null };
  assert.throws(() => project([], broken), /history/);
  assert.ok(Object.isFrozen(WORD_EXERCISE_RULES));
  assert.ok(Object.isFrozen(WORD_EXERCISE_RULES['target-choice'].assessed));
});
