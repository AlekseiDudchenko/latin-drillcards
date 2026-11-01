import test from 'node:test';
import assert from 'node:assert/strict';
import { replayWord, createWordProgress, initializeComponent, reviewComponent, summarizeWord,
  selectNewWords, selectDueWords, EVIDENCE_POLICY_VERSION, WORD_SUMMARY_POLICY, CLOCK_POLICY } from '../packages/vocabulary-core/dist/index.js';
import { words, answer } from '../packages/vocabulary-core/build-test/test/fixtures.js';

const owner = { kind: 'account', id: 'user-1' };
const word = words[0];
const context = { owner, dataEpoch: 'v2', epochStartedAt: '2026-10-01T00:00:00.000Z', asOf: '2026-10-26T12:00:00.000Z' };
let next = 0;
function record(at, intent = 'review-due', components = { recall: 'correct', spelling: 'correct' }, overrides = {}, receipt = at) {
  const id = ++next;
  return { owner, receivedAt: receipt, event: { ...answer, eventId: `event-${id}`, commandId: `command-${id}`,
    attemptId: `attempt-${id}`, taskId: `task-${id}`, sessionId: `session-${id}`, intent,
    occurredAt: at, policyVersion: EVIDENCE_POLICY_VERSION, ...overrides },
    evaluation: { source: 'automatic', outcome: Object.values(components).includes('incorrect') ? 'incorrect' : 'correct', components } };
}
const introduction = () => record('2026-10-20T10:00:00.000Z', 'learn-new');
const review1 = () => record('2026-10-21T10:00:00.000Z');
const review2 = () => record('2026-10-24T10:00:00.000Z');
const replay = records => replayWord(word, records, context);

test('multi-day replay is deterministic under input order and duplicate event delivery', () => {
  const facts = [introduction(), review1(), review2()];
  const before = JSON.stringify(facts);
  const forward = replay(facts);
  assert.deepEqual(forward, replay([...facts].reverse()));
  assert.deepEqual(forward, replay([facts[2], facts[0], JSON.parse(JSON.stringify(facts[0])), facts[1]]));
  assert.equal(JSON.stringify(facts), before);
  assert.deepEqual(forward.days.map(day => day.day.date), ['2026-10-20', '2026-10-21', '2026-10-24']);
  assert.equal(forward.progress.components.recall.reviewCount, 2);
  assert.equal(forward.days[0].progress.components.recall.reviewCount, 0);
  assert.equal(forward.days[1].before, forward.days[0].progress);
  assert.equal(forward.progress.components.article.stage, 'unintroduced');
});

test('late independent failure recomputes its date and every subsequent transition from the original baseline', () => {
  const facts = [introduction(), review1(), review2()];
  const first = replay(facts);
  const late = record('2026-10-21T11:00:00.000Z', 'review-due', { recall: 'incorrect', spelling: 'unobserved' }, {}, '2026-10-25T12:00:00.000Z');
  const corrected = replay([...facts, late]);
  assert.deepEqual(corrected.days[0], first.days[0]);
  assert.equal(corrected.days[1].transitions.find(item => item.component === 'recall').rating, 'again');
  assert.notEqual(corrected.days[2].progress.components.recall.stability, first.days[2].progress.components.recall.stability);
  assert.equal(corrected.progress.components.recall.reviewCount, 2);
  assert.deepEqual(corrected.progress.components.spelling, first.progress.components.spelling);
  assert.deepEqual(corrected, replay([late, ...facts].reverse()));
});

test('large future clock errors are quarantined and retry delivery cannot legitimize them', () => {
  const future = record('2030-01-01T10:00:00.000Z', 'learn-new', undefined, {}, '2026-10-25T10:00:00.000Z');
  const result = replay([future]);
  assert.equal(result.progress.introducedAt, null);
  assert.deepEqual(result.quarantined, [{ eventId: future.event.eventId, reason: 'future-clock' }]);
  const retry = { ...future, receivedAt: '2030-01-01T10:00:00.000Z' };
  assert.deepEqual(result, replay([retry, future]));
  assert.equal(CLOCK_POLICY.maxFutureSkewMinutes, 5);
});

