import type { StudyIntent, TranslationLanguage, WordId } from './content.js';
import { isLearningEvent, type LearningEvent } from './event.js';
import type { BuildContext, Evaluation, InputKind, JsonValue, Task } from './exercise.js';
import { germanSpellingForm, MAX_GERMAN_ANSWER_LENGTH } from './german-answer.js';
import { SENTENCE_ASSEMBLY } from './families/sentences.js';

/** G3 (#332): every non-word family (sentences, grammar, phrases, audio/video, tests) shares
 * one content port, one Task/Evaluation contract and one journal with the word exercises.
 * Item answers never become word evidence: a word an item mentions gets no SRS progress.
 */
export const ITEM_TARGET_KINDS = Object.freeze(['sentence', 'grammar-item', 'phrase', 'video-segment', 'assessment'] as const);
export type ItemTargetKind = typeof ITEM_TARGET_KINDS[number];
export type ItemTarget = { readonly kind: ItemTargetKind; readonly datasetId: string; readonly itemId: string };
export const ITEM_POLICY_VERSION = 'item-evidence/1';
export const ITEM_DATASET_SCHEMA_VERSION = 1;
export const ITEM_TASK_SCHEMA_VERSION = 1;

/** One published item. `content` is the family's own JSON; `wordIds` are words it mentions,
 * for links and filters only. A new text is a new `contentVersion` of the same `id`. */
export interface LearningItem {
  readonly id: string;
  readonly contentVersion: number;
  readonly content: JsonValue;
  readonly wordIds: readonly WordId[];
}
/** An immutable, versioned dataset. Tasks pin `version`; the server re-evaluates against it. */
export interface ItemDataset {
  readonly schemaVersion: typeof ITEM_DATASET_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly kind: ItemTargetKind;
  readonly title: string;
  readonly items: readonly LearningItem[];
}
export interface ItemTaskSpecification {
  readonly schemaVersion: typeof ITEM_TASK_SCHEMA_VERSION;
  readonly datasetVersion: string;
  readonly seed: string;
  readonly answerLanguage: TranslationLanguage;
  /** What the definition shows and checks: built deterministically from the item. */
  readonly exercise: JsonValue;
}
export interface ItemExerciseTask extends Task {
  readonly target: ItemTarget;
  readonly specification: ItemTaskSpecification & { readonly [key: string]: JsonValue };
}

/** The adapter a family (M1–M8) implements. Pure and deterministic: the browser builds the task,
 * the server rebuilds it from the pinned dataset and runs the same `evaluate`. */
export interface ItemExerciseDefinition {
  readonly id: string;
  /** Changing build or evaluation rules needs a new version; it is the task version. */
  readonly version: string;
  readonly targetKinds: readonly ItemTargetKind[];
  readonly input: InputKind;
  readonly source: Evaluation['source'];
  isApplicable(item: LearningItem, context: BuildContext): boolean;
  /** The exercise part of the specification, e.g. a prompt and shuffled options. */
  build(item: LearningItem, context: BuildContext): JsonValue;
  /** Throws RangeError for a malformed answer (rejected), never for a wrong one. */
  evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue): 'correct' | 'incorrect';
}

