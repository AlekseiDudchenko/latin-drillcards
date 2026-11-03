import type { TranslationLanguage, Word } from './content.js';
import { isTranslationLanguage } from './content.js';
import type { BuildContext, Evaluation, ExerciseDefinition, JsonValue, Task } from './exercise.js';
import { isLearningEvent, type LearningEvent } from './event.js';
import { applicableComponents } from './progress.js';
import { TARGET_NORMALIZATION_VERSION, evaluateTargetProduction } from './target-answer.js';
import { EVIDENCE_POLICY_VERSION, WORD_EXERCISE_RULES } from './word-evidence.js';

export const WORD_EXERCISE_IDS = Object.freeze(['meaning-choice', 'target-choice', 'meaning-recall', 'introduction', 'target-type', 'article-choice', 'target-with-article-type'] as const);
export type WordExerciseId = typeof WORD_EXERCISE_IDS[number];
export const WORD_TASK_SCHEMA_VERSION = 1;
export const CHOICE_OPTION_COUNT = 4;
export type UnavailableReason = 'missing-translation' | 'insufficient-options' | 'unknown-word' | 'content-version' | 'article-not-applicable';
export class ExerciseUnavailable extends Error {
  constructor(readonly exerciseId: WordExerciseId, readonly reason: UnavailableReason) {
    super(`${exerciseId}: ${reason}`); this.name = 'ExerciseUnavailable';
  }
}
export type WordTaskSpecification = {
  schemaVersion: 1;
  catalogVersion: string;
  normalizationVersion?: string;
  seed: string;
  answerLanguage: TranslationLanguage;
  prompt: { text: string; lang: string };
  answer: { text: string; lang: string };
  options: readonly { id: string; label: string; wordId: string; contentVersion: number }[];
  correctOptionId: string | null;
};
export interface WordExerciseTask extends Task {
  readonly exerciseId: WordExerciseId;
  readonly specification: WordTaskSpecification;
}
export interface WordExerciseRegistry {
  readonly ids: typeof WORD_EXERCISE_IDS;
  readonly catalogVersion: string;
  get(id: string): ExerciseDefinition<Word>;
  getWord(id: string, contentVersion: number): Word;
  availability(id: WordExerciseId, word: Word, context: BuildContext): { available: true } | { available: false; reason: UnavailableReason };
  validateTask(task: Task): WordExerciseTask;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
const normalized = (value: string): string => value.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
function meaningAliases(word: Word, language: TranslationLanguage): Set<string> {
  const meaning = word.meanings[language];
  const result = new Set<string>();
  for (const value of meaning ? [meaning.preferred, ...meaning.accepted] : []) {
    // Prefer false-negative availability to offering an explicitly overlapping sense.
    for (const part of [value, ...value.replace(/\([^)]*\)/g, '').split(/[,;/|]/)]) {
      const key = normalized(part).replace(/[.!?]+$/, '').trim(); if (key) result.add(key);
    }
  }
  return result;
}
function targetAliases(word: Word): Set<string> {
  return new Set([word.lemma, ...word.acceptedForms].map(form => normalized(form).replace(/^(der|die|das)\s+/, '')));
}
const overlap = (a: Set<string>, b: Set<string>): boolean => [...a].some(item => b.has(item));
const targetLabel = (word: Word): string => [word.article, word.lemma].filter(Boolean).join(' ');

