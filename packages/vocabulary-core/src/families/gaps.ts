import type { BuildContext, JsonValue } from '../exercise.js';
import { germanSpellingForm, MAX_GERMAN_ANSWER_LENGTH } from '../german-answer.js';
// Types only: item-exercises.ts registers these definitions, so a value import would be circular.
import type { ItemExerciseDefinition, LearningItem } from '../item-exercises.js';

/** M3 (#335): gap sentences (FC05 relative pronouns, FC06 Passiv) on the shared ClozeInput.
 * One item is one sentence with one or more `___` gaps. The same item is practised by typing
 * (`gap-type`) or by choosing from chips (`gap-select`); a wrong slot makes the whole answer
 * incorrect, and the per-slot grading below is what the card shows.
 */
export const GAP_MARKER = '___';
export const PASSIV_TENSES = Object.freeze(['Präs.', 'Prät.', 'Perf.', 'Plusq.', 'Fut. I'] as const);
export type PassivTense = typeof PASSIV_TENSES[number];

export interface GapContent {
  /** German sentence; every `___` is one gap, numbered `slot-1`, `slot-2`, … from the left. */
  readonly template: string;
  /** Accepted forms per gap; the first one is the form shown as the answer. */
  readonly answers: readonly (readonly string[])[];
  /** Chips per gap in select mode, each list containing that gap's first accepted form. */
  readonly choices: readonly (readonly string[])[];
  readonly translations?: { readonly en: string; readonly ru: string };
  /** Passiv: the tense of this sentence and the item IDs of the same sentence in every tense (itself included). */
  readonly tense?: PassivTense;
  readonly tenseVariants?: readonly string[];
  readonly level?: string;
}
export type GapSlot = { readonly slotId: string; readonly input: 'text' } |
  { readonly slotId: string; readonly input: 'choice'; readonly options: readonly { readonly id: string; readonly label: string }[] };
/** The exercise part of a gap task: what the card shows and what is graded. */
export interface GapExercise {
  readonly template: string;
  readonly slots: readonly GapSlot[];
  readonly answers: readonly (readonly string[])[];
}
export type GapAnswer = Readonly<Record<string, string>>;
export interface GapGrade {
  readonly slots: Readonly<Record<string, 'correct' | 'incorrect'>>;
  readonly correct: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length;
/** Accepted-form comparison: Unicode/whitespace equivalence and case, as the v1 pages did. */
export const gapForm = (value: string): string => germanSpellingForm(value).toLowerCase();
export const gapSlotId = (index: number): string => `slot-${index + 1}`;
export const gapCount = (template: string): number => template.split(GAP_MARKER).length - 1;

/** Content check shared by both definitions and the dataset converter; null when unusable. */
export function gapContent(content: JsonValue): GapContent | null {
  if (!record(content) || !text(content.template) || !Array.isArray(content.answers) || !Array.isArray(content.choices)) return null;
  const count = gapCount(content.template);
  if (count < 1 || content.answers.length !== count || content.choices.length !== count) return null;
  if (!content.answers.every(texts) || !content.choices.every(texts)) return null;
  const answers = content.answers as string[][]; const choices = content.choices as string[][];
  if (!choices.every((options, index) => options.some(option => gapForm(option) === gapForm(answers[index]![0]!)))) return null;
  if (content.translations !== undefined && !(record(content.translations) && text(content.translations.en) && text(content.translations.ru))) return null;
  if (content.tense !== undefined && !(PASSIV_TENSES as readonly unknown[]).includes(content.tense)) return null;
  if (content.tenseVariants !== undefined && !texts(content.tenseVariants)) return null;
  if (content.level !== undefined && !text(content.level)) return null;
  return content as unknown as GapContent;
}
function gapExercise(value: JsonValue): GapExercise | null {
  if (!record(value) || !text(value.template) || !Array.isArray(value.slots) || !Array.isArray(value.answers)) return null;
  const count = gapCount(value.template);
  if (value.slots.length !== count || value.answers.length !== count || !value.answers.every(texts)) return null;
  const slots = value.slots as unknown[];
  if (!slots.every((slot, index) => record(slot) && slot.slotId === gapSlotId(index) && (slot.input === 'text' ||
      (slot.input === 'choice' && Array.isArray(slot.options) && slot.options.length >= 2 &&
        slot.options.every(o => record(o) && text(o.id) && o.label === o.id))))) return null;
  return value as unknown as GapExercise;
}

/** Per-slot grading against the item's accepted forms. Throws RangeError for a malformed answer
 * (missing/extra slots, empty or oversized text, an unknown chip), never for a wrong one. */
export function gradeGapAnswer(item: LearningItem, exercise: JsonValue, answer: JsonValue): GapGrade {
  const content = gapContent(item.content); const built = gapExercise(exercise);
  if (!content || !built || built.template !== content.template) throw new RangeError('Invalid gap task');
  if (!record(answer)) throw new RangeError('Invalid gap answer');
  const ids = built.slots.map(slot => slot.slotId);
  if (Object.keys(answer).length !== ids.length || !ids.every(id => Object.prototype.hasOwnProperty.call(answer, id))) throw new RangeError('Invalid gap answer');
  const slots: Record<string, 'correct' | 'incorrect'> = {};
  built.slots.forEach((slot, index) => {
    const value = answer[slot.slotId];
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_GERMAN_ANSWER_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(value))
      throw new RangeError('Invalid gap answer');
    if (slot.input === 'choice' && !slot.options.some(option => option.id === value)) throw new RangeError('Unknown gap option');
    slots[slot.slotId] = content.answers[index]!.some(accepted => gapForm(accepted) === gapForm(value)) ? 'correct' : 'incorrect';
  });
  return { slots, correct: Object.values(slots).every(outcome => outcome === 'correct') };
}

function definition(id: 'gap-type' | 'gap-select', input: 'text' | 'choice'): ItemExerciseDefinition {
  return Object.freeze({
    id, version: `${id}/1`, targetKinds: Object.freeze(['grammar-item'] as const), input: 'cloze' as const, source: 'automatic' as const,
    isApplicable: (item: LearningItem) => gapContent(item.content) !== null,
    // Chips keep the dataset order (as in v1), so the digit keys stay the same from task to task.
    build(item: LearningItem, _context: BuildContext): JsonValue {
      const content = gapContent(item.content)!;
      return { template: content.template, answers: content.answers.map(forms => [...forms]),
        slots: content.answers.map((_, index) => input === 'text' ? { slotId: gapSlotId(index), input }
          : { slotId: gapSlotId(index), input, options: content.choices[index]!.map(label => ({ id: label, label })) }) };
    },
    evaluate: (item: LearningItem, exercise: JsonValue, answer: JsonValue) => gradeGapAnswer(item, exercise, answer).correct ? 'correct' : 'incorrect',
  });
}
export const GAP_TYPE: ItemExerciseDefinition = definition('gap-type', 'text');
export const GAP_SELECT: ItemExerciseDefinition = definition('gap-select', 'choice');
export const GAP_EXERCISE_IDS = Object.freeze(['gap-select', 'gap-type'] as const);
export type GapExerciseId = typeof GAP_EXERCISE_IDS[number];
