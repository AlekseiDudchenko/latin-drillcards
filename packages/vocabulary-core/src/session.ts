import type { Deck, Owner, PartOfSpeech, TranslationLanguage, WordId } from './content.js';
import type { LearningEvent } from './event.js';
import type { Task } from './exercise.js';
import type { WordProgress } from './progress.js';
import type { UnavailableReason, WordExerciseId } from './word-exercises.js';

export type SessionRequest = {
  readonly deckId: Deck['id'];
  readonly answerLanguage: TranslationLanguage;
  readonly filter?: { readonly partOfSpeech?: readonly PartOfSpeech[]; readonly tags?: readonly string[] };
} & (
  | { readonly intent: 'learn-new' }
  | { readonly intent: 'review-due' }
  | { readonly intent: 'practice'; readonly wordIds: readonly WordId[] }
) & (
  | { readonly format: 'single'; readonly exerciseId: string }
  | { readonly format: 'circuit'; readonly circuitScope: 'due-components' | 'all-exercises' }
);

export interface StudyBatch {
  readonly capacity: 5 | 20;
  readonly wordIds: readonly WordId[];
}

/** Generic plans also carry sentence/grammar/media tasks, without forcing word batch limits. */
export interface SessionPlan {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly owner: Owner;
  readonly dataEpoch: string;
  readonly studyTimezone: string;
  readonly seed: string;
  readonly createdAt: string;
  readonly policyVersion: string;
  readonly tasks: readonly Task[];
}

export interface VocabularySessionPlan extends SessionPlan {
  readonly plannerVersion: string;
  readonly catalogVersion: string;
  readonly request: SessionRequest;
  readonly batch: StudyBatch;
  readonly wordVersions: readonly { readonly wordId: WordId; readonly contentVersion: number }[];
  readonly skippedExercises: readonly SkippedWordExercise[];
}

export interface SkippedWordExercise {
  readonly wordId: WordId;
  readonly exerciseId: WordExerciseId;
  readonly reason: UnavailableReason;
}

export interface SessionState {
  readonly plan: SessionPlan;
  /** Append-only correction round after a circuit's planned tasks; the plan itself never changes.
   * The cursor runs over plan.tasks followed by these tasks (see sessionTasks). */
  readonly corrections?: readonly Task[];
  readonly status: 'ready' | 'presenting' | 'answered' | 'feedback' | 'paused' | 'completed' | 'abandoned';
  readonly taskIndex: number;
  readonly revision: number;
}

/** One transaction commits the event, projection, session and outbox together.
 * Implementations must deduplicate commandId, reject revision conflicts and isolate owner/epoch.
 */
export interface LearningStore {
  commit(input: {
    readonly owner: Owner;
    readonly dataEpoch: string;
    readonly event: LearningEvent;
    /** First local receipt supplied by the adapter's clock, not a retry/event timestamp. */
    readonly receivedAt: string;
    readonly session: SessionState;
    readonly expectedSessionRevision: number;
    readonly wordProgress?: WordProgress;
  }): Promise<'committed' | 'duplicate' | 'conflict'>;
}