export interface ItemExerciseRegistry {
  readonly datasets: readonly ItemDataset[];
  get(exerciseId: string): ItemExerciseDefinition;
  dataset(datasetId: string, version?: string): ItemDataset;
  getItem(datasetId: string, itemId: string, version?: string): LearningItem;
  isAvailable(exerciseId: string, datasetId: string, itemId: string, context: BuildContext): boolean;
  buildTask(exerciseId: string, datasetId: string, itemId: string, context: BuildContext): ItemExerciseTask;
  validateTask(task: Task): ItemExerciseTask;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
export const isItemTarget = (target: LearningEvent['target']): target is ItemTarget => target.kind !== 'word';

/** Structural check of a published dataset; content is validated by each definition. */
export function assertItemDataset(dataset: ItemDataset): void {
  if (!record(dataset) || dataset.schemaVersion !== ITEM_DATASET_SCHEMA_VERSION || !text(dataset.id) || dataset.id.includes(':') ||
      !text(dataset.version) || !text(dataset.title) || !(ITEM_TARGET_KINDS as readonly string[]).includes(dataset.kind) ||
      !Array.isArray(dataset.items) || !dataset.items.length) throw new RangeError('Invalid item dataset');
  const ids = new Set<string>();
  for (const item of dataset.items) {
    if (!record(item) || !text(item.id) || ids.has(item.id) || !Number.isSafeInteger(item.contentVersion) || (item.contentVersion as number) < 1 ||
        !Array.isArray(item.wordIds) || !item.wordIds.every(text) || new Set(item.wordIds).size !== item.wordIds.length ||
        item.content === undefined) throw new RangeError(`Invalid item ${dataset.id}/${String(item?.id)}`);
    ids.add(item.id);
  }
}

/** Intents an item event may carry: tests are assessments, everything else is practice.
 * SRS intents (learn-new, review-due) belong to words only. */
export function itemIntent(kind: ItemTargetKind): StudyIntent { return kind === 'assessment' ? 'assessment' : 'practice'; }

/** Registry over the pinned datasets of a session (client) or of one task (server). */
export function createItemExerciseRegistry(datasets: readonly ItemDataset[],
  definitions: readonly ItemExerciseDefinition[] = ITEM_EXERCISES): ItemExerciseRegistry {
  const byKey = new Map<string, ItemDataset>();
  const latest = new Map<string, ItemDataset>();
  for (const input of datasets) {
    assertItemDataset(input);
    const key = JSON.stringify([input.id, input.version]);
    const dataset = freeze(JSON.parse(JSON.stringify(input)) as ItemDataset);
    if (byKey.has(key)) { if (canonical(byKey.get(key)) !== canonical(dataset)) throw new RangeError('Dataset version reused'); continue; }
    if (latest.has(input.id)) throw new RangeError('One version per dataset in a registry');
    byKey.set(key, dataset); latest.set(input.id, dataset);
  }
  const exercises = new Map<string, ItemExerciseDefinition>();
  for (const definition of definitions) {
    if (!text(definition.id) || !text(definition.version) || exercises.has(definition.id)) throw new RangeError('Invalid item exercise definition');
    exercises.set(definition.id, definition);
  }
  function get(exerciseId: string): ItemExerciseDefinition {
    const definition = exercises.get(exerciseId);
    if (!definition) throw new RangeError('Unknown item exercise');
    return definition;
  }
  function dataset(datasetId: string, version?: string): ItemDataset {
    const found = latest.get(datasetId);
    if (!found || (version !== undefined && found.version !== version)) throw new RangeError('Dataset version unavailable');
    return found;
  }
  function getItem(datasetId: string, itemId: string, version?: string): LearningItem {
    const item = dataset(datasetId, version).items.find(candidate => candidate.id === itemId);
    if (!item) throw new RangeError('Unknown item');
    return item;
  }
  function context(value: BuildContext): void {
    if (!text(value.taskId) || !text(value.seed) || (value.answerLanguage !== 'ru' && value.answerLanguage !== 'en')) throw new RangeError('Invalid task build context');
  }
  function isAvailable(exerciseId: string, datasetId: string, itemId: string, build: BuildContext): boolean {
    context(build);
    const definition = get(exerciseId); const source = dataset(datasetId);
    return definition.targetKinds.includes(source.kind) && definition.isApplicable(getItem(datasetId, itemId), build);
  }
  function buildTask(exerciseId: string, datasetId: string, itemId: string, build: BuildContext): ItemExerciseTask {
    if (!isAvailable(exerciseId, datasetId, itemId, build)) throw new RangeError(`${exerciseId}: not applicable to ${datasetId}/${itemId}`);
    const definition = get(exerciseId); const source = dataset(datasetId); const item = getItem(datasetId, itemId);
    return freeze({ id: build.taskId, exerciseId, taskVersion: definition.version, contentVersion: item.contentVersion,
      target: { kind: source.kind, datasetId, itemId }, input: definition.input, assessedComponents: [],
      specification: { schemaVersion: ITEM_TASK_SCHEMA_VERSION, datasetVersion: source.version, seed: build.seed,
        answerLanguage: build.answerLanguage, exercise: definition.build(item, build) } });
  }
  function validateTask(task: Task): ItemExerciseTask {
    if (!record(task) || !record(task.target) || !isItemTarget(task.target)) throw new RangeError('Not an item task');
    const spec = task.specification;
    if (!record(spec) || typeof spec.datasetVersion !== 'string' || typeof spec.seed !== 'string' ||
        (spec.answerLanguage !== 'ru' && spec.answerLanguage !== 'en')) throw new RangeError('Invalid item task specification');
    const item = getItem(task.target.datasetId, task.target.itemId, spec.datasetVersion);
    if (item.contentVersion !== task.contentVersion) throw new RangeError('Task content version unavailable');
    const rebuilt = buildTask(task.exerciseId, task.target.datasetId, task.target.itemId,
      { taskId: task.id, seed: spec.seed, answerLanguage: spec.answerLanguage });
    if (canonical(rebuilt) !== canonical(task)) throw new RangeError('Task differs from canonical build');
    return rebuilt;
  }
  return Object.freeze({ datasets: [...latest.values()], get, dataset, getItem, isAvailable, buildTask, validateTask });
}

/** Bind an event to the canonical rebuild of its task: the shared check of the local store and the server. */
export function bindItemEvent(registry: ItemExerciseRegistry, source: Task, event: LearningEvent): ItemExerciseTask {
  const task = registry.validateTask(source);
  if (!isLearningEvent(event) || !isItemTarget(event.target) || canonical(event.target) !== canonical(task.target) ||
      event.taskId !== task.id || event.exerciseId !== task.exerciseId || event.taskVersion !== task.taskVersion ||
      event.contentVersion !== task.contentVersion || event.answerLanguage !== task.specification.answerLanguage ||
      event.policyVersion !== ITEM_POLICY_VERSION || event.intent !== itemIntent(task.target.kind) ||
      event.kind === 'introduction' || event.exposure.length !== 0 ||
      (event.kind === 'reveal' && task.input !== 'reveal')) throw new RangeError('Item event/task context mismatch');
  return task;
}

/** Trusted evaluation of an item answer; uploaded evaluations are never read. */
export function evaluateItemAnswer(registry: ItemExerciseRegistry, source: Task, event: LearningEvent): Evaluation {
  const task = bindItemEvent(registry, source, event);
  if (event.kind !== 'answer') throw new RangeError('Only answers are evaluated');
  const definition = registry.get(task.exerciseId);
  const item = registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion);
  return { outcome: definition.evaluate(item, task.specification.exercise, event.rawAnswer), source: definition.source, components: {} };
}

