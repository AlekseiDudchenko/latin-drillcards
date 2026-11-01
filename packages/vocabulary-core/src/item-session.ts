import type { Owner, TranslationLanguage } from './content.js';
import type { Evaluation } from './exercise.js';
import { ITEM_POLICY_VERSION, itemIntent, type ItemExerciseRegistry, type ItemExerciseTask } from './item-exercises.js';
import type { RecordedLearningFact } from './item-progress.js';
import type { SessionPlan, SessionState } from './session.js';

export const ITEM_PLANNER_VERSION = 'item-planner/1';
/** A session over items of one dataset. Same Runner, store, journal and sync as vocabulary sessions. */
export interface ItemSessionPlan extends SessionPlan {
  readonly family: 'items';
  readonly plannerVersion: typeof ITEM_PLANNER_VERSION;
  readonly intent: 'practice' | 'assessment';
  readonly answerLanguage: TranslationLanguage;
  /** Pinned dataset versions; the session archive carries exactly these datasets. */
  readonly datasets: readonly { readonly datasetId: string; readonly version: string }[];
  readonly tasks: readonly ItemExerciseTask[];
}
export const isItemSessionPlan = (plan: SessionPlan): plan is ItemSessionPlan => (plan as Partial<ItemSessionPlan>).family === 'items';

export interface ItemPlannerInput {
  readonly registry: ItemExerciseRegistry;
  readonly owner: Owner;
  readonly sessionId: string;
  readonly dataEpoch: string;
  readonly studyTimezone: string;
  readonly seed: string;
  readonly createdAt: string;
  readonly answerLanguage: TranslationLanguage;
  readonly datasetId: string;
  /** One task per entry, in order; selection (e.g. selectItems) is the caller's. */
  readonly items: readonly { readonly itemId: string; readonly exerciseId: string }[];
}

/** Deterministic plan: task IDs derive from the session, so a rebuilt plan is identical. */
export function planItemSession(input: ItemPlannerInput): ItemSessionPlan {
  const dataset = input.registry.dataset(input.datasetId);
  if (!input.items.length) throw new RangeError('An item session needs at least one task');
  const tasks = input.items.map(({ itemId, exerciseId }, index) => input.registry.buildTask(exerciseId, dataset.id, itemId,
    { answerLanguage: input.answerLanguage, seed: input.seed, taskId: `${input.sessionId}:${index}:${exerciseId}:${itemId}` }));
  return { schemaVersion: 1, family: 'items', plannerVersion: ITEM_PLANNER_VERSION, sessionId: input.sessionId, owner: input.owner,
    dataEpoch: input.dataEpoch, studyTimezone: input.studyTimezone, seed: input.seed, createdAt: input.createdAt,
    policyVersion: ITEM_POLICY_VERSION, intent: itemIntent(dataset.kind) as 'practice' | 'assessment', answerLanguage: input.answerLanguage,
    datasets: [{ datasetId: dataset.id, version: dataset.version }], tasks };
}

export interface ItemSessionSummary {
  readonly answered: number;
  readonly correct: number;
  readonly tasks: readonly { readonly taskId: string; readonly itemId: string; readonly outcome: Evaluation['outcome'] | null }[];
}
/** Per task: the outcome of its first stored answer, or null when it was not answered. */
export function summarizeItemSession(state: SessionState, facts: readonly Pick<RecordedLearningFact, 'event' | 'evaluation'>[]): ItemSessionSummary {
  if (!isItemSessionPlan(state.plan)) throw new RangeError('Not an item session');
  const tasks = state.plan.tasks.map(task => {
    const first = facts.find(f => f.event.sessionId === state.plan.sessionId && f.event.taskId === task.id && f.event.kind === 'answer');
    return { taskId: task.id, itemId: task.target.itemId, outcome: first?.evaluation?.outcome ?? null };
  });
  return { answered: tasks.filter(t => t.outcome !== null).length, correct: tasks.filter(t => t.outcome === 'correct').length, tasks };
}