test('small future skew and not-yet-received records are deferred, never applied early', () => {
  const f = record('2026-10-26T12:03:00.000Z', 'learn-new', undefined, {}, context.asOf);
  const result = replay([f]);
  assert.equal(result.progress.introducedAt, null);
  assert.deepEqual(result.deferredEventIds, [f.event.eventId]);
  const later = replayWord(word, [f], { ...context, asOf: '2026-10-26T12:04:00.000Z' });
  assert.equal(later.progress.introducedAt, f.event.occurredAt);
  const offline = record('2026-10-20T10:00:00.000Z', 'learn-new', undefined, {}, '2026-10-27T10:00:00.000Z');
  assert.deepEqual(replay([offline]).deferredEventIds, [offline.event.eventId]);
});

test('epoch and owner isolation are explicit, and pre-epoch facts cannot restore old progress', () => {
  const old = record('2026-09-30T10:00:00.000Z', 'learn-new', undefined, {}, '2026-10-25T10:00:00.000Z');
  assert.deepEqual(replay([old]).quarantined, [{ eventId: old.event.eventId, reason: 'before-epoch' }]);
  assert.throws(() => replay([{ ...introduction(), owner: { ...owner, id: 'other' } }]), /owner\/epoch/);
  assert.throws(() => replay([record('2026-10-20T10:00:00.000Z', 'learn-new', undefined, { dataEpoch: 'old' })]), /owner\/epoch/);
  assert.throws(() => replayWord(word, [], { ...context, epochStartedAt: '2026-11-01T00:00:00.000Z' }), /Epoch/);
});

test('a late reveal restores its subjective rating through replay without making it automatic', () => {
  const intro = introduction();
  // Add explicit recognition learning; the typed introduction above only starts recall/spelling.
  const startRecognition = record('2026-10-20T11:00:00.000Z', 'learn-new', { recognition: 'correct' }, { exerciseId: 'meaning-choice', taskVersion: 'meaning-choice/1' });
  const rating = record('2026-10-24T10:02:00.000Z', 'review-due', { recognition: 'correct' }, { exerciseId: 'meaning-recall', taskVersion: 'meaning-recall/1' });
  rating.evaluation.source = 'self-assessment';
  const { attemptId, rawAnswer, assisted, ...event } = rating.event;
  const reveal = { owner, receivedAt: '2026-10-25T12:00:00.000Z', event: { ...event, eventId: 'reveal', commandId: 'reveal-command', kind: 'reveal', occurredAt: '2026-10-24T10:01:00.000Z' } };
  const incomplete = replay([intro, startRecognition, rating]);
  const complete = replay([intro, startRecognition, rating, reveal]);
  assert.equal(incomplete.progress.components.recognition.reviewCount, 0);
  assert.equal(complete.progress.components.recognition.reviewCount, 1);
  assert.equal(complete.days.at(-1).transitions[0].rating, 'hard');
  assert.equal(complete.days.at(-1).evidence[0].source, 'self-assessment');
});

test('session exposure across midnight persists in full replay and DST keeps one calendar day', () => {
  const choice = record('2026-10-23T21:59:00.000Z', 'review-due', { recognition: 'correct' }, { exerciseId: 'meaning-choice', taskVersion: 'meaning-choice/1', sessionId: 'resumed' });
  const typed = record('2026-10-23T22:01:00.000Z', 'review-due', undefined, { sessionId: 'resumed' });
  const result = replay([introduction(), choice, typed]);
  assert.equal(result.days.at(-1).day.date, '2026-10-24');
  assert.ok(result.days.at(-1).evidence.every(item => item.strength === 'aided'));
  assert.equal(result.days.at(-1).transitions.length, 0);
  const a = record('2026-10-25T00:30:00.000Z');
  const b = record('2026-10-25T01:30:00.000Z');
  const dst = replay([introduction(), a, b]);
  assert.equal(dst.days.length, 2);
  assert.equal(dst.progress.components.recall.reviewCount, 1);
});