// Shared sample adapters. Families may use them as they are or register their own definitions.
type Prompt = { text: string; lang: string };
const prompt = (value: unknown): value is Prompt => record(value) && text(value.text) && text(value.lang);
function choiceContent(content: JsonValue): { prompt: Prompt; options: { id: string; label: string }[]; correctOptionId: string } | null {
  if (!record(content) || !prompt(content.prompt) || !Array.isArray(content.options) || content.options.length < 2 ||
      !text(content.correctOptionId)) return null;
  const options = content.options as unknown[];
  if (!options.every(o => record(o) && text(o.id) && text(o.label)) || new Set(options.map(o => (o as { id: string }).id)).size !== options.length ||
      !options.some(o => (o as { id: string }).id === content.correctOptionId)) return null;
  return content as unknown as ReturnType<typeof choiceContent> & object;
}
function textContent(content: JsonValue): { prompt: Prompt; answers: string[] } | null {
  if (!record(content) || !prompt(content.prompt) || !Array.isArray(content.answers) || !content.answers.length ||
      !content.answers.every(text)) return null;
  return content as unknown as { prompt: Prompt; answers: string[] };
}
function revealContent(content: JsonValue): { prompt: Prompt; answer: Prompt } | null {
  return record(content) && prompt(content.prompt) && prompt(content.answer) ? content as unknown as { prompt: Prompt; answer: Prompt } : null;
}

