import type { Deck, Owner, Word } from './content.js';
import type { Task } from './exercise.js';
import type { Component, WordProgress } from './progress.js';
import { compareDueWords, selectDueWords, selectNewWords, selectPracticeWords, summarizeWord, type DueWord,
  type WordQueryContext } from './progress-queries.js';
import { timestamp } from './scheduler.js';
import type { SessionRequest, SkippedWordExercise, VocabularySessionPlan } from './session.js';
import { EVIDENCE_POLICY_VERSION } from './word-evidence.js';
import { createWordExerciseRegistry, WORD_EXERCISE_IDS, type WordExerciseId } from './word-exercises.js';

export const VOCABULARY_PLANNER_VERSION = 'vocabulary-planner/2';
const LEARNING_ORDER: readonly WordExerciseId[] = ['meaning-choice', 'target-choice', 'article-choice',
  'target-type', 'target-with-article-type', 'meaning-recall'];
// Productive prompts precede German disclosures; each word's own diagnostic runs before all of them.
const REVIEW_ORDER: readonly WordExerciseId[] = ['target-with-article-type', 'target-type',
  'article-choice', 'target-choice', 'meaning-choice', 'meaning-recall'];
// Any feedback discloses every component, so only a word's first task is independent evidence.
// Its most overdue due component chooses that task; ties prefer productive checks.
const DIAGNOSTIC_TIES: readonly Component[] = ['recall', 'spelling', 'article', 'recognition'];
const DIAGNOSTIC_EXERCISES: Readonly<Record<Component, readonly WordExerciseId[]>> = {
  recall: ['target-with-article-type', 'target-type'], spelling: ['target-with-article-type', 'target-type'],
  article: ['target-with-article-type', 'article-choice'], recognition: ['meaning-choice', 'target-choice', 'meaning-recall'] };
export type PlanOmission = SkippedWordExercise;
export interface VocabularyPlannerInput {
  readonly request: SessionRequest;
  readonly deck: Deck;
  readonly words: readonly Word[];
  /** Active-epoch owner-scoped projections, supplied by the repository. */
  readonly progress: readonly WordProgress[];
  readonly owner: Owner;
  readonly dataEpoch: string;
  readonly sessionId: string;
  readonly seed: string;
  readonly catalogVersion: string;
  readonly studyTimezone: string;
  readonly at: string;
}
export type VocabularyPlanResult =
  | { readonly kind: 'ready'; readonly plan: VocabularySessionPlan; readonly omissions: readonly PlanOmission[] }
  | { readonly kind: 'empty'; readonly reason: 'no-new-words' | 'no-due-words' | 'empty-practice' | 'no-applicable-tasks';
      readonly omissions: readonly PlanOmission[] };

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// Domain values are JSON. Copy before freezing so caller-owned requests/catalog stay writable.
function snapshot<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
function validate(input: VocabularyPlannerInput): void {
  const r = input.request;
  if (![input.sessionId, input.seed, input.dataEpoch, input.catalogVersion, input.studyTimezone, r.deckId].every(text) ||
      r.deckId !== input.deck.id || !['single', 'circuit'].includes(r.format) ||
      !['learn-new', 'review-due', 'practice'].includes(r.intent) ||
      !['ru', 'en'].includes(r.answerLanguage)) throw new RangeError('Invalid session request/identity');
  if (r.format === 'single' && !(WORD_EXERCISE_IDS as readonly string[]).includes(r.exerciseId)) throw new RangeError('Unknown exercise');
  if (r.format === 'circuit' && (!['due-components', 'all-exercises'].includes(r.circuitScope) ||
      (r.circuitScope === 'due-components' && r.intent !== 'review-due'))) throw new RangeError('Due-components requires review-due');
  if (r.intent === 'practice' && (!Array.isArray(r.wordIds) || !r.wordIds.every(text))) throw new RangeError('Practice requires explicit word IDs');
  const filter = r.filter;
  if (filter?.partOfSpeech && (!Array.isArray(filter.partOfSpeech) ||
      !filter.partOfSpeech.every(pos => ['noun', 'verb', 'adjective', 'adverb', 'other'].includes(pos)))) throw new RangeError('Invalid part-of-speech filter');
  if (filter?.tags && (!Array.isArray(filter.tags) || !filter.tags.every(text))) throw new RangeError('Invalid tag filter');
  timestamp(input.at); new Intl.DateTimeFormat('en', { timeZone: input.studyTimezone });
}