test('timezone changes preserve stored dates; ambiguous or overlapping calendars fail explicitly', () => {
  const a = introduction();
  const b = record('2026-10-24T10:00:00.000Z', 'review-due', undefined, { studyTimezone: 'America/New_York' });
  const result = replay([a, b]);
  assert.equal(result.days[0].day.timezone, 'Europe/Berlin');
  assert.equal(result.days[1].day.timezone, 'America/New_York');
  assert.equal(result.days[0].day.date, '2026-10-20');
  assert.throws(() => replay([a, record(a.event.occurredAt, 'learn-new', undefined, { studyTimezone: 'UTC' })]), /timezone/);
  const laterLocalDate = record('2026-10-23T22:30:00.000Z', 'learn-new');
  const earlierLocalDate = record('2026-10-23T23:30:00.000Z', 'review-due', undefined, { studyTimezone: 'America/New_York' });
  assert.throws(() => replay([laterLocalDate, earlierLocalDate]), /Overlapping study calendar/);
  // Travelling east changes the local date of an old baseline if reinterpreted;
  // its original pinned date must be preserved instead.
  const west = record('2026-10-23T23:30:00.000Z', 'learn-new', undefined, { studyTimezone: 'America/New_York' });
  const east = record('2026-10-24T00:30:00.000Z');
  const travel = replay([east, west]);
  assert.deepEqual(travel.days.map(d => d.day.date), ['2026-10-23', '2026-10-24']);
  assert.equal(travel.progress.components.recall.reviewCount, 1);
  const simultaneous = { ...east, event: { ...east.event, occurredAt: west.event.occurredAt }, receivedAt: west.receivedAt };
  assert.throws(() => replay([west, simultaneous]), /Overlapping study calendar/);
});

function fresh(w = word) { return createWordProgress(w, owner, EVIDENCE_POLICY_VERSION); }
function started(w = word, component = 'recognition', at = '2026-10-20T10:00:00.000Z') {
  return initializeComponent(fresh(w), w, component, at);
}
function query(progress = [], exerciseId) {
  const result = { owner, words, progress, at: context.asOf, answerLanguage: 'ru' };
  if (exerciseId) result.exerciseId = exerciseId;
  return result;
}
const deck = { id: 'deck-1', title: 'Test', wordIds: [word.id, words[1].id, words[2].id, words[3].id] };

test('new queries preserve deck order, deduplicate membership and never treat a different exercise as newness', () => {
  const d = { ...deck, wordIds: [words[1].id, word.id, words[1].id] };
  assert.deepEqual(selectNewWords(d, query()).map(w => w.id), [words[1].id, word.id]);
  assert.deepEqual(selectNewWords(d, query([started()], 'target-type')).map(w => w.id), [words[1].id]);
  assert.equal(selectNewWords(d, query(), 1).length, 1);
  assert.equal(selectNewWords(d, query(), 0).length, 0);
  assert.equal(selectDueWords(d, query()).length, 0);
});

test('due queries select started components actually assessed by the chosen exercise, without padding', () => {
  const recall = started(word, 'recall');
  assert.equal(selectDueWords(deck, query([recall], 'target-choice')).length, 0);
  const due = selectDueWords(deck, query([recall], 'target-type'));
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].dueComponents, ['recall']);
  assert.equal(due[0].dueAt, recall.components.recall.dueAt);
  assert.equal(selectDueWords(deck, query([recall], 'introduction')).length, 0);
  assert.equal(selectDueWords(deck, query([recall], 'article-choice')).length, 0);
});

test('due queries prioritize learning/relearning, then earliest deadline and stable identity', () => {
  const noun = reviewComponent(started(), word, 'recognition', 'good', '2026-10-21T10:00:00.000Z');
  const verb = started(words[1], 'recognition', '2026-10-25T10:00:00.000Z');
  const results = selectDueWords(deck, query([noun, verb]));
  assert.deepEqual(results.map(item => item.word.id), [words[1].id, word.id]);
  const x = { ...word, id: 'a-word' };
  const y = { ...word, id: 'z-word' };
  const tied = { ...query([started(x), started(y)]), words: [y, x] };
  assert.deepEqual(selectDueWords({ ...deck, wordIds: [y.id, x.id] }, tied).map(item => item.word.id), [x.id, y.id]);
});

test('eligibility respects missing translations, parts of speech, tags and article applicability', () => {
  assert.deepEqual(selectNewWords(deck, { ...query(), answerLanguage: 'en' }).map(w => w.id), [word.id, words[2].id, words[3].id]);
  assert.deepEqual(selectNewWords(deck, query([], 'article-choice')).map(w => w.id), [word.id, words[2].id, words[3].id]);
  assert.deepEqual(selectNewWords(deck, query([], 'target-with-article-type')).map(w => w.id), [word.id]);
  assert.deepEqual(selectNewWords(deck, { ...query(), filter: { partOfSpeech: ['verb'] } }).map(w => w.id), [words[1].id]);
  const tagged = { ...word, tags: ['topic', 'a1'] };
  assert.equal(selectNewWords({ ...deck, wordIds: [word.id] }, { ...query(), words: [tagged], filter: { tags: ['topic', 'a1'] } }).length, 1);
  assert.equal(selectNewWords(deck, { ...query(), filter: { tags: ['missing'] } }).length, 0);
});

