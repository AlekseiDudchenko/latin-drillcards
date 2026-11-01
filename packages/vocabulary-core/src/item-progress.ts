import type { Owner } from './content.js';
import { isLearningEvent, type LearningEvent } from './event.js';
import type { Evaluation } from './exercise.js';
import { ITEM_POLICY_VERSION, isItemTarget, itemIntent, type ItemDataset, type ItemExerciseRegistry, type ItemTarget, type ItemTargetKind } from './item-exercises.js';
import { timestamp } from './scheduler.js';
import { studyDate } from './word-evidence.js';
import { CLOCK_POLICY, type ReplayContext } from './word-projector.js';

/** A journal record of any target, as the local store and the server keep it. */
export interface RecordedLearningFact {
  readonly owner: Owner;
  readonly event: LearningEvent;
  readonly evaluation?: Evaluation;
  readonly receivedAt: string;
}
export type Quarantine = { readonly eventId: string; readonly reason: 'before-epoch' | 'future-clock' };
interface Accepted { readonly facts: readonly RecordedLearningFact[]; readonly quarantined: readonly Quarantine[]; readonly deferredEventIds: readonly string[] }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
const byTime = (a: RecordedLearningFact, b: RecordedLearningFact): number => timestamp(a.event.occurredAt) - timestamp(b.event.occurredAt) ||
  (a.event.eventId < b.event.eventId ? -1 : a.event.eventId > b.event.eventId ? 1 : 0);

/** The union of journal records, once per eventId, under the same clock policy as replayWord.
 * A repeated delivery keeps its first receipt; a reused event/command/attempt ID is a conflict. */
export function acceptJournal(records: readonly RecordedLearningFact[], context: ReplayContext): Accepted {
  if (!context.dataEpoch.trim()) throw new RangeError('Missing data epoch');
  const now = timestamp(context.asOf); const start = timestamp(context.epochStartedAt);
  if (start > now) throw new RangeError('Epoch starts after replay time');
  const unique = new Map<string, RecordedLearningFact>();
  const commands = new Map<string, string>(); const attempts = new Map<string, string>();
  for (const record of records) {
    const event = record.event;
    if (!isLearningEvent(event)) throw new RangeError('Invalid learning event');
    if (record.owner.kind !== context.owner.kind || record.owner.id !== context.owner.id || event.dataEpoch !== context.dataEpoch) throw new RangeError('Replay owner/epoch mismatch');
    if ((event.kind === 'answer') !== (record.evaluation !== undefined)) throw new RangeError('Answer evaluation mismatch');
    const previous = unique.get(event.eventId);
    if (previous) {
      if (canonical(previous.event) !== canonical(event) || canonical(previous.evaluation) !== canonical(record.evaluation)) throw new RangeError('Conflicting event identity');
      if (timestamp(record.receivedAt) < timestamp(previous.receivedAt)) unique.set(event.eventId, record);
      continue;
    }
    if (commands.has(event.commandId)) throw new RangeError('Command reused by another event');
    commands.set(event.commandId, event.eventId);
    if (event.kind === 'answer') {
      if (attempts.has(event.attemptId)) throw new RangeError('Attempt reused by another event');
      attempts.set(event.attemptId, event.eventId);
    }
    timestamp(record.receivedAt);
    unique.set(event.eventId, record);
  }
  const facts: RecordedLearningFact[] = []; const quarantined: Quarantine[] = []; const deferredEventIds: string[] = [];
  for (const record of [...unique.values()].sort(byTime)) {
    const occurred = timestamp(record.event.occurredAt); const received = timestamp(record.receivedAt);
    if (occurred < start || received < start) quarantined.push({ eventId: record.event.eventId, reason: 'before-epoch' });
    else if (occurred > received + CLOCK_POLICY.maxFutureSkewMinutes * 60000) quarantined.push({ eventId: record.event.eventId, reason: 'future-clock' });
    else if (occurred > now || received > now) deferredEventIds.push(record.event.eventId);
    else facts.push(record);
  }
  return { facts, quarantined, deferredEventIds };
}