export interface VocabularyQueueInput {
  readonly request: SessionRequest;
  readonly deck: Deck;
  readonly words: readonly Word[];
  readonly progress: readonly WordProgress[];
  readonly owner: Owner;
  readonly at: string;
}
export interface VocabularyQueues {
  /** Words never introduced, in deck order. */
  readonly fresh: readonly Word[];
  /** Words with a due component the request can assess, most urgent first. */
  readonly due: readonly DueWord[];
}

function queryContext(input: VocabularyQueueInput): WordQueryContext {
  const r = input.request;
  return { owner: input.owner, words: input.words, progress: input.progress,
    at: input.at, answerLanguage: r.answerLanguage, ...(r.filter ? { filter: r.filter } : {}),
    ...(r.format === 'single' ? { exerciseId: r.exerciseId as WordExerciseId } : {}) };
}

/**
 * The planner's candidate queues for a request's deck, exercise and answer language, before
 * capacity and per-word task availability. The intent only chooses between them, so a home
 * screen can count both with exactly the planner's rules.
 */
export function vocabularyQueues(input: VocabularyQueueInput): VocabularyQueues {
  const context = queryContext(input);
  const max = new Set(input.deck.wordIds).size;
  // Query full eligible queue: availability is evaluated before consuming capacity.
  // This also validates deck/projection identities even when practice selects a subset.
  const fresh = selectNewWords(input.deck, context, max);
  const due = [...selectDueWords(input.deck, context, max)];
  if (input.request.format === 'circuit') {
    // Article-only work remains useful when the requested translation is absent.
    for (const item of selectDueWords(input.deck, { ...context, exerciseId: 'article-choice' }, max))
      if (!due.some(other => other.word.id === item.word.id)) due.push(item);
    due.sort(compareDueWords);
  }
  return { fresh, due };
}

