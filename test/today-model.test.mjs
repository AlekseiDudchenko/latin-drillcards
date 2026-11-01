import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_GOAL, dailyProgress, dayOf, dueDeck, focusDeck } from '../public/v2/today-model.js';
import { count, fill } from '../public/v2/today-i18n.js';

const answer = (occurredAt, kind = 'answer', studyTimezone = 'UTC') => ({ event: { kind, occurredAt, studyTimezone } });
const many = (day, n, kind = 'answer') => Array.from({ length: n }, (_, i) => answer(`${day}T10:${String(i % 60).padStart(2, '0')}:00Z`, kind));

test('dayOf follows the time zone and survives an unknown one', () => {
  assert.equal(dayOf('2026-10-31T23:30:00Z', 'UTC'), '2026-10-31');
  assert.equal(dayOf('2026-10-31T23:30:00Z', 'Europe/Berlin'), '2026-11-01');
  assert.equal(dayOf('2026-10-31T23:30:00Z', 'Not/AZone'), '2026-10-31');
});

test('only answers count towards today, not reveals or introductions', () => {
  const facts = [...many('2026-10-31', 3), ...many('2026-10-31', 4, 'reveal'), ...many('2026-10-30', 2)];
  assert.deepEqual(dailyProgress(facts, '2026-10-31T18:00:00Z', 'UTC'), { today: 3, goal: DAILY_GOAL, streak: 0, best: 0 });
});

test('the streak counts goal days up to today, or up to yesterday while today is open', () => {
  const days = ['2026-10-27', '2026-10-28', '2026-10-30'].flatMap(day => many(day, 25));
  // 29th missed: only the 30th counts, and today (31st) has not reached the goal yet.
  assert.equal(dailyProgress(days, '2026-10-31T09:00:00Z', 'UTC').streak, 1);
  assert.equal(dailyProgress(days, '2026-10-31T09:00:00Z', 'UTC').best, 2);
  // Reaching the goal today extends the run through the 30th.
  const reached = [...days, ...many('2026-10-31', 25)];
  assert.deepEqual(dailyProgress(reached, '2026-10-31T20:00:00Z', 'UTC'), { today: 25, goal: 25, streak: 2, best: 2 });
  // A missed yesterday breaks it.
  assert.equal(dailyProgress(many('2026-10-29', 25), '2026-10-31T09:00:00Z', 'UTC').streak, 0);
});

test('the streak crosses a month boundary and the record outlives a broken streak', () => {
  const facts = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].flatMap(day => many(day, 25));
  const progress = dailyProgress(facts, '2026-10-20T09:00:00Z', 'UTC');
  assert.equal(progress.streak, 0); assert.equal(progress.best, 4);
});

test('the focus deck: last studied, then recommended, then the first with words left', () => {
  const decks = [{ id: 'a1', total: 10, started: 10 }, { id: 'a2', total: 10, started: 4 }, { id: 'b1', total: 10, started: 0 }];
  assert.equal(focusDeck(decks, 'b1', 'a2'), 'b1');
  assert.equal(focusDeck(decks, 'a1', 'a2'), 'a2'); // a1 has nothing left to start
  assert.equal(focusDeck(decks, undefined, 'zz'), 'a2');
  assert.equal(focusDeck(decks.map(deck => ({ ...deck, started: deck.total }))), 'a1');
  assert.equal(focusDeck([]), undefined);
});

test('the deck to review is the one with most due words, ties keep catalog order', () => {
  assert.equal(dueDeck(new Map([['a1', 0], ['a2', 5], ['b1', 5]])), 'a2');
  assert.equal(dueDeck(new Map([['a1', 0]])), undefined);
});

test('counts use the plural forms of each language; placeholders are not String.replace patterns', () => {
  assert.equal(count('ru', 1, 'day'), '1 день'); assert.equal(count('ru', 3, 'day'), '3 дня'); assert.equal(count('ru', 6, 'day'), '6 дней');
  assert.equal(count('ru', 21, 'word'), '21 слово'); assert.equal(count('ru', 0, 'word'), '0 слов');
  assert.equal(count('en', 1, 'day'), '1 day'); assert.equal(count('en', 2, 'answer'), '2 answers');
  assert.equal(count('de', 3, 'word'), '3 Wörter');
  assert.equal(fill('{a} of {b} {c}', { a: 1, b: '$&' }), '1 of $& {c}');
});