function assertItemFact(fact: RecordedLearningFact): asserts fact is RecordedLearningFact & { event: LearningEvent & { target: ItemTarget } } {
  const { event, evaluation } = fact;
  if (!isItemTarget(event.target) || event.policyVersion !== ITEM_POLICY_VERSION || event.intent !== itemIntent(event.target.kind) ||
      event.kind === 'introduction' || event.exposure.length) throw new RangeError('Invalid item event');
  if (evaluation && (!['correct', 'incorrect', 'unobserved'].includes(evaluation.outcome) || Object.keys(evaluation.components).length)) throw new RangeError('Invalid item evaluation');
}

export const EXERCISE_PROJECTOR_VERSION = 'exercise-progress/1';
/** Progress of one item in one exercise. Identity: exerciseId + datasetId + itemId; owner-wide, not per session. */
export interface ItemExerciseProgress {
  readonly exerciseId: string;
  readonly datasetId: string;
  readonly itemId: string;
  readonly targetKind: ItemTargetKind;
  /** Tasks answered (first answers), every answer, and first answers that were right without a reveal or retry. */
  readonly tasks: number;
  readonly answers: number;
  readonly independentCorrect: number;
  readonly lastOutcome: 'correct' | 'incorrect' | 'unobserved';
  readonly firstAnsweredAt: string;
  readonly lastAnsweredAt: string;
}
export interface ExerciseProgressResult {
  readonly version: typeof EXERCISE_PROJECTOR_VERSION;
  readonly items: readonly ItemExerciseProgress[];
  readonly processedEventIds: readonly string[];
  readonly quarantined: readonly Quarantine[];
  readonly deferredEventIds: readonly string[];
}
const itemKey = (exerciseId: string, datasetId: string, itemId: string): string => JSON.stringify([exerciseId, datasetId, itemId]);

/** Rebuild practice statistics of non-word targets from the complete journal (assessments are separate).
 * Word targets are ignored here: WordProgressProjector owns them, and an item never feeds it. */
export function projectExerciseProgress(records: readonly RecordedLearningFact[], context: ReplayContext): ExerciseProgressResult {
  const { facts, quarantined, deferredEventIds } = acceptJournal(records, context);
  const progress = new Map<string, ItemExerciseProgress>();
  const answeredTasks = new Set<string>(); const revealedTasks = new Set<string>();
  const processed: string[] = [];
  for (const fact of facts) {
    const { event } = fact;
    if (!isItemTarget(event.target) || event.intent === 'assessment') continue;
    assertItemFact(fact);
    processed.push(event.eventId);
    const task = JSON.stringify([event.sessionId, event.taskId]);
    if (event.kind === 'reveal') { revealedTasks.add(task); continue; }
    if (event.kind !== 'answer') continue;
    let outcome = fact.evaluation!.outcome;
    // A self-rating without its reveal is not an observation (same rule as words).
    if (fact.evaluation!.source === 'self-assessment' && !revealedTasks.has(task)) outcome = 'unobserved';
    const first = !answeredTasks.has(task); answeredTasks.add(task);
    const independent = first && outcome === 'correct' && !event.assisted && (fact.evaluation!.source === 'self-assessment' || !revealedTasks.has(task));
    const key = itemKey(event.exerciseId, event.target.datasetId, event.target.itemId);
    const previous = progress.get(key);
    progress.set(key, { exerciseId: event.exerciseId, datasetId: event.target.datasetId, itemId: event.target.itemId,
      targetKind: event.target.kind, tasks: (previous?.tasks ?? 0) + (first ? 1 : 0), answers: (previous?.answers ?? 0) + 1,
      independentCorrect: (previous?.independentCorrect ?? 0) + (independent ? 1 : 0), lastOutcome: outcome,
      firstAnsweredAt: previous?.firstAnsweredAt ?? event.occurredAt, lastAnsweredAt: event.occurredAt });
  }
  const items = [...progress.values()].sort((a, b) => itemKey(a.exerciseId, a.datasetId, a.itemId) < itemKey(b.exerciseId, b.datasetId, b.itemId) ? -1 : 1);
  return { version: EXERCISE_PROJECTOR_VERSION, items, processedEventIds: processed, quarantined, deferredEventIds };
}

