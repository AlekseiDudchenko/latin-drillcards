import type { BuildContext, JsonValue } from '../exercise.js';
// Types only: item-exercises.ts registers these definitions, so a value import would be circular.
import type { ItemExerciseDefinition, LearningItem } from '../item-exercises.js';

/** M4 (#336): Kasus (FC07), accusative or dative in three variants on the shared inputs.
 * `article` fills the one `___` of the sentence on ClozeInput (one choice slot); `case` and
 * `question` choose for the highlighted phrase (`focus`) on ChoiceInput. Each variant is its
 * own exercise, so filters and statistics are per variant over the one Kasus dataset.
 * The rule (`rule`, a key of the shared rule tables) and `gender` (the table row) explain the answer.
 */
export const KASUS_VARIANTS = Object.freeze(['article', 'case', 'question'] as const);
export type KasusVariant = typeof KASUS_VARIANTS[number];
export const KASUS_GENDERS = Object.freeze(['m', 'f', 'n', 'pl'] as const);
export type KasusGender = typeof KASUS_GENDERS[number];
export const KASUS_GAP = '___';
export const KASUS_SLOT = 'slot-1';
type Trilingual = { readonly de: string; readonly ru: string; readonly en: string };

export interface KasusContent {
  readonly variant: KasusVariant;
  /** German sentence; an `article` sentence has exactly one `___`, the others none. */
  readonly sentence: string;
  /** `case`/`question`: the phrase the task is about, verbatim in the sentence. */
  readonly focus?: string;
  /** Options in the source order; the task shows them in a per-task order. */
  readonly options: readonly string[];
  readonly answer: string;
  readonly case: 'akkusativ' | 'dativ';
  /** Key of the rule (explanation, table, examples) this answer rests on. */
  readonly rule: string;
  /** Gender/number of the noun: the row of the rule table that decides this task. */
  readonly gender: KasusGender;
  /** Why this answer is right, for this sentence. */
  readonly explanation: Trilingual;
  readonly translations: { readonly en: string; readonly ru: string };
  readonly level: string;
}
export type KasusOption = { readonly id: string; readonly label: string };
/** `article`: the cloze part of the task (ClozeInput); the answer is `{ "slot-1": optionId }`. */
export interface KasusArticleExercise {
  readonly template: string;
  readonly slots: readonly [{ readonly slotId: typeof KASUS_SLOT; readonly input: 'choice'; readonly options: readonly KasusOption[] }];
  readonly answers: readonly [readonly [string]];
}
/** `case`/`question`: the choice part of the task (ChoiceInput); the answer is an option ID. */
export interface KasusChoiceExercise {
  readonly prompt: { readonly text: string; readonly lang: 'de'; readonly focus: string };
  readonly options: readonly KasusOption[];
  readonly correctOptionId: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const trilingual = (value: unknown): value is Trilingual => record(value) && text(value.de) && text(value.ru) && text(value.en);
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
export const kasusGapCount = (sentence: string): number => sentence.split(KASUS_GAP).length - 1;

/** Content check shared by the definitions and the dataset converter; null when unusable. */
export function kasusContent(content: JsonValue): KasusContent | null {
  if (!record(content) || !(KASUS_VARIANTS as readonly unknown[]).includes(content.variant) || !text(content.sentence) ||
      !Array.isArray(content.options) || content.options.length < 2 || !content.options.every(text) ||
      new Set(content.options).size !== content.options.length || !text(content.answer) || !content.options.includes(content.answer) ||
      (content.case !== 'akkusativ' && content.case !== 'dativ') || !text(content.rule) ||
      !(KASUS_GENDERS as readonly unknown[]).includes(content.gender) || !trilingual(content.explanation) ||
      !record(content.translations) || !text(content.translations.en) || !text(content.translations.ru) || !text(content.level)) return null;
  const gaps = kasusGapCount(content.sentence);
  if (content.variant === 'article' ? gaps !== 1 || content.focus !== undefined
    : gaps !== 0 || !text(content.focus) || !content.sentence.includes(content.focus)) return null;
  return content as unknown as KasusContent;
}

/** Per-task option order (v1 shuffled on every render): deterministic for the seed and task. */
function ordered(content: KasusContent, item: LearningItem, context: BuildContext): KasusOption[] {
  const key = JSON.stringify([context.seed, context.taskId, item.id]);
  return [...content.options].sort((a, b) => hash(`${key}:${a}`) - hash(`${key}:${b}`) || (a < b ? -1 : 1)).map(label => ({ id: label, label }));
}
const options = (value: unknown): value is KasusOption[] => Array.isArray(value) && value.length >= 2 &&
  value.every(o => record(o) && text(o.id) && o.label === o.id) && new Set(value.map(o => (o as KasusOption).id)).size === value.length;
function sameOptions(content: KasusContent, built: readonly KasusOption[]): boolean {
  return built.length === content.options.length && built.every(option => content.options.includes(option.id));
}

/** The grade of a stored or submitted answer: the chosen option and whether it is the item's answer.
 * Throws RangeError for a malformed answer or a task that does not belong to the item, never for a wrong one. */
export function gradeKasusAnswer(item: LearningItem, exercise: JsonValue, answer: JsonValue): { readonly chosen: string; readonly correct: boolean } {
  const content = kasusContent(item.content);
  if (!content || !record(exercise)) throw new RangeError('Invalid Kasus task');
  let chosen: unknown; let built: unknown;
  if (content.variant === 'article') {
    const slots = exercise.slots;
    if (exercise.template !== content.sentence || !Array.isArray(slots) || slots.length !== 1 || !record(slots[0]) ||
        slots[0].slotId !== KASUS_SLOT || slots[0].input !== 'choice') throw new RangeError('Invalid Kasus task');
    if (!record(answer) || Object.keys(answer).length !== 1) throw new RangeError('Invalid Kasus answer');
    built = slots[0].options; chosen = answer[KASUS_SLOT];
  } else {
    if (!record(exercise.prompt) || exercise.prompt.text !== content.sentence || exercise.prompt.focus !== content.focus) throw new RangeError('Invalid Kasus task');
    built = exercise.options; chosen = answer;
  }
  if (!options(built) || !sameOptions(content, built)) throw new RangeError('Invalid Kasus task');
  if (typeof chosen !== 'string' || !built.some(option => option.id === chosen)) throw new RangeError('Unknown Kasus option');
  return { chosen, correct: chosen === content.answer };
}

function definition(variant: KasusVariant): ItemExerciseDefinition {
  const article = variant === 'article';
  return Object.freeze({
    id: `kasus-${variant}`, version: `kasus-${variant}/1`, targetKinds: Object.freeze(['grammar-item'] as const),
    input: article ? 'cloze' as const : 'choice' as const, source: 'automatic' as const,
    isApplicable: (item: LearningItem) => kasusContent(item.content)?.variant === variant,
    build(item: LearningItem, context: BuildContext): JsonValue {
      const content = kasusContent(item.content)!;
      const choices = ordered(content, item, context);
      return article
        ? { template: content.sentence, slots: [{ slotId: KASUS_SLOT, input: 'choice', options: choices }], answers: [[content.answer]] }
        : { prompt: { text: content.sentence, lang: 'de', focus: content.focus! }, options: choices, correctOptionId: content.answer };
    },
    evaluate: (item: LearningItem, exercise: JsonValue, answer: JsonValue) => gradeKasusAnswer(item, exercise, answer).correct ? 'correct' : 'incorrect',
  });
}
export const KASUS_ARTICLE: ItemExerciseDefinition = definition('article');
export const KASUS_CASE: ItemExerciseDefinition = definition('case');
export const KASUS_QUESTION: ItemExerciseDefinition = definition('question');
export const KASUS_EXERCISE: Readonly<Record<KasusVariant, `kasus-${KasusVariant}`>> =
  Object.freeze({ article: 'kasus-article', case: 'kasus-case', question: 'kasus-question' });
