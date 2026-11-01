import type { Owner, Word, WordId } from './content.js';

export const COMPONENTS = Object.freeze(['recognition', 'recall', 'spelling', 'article'] as const);
export type Component = typeof COMPONENTS[number];

export interface ComponentProgress {
  readonly stage: 'unintroduced' | 'learning' | 'review' | 'relearning';
  readonly stability: number;
  readonly difficulty: number;
  /** Memory baseline established without counting introduction as a successful review. */
  readonly initializedAt: string | null;
  readonly lastReviewedAt: string | null;
  readonly dueAt: string | null;
  readonly reviewCount: number;
  readonly lapseCount: number;
}

/** Identity is owner + word, independent of deck, exercise and answer language. */
export interface WordProgress {
  readonly owner: Owner;
  readonly wordId: WordId;
  readonly introducedAt: string | null;
  readonly components: Readonly<Partial<Record<Component, ComponentProgress>>>;
  readonly revision: number;
  readonly schedulerVersion: string;
  readonly evidencePolicyVersion: string;
}

export function applicableComponents(word: Word): readonly Component[] {
  return word.partOfSpeech === 'noun' && word.article !== undefined
    ? COMPONENTS : COMPONENTS.filter(component => component !== 'article');
}