export interface ExerciseSummary {
  readonly exerciseId: string;
  readonly datasetId: string;
  /** Items of the dataset this exercise applies to, and how many of them were answered. */
  readonly applicable: number;
  readonly attempted: number;
  readonly coverage: number;
  /** Independent first-answer accuracy over answered tasks; null before the first answer. */
  readonly accuracy: number | null;
  readonly incorrect: number;
}
function forExercise(registry: ItemExerciseRegistry, exerciseId: string, dataset: ItemDataset, progress: ExerciseProgressResult) {
  const applicable = dataset.items.filter(item => registry.get(exerciseId).targetKinds.includes(dataset.kind) &&
    registry.get(exerciseId).isApplicable(item, { answerLanguage: 'ru', seed: 'summary', taskId: 'summary' }));
  const own = new Map(progress.items.filter(p => p.exerciseId === exerciseId && p.datasetId === dataset.id).map(p => [p.itemId, p]));
  return { applicable, own };
}

/** Coverage and accuracy of one exercise over one dataset. Items no longer in the dataset do not count. */
export function summarizeExercise(registry: ItemExerciseRegistry, exerciseId: string, datasetId: string,
  progress: ExerciseProgressResult): ExerciseSummary {
  const { applicable, own } = forExercise(registry, exerciseId, registry.dataset(datasetId), progress);
  const answered = applicable.flatMap(item => own.has(item.id) ? [own.get(item.id)!] : []);
  const tasks = answered.reduce((sum, p) => sum + p.tasks, 0);
  return { exerciseId, datasetId, applicable: applicable.length, attempted: answered.length,
    coverage: applicable.length ? answered.length / applicable.length : 0,
    accuracy: tasks ? answered.reduce((sum, p) => sum + p.independentCorrect, 0) / tasks : null,
    incorrect: answered.filter(p => p.lastOutcome === 'incorrect').length };
}

/** Selection for a practice session: never answered (dataset order), then last answered wrong
 * (oldest first), then the rest by oldest answer. Deterministic for the same journal. */
export function selectItems(registry: ItemExerciseRegistry, exerciseId: string, datasetId: string,
  progress: ExerciseProgressResult, limit = 20): readonly string[] {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid query limit');
  const { applicable, own } = forExercise(registry, exerciseId, registry.dataset(datasetId), progress);
  const rank = (id: string): number => !own.has(id) ? 0 : own.get(id)!.lastOutcome === 'incorrect' ? 1 : 2;
  return applicable.map((item, index) => ({ id: item.id, index })).sort((a, b) => rank(a.id) - rank(b.id) ||
    (rank(a.id) ? timestamp(own.get(a.id)!.lastAnsweredAt) - timestamp(own.get(b.id)!.lastAnsweredAt) : 0) || a.index - b.index)
    .slice(0, limit).map(entry => entry.id);
}

export const DAILY_ACTIVITY_VERSION = 'daily-activity/1';
export interface DailyActivityDay { readonly date: string; readonly answers: number; readonly goalMet: boolean }
export interface DailyActivityResult {
  readonly version: typeof DAILY_ACTIVITY_VERSION;
  readonly goal: number;
  readonly days: readonly DailyActivityDay[];
  /** Consecutive goal days ending today, or yesterday while today is still open. */
  readonly streak: number;
  readonly today: DailyActivityDay;
  readonly answerEventIds: readonly string[];
}

/** Daily goal and streak over every target. Each answer event counts once, on its study date;
 * reveals, introductions, repeated deliveries and rejected events do not count. Publishing content
 * writes no journal event, so it cannot count either. */
