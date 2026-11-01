export const CONTENT_SCHEMA_VERSION = 1 as const;
export type WordId = string;
export type TranslationLanguage = 'ru' | 'en';
export type StudyIntent = 'learn-new' | 'review-due' | 'practice' | 'assessment';
export type Article = 'der' | 'die' | 'das';
export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'other';

/** Published read model. Candidates and unconfirmed revisions never enter this type. */
export interface Word {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly id: WordId;
  readonly lemma: string;
  readonly partOfSpeech: PartOfSpeech;
  readonly senseId: string;
  readonly article?: Article;
  readonly meanings: Readonly<Partial<Record<TranslationLanguage, {
    readonly preferred: string;
    readonly accepted: readonly string[];
  }>>>;
  readonly acceptedForms: readonly string[];
  readonly examples: readonly {
    readonly id: string;
    readonly text: string;
    readonly translations: Readonly<Partial<Record<TranslationLanguage, string>>>;
  }[];
  readonly tags: readonly string[];
  readonly contentVersion: number;
}

export interface Deck {
  readonly id: string;
  readonly title: string;
  readonly wordIds: readonly WordId[];
}

export type LearningTarget =
  | { readonly kind: 'word'; readonly wordId: WordId }
  | { readonly kind: 'sentence' | 'grammar-item' | 'phrase' | 'video-segment' | 'assessment';
      readonly datasetId: string; readonly itemId: string };

export type Owner = { readonly kind: 'guest' | 'account'; readonly id: string };
