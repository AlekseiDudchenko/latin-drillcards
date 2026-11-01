import type { LearningEvent, Word } from '../src/index.js';

const base = {
  schemaVersion: 1, contentVersion: 1, acceptedGermanForms: [], examples: [], tags: [],
} as const;

export const words = [
  { ...base, id: 'word-tisch', lemma: 'Tisch', partOfSpeech: 'noun', senseId: 'table-furniture',
    article: 'der', meanings: { ru: { preferred: 'стол', accepted: ['стол'] },
      en: { preferred: 'table', accepted: ['table'] } }, acceptedGermanForms: ['Tisch'],
    examples: [{ id: 'example-tisch', de: 'Der Tisch ist groß.', translations: { ru: 'Стол большой.' } }] },
  { ...base, id: 'word-gehen', lemma: 'gehen', partOfSpeech: 'verb', senseId: 'walk',
    meanings: { ru: { preferred: 'идти', accepted: ['идти', 'ходить'] } }, acceptedGermanForms: ['gehen'] },
  { ...base, id: 'word-band-volume', lemma: 'Band', partOfSpeech: 'noun', senseId: 'book-volume',
    article: 'der', meanings: { en: { preferred: 'volume', accepted: ['volume'] } }, acceptedGermanForms: ['Band'] },
  { ...base, id: 'word-band-ribbon', lemma: 'Band', partOfSpeech: 'noun', senseId: 'ribbon',
    article: 'das', meanings: { en: { preferred: 'ribbon', accepted: ['ribbon', 'tape'] } }, acceptedGermanForms: ['Band'] },
] as const satisfies readonly Word[];

export const answer = {
  schemaVersion: 1, kind: 'answer', eventId: 'event-1', commandId: 'command-1',
  sessionId: 'session-1', taskId: 'task-1', attemptId: 'attempt-1',
  target: { kind: 'word', wordId: words[0].id }, exerciseId: 'german-type',
  intent: 'review-due', answerLanguage: 'ru',
  occurredAt: '2026-10-23T12:00:00.000Z', studyTimezone: 'Europe/Berlin',
  taskVersion: 'german-type/1', contentVersion: 1, policyVersion: 'evidence/1',
  dataEpoch: 'v2', rawAnswer: 'Tisch', assisted: false, exposure: [],
} as const satisfies LearningEvent;
