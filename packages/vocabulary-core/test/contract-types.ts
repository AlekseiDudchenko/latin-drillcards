import type { LearningEvent, SessionRequest, WordProgress } from '../src/index.js';
import { answer } from './fixtures.js';

const event: LearningEvent = answer;
void event;
const { intent, ...missingIntent } = answer;
// @ts-expect-error Event must retain mode for server-side SRS eligibility.
const withoutIntent: LearningEvent = missingIntent;
void withoutIntent;
// @ts-expect-error Single exercise must be selected explicitly.
const missingExercise: SessionRequest = { deckId: 'a1', intent: 'review-due', answerLanguage: 'ru', format: 'single' };
// @ts-expect-error Reveal is not an answer and must not carry an attempt or raw answer.
const reveal: LearningEvent = { ...answer, kind: 'reveal', rawAnswer: 'Tisch' };
// @ts-expect-error Assessment target needs a dataset and item, not a word ID.
const assessment: LearningEvent = { ...answer, target: { kind: 'assessment', wordId: 'word-1' } };
// @ts-expect-error Word progress must belong to an owner.
const progress: WordProgress = { wordId: 'word-1', introducedAt: null, components: {}, revision: 0, schedulerVersion: '1', evidencePolicyVersion: '1' };
// @ts-expect-error Domain compilation intentionally excludes browser globals.
document.querySelector('body');
// @ts-expect-error Domain compilation intentionally excludes network globals.
fetch('/api');
void [missingExercise, reveal, assessment, progress];
// @ts-expect-error Extra practice requires explicit word IDs; it is never an implicit due fallback.
const implicitPractice: SessionRequest = { deckId: 'a1', intent: 'practice', answerLanguage: 'ru', format: 'single', exerciseId: 'german-type' };
void implicitPractice;