/** `content: { prompt, options: [{id,label}], correctOptionId }`; the answer is an option ID. */
export const ITEM_CHOICE: ItemExerciseDefinition = Object.freeze({
  id: 'item-choice', version: 'item-choice/1', targetKinds: ITEM_TARGET_KINDS, input: 'choice', source: 'automatic',
  isApplicable: (item: LearningItem) => choiceContent(item.content) !== null,
  build(item: LearningItem, context: BuildContext): JsonValue {
    const content = choiceContent(item.content)!;
    const key = JSON.stringify([context.seed, context.taskId, item.id]);
    const options = [...content.options].sort((a, b) => hash(`${key}:${a.id}`) - hash(`${key}:${b.id}`) || (a.id < b.id ? -1 : 1));
    return { prompt: content.prompt, options: options.map(o => ({ id: o.id, label: o.label })), correctOptionId: content.correctOptionId };
  },
  evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue) {
    const built = choiceContent(exercise);
    if (!built || typeof answer !== 'string' || !built.options.some(o => o.id === answer)) throw new RangeError('Unknown answer option');
    return answer === built.correctOptionId ? 'correct' : 'incorrect';
  },
});
/** `content: { prompt, answers: [...] }`; only whitespace and Unicode equivalence are neutral. */
export const ITEM_TEXT: ItemExerciseDefinition = Object.freeze({
  id: 'item-text', version: 'item-text/1', targetKinds: ITEM_TARGET_KINDS, input: 'text', source: 'automatic',
  isApplicable: (item: LearningItem) => textContent(item.content) !== null,
  build: (item: LearningItem): JsonValue => textContent(item.content) as unknown as JsonValue,
  evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue) {
    const built = textContent(exercise);
    if (!built || typeof answer !== 'string' || !answer.trim() || answer.length > MAX_GERMAN_ANSWER_LENGTH ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(answer)) throw new RangeError('Invalid text answer');
    return built.answers.some(accepted => germanSpellingForm(accepted) === germanSpellingForm(answer)) ? 'correct' : 'incorrect';
  },
});
/** `content: { prompt, answer }`: reveal, then rate `remembered` / `forgotten` (audio, video, phrases). */
export const ITEM_SELF_CHECK: ItemExerciseDefinition = Object.freeze({
  id: 'item-self-check', version: 'item-self-check/1', targetKinds: ITEM_TARGET_KINDS.filter(kind => kind !== 'assessment'),
  input: 'reveal', source: 'self-assessment',
  isApplicable: (item: LearningItem) => revealContent(item.content) !== null,
  build: (item: LearningItem): JsonValue => revealContent(item.content) as unknown as JsonValue,
  evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue) {
    if (!revealContent(exercise) || (answer !== 'remembered' && answer !== 'forgotten')) throw new RangeError('Invalid self-assessment');
    return answer === 'remembered' ? 'correct' : 'incorrect';
  },
});
/** Definitions the server knows. A family adds its adapter here, so both sides evaluate the same way. */
export const ITEM_EXERCISES: readonly ItemExerciseDefinition[] = Object.freeze([ITEM_CHOICE, ITEM_TEXT, ITEM_SELF_CHECK,
  SENTENCE_ASSEMBLY,
]);
