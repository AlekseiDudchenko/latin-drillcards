import type { BuildContext, JsonValue } from '../exercise.js';
import { MAX_GERMAN_ANSWER_LENGTH } from '../german-answer.js';
// Types only: item-exercises.ts registers these definitions, so a value import would be circular.
import type { ItemExerciseDefinition, LearningItem } from '../item-exercises.js';
import { sentenceTokenOrder } from './sentences.js';

/** M5 (#337): the four Konjunktiv II trainers (FC08) on the shared item contracts. One item is one
 * sentence with `(verb) ___` gaps; it is answered by typing (TextInput) or by placing chips from a
 * pool with distractors (TokenInput). Each trainer and mode is its own definition, so statistics,
 * selection and a later rule change stay per trainer. The check rules are the v1 ones:
 * case, punctuation and spacing are neutral; conditional sentences typed by hand need the comma
 * between their two forms, while chips cannot place a comma and are compared without it. */
export const KONJUNKTIV2_TRAINERS = Object.freeze(['transformation', 'conditional', 'polite', 'past'] as const);
export type Konjunktiv2Trainer = typeof KONJUNKTIV2_TRAINERS[number];
export const KONJUNKTIV2_MODES = Object.freeze(['text', 'tokens'] as const);
export type Konjunktiv2Mode = typeof KONJUNKTIV2_MODES[number];

export interface Konjunktiv2Content {
  readonly trainer: Konjunktiv2Trainer;
  /** v1 sentence: every `___` is a gap, preceded by the verb to put into Konjunktiv II in brackets. */
  readonly template: string;
  /** Accepted answers; the first is the one shown. Several gaps are separated by a comma. */
  readonly answers: readonly string[];
  /** Chips of the token mode, distractors included; the first answer can always be built from them. */
  readonly tokens: readonly string[];
  /** v1 hint shown with the feedback, e.g. "reisen → würde … reisen". */
  readonly hint: string;
  /** The complete German sentence with the first answer, for speech. */
  readonly solution: string;
}
export interface Konjunktiv2Exercise {
  readonly trainer: Konjunktiv2Trainer;
  readonly template: string;
  readonly answers: readonly string[];
  /** Token mode only: chips in display order, deterministic per seed and item. IDs are source positions. */
  readonly tokens?: readonly { readonly id: string; readonly text: string }[];
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text);
const isTrainer = (value: unknown): value is Konjunktiv2Trainer => (KONJUNKTIV2_TRAINERS as readonly unknown[]).includes(value);

/** v1 comparison form. `comma` keeps commas (spacing around them is neutral); `plain` drops all punctuation. */
export function konjunktiv2Form(value: string, rule: 'plain' | 'comma'): string {
  const lower = value.normalize('NFC').toLowerCase();
  const kept = rule === 'comma' ? lower.replace(/[^a-zäöüß0-9\s,]/gu, '').replace(/\s*,\s*/gu, ', ') : lower.replace(/[^a-zäöüß0-9\s]/gu, '');
  return kept.replace(/\s+/gu, ' ').trim();
}
export const konjunktiv2Rule = (trainer: Konjunktiv2Trainer, mode: Konjunktiv2Mode): 'plain' | 'comma' =>
  trainer === 'conditional' && mode === 'text' ? 'comma' : 'plain';
export function isKonjunktiv2Correct(trainer: Konjunktiv2Trainer, mode: Konjunktiv2Mode, answer: string, accepted: readonly string[]): boolean {
  const rule = konjunktiv2Rule(trainer, mode);
  const given = konjunktiv2Form(answer, rule);
  return given.length > 0 && accepted.some(form => konjunktiv2Form(form, rule) === given);
}
/** True when `answer` can be laid out from the chips (each chip used once). */
export function buildableFromTokens(answer: string, tokens: readonly string[]): boolean {
  const pool = tokens.map(token => konjunktiv2Form(token, 'plain'));
  return konjunktiv2Form(answer, 'plain').split(' ').every(word => {
    const index = pool.indexOf(word);
    if (index < 0) return false;
    pool.splice(index, 1); return true;
  });
}

