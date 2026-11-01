import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordProgress, initializeComponent, reviewComponent, applicableComponents, describeWordStatus, WORD_STATUS_POLICY,
  EVIDENCE_POLICY_VERSION } from '../packages/vocabulary-core/dist/index.js';

const owner = { kind: 'guest', id: 'G' };
const noun = { schemaVersion: 1, contentVersion: 1, id: 'tisch', lemma: 'Tisch', article: 'der', partOfSpeech: 'noun', senseId: 'tisch',
  meanings: { ru: { preferred: 'стол', accepted: [] } }, acceptedForms: [], tags: [], examples: [] };
const verb = { ...noun, id: 'gehen', lemma: 'gehen', article: undefined, partOfSpeech: 'verb', meanings: { ru: { preferred: 'идти', accepted: [] }, en: { preferred: 'go', accepted: [] } } };
const day = n => new Date(Date.UTC(2026, 9, 1 + n, 12)).toISOString();

/** Initialize every applicable component and review each one `reviews` times on consecutive far-apart days. */
function reviewed(word, reviews, components = applicableComponents(word), gapDays = 20) {
  let progress = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
  for (const component of components) {
    progress = initializeComponent(progress, word, component, day(0));
    for (let i = 1; i <= reviews; i++) progress = reviewComponent(progress, word, component, 'good', day(i * gapDays));
  }
  return progress;
}
const byExercise = (status, id) => status.exercises.find(item => item.exerciseId === id);

test('an unknown or never introduced word is new and every exercise starts at zero', () => {
  for (const progress of [undefined, createWordProgress(noun, owner, EVIDENCE_POLICY_VERSION)]) {
    const status = describeWordStatus(noun, progress, 'ru');
    assert.equal(status.state, 'new');
    assert.deepEqual(status.exercises.map(item => item.exerciseId),
      ['meaning-choice', 'target-choice', 'meaning-recall', 'target-type', 'article-choice', 'target-with-article-type']);
    assert.ok(status.exercises.every(item => item.available && item.reviews === 0 && !item.done && item.required === WORD_STATUS_POLICY.requiredReviews));
  }
});

test('exercises report their weakest assessed component and are done only when all of them are', () => {
  let progress = reviewed(noun, 4, ['recognition', 'recall', 'spelling']);
  progress = initializeComponent(progress, noun, 'article', day(0));
  const status = describeWordStatus(noun, progress, 'ru');
  assert.equal(byExercise(status, 'meaning-choice').done, true);
  assert.equal(byExercise(status, 'target-type').done, true);
  assert.equal(byExercise(status, 'article-choice').reviews, 0);
  assert.equal(byExercise(status, 'target-with-article-type').reviews, 0);
  assert.equal(byExercise(status, 'target-with-article-type').done, false);
  assert.notEqual(status.state, 'learned');
});

test('a word is learned once every applicable component has the reviews and the stability', () => {
  const status = describeWordStatus(noun, reviewed(noun, 4), 'ru');
  assert.equal(status.state, 'learned');
  assert.ok(status.components.every(item => item.done && item.stage === 'review' && item.stability >= WORD_STATUS_POLICY.requiredStabilityDays));
  assert.ok(status.exercises.every(item => item.done));
});

test('enough reviews with unstable memory is "unsettled", not learned', () => {
  const status = describeWordStatus(noun, reviewed(noun, 3, undefined, 1), 'ru');
  assert.ok(status.components.every(item => item.reviews >= WORD_STATUS_POLICY.requiredReviews));
  assert.ok(status.components.some(item => item.stability < WORD_STATUS_POLICY.requiredStabilityDays));
  assert.equal(status.state, 'unsettled');
});

test('a lapse takes a learned word back out of the learned state', () => {
  const progress = reviewComponent(reviewed(noun, 4), noun, 'recall', 'again', day(400));
  const status = describeWordStatus(noun, progress, 'ru');
  assert.notEqual(status.state, 'learned');
  assert.equal(status.components.find(item => item.component === 'recall').done, false);
});

test('a word with a few reviews is still learning', () => {
  assert.equal(describeWordStatus(noun, reviewed(noun, 1), 'ru').state, 'learning');
});

test('article exercises are unavailable without an article; a missing translation hides the others', () => {
  const status = describeWordStatus(verb, reviewed(verb, 4), 'ru');
  assert.equal(status.state, 'learned');
  for (const id of ['article-choice', 'target-with-article-type']) {
    assert.deepEqual([byExercise(status, id).available, byExercise(status, id).unavailableReason], [false, 'no-article']);
  }
  assert.equal(status.components.some(item => item.component === 'article'), false);
  const noTranslation = describeWordStatus(noun, undefined, 'en');
  assert.equal(byExercise(noTranslation, 'meaning-choice').unavailableReason, 'no-translation');
  assert.equal(byExercise(noTranslation, 'article-choice').available, true);
});

test('status does not depend on the deck or the interface: only owner progress and the answer language', () => {
  const progress = reviewed(noun, 2);
  assert.deepEqual(describeWordStatus(noun, progress, 'ru'), describeWordStatus({ ...noun, tags: ['another-deck'] }, progress, 'ru'));
});
