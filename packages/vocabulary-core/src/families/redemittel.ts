import type { BuildContext, JsonValue } from '../exercise.js';
// Types only: item-exercises.ts registers this definition, so a value import would be circular.
import type { ItemExerciseDefinition, LearningItem } from '../item-exercises.js';

/** M7 (#339): Redemittel (FC11). One item is one whole phrase, never a word: the learner reads
 * the meaning, recalls the German phrase, reveals it and rates themself (`remembered` / `forgotten`).
 * The rating is subjective evidence (`self-assessment`); the reveal is its own event and no answer.
 * Unlike the sample `item-self-check`, whose prompt is fixed in the content, the prompt here is the
 * translation in the task's answer language, so one item serves RU and EN learners.
 */
export const PHRASE_DECKS = Object.freeze(['beruf', 'daily'] as const);
export type PhraseDeck = typeof PHRASE_DECKS[number];
export const PHRASE_RATINGS = Object.freeze(['forgotten', 'remembered'] as const);
export type PhraseRating = typeof PHRASE_RATINGS[number];

export interface PhraseContent {
  readonly de: string;
  readonly translations: { readonly en: string; readonly ru: string };
  readonly deck: PhraseDeck;
}
/** The exercise part of a phrase task: the meaning shown first and the phrase revealed after. */
export interface PhraseExercise {
  readonly prompt: { readonly text: string; readonly lang: 'ru' | 'en' };
  readonly answer: { readonly text: string; readonly lang: 'de' };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();

/** Content check shared by the definition and the dataset converter; null when unusable. */
export function phraseContent(content: JsonValue): PhraseContent | null {
  if (!record(content) || !text(content.de) || !record(content.translations) || !text(content.translations.en) ||
      !text(content.translations.ru) || !(PHRASE_DECKS as readonly unknown[]).includes(content.deck)) return null;
  return content as unknown as PhraseContent;
}
function phraseExercise(value: JsonValue): PhraseExercise | null {
  if (!record(value) || !record(value.prompt) || !record(value.answer) || !text(value.prompt.text) ||
      (value.prompt.lang !== 'ru' && value.prompt.lang !== 'en') || !text(value.answer.text) || value.answer.lang !== 'de') return null;
  return value as unknown as PhraseExercise;
}

export const PHRASE_RECALL: ItemExerciseDefinition = Object.freeze({
  id: 'phrase-recall', version: 'phrase-recall/1', targetKinds: Object.freeze(['phrase'] as const),
  input: 'reveal' as const, source: 'self-assessment' as const,
  isApplicable: (item: LearningItem) => phraseContent(item.content) !== null,
  build(item: LearningItem, context: BuildContext): JsonValue {
    const content = phraseContent(item.content)!;
    return { prompt: { text: content.translations[context.answerLanguage], lang: context.answerLanguage }, answer: { text: content.de, lang: 'de' } };
  },
  evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue) {
    const content = phraseContent(item.content); const built = phraseExercise(exercise);
    if (!content || !built || built.answer.text !== content.de) throw new RangeError('Invalid phrase task');
    if (answer !== 'remembered' && answer !== 'forgotten') throw new RangeError('Invalid self-assessment');
    return answer === 'remembered' ? 'correct' : 'incorrect';
  },
});