/** Structural check of a Konjunktiv II item, or null. */
export function konjunktiv2Content(content: JsonValue): Konjunktiv2Content | null {
  if (!record(content) || !isTrainer(content.trainer) || !text(content.template) || !texts(content.answers) || !texts(content.tokens) ||
      !text(content.hint) || !text(content.solution) || !content.template.includes('___') || content.solution.includes('___')) return null;
  if (!buildableFromTokens(content.answers[0] as string, content.tokens as string[])) return null;
  return content as unknown as Konjunktiv2Content;
}
function exerciseOf(value: JsonValue, trainer: Konjunktiv2Trainer, mode: Konjunktiv2Mode): Konjunktiv2Exercise | null {
  if (!record(value) || value.trainer !== trainer || !text(value.template) || !texts(value.answers)) return null;
  if (mode === 'text') return value.tokens === undefined ? value as unknown as Konjunktiv2Exercise : null;
  if (!Array.isArray(value.tokens) || !value.tokens.length || !value.tokens.every(token => record(token) && text(token.id) && text(token.text)) ||
      new Set(value.tokens.map(token => (token as { id: string }).id)).size !== value.tokens.length) return null;
  return value as unknown as Konjunktiv2Exercise;
}

/** The answer as text: typed (text mode) or the placed chips joined by spaces (token mode).
 * Throws RangeError for a malformed answer, never for a wrong one. */
export function konjunktiv2AnswerText(exercise: Konjunktiv2Exercise, mode: Konjunktiv2Mode, answer: JsonValue): string {
  if (mode === 'text') {
    if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_GERMAN_ANSWER_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(answer))
      throw new RangeError('Invalid text answer');
    return answer;
  }
  const tokens = new Map(exercise.tokens!.map(token => [token.id, token.text]));
  if (!Array.isArray(answer) || !answer.length || answer.length > tokens.size || new Set(answer).size !== answer.length ||
      !answer.every(id => typeof id === 'string' && tokens.has(id))) throw new RangeError('Invalid token answer');
  return (answer as string[]).map(id => tokens.get(id)!).join(' ');
}

function definition(trainer: Konjunktiv2Trainer, mode: Konjunktiv2Mode): ItemExerciseDefinition {
  const id = konjunktiv2ExerciseId(trainer, mode);
  return Object.freeze({
    id, version: `${id}/1`, targetKinds: Object.freeze(['grammar-item'] as const), input: mode, source: 'automatic' as const,
    isApplicable: (item: LearningItem) => konjunktiv2Content(item.content)?.trainer === trainer,
    build(item: LearningItem, context: BuildContext): JsonValue {
      const content = konjunktiv2Content(item.content)!;
      const base = { trainer, template: content.template, answers: [...content.answers] };
      if (mode === 'text') return base;
      // Keyed by seed and item (as sentences): a retry with the same seed shows the same chip order.
      const order = sentenceTokenOrder(content.tokens, JSON.stringify([context.seed, item.id]));
      return { ...base, tokens: order.map(index => ({ id: `t${index}`, text: content.tokens[index]! })) };
    },
    evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue) {
      const content = konjunktiv2Content(item.content); const built = exerciseOf(exercise, trainer, mode);
      if (!content || !built || built.template !== content.template) throw new RangeError('Invalid Konjunktiv II task');
      return isKonjunktiv2Correct(trainer, mode, konjunktiv2AnswerText(built, mode, answer), content.answers) ? 'correct' : 'incorrect';
    },
  });
}
export const konjunktiv2ExerciseId = (trainer: Konjunktiv2Trainer, mode: Konjunktiv2Mode): string => `konjunktiv2-${trainer}-${mode}`;
/** All eight definitions: four trainers × text/tokens. */
export const KONJUNKTIV2_EXERCISES: readonly ItemExerciseDefinition[] = Object.freeze(
  KONJUNKTIV2_TRAINERS.flatMap(trainer => KONJUNKTIV2_MODES.map(mode => definition(trainer, mode))));