test('summary is derived from applicable components with zero unintroduced weight and a fixed future horizon', () => {
  const untouched = summarizeWord(word, undefined, context.asOf);
  assert.equal(untouched.state, 'new');
  assert.equal(untouched.coverage, 0);
  assert.equal(untouched.score, 0);
  assert.equal(untouched.dueAt, null);
  const progress = started(word, 'recognition', context.asOf);
  const snapshot = JSON.stringify(progress);
  const summary = summarizeWord(word, progress, context.asOf);
  assert.equal(summary.state, 'learning');
  assert.equal(summary.coverage, 0.25);
  assert.equal(summary.introducedCount, 1);
  assert.equal(summary.dueAt, progress.components.recognition.dueAt);
  assert.equal(summary.components[0].retentionNow, 1);
  assert.ok(summary.score > 0 && summary.score < 0.25);
  assert.equal(summary.scoreHorizonDays, 7);
  assert.equal(JSON.stringify(progress), snapshot);
  assert.equal(summarizeWord(words[1], undefined, context.asOf).applicableCount, 3);
  assert.ok(Object.isFrozen(WORD_SUMMARY_POLICY.weights));
});

test('word deadline is minimum among started components, and summary changes only by explicit time', () => {
  let p = started(word, 'recall');
  p = initializeComponent(p, word, 'spelling', '2026-10-21T10:00:00.000Z');
  const s = summarizeWord(word, p, context.asOf);
  assert.equal(s.state, 'due');
  assert.deepEqual(s.dueComponents, ['recall', 'spelling']);
  assert.equal(s.dueAt, p.components.recall.dueAt);
  const later = summarizeWord(word, p, '2026-10-30T12:00:00.000Z');
  assert.ok(later.score < s.score);
  const once = selectDueWords(deck, query([p]));
  assert.equal(once.length, 1);
  assert.deepEqual(once[0].dueComponents, ['recall', 'spelling']);
});

test('a complete word with future review deadlines is scheduled and stays out of both queues', () => {
  let progress = fresh();
  for (const component of Object.keys(progress.components)) progress = initializeComponent(progress, word, component, '2026-10-20T10:00:00.000Z');
  for (const component of Object.keys(progress.components)) progress = reviewComponent(progress, word, component, 'good', '2026-10-26T10:00:00.000Z');
  const summary = summarizeWord(word, progress, context.asOf);
  assert.equal(summary.coverage, 1);
  assert.equal(summary.state, 'scheduled');
  assert.deepEqual(summary.dueComponents, []);
  assert.ok(summary.score > 0 && summary.score < 1);
  const one = { ...deck, wordIds: [word.id] };
  assert.equal(selectNewWords(one, query([progress])).length, 0);
  assert.equal(selectDueWords(one, query([progress])).length, 0);
});

test('queries reject cross-owner projections, invalid limits, missing IDs, versions and duplicate snapshots', () => {
  assert.throws(() => selectNewWords(deck, query([{ ...started(), owner: { kind: 'guest', id: owner.id } }])), /owner/);
  assert.throws(() => selectDueWords(deck, query(), -1), /limit/);
  assert.throws(() => selectNewWords({ ...deck, wordIds: ['unknown'] }, query()), /unknown word/);
  assert.throws(() => selectNewWords(deck, query([started(), started()])), /Duplicate word/);
  assert.throws(() => selectNewWords(deck, { ...query(), words: [word, word] }), /Duplicate catalog/);
  assert.throws(() => summarizeWord(word, { ...started(), evidencePolicyVersion: 'future' }, context.asOf), /policy/);
  assert.throws(() => summarizeWord(word, started(word, 'recognition', '2026-10-27T12:00:00.000Z'), context.asOf), /precedes/);
});

test('a word is not due on the study day it was introduced or last reviewed, so offered reviews are never discarded', () => {
  const learned = replay([introduction()]);
  const sameDay = summarizeWord(word, learned.progress, '2026-10-20T20:00:00.000Z', 'UTC');
  assert.equal(sameDay.state, 'learning');
  assert.deepEqual(sameDay.dueComponents, []);
  const nextDay = summarizeWord(word, learned.progress, '2026-10-21T08:00:00.000Z', 'UTC');
  assert.equal(nextDay.state, 'due');
  const reviewed = replay([introduction(), review1()]);
  assert.deepEqual(summarizeWord(word, reviewed.progress, '2026-10-21T20:00:00.000Z', 'UTC').dueComponents, []);
});
