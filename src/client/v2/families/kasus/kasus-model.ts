import { gradeKasusAnswer, kasusContent, projectExerciseProgress, selectItems, summarizeExercise, KASUS_EXERCISE, KASUS_GAP, KASUS_GENDERS,
  KASUS_SLOT, KASUS_VARIANTS, type ExerciseSummary, type ItemExerciseRegistry, type ItemExerciseTask, type JsonValue, type KasusArticleExercise,
  type KasusChoiceExercise, type KasusContent, type KasusVariant, type RecordedLearningFact, type ReplayContext } from '../../core/index.js';
import { parseClozeTemplate, type ClozeDefinition } from '../../cloze-model.js';
import type { InputDefinition } from '../../card-inputs.js';
import type { Lang } from '../../../i18n.js';

/** M4 (#336): DOM-free part of the Kasus page: the dataset, what a session contains, how a task
 * becomes a ClozeInput (article) or ChoiceInput (case, question) definition, and which rule row explains it. */
export const KASUS_DATASET = Object.freeze({ datasetId: 'kasus-a2', file: 'data/items/kasus-a2.json', rules: 'data/kasus-rules.json' });
export const KASUS_FILTERS = Object.freeze(['all', ...KASUS_VARIANTS] as const);
export type KasusFilter = typeof KASUS_FILTERS[number];
export const KASUS_SESSION_SIZE = 10;
export const isKasusTask = (task: ItemExerciseTask | undefined): boolean => task?.target.datasetId === KASUS_DATASET.datasetId;

type Trilingual = Readonly<Record<Lang, string>>;
/** One entry of the shared rule file (kasus-rules.json): the rule window's content. */
export interface KasusRule {
  readonly title: Trilingual;
  readonly summary: Trilingual;
  readonly body: Readonly<Record<Lang, readonly string[]>>;
  readonly table: {
    readonly head: Readonly<Record<Lang, readonly string[]>>;
    /** One row per gender, in KASUS_GENDERS order (maskulin, feminin, neutrum, Plural). */
    readonly rows: readonly { readonly gender: Trilingual; readonly nom: string; readonly form: string; readonly indef: string; readonly kein: string }[];
  };
  readonly examples: readonly Trilingual[];
}
export type KasusRules = Readonly<Record<string, KasusRule>>;

export function itemContent(registry: ItemExerciseRegistry, task: ItemExerciseTask): KasusContent {
  const content = kasusContent(registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion).content);
  if (!content) throw new RangeError('Not a Kasus item');
  return content;
}
export const variantOf = (task: ItemExerciseTask): KasusVariant => task.exerciseId.slice('kasus-'.length) as KasusVariant;

/** Items of the next session. One variant: never answered, then last answered wrong, then the oldest (selectItems).
 * All variants: the three queues in turn (article, case, question, …), so a session mixes them as v1 did. */
export function planKasusItems(registry: ItemExerciseRegistry, filter: KasusFilter, records: readonly RecordedLearningFact[],
  context: ReplayContext, limit = KASUS_SESSION_SIZE): { readonly itemId: string; readonly exerciseId: string }[] {
  const progress = projectExerciseProgress(records, context);
  const variants = filter === 'all' ? KASUS_VARIANTS : [filter];
  const queues = variants.map(variant => selectItems(registry, KASUS_EXERCISE[variant], KASUS_DATASET.datasetId, progress, limit)
    .map(itemId => ({ itemId, exerciseId: KASUS_EXERCISE[variant] })));
  const result: { itemId: string; exerciseId: string }[] = [];
  for (let index = 0; result.length < limit && queues.some(queue => index < queue.length); index++)
    for (const queue of queues) if (index < queue.length && result.length < limit) result.push(queue[index]!);
  return result;
}

/** `article`: the shared ClozeInput definition (G2 API unchanged), one choice slot in the sentence. */
export function clozeDefinition(task: ItemExerciseTask): ClozeDefinition {
  const exercise = task.specification.exercise as unknown as KasusArticleExercise;
  const { segments, slotIds } = parseClozeTemplate(exercise.template, KASUS_GAP);
  if (slotIds.length !== 1 || slotIds[0] !== KASUS_SLOT) throw new RangeError('Kasus task does not match its sentence');
  return { id: task.id, answerLang: 'de', segments,
    slots: [{ slotId: KASUS_SLOT, input: 'choice', options: exercise.slots[0].options.map(option => ({ ...option })) }] };
}
/** `case`/`question`: the sentence with its highlighted phrase and the ChoiceInput options. */
export function choiceDefinition(task: ItemExerciseTask): { prompt: { text: string; lang: string; focus: string }; input: Extract<InputDefinition, { kind: 'choice' }> } {
  const exercise = task.specification.exercise as unknown as KasusChoiceExercise;
  return { prompt: { ...exercise.prompt }, input: { kind: 'choice', answerLang: 'de', options: exercise.options.map(option => ({ ...option })) } };
}
/** The raw answer the Runner stores for a chosen option. */
export const rawAnswer = (task: ItemExerciseTask, option: string): JsonValue => variantOf(task) === 'article' ? { [KASUS_SLOT]: option } : option;
/** The option a stored answer chose, and whether it was right: the same core rule the server runs. */
export function grade(registry: ItemExerciseRegistry, task: ItemExerciseTask, raw: JsonValue): { readonly chosen: string; readonly correct: boolean } {
  return gradeKasusAnswer(registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion), task.specification.exercise, raw);
}
/** The complete sentence (speech, summary): an article gap is closed with the answer. */
export const solvedSentence = (content: Pick<KasusContent, 'sentence' | 'answer'>): string => content.sentence.replace(KASUS_GAP, content.answer);
/** Index of the rule table row that decides the item (its noun's gender). */
export const ruleRow = (content: Pick<KasusContent, 'gender'>): number => KASUS_GENDERS.indexOf(content.gender);
/** The rule of an item, if the shared rule file has it with one row per gender. */
export function ruleOf(rules: KasusRules, content: Pick<KasusContent, 'rule'>): KasusRule | undefined {
  const rule = Object.prototype.hasOwnProperty.call(rules, content.rule) ? rules[content.rule] : undefined;
  return rule && rule.table.rows.length === KASUS_GENDERS.length ? rule : undefined;
}

/** Statistics: one row per variant (each variant is its own exercise) over the Kasus dataset. */
export function kasusStats(registry: ItemExerciseRegistry, records: readonly RecordedLearningFact[], context: ReplayContext): Record<KasusVariant, ExerciseSummary> {
  const progress = projectExerciseProgress(records, context);
  return Object.fromEntries(KASUS_VARIANTS.map(variant => [variant, summarizeExercise(registry, KASUS_EXERCISE[variant], KASUS_DATASET.datasetId, progress)])) as Record<KasusVariant, ExerciseSummary>;
}
/** This item's own record in its exercise: answers so far and how many were right on the first try. */
export function itemStats(records: readonly RecordedLearningFact[], context: ReplayContext, task: ItemExerciseTask): { readonly tasks: number; readonly independentCorrect: number } {
  const own = projectExerciseProgress(records, context).items
    .find(p => p.exerciseId === task.exerciseId && p.datasetId === task.target.datasetId && p.itemId === task.target.itemId);
  return { tasks: own?.tasks ?? 0, independentCorrect: own?.independentCorrect ?? 0 };
}
