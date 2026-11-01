import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduler, SCHEDULER_PARAMETERS, SCHEDULER_VERSION, unintroducedComponent,
  createWordProgress, initializeComponent, reviewComponent, COMPONENTS } from '../packages/vocabulary-core/dist/index.js';
import { words } from '../packages/vocabulary-core/build-test/test/fixtures.js';

const T0 = '2026-10-23T12:00:00.000Z';
const T1 = '2026-10-24T12:00:00.000Z';
const T2 = '2026-10-25T12:00:00.000Z';
const noun = words[0];
const verb = words[1];
const owner = { kind: 'account', id: 'user-1' };
const close = (actual, expected, epsilon = 1e-12) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test('untouched word contains only applicable, unintroduced components with no deadline', () => {
  const nounProgress = createWordProgress(noun, owner, 'evidence/1');
  const verbProgress = createWordProgress(verb, owner, 'evidence/1');
  assert.equal(nounProgress.introducedAt, null);
  assert.equal(nounProgress.schedulerVersion, SCHEDULER_VERSION);
  assert.deepEqual(Object.keys(nounProgress.components), ['recognition', 'recall', 'spelling', 'article']);
  assert.equal('article' in verbProgress.components, false);
  for (const state of Object.values(nounProgress.components)) {
    assert.equal(state.stage, 'unintroduced');
    assert.equal(state.dueAt, null);
    assert.equal(scheduler.nextDue(state), null);
    assert.equal(scheduler.retention(state, T0), 0);
  }
  assert.notEqual(nounProgress.components.recognition, nounProgress.components.recall);
});

test('introduction schedules conservative learning without fabricating a review', () => {
  const original = createWordProgress(noun, owner, 'evidence/1');
  const before = JSON.stringify(original);
  const introduced = initializeComponent(original, noun, 'recognition', T0);
  assert.equal(JSON.stringify(original), before);
  assert.equal(introduced.introducedAt, T0);
  assert.equal(introduced.revision, 1);
  assert.deepEqual(introduced.components.recognition, {
    stage: 'learning', stability: 0.40255, difficulty: 7.1949, initializedAt: T0,
    lastReviewedAt: null, dueAt: '2026-10-23T12:10:00.000Z', reviewCount: 0, lapseCount: 0,
  });
  assert.equal(initializeComponent(introduced, noun, 'recognition', T1), introduced);
  assert.equal(introduced.components.recall.stage, 'unintroduced');
  assert.equal(introduced.components.recall.dueAt, null);
});

test('published FSRS-5 parameters give fixed one-day reference transitions for all grades', () => {
  // Constants calculated independently from the published equations in Python.
  // The DrillCards learning step keeps Hard in learning and Again is not a mature lapse.
  const expected = [
    ['again', 0.2619420221524462, 8.082797017759107, 'learning', '2026-10-24T12:10:00.000Z'],
    ['hard', 0.8337093592231163, 7.629716592535107, 'learning', '2026-10-24T12:10:00.000Z'],
    ['good', 2.265009435089055, 7.176636167311107, 'review', '2026-10-26T12:00:00.000Z'],
    ['easy', 5.970931219029256, 6.723555742087108, 'review', '2026-10-30T12:00:00.000Z'],
  ];
  const original = Object.freeze(scheduler.initialize(T0));
  for (const [rating, stability, difficulty, stage, dueAt] of expected) {
    const actual = scheduler.review(original, rating, T1);
    close(actual.stability, stability);
    close(actual.difficulty, difficulty);
    assert.equal(actual.stage, stage);
    assert.equal(actual.dueAt, dueAt);
    assert.equal(scheduler.nextDue(actual), dueAt);
    assert.equal(actual.reviewCount, 1);
    assert.equal(actual.lapseCount, 0);
    assert.deepEqual(actual, scheduler.review(original, rating, T1));
  }
});

test('retention is nonlinear and reaches 90% at stability days after the baseline', () => {
  const state = scheduler.initialize(T0);
  const atDays = days => new Date(Date.parse(T0) + days * 86400000).toISOString();
  close(scheduler.retention(state, T0), 1);
  close(scheduler.retention(state, atDays(state.stability)), 0.9, 1e-8);
  close(scheduler.retention(state, T1), 0.7948771480768196);
  const r1 = scheduler.retention(state, atDays(1));
  const r2 = scheduler.retention(state, atDays(2));
  const r3 = scheduler.retention(state, atDays(3));
  assert.ok(r1 > r2 && r2 > r3 && r3 > 0);
  assert.ok(r1 - r2 > r2 - r3);
});

test('a lapse enters relearning and recovery returns to review without losing history', () => {
  const learned = scheduler.review(scheduler.initialize(T0), 'good', T1);
  const failed = scheduler.review(learned, 'again', T2);
  assert.equal(failed.stage, 'relearning');
  assert.equal(failed.lapseCount, 1);
  assert.equal(failed.reviewCount, 2);
  assert.equal(failed.dueAt, '2026-10-25T12:10:00.000Z');
  assert.ok(failed.stability <= learned.stability);
  const failedAgain = scheduler.review(failed, 'again', '2026-10-25T12:10:00.000Z');
  assert.equal(failedAgain.lapseCount, 1); // one forgetting episode, not every retry
  const recovered = scheduler.review(failedAgain, 'good', '2026-10-26T12:00:00.000Z');
  assert.equal(recovered.stage, 'review');
  assert.equal(recovered.lapseCount, 1);
  assert.equal(recovered.reviewCount, 4);
});

