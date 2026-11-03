import test from 'node:test';
import assert from 'node:assert/strict';
import { planVocabularySession, vocabularyQueues, createWordProgress, initializeComponent, applicableComponents,
  EVIDENCE_POLICY_VERSION } from '../packages/vocabulary-core/dist/index.js';
import { deckOverview, decksOfWord, defaultSessionRequest, emptyQueueReason, parseRoute, routeHash, searchDecks, searchWords, startedCount,
  wordSummary } from '../public/v2/home-model.js';

const at = '2026-10-23T12:00:00.000Z';
const before = '2026-10-20T12:00:00.000Z';
const owner = { kind: 'guest', id: 'G' };
const noun = (id, lemma, article, ru, en = '') => ({ schemaVersion: 1, contentVersion: 1, id, lemma, article, partOfSpeech: 'noun',
  senseId: id, meanings: { ru: { preferred: ru, accepted: [] }, ...(en ? { en: { preferred: en, accepted: [] } } : {}) },
  acceptedForms: [], tags: [], examples: [] });
const verb = (id, lemma, ru) => ({ ...noun(id, lemma, undefined, ru, lemma), partOfSpeech: 'verb', article: undefined });
const words = [noun('tisch', 'Tisch', 'der', 'стол', 'table'), noun('tuer', 'Tür', 'die', 'дверь', 'door'),
  noun('bett', 'Bett', 'das', 'кровать', 'bed'), noun('lampe', 'Lampe', 'die', 'лампа'), verb('gehen', 'gehen', 'идти')];
const home = { id: 'home', title: 'Zuhause', wordIds: ['tisch', 'tuer', 'bett', 'lampe', 'gehen'] };
const office = { id: 'office', title: 'Büro', wordIds: ['tisch', 'lampe'] };
function progress(word, components = applicableComponents(word), time = before) {
  let result = createWordProgress(word, owner, EVIDENCE_POLICY_VERSION);
  for (const c of components) result = initializeComponent(result, word, c, time);
  return result;
}
const single = (exerciseId, answerLanguage = 'ru', deckId = 'home') =>
  ({ deckId, intent: 'learn-new', format: 'single', exerciseId, answerLanguage });
const overview = (request, progressList, deck = home) =>
  deckOverview({ request, deck, words: words.filter(w => deck.wordIds.includes(w.id)), progress: progressList, owner, at });

test('routes round-trip through the hash and fall back to the home screen', () => {
  for (const route of [{ view: 'home' }, { view: 'session' }, { view: 'deck', deckId: 'a1' },
    { view: 'word', wordId: 'w-tür & co', deckId: 'beruf' }, { view: 'word', wordId: 'w-tisch' }])
    assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.deepEqual(parseRoute(''), { view: 'home' });
  assert.deepEqual(parseRoute('#unknown=1'), { view: 'home' });
  assert.deepEqual(parseRoute('#deck=%20'), { view: 'home' });
});

test('a deck route may ask to start a session in an answer language; unknown values are ignored', () => {
  for (const route of [{ view: 'deck', deckId: 'a1', start: 'review-due' }, { view: 'deck', deckId: 'a1', start: 'learn-new', answer: 'en' }, { view: 'deck', deckId: 'a1', answer: 'de' },
    { view: 'deck', deckId: 'a1', answer: 'ru' }])
    assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(routeHash({ view: 'deck', deckId: 'a1', start: 'review-due', answer: 'en' }), '#deck=a1&start=review-due&answer=en');
  assert.deepEqual(parseRoute('#deck=a1&start=practice&answer=fr'), { view: 'deck', deckId: 'a1' });
  assert.deepEqual(parseRoute('#word=w-tisch&deck=a1&start=review-due'), { view: 'word', wordId: 'w-tisch', deckId: 'a1' });
});

test('the default session is a circuit through every exercise, for review as for new words', () => {
  for (const intent of ['review-due', 'learn-new'])
    assert.deepEqual(defaultSessionRequest(intent, 'a1', 'en'),
      { deckId: 'a1', answerLanguage: 'en', intent, format: 'circuit', circuitScope: 'all-exercises' });
});