/** One immutable published catalog snapshot is used for construction and server re-evaluation. */
export function createWordExerciseRegistry(source: readonly Word[], catalogVersion: string): WordExerciseRegistry {
  if (!catalogVersion.trim()) throw new RangeError('Missing catalog snapshot version');
  const catalog = new Map<string, Word>();
  for (const input of source) {
    if (!input.id.trim() || !input.lemma.trim() || input.schemaVersion !== 1 || !Number.isSafeInteger(input.contentVersion) || input.contentVersion < 1 || catalog.has(input.id)) {
      throw new RangeError('Invalid or duplicate catalog identity/version');
    }
    const word: Word = freeze(JSON.parse(JSON.stringify(input)) as Word);
    catalog.set(word.id, word);
  }
  const pool = [...catalog.values()].sort((a, b) => compare(a.id, b.id));
  function id(value: string): WordExerciseId {
    if (!(WORD_EXERCISE_IDS as readonly string[]).includes(value)) throw new RangeError('Unknown word exercise');
    return value as WordExerciseId;
  }
  function contextValid(context: BuildContext): void {
    if (!context.taskId.trim() || !context.seed.trim() || (!isTranslationLanguage(context.answerLanguage))) throw new RangeError('Invalid task build context');
  }
  function optionsFor(exerciseId: WordExerciseId, target: Word, context: BuildContext): Word[] {
    const key = JSON.stringify([context.seed, context.taskId, exerciseId, target.id, context.answerLanguage]);
    const selected = [target];
    const meaningSets = [meaningAliases(target, context.answerLanguage)];
    const targetSets = [targetAliases(target)];
    const candidates = pool.filter(word => word.id !== target.id && word.partOfSpeech === target.partOfSpeech && word.meanings[context.answerLanguage]?.preferred.trim());
    const topic = (word: Word): number => word.tags.filter(tag => target.tags.includes(tag)).length;
    candidates.sort((a, b) => topic(b) - topic(a) || hash(`${key}:${a.id}`) - hash(`${key}:${b.id}`) || compare(a.id, b.id));
    for (const candidate of candidates) {
      const meanings = meaningAliases(candidate, context.answerLanguage);
      const german = targetAliases(candidate);
      if (meaningSets.some(set => overlap(set, meanings)) || targetSets.some(set => overlap(set, german))) continue;
      selected.push(candidate); meaningSets.push(meanings); targetSets.push(german);
      if (selected.length === CHOICE_OPTION_COUNT) break;
    }
    return selected.sort((a, b) => hash(`${key}:layout:${a.id}`) - hash(`${key}:layout:${b.id}`) || compare(a.id, b.id));
  }
  function availability(exerciseId: WordExerciseId, requested: Word, context: BuildContext) {
    id(exerciseId); contextValid(context);
    const word = catalog.get(requested.id);
    if (!word) return { available: false as const, reason: 'unknown-word' as const };
    if (word.contentVersion !== requested.contentVersion) return { available: false as const, reason: 'content-version' as const };
    if (exerciseId !== 'article-choice' && !word.meanings[context.answerLanguage]?.preferred.trim()) return { available: false as const, reason: 'missing-translation' as const };
    if ((exerciseId === 'article-choice' || exerciseId === 'target-with-article-type') &&
        (word.partOfSpeech !== 'noun' || !word.article)) return { available: false as const, reason: 'article-not-applicable' as const };
    if ((exerciseId === 'meaning-choice' || exerciseId === 'target-choice') && optionsFor(exerciseId, word, context).length < CHOICE_OPTION_COUNT) return { available: false as const, reason: 'insufficient-options' as const };
    return { available: true as const };
  }
  /**
   * Choice options a task carries, checked by their properties instead of rebuilt: the planner draws
   * distractors from whatever pool it was given (a deck), the server validates against the whole
   * snapshot. Exactly the option count, the target once, catalog words of its part of speech with a
   * translation, and no overlapping meaning or target-language form, so there is a single correct answer.
   */
  function checkedOptions(exerciseId: WordExerciseId, target: Word, context: BuildContext, ids: readonly string[]): Word[] {
    if (ids.length !== CHOICE_OPTION_COUNT || new Set(ids).size !== ids.length || !ids.includes(target.id)) throw new RangeError('Invalid choice options');
    const meaningSets: Set<string>[] = []; const targetSets: Set<string>[] = [];
    return ids.map(optionId => {
      const option = catalog.get(optionId);
      if (!option || option.partOfSpeech !== target.partOfSpeech || !option.meanings[context.answerLanguage]?.preferred.trim()) throw new RangeError(`Invalid ${exerciseId} option`);
      const meanings = meaningAliases(option, context.answerLanguage); const forms = targetAliases(option);
      if (meaningSets.some(set => overlap(set, meanings)) || targetSets.some(set => overlap(set, forms))) throw new RangeError(`Ambiguous ${exerciseId} options`);
      meaningSets.push(meanings); targetSets.push(forms);
      return option;
    });
  }
  function buildTask(exerciseId: WordExerciseId, requested: Word, context: BuildContext, optionIds?: readonly string[]): WordExerciseTask {
    // Validation supplies the task's own options; their sufficiency is checked by checkedOptions.
    const available = optionIds ? { available: true as const } : availability(exerciseId, requested, context);
    if (!available.available) throw new ExerciseUnavailable(exerciseId, available.reason);
    const word = catalog.get(requested.id)!;
    const articleChoice = exerciseId === 'article-choice';
    const typed = exerciseId === 'target-type' || exerciseId === 'target-with-article-type';
    const choice = exerciseId.endsWith('-choice');
    const reverse = exerciseId === 'target-choice' || typed;
    const prompt = { text: articleChoice ? word.lemma : reverse ? word.meanings[context.answerLanguage]!.preferred : targetLabel(word), lang: reverse ? context.answerLanguage : 'de' };
    const answer = { text: articleChoice ? word.article! : exerciseId === 'target-type' ? word.lemma : reverse ? targetLabel(word) : word.meanings[context.answerLanguage]!.preferred, lang: reverse || articleChoice ? 'de' : context.answerLanguage };
    const options = articleChoice ? ['der', 'die', 'das'].map(article => ({ id: article, label: article, wordId: word.id, contentVersion: word.contentVersion }))
      : choice ? (optionIds ? checkedOptions(exerciseId, word, context, optionIds) : optionsFor(exerciseId, word, context)).map(option => ({ id: option.id, label: reverse ? targetLabel(option) : option.meanings[context.answerLanguage]!.preferred, wordId: option.id, contentVersion: option.contentVersion })) : [];
    return freeze({ id: context.taskId, exerciseId, taskVersion: `${exerciseId}/1`, contentVersion: word.contentVersion,
      target: { kind: 'word', wordId: word.id }, input: choice ? 'choice' : typed ? 'text' : 'reveal',
      assessedComponents: exerciseId === 'introduction' ? [] : [...WORD_EXERCISE_RULES[exerciseId].assessed].filter(component => applicableComponents(word).includes(component)),
      specification: { schemaVersion: WORD_TASK_SCHEMA_VERSION, catalogVersion, seed: context.seed, answerLanguage: context.answerLanguage,
        ...(typed ? { normalizationVersion: TARGET_NORMALIZATION_VERSION } : {}), prompt, answer, options,
        correctOptionId: articleChoice ? word.article! : choice ? word.id : null } });
  }

  function validateTask(task: Task): WordExerciseTask {
    const exerciseId = id(task.exerciseId);
    if (task.target.kind !== 'word') throw new RangeError('Not a word task');
    const specification = task.specification;
    if (specification === null || typeof specification !== 'object' || Array.isArray(specification)) throw new RangeError('Invalid word task specification');
    const fields = specification as Record<string, JsonValue>;
    if (fields.catalogVersion !== catalogVersion || typeof fields.seed !== 'string' || (!isTranslationLanguage(fields.answerLanguage))) throw new RangeError('Task snapshot/context mismatch');
    const word = catalog.get(task.target.wordId);
    if (!word || word.contentVersion !== task.contentVersion) throw new RangeError('Task content version unavailable');
    const context: BuildContext = { taskId: task.id, seed: fields.seed, answerLanguage: fields.answerLanguage };
    if (exerciseId !== 'article-choice' && !word.meanings[context.answerLanguage]?.preferred.trim()) throw new RangeError('Task translation unavailable');
    // Choice options are validated, not re-derived: see checkedOptions. Everything else is rebuilt exactly.
    const supplied = exerciseId === 'meaning-choice' || exerciseId === 'target-choice'
      ? (Array.isArray(fields.options) ? fields.options : []).map(option => (option as { id?: unknown } | null)?.id)
      : undefined;
    if (supplied && !supplied.every((value): value is string => typeof value === 'string')) throw new RangeError('Invalid choice options');
    const rebuilt = buildTask(exerciseId, word, context, supplied as string[] | undefined);
    if (canonical(rebuilt) !== canonical(task)) throw new RangeError('Task differs from canonical build');
    return rebuilt;
  }
  const definitions = new Map<WordExerciseId, ExerciseDefinition<Word>>();
  for (const exerciseId of WORD_EXERCISE_IDS) definitions.set(exerciseId, Object.freeze({
    id: exerciseId, version: `${exerciseId}/1`,
    isApplicable: (word: Word, context: BuildContext) => availability(exerciseId, word, context).available,
    assessedComponents: (word: Word) => exerciseId === 'introduction' ? [] : WORD_EXERCISE_RULES[exerciseId].assessed.filter(component => applicableComponents(word).includes(component)),
    buildTask: (word: Word, context: BuildContext) => buildTask(exerciseId, word, context),
    evaluate(task: Task, raw: JsonValue): Evaluation {
      if (task.exerciseId !== exerciseId) throw new RangeError('Exercise/task mismatch');
      const checked = validateTask(task);
      if (exerciseId === 'introduction') {
        if (raw !== 'continue') throw new RangeError('Introduction has no answer rating');
        return { outcome: 'unobserved', source: 'automatic', components: {} };
      }
      if (exerciseId === 'meaning-recall') {
        if (raw !== 'remembered' && raw !== 'forgotten') throw new RangeError('Invalid self-assessment');
        const outcome = raw === 'remembered' ? 'correct' : 'incorrect';
        return { outcome, source: 'self-assessment', components: { recognition: outcome } };
      }
      if (exerciseId === 'target-type' || exerciseId === 'target-with-article-type') {
        if (checked.target.kind !== 'word') throw new RangeError('Not a word task');
        return evaluateTargetProduction(catalog.get(checked.target.wordId)!, raw, exerciseId === 'target-with-article-type', pool);
      }
      if (typeof raw !== 'string' || !checked.specification.options.some(option => option.id === raw)) throw new RangeError('Unknown answer option');
      const outcome = raw === checked.specification.correctOptionId ? 'correct' : 'incorrect';
      return { outcome, source: 'automatic', components: exerciseId === 'article-choice' ? { article: outcome } : { recognition: outcome } };
    },
  }));
  return Object.freeze({ ids: WORD_EXERCISE_IDS, catalogVersion,
    get(value: string) { return definitions.get(id(value))!; },
    getWord(wordId: string, version: number) {
      const word = catalog.get(wordId); if (!word || word.contentVersion !== version) throw new RangeError('Word revision unavailable'); return word;
    }, availability, validateTask });
}

/** Bind an authenticated service's task snapshot to the event before deriving trusted evidence. */
export function evaluateWordAnswer(registry: WordExerciseRegistry, source: Task, event: LearningEvent): Evaluation {
  const task = registry.validateTask(source);
  if (!isLearningEvent(event) || event.kind !== 'answer' || task.exerciseId === 'introduction' ||
      event.target.kind !== 'word' || task.target.kind !== 'word' || event.target.wordId !== task.target.wordId ||
      event.taskId !== task.id || event.exerciseId !== task.exerciseId || event.taskVersion !== task.taskVersion ||
      event.contentVersion !== task.contentVersion || event.answerLanguage !== task.specification.answerLanguage ||
      event.policyVersion !== EVIDENCE_POLICY_VERSION) throw new RangeError('Answer event/task context mismatch');
  return registry.get(task.exerciseId).evaluate(task, event.rawAnswer);
}