/** Pure planner. Select once, pin tasks/catalog/seed, never read a clock or change progress. */
export function planVocabularySession(input: VocabularyPlannerInput): VocabularyPlanResult {
  validate(input);
  const r = input.request;
  const registry = createWordExerciseRegistry(input.words, input.catalogVersion);
  const context = queryContext(input);
  // A new-word batch is always 5: a larger batch is too many introductions at once.
  const capacity = r.format === 'single' && r.intent !== 'learn-new' ? 20 : 5;
  const max = new Set(input.deck.wordIds).size;
  const { fresh, due } = vocabularyQueues(input);
  let candidates: readonly Word[];
  if (r.intent === 'learn-new') candidates = fresh;
  else if (r.intent === 'review-due') candidates = due.map(item => item.word);
  else {
    const members = new Set(input.deck.wordIds);
    if (r.wordIds.some(id => !members.has(id))) throw new RangeError('Practice word outside deck');
    const practiceDeck = { ...input.deck, wordIds: [...new Set(r.wordIds)] };
    const eligible = new Set(selectPracticeWords(practiceDeck, context, max).map(w => w.id));
    if (r.format === 'circuit') for (const word of selectPracticeWords(practiceDeck, { ...context, exerciseId: 'article-choice' }, max)) eligible.add(word.id);
    candidates = practiceDeck.wordIds.filter(id => eligible.has(id)).map(id => input.words.find(w => w.id === id)!);
  }
  const selected: Word[] = [];
  const omissions: PlanOmission[] = [];
  const built = new Map<string, Map<WordExerciseId, Task>>();
  const order = r.format === 'single' ? [r.exerciseId as WordExerciseId]
    : r.intent === 'learn-new' ? LEARNING_ORDER : REVIEW_ORDER;
  const dueByWord = new Map(due.map(item => [item.word.id, item.dueComponents]));
  function build(word: Word, id: WordExerciseId): Task | undefined {
    const taskId = JSON.stringify(['task', input.sessionId, word.id, id]);
    const buildContext = { taskId, seed: JSON.stringify([input.seed, word.id, id]), answerLanguage: r.answerLanguage };
    const availability = registry.availability(id, word, buildContext);
    if (!availability.available) { omissions.push({ wordId: word.id, exerciseId: id, reason: availability.reason }); return undefined; }
    return registry.get(id).buildTask(word, buildContext);
  }
  for (const word of candidates) {
    const tasks = new Map<WordExerciseId, Task>();
    if (r.intent === 'learn-new') {
      const introduction = build(word, 'introduction');
      if (!introduction) continue;
      tasks.set('introduction', introduction);
    }
    for (const id of order) {
      if (tasks.has(id)) continue;
      if (r.format === 'circuit' && r.circuitScope === 'due-components' &&
          !registry.get(id).assessedComponents(word).some(c => dueByWord.get(word.id)?.includes(c))) continue;
      const task = build(word, id); if (task) tasks.set(id, task);
    }
    const exercises = [...tasks.keys()].filter(id => id !== 'introduction');
    if (!exercises.length && !(r.format === 'single' && r.exerciseId === 'introduction' && tasks.size)) continue;
    selected.push(word); built.set(word.id, tasks);
    if (selected.length === capacity) break;
  }
  if (!selected.length) return freeze({ kind: 'empty', reason: candidates.length ? 'no-applicable-tasks'
    : r.intent === 'learn-new' ? 'no-new-words' : r.intent === 'review-due' ? 'no-due-words' : 'empty-practice', omissions });
  const stages: readonly WordExerciseId[] = r.intent === 'learn-new' ? ['introduction', ...order.filter(id => id !== 'introduction')] : order;
  const diagnostics = new Map<string, WordExerciseId>();
  if (r.format === 'circuit' && r.intent === 'review-due') for (const word of selected) {
    const progress = input.progress.find(item => item.wordId === word.id);
    const due = summarizeWord(word, progress, input.at, input.studyTimezone).components
      .filter(c => c.due && c.dueAt !== null && dueByWord.get(word.id)?.includes(c.component))
      .sort((a, b) => timestamp(a.dueAt!) - timestamp(b.dueAt!) || DIAGNOSTIC_TIES.indexOf(a.component) - DIAGNOSTIC_TIES.indexOf(b.component));
    for (const { component } of due) {
      const id = DIAGNOSTIC_EXERCISES[component].find(exercise => built.get(word.id)!.has(exercise));
      if (id) { diagnostics.set(word.id, id); break; }
    }
  }
  const shuffled = (stage: string): readonly Word[] => r.format === 'circuit' ? [...selected].sort((a, b) =>
    rank(input.seed, stage, a.id) - rank(input.seed, stage, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : selected;
  const tasks = [
    ...shuffled('diagnostic').flatMap(word => diagnostics.has(word.id) ? [built.get(word.id)!.get(diagnostics.get(word.id)!)!] : []),
    ...stages.flatMap(id => shuffled(id).flatMap(word => {
      const task = built.get(word.id)!.get(id); return task && diagnostics.get(word.id) !== id ? [task] : [];
    })),
  ];
  const plan: VocabularySessionPlan = { schemaVersion: 1, plannerVersion: VOCABULARY_PLANNER_VERSION,
    sessionId: input.sessionId, owner: snapshot(input.owner), dataEpoch: input.dataEpoch,
    studyTimezone: input.studyTimezone, seed: input.seed, createdAt: input.at, policyVersion: EVIDENCE_POLICY_VERSION,
    catalogVersion: input.catalogVersion, request: snapshot(r), batch: { capacity, wordIds: selected.map(w => w.id) },
    wordVersions: selected.map(w => ({ wordId: w.id, contentVersion: w.contentVersion })),
    skippedExercises: omissions.filter(item => selected.some(word => word.id === item.wordId)), tasks };
  return freeze({ kind: 'ready', plan, omissions });
}

function rank(seed: string, stage: string, wordId: string): number {
  let hash = 2166136261;
  for (const char of JSON.stringify([seed, stage, wordId])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