test('short-interval branch is separate from calendar-day evidence aggregation', () => {
  const state = scheduler.initialize(T0);
  const good = scheduler.review(state, 'good', '2026-10-23T12:10:00.000Z');
  close(good.stability, 0.5666983024925972);
  const hard = scheduler.review(state, 'hard', '2026-10-23T12:10:00.000Z');
  assert.equal(hard.stability, state.stability);
  assert.equal(hard.stage, 'learning');
  assert.equal(scheduler.review(state, 'again', T0).stage, 'learning');
});

test('components remain independent under the same word across exercise/deck context changes', () => {
  let progress = createWordProgress(noun, owner, 'evidence/1');
  progress = initializeComponent(progress, noun, 'recall', T0);
  progress = initializeComponent(progress, noun, 'spelling', T0);
  progress = initializeComponent(progress, noun, 'article', T0);
  const before = JSON.stringify(progress);
  const spelling = progress.components.spelling;
  const article = progress.components.article;
  const changed = reviewComponent(progress, { ...noun, tags: ['another-deck'] }, 'recall', 'good', T1);
  assert.equal(changed.wordId, noun.id);
  assert.equal(changed.components.spelling, spelling);
  assert.equal(changed.components.article, article);
  assert.equal(changed.components.recognition.stage, 'unintroduced');
  assert.equal(changed.components.recognition.dueAt, null);
  assert.equal(changed.introducedAt, T0);
  assert.equal(JSON.stringify(progress), before);
  assert.equal(changed.revision, progress.revision + 1);
});

test('invalid identity, applicability, version and inconsistent word snapshots fail explicitly', () => {
  const empty = createWordProgress(verb, owner, 'evidence/1');
  assert.throws(() => initializeComponent(empty, verb, 'article', T0), /does not apply/);
  assert.throws(() => reviewComponent(empty, verb, 'recall', 'good', T1), /Introduce/);
  assert.throws(() => initializeComponent(empty, noun, 'recall', T0), /identity/);
  assert.throws(() => initializeComponent({ ...empty, schedulerVersion: 'future' }, verb, 'recall', T0), /version/);
  assert.throws(() => initializeComponent({ ...empty, components: {} }, verb, 'recall', T0), /missing/);
  assert.throws(() => initializeComponent({ ...empty, components: { ...empty.components, article: unintroducedComponent() } }, verb, 'recall', T0), /Unexpected/);
  const active = initializeComponent(empty, verb, 'recall', T0);
  assert.throws(() => reviewComponent({ ...active, introducedAt: null }, verb, 'recall', 'good', T1), /history/);
  assert.throws(() => initializeComponent(active, verb, 'spelling', '2026-10-22T12:00:00.000Z'), /Replay/);
});

test('reject backwards time, impossible dates, invalid grades and corrupted component states', () => {
  const state = scheduler.initialize(T0);
  for (const at of ['bad', '2026-02-30T12:00:00.000Z', '2026-10-23', '2026-10-23T12:00:00+00:00']) {
    assert.throws(() => scheduler.initialize(at), RangeError);
  }
  assert.throws(() => scheduler.review(state, 'good', '2026-10-22T12:00:00.000Z'), /precedes/);
  for (const rating of ['bad', ['good'], null]) assert.throws(() => scheduler.review(state, rating, T1), /rating/);
  for (const bad of [{ ...state, stability: NaN }, { ...state, difficulty: 11 },
    { ...state, reviewCount: -1 }, { ...state, lapseCount: 1 },
    { ...state, dueAt: T1 }, { ...state, initializedAt: null },
    { ...state, stage: 'review' }, { ...unintroducedComponent(), dueAt: T0 }]) {
    assert.throws(() => scheduler.review(bad, 'good', T1), RangeError);
  }
});

test('long review sequences stay finite and obey versioned limits', () => {
  let state = scheduler.initialize(T0);
  for (let i = 0; i < 150; i++) {
    const at = new Date(Date.parse(state.lastReviewedAt ?? state.initializedAt) + 10 * 86400000).toISOString();
    state = scheduler.review(state, i % 7 === 6 ? 'again' : 'easy', at);
    assert.ok(Number.isFinite(state.stability));
    assert.ok(state.stability >= SCHEDULER_PARAMETERS.minStabilityDays && state.stability <= SCHEDULER_PARAMETERS.maxStabilityDays);
    assert.ok(state.difficulty >= 1 && state.difficulty <= 10);
    assert.ok(Date.parse(scheduler.nextDue(state)) > Date.parse(at));
    assert.ok(scheduler.retention(state, at) <= 1);
  }
  assert.equal(state.reviewCount, 150);
  assert.ok(Object.isFrozen(SCHEDULER_PARAMETERS));
  assert.ok(Object.isFrozen(SCHEDULER_PARAMETERS.weights));
  assert.ok(Object.isFrozen(COMPONENTS));
});