test('deck search matches titles; word search matches headword with article and any translation', () => {
  assert.deepEqual(searchDecks([home, office], 'bü').map(d => d.id), ['office']);
  assert.deepEqual(searchDecks([home, office], '  ').map(d => d.id), ['home', 'office']);
  assert.deepEqual(searchWords(words, 'DIE T').map(w => w.id), ['tuer']);
  assert.deepEqual(searchWords(words, 'лампа').map(w => w.id), ['lampe']);
  assert.deepEqual(searchWords(words, 'door').map(w => w.id), ['tuer']);
  assert.deepEqual(decksOfWord([home, office], 'lampe').map(d => d.id), ['home', 'office']);
});

test('counts are the planner queues for the chosen exercise and language; a batch only draws from them', () => {
  const started = [progress(words[0])];
  for (const request of [single('meaning-choice'), single('article-choice'), single('target-choice', 'en'),
    { deckId: 'home', intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises', answerLanguage: 'en' }]) {
    const stats = overview(request, started);
    const queues = vocabularyQueues({ request, deck: home, words, progress: started, owner, at });
    assert.equal(stats.fresh, queues.fresh.length);
    const plan = planVocabularySession({ request, deck: home, words, progress: started, owner, at, dataEpoch: 'e',
      sessionId: 's', seed: 's', catalogVersion: 'c', studyTimezone: 'UTC' });
    // The planner may still skip a queued word without an available task (e.g. too few choice options).
    const batch = plan.kind === 'ready' ? plan.plan.batch.wordIds : [];
    const queued = queues.fresh.map(w => w.id);
    assert.deepEqual(batch, queued.filter(id => batch.includes(id)));
  }
  // Articles exist for nouns only; English lacks a translation for "Lampe".
  assert.equal(overview(single('article-choice'), []).fresh, 4);
  assert.equal(overview(single('target-choice', 'en'), []).fresh, 4);
});

test('new and due queues stay separate and explain why they are empty', () => {
  const none = overview(single('meaning-choice'), []);
  assert.deepEqual([none.fresh, none.due, none.started, none.nextDueAt], [5, 0, 0, null]);
  assert.equal(emptyQueueReason('learn-new', none), undefined);
  assert.equal(emptyQueueReason('review-due', none), 'nothing-started');

  // Every word started; their components are due three days after initialization.
  const all = words.map(w => progress(w));
  const due = overview(single('meaning-choice'), all);
  assert.deepEqual([due.fresh, due.due, due.started], [0, 5, 5]);
  assert.equal(emptyQueueReason('learn-new', due), 'all-started');
  assert.equal(emptyQueueReason('review-due', due), undefined);

  // Only the recall component is started: nothing is due for an article exercise, but something is in a full set.
  const recall = words.slice(0, 4).map(w => progress(w, ['recall']));
  const article = overview(single('article-choice'), recall);
  assert.deepEqual([article.due, article.dueAnyExercise], [0, 4]);
  assert.equal(emptyQueueReason('review-due', article), 'not-for-exercise');
  assert.equal(emptyQueueReason('learn-new', overview(single('article-choice'), [...recall])), 'not-for-exercise');

  // Started just now: nothing due yet, with the next deadline.
  const fresh = overview(single('meaning-choice'), [progress(words[0], undefined, at)]);
  assert.equal(fresh.due, 0);
  assert.equal(emptyQueueReason('review-due', fresh), 'not-due-yet');
  assert.ok(fresh.nextDueAt > at);

  // English: the remaining new word has no translation.
  const en = overview(single('meaning-choice', 'en'), words.filter(w => w.id !== 'lampe').map(w => progress(w)));
  assert.equal(emptyQueueReason('learn-new', en), 'no-translation');
});

test("a word's progress is the same from every deck that contains it", () => {
  const list = [progress(words[0])];
  assert.deepEqual(wordSummary(words[0], list, at), wordSummary(words[0], list, at));
  assert.equal(startedCount(home, list), 1);
  assert.equal(startedCount(office, list), 1);
  assert.equal(overview(single('meaning-choice', 'ru', 'office'), list, office).due, 1);
  assert.equal(overview(single('meaning-choice'), list).due, 1);
  assert.equal(wordSummary(words[1], list, at).state, 'new');
});
