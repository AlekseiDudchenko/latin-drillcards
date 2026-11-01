import type { TranslationLanguage, Word } from './content.js';
import { applicableComponents, type Component, type ComponentProgress, type WordProgress } from './progress.js';
import { WORD_EXERCISE_RULES } from './word-evidence.js';
import { WORD_EXERCISE_IDS } from './word-exercises.js';

/**
 * When a word counts as learned. Every applicable component must be in review, have at least `requiredReviews`
 * counted reviews and a memory stability of `requiredStabilityDays`. Changing a number is a new version.
 */
export const WORD_STATUS_POLICY = Object.freeze({ version: 'word-status/1', requiredReviews: 3, requiredStabilityDays: 21 });

export type StatusExerciseId = Exclude<typeof WORD_EXERCISE_IDS[number], 'introduction'>;

export interface ComponentStatus {
  readonly component: Component;
  readonly stage: ComponentProgress['stage'];
  readonly reviews: number;
  readonly requiredReviews: number;
  readonly stability: number;
  readonly requiredStability: number;
  readonly done: boolean;
}
/** Progress is stored per component, so an exercise reports the weakest component it assesses. */
export interface ExerciseStatus {
  readonly exerciseId: StatusExerciseId;
  readonly available: boolean;
  readonly unavailableReason?: 'no-article' | 'no-translation';
  readonly components: readonly Component[];
  readonly reviews: number;
  readonly required: number;
  readonly done: boolean;
}
export interface WordStatus {
  readonly version: typeof WORD_STATUS_POLICY.version;
  readonly wordId: string;
  /** `unsettled`: enough reviews everywhere, but memory is not stable or a component is relearning. */
  readonly state: 'new' | 'learning' | 'unsettled' | 'learned';
  readonly components: readonly ComponentStatus[];
  readonly exercises: readonly ExerciseStatus[];
}

const statusExercises = WORD_EXERCISE_IDS.filter((id): id is StatusExerciseId => id !== 'introduction');

export function describeWordStatus(word: Word, progress: WordProgress | undefined, language: TranslationLanguage): WordStatus {
  const { requiredReviews, requiredStabilityDays } = WORD_STATUS_POLICY;
  const components: ComponentStatus[] = applicableComponents(word).map(component => {
    const state = progress?.components[component];
    const active = state !== undefined && state.stage !== 'unintroduced';
    const reviews = active ? state.reviewCount : 0; const stability = active ? state.stability : 0;
    return { component, stage: state?.stage ?? 'unintroduced', reviews, requiredReviews, stability, requiredStability: requiredStabilityDays,
      done: active && state.stage === 'review' && reviews >= requiredReviews && stability >= requiredStabilityDays };
  });
  const byComponent = new Map(components.map(item => [item.component, item]));
  const hasMeaning = Boolean(word.meanings[language]?.preferred.trim());
  const exercises = statusExercises.map((exerciseId): ExerciseStatus => {
    const assessed = WORD_EXERCISE_RULES[exerciseId].assessed;
    const base = { exerciseId, components: assessed, required: requiredReviews };
    if (assessed.some(component => !byComponent.has(component))) return { ...base, available: false, unavailableReason: 'no-article', reviews: 0, done: false };
    if (exerciseId !== 'article-choice' && !hasMeaning) return { ...base, available: false, unavailableReason: 'no-translation', reviews: 0, done: false };
    const parts = assessed.map(component => byComponent.get(component)!);
    return { ...base, available: true, reviews: Math.min(...parts.map(part => part.reviews)), done: parts.every(part => part.done) };
  });
  const started = progress !== undefined && progress.introducedAt !== null;
  const state = !started ? 'new' : components.every(item => item.done) ? 'learned'
    : components.every(item => item.reviews >= requiredReviews) ? 'unsettled' : 'learning';
  return { version: WORD_STATUS_POLICY.version, wordId: word.id, state, components, exercises };
}
