import type { Word, WordId } from './content.js';
import type { Task } from './exercise.js';
import { applicableComponents, type Component } from './progress.js';
import type { SessionState, VocabularySessionPlan } from './session.js';
import { deriveWordEvidence, type EvaluatedWordFact, type WordEvidence } from './word-evidence.js';
import type { WordExerciseId, WordExerciseRegistry } from './word-exercises.js';

export const CORRECTION_POLICY_VERSION = 'corrections/1';

/** Tasks in cursor order: the immutable plan, then its appended correction round. */
export function sessionTasks(state: SessionState): readonly Task[] {
  return state.corrections?.length ? [...state.plan.tasks, ...state.corrections] : state.plan.tasks;
}

export function correctionTaskId(sessionId: string, wordId: WordId, exerciseId: string): string {
  return JSON.stringify(['correction', sessionId, wordId, exerciseId]);
}

const ofSession = (plan: VocabularySessionPlan, facts: readonly EvaluatedWordFact[]) =>
  facts.filter(fact => fact.event.sessionId === plan.sessionId);

/**
 * One correction round per circuit: each planned task answered incorrectly is presented once
 * more as a new task for the same word and exercise, with its own seed (fresh option order).
 * Deterministic from plan and journal, so storage and server can rebuild and compare it.
 * The batch never grows; single sessions have no correction round.
 */
export function buildCorrectionTasks(plan: VocabularySessionPlan, registry: WordExerciseRegistry,
  facts: readonly EvaluatedWordFact[]): readonly Task[] {
  // Generic (non-vocabulary) plans and single sessions have no correction round.
  if ((plan as Partial<VocabularySessionPlan>).request?.format !== 'circuit') return [];
  const failed = new Set(ofSession(plan, facts).filter(fact => fact.event.kind === 'answer' &&
    fact.evaluation?.outcome === 'incorrect').map(fact => fact.event.taskId));
  return plan.tasks.filter(task => failed.has(task.id)).map(source => {
    const task = registry.validateTask(source);
    if (task.target.kind !== 'word') throw new RangeError('Not a word task');
    const word = registry.getWord(task.target.wordId, task.contentVersion);
    return registry.get(task.exerciseId).buildTask(word, { taskId: correctionTaskId(plan.sessionId, word.id, task.exerciseId),
      seed: JSON.stringify([plan.seed, 'correction', word.id, task.exerciseId]), answerLanguage: plan.request.answerLanguage });
  });
}

export type ComponentResult = 'correct' | 'incorrect' | 'corrected' | 'unobserved';
export interface ComponentSessionSummary {
  readonly component: Component;
  readonly result: ComponentResult;
  /** Strength of the first observation: independent for a clean diagnostic, aided after a disclosure.
   * Whether it changes the schedule is decided by the daily projection, across all sessions of that day. */
  readonly first: WordEvidence['strength'] | null;
}
export interface SessionMistake {
  readonly taskId: string;
  readonly exerciseId: WordExerciseId;
  readonly given: string;
  readonly expected: string;
  /** Language of the expected answer and of choice/typed answers (German or the translation). */
  readonly lang: string;
  readonly corrected: boolean;
}
export interface WordSessionSummary {
  readonly wordId: WordId;
  readonly label: string;
  readonly components: readonly ComponentSessionSummary[];
  readonly mistakes: readonly SessionMistake[];
}
export interface VocabularySessionSummary {
  readonly tasks: number;
  readonly answered: number;
  readonly mistakes: number;
  readonly words: readonly WordSessionSummary[];
}

/**
 * Result per batch word: component outcomes from the shared evidence policy (prompts, reveals and
 * feedback of earlier stages count as exposure), and every incorrect answer with what was expected.
 */
export function summarizeVocabularySession(state: SessionState, registry: WordExerciseRegistry,
  facts: readonly EvaluatedWordFact[]): VocabularySessionSummary {
  const plan = state.plan as VocabularySessionPlan;
  if (!('batch' in plan)) throw new RangeError('Not a vocabulary session');
  const own = ofSession(plan, facts);
  const tasks = new Map(sessionTasks(state).map(task => [task.id, registry.validateTask(task)]));
  const words = plan.batch.wordIds.map(wordId => {
    const version = plan.wordVersions.find(item => item.wordId === wordId)!.contentVersion;
    const word: Word = registry.getWord(wordId, version);
    const wordFacts = own.filter(fact => fact.event.target.kind === 'word' && fact.event.target.wordId === wordId);
    const evidence = deriveWordEvidence(word, wordFacts);
    const components = applicableComponents(word).flatMap(component => {
      const items = evidence.filter(item => item.component === component);
      if (!items.length) return [];
      const observed = items.filter(item => item.outcome !== 'unobserved');
      const lastError = observed.map(item => item.outcome).lastIndexOf('incorrect');
      const result: ComponentResult = !observed.length ? 'unobserved' : lastError < 0 ? 'correct'
        : observed.slice(lastError + 1).some(item => item.outcome === 'correct') ? 'corrected' : 'incorrect';
      return [{ component, result, first: observed[0]?.strength ?? null }];
    });
    const answers = wordFacts.filter(fact => fact.event.kind === 'answer' && fact.evaluation);
    const mistakes = answers.flatMap((fact, index) => {
      const task = tasks.get(fact.event.taskId);
      if (!task || fact.event.kind !== 'answer' || fact.evaluation!.outcome !== 'incorrect') return [];
      const raw = fact.event.rawAnswer;
      const given = task.input === 'choice' ? task.specification.options.find(option => option.id === raw)?.label ?? String(raw) : String(raw);
      const corrected = answers.slice(index + 1).some(later => later.evaluation!.outcome === 'correct' &&
        tasks.get(later.event.taskId)?.exerciseId === task.exerciseId);
      return [{ taskId: task.id, exerciseId: task.exerciseId, given, expected: task.specification.answer.text,
        lang: task.specification.answer.lang, corrected }];
    });
    return { wordId, label: [word.article, word.lemma].filter(Boolean).join(' '), components, mistakes };
  });
  return { tasks: tasks.size, answered: own.filter(fact => fact.event.kind === 'answer').length,
    mistakes: words.reduce((sum, word) => sum + word.mistakes.length, 0), words };
}