export function projectDailyActivity(records: readonly RecordedLearningFact[],
  context: ReplayContext & { readonly goal: number; readonly timezone: string; readonly excludeEventIds?: readonly string[] }): DailyActivityResult {
  if (!Number.isSafeInteger(context.goal) || context.goal < 1) throw new RangeError('Invalid daily goal');
  const excluded = new Set(context.excludeEventIds ?? []);
  const { facts } = acceptJournal(records, context);
  const counts = new Map<string, number>(); const answerEventIds: string[] = [];
  for (const { event } of facts) {
    if (event.kind !== 'answer' || excluded.has(event.eventId)) continue;
    const date = studyDate(event.occurredAt, event.studyTimezone);
    counts.set(date, (counts.get(date) ?? 0) + 1); answerEventIds.push(event.eventId);
  }
  const day = (date: string): DailyActivityDay => ({ date, answers: counts.get(date) ?? 0, goalMet: (counts.get(date) ?? 0) >= context.goal });
  const days = [...counts.keys()].sort().map(day);
  const todayDate = studyDate(context.asOf, context.timezone);
  const previous = (date: string): string => new Date(Date.parse(`${date}T12:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
  let streak = 0;
  for (let date = day(todayDate).goalMet ? todayDate : previous(todayDate); day(date).goalMet; date = previous(date)) streak++;
  return { version: DAILY_ACTIVITY_VERSION, goal: context.goal, days, streak, today: day(todayDate), answerEventIds };
}

export const ASSESSMENT_PROJECTOR_VERSION = 'assessment/1';
export interface AssessmentResult {
  readonly sessionId: string;
  readonly datasetId: string;
  readonly startedAt: string;
  readonly lastAnsweredAt: string;
  /** First answer per question; a question revealed before its answer is not correct. */
  readonly answered: number;
  readonly correct: number;
  readonly score: number;
  readonly questions: readonly { readonly itemId: string; readonly outcome: 'correct' | 'incorrect' | 'unobserved' }[];
}
/** One result per test run (session), separate from all learning progress: it never changes
 * WordProgress or exercise statistics, and a test answer is never SRS evidence. */
export function projectAssessments(records: readonly RecordedLearningFact[], context: ReplayContext): readonly AssessmentResult[] {
  const { facts } = acceptJournal(records, context);
  const runs = new Map<string, { datasetId: string; startedAt: string; lastAnsweredAt: string; questions: Map<string, AssessmentResult['questions'][number]> }>();
  const revealed = new Set<string>();
  for (const fact of facts) {
    const { event } = fact;
    if (event.target.kind !== 'assessment') continue;
    assertItemFact(fact);
    const question = JSON.stringify([event.sessionId, event.target.itemId]);
    if (event.kind === 'reveal') { revealed.add(question); continue; }
    if (event.kind !== 'answer') continue;
    const run = runs.get(event.sessionId) ?? { datasetId: event.target.datasetId, startedAt: event.occurredAt, lastAnsweredAt: event.occurredAt, questions: new Map() };
    if (run.datasetId !== event.target.datasetId) throw new RangeError('One assessment dataset per session');
    run.lastAnsweredAt = event.occurredAt;
    if (!run.questions.has(event.target.itemId)) run.questions.set(event.target.itemId, { itemId: event.target.itemId,
      outcome: revealed.has(question) || event.assisted ? 'unobserved' : fact.evaluation!.outcome });
    runs.set(event.sessionId, run);
  }
  return [...runs.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([sessionId, run]) => {
    const questions = [...run.questions.values()];
    const correct = questions.filter(q => q.outcome === 'correct').length;
    return { sessionId, datasetId: run.datasetId, startedAt: run.startedAt, lastAnsweredAt: run.lastAnsweredAt,
      answered: questions.length, correct, score: questions.length ? correct / questions.length : 0, questions };
  });
}
