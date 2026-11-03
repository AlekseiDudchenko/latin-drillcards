import type { BuildContext, JsonValue } from '../exercise.js';
import type { ItemExerciseDefinition, LearningItem } from '../item-exercises.js';

/** M1 (#333): sentence assembly (FC03) on the shared item contracts. The same content and
 * adapter serve audio (M2 #334) and video sentences (M6 #338): they add their own prompt
 * (audio, segment) and reuse the token answer, alternatives and check.
 * Only type imports from item-exercises: that module registers this adapter (no import cycle). */
export interface SentenceContent {
  /** v1 deck the sentence came from: a1…c2, beruf, arch. */
  readonly deck: string;
  readonly level: string;
  readonly tags: readonly string[];
  readonly target: string;
  readonly tokens: readonly string[];
  /** Other correct orders; the target is always correct. */
  readonly alternatives: readonly string[];
  readonly translations: Readonly<Partial<Record<'ru' | 'en' | 'de' | 'es', string>>>;
  readonly explanation?: string;
  /** The same statement in another word order (v1 `variant_of`). */
  readonly variantOf?: string;
  /** Tense label and the IDs of the sentence's tense family, in display order. */
  readonly tense?: string;
  readonly tenseVariants?: readonly string[];
}
export interface SentenceExercise {
  readonly prompt: { readonly text: string; readonly lang: string };
  /** Display order, deterministic per task. IDs are positions in the source tokens. */
  readonly tokens: readonly { readonly id: string; readonly text: string }[];
  readonly target: string;
  readonly alternatives: readonly string[];
  readonly explanation?: string;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

/** Structural check of a sentence item's content, or null. */
export function sentenceContent(content: JsonValue): SentenceContent | null {
  if (!record(content) || !text(content.deck) || !text(content.level) || !text(content.target) ||
      !Array.isArray(content.tokens) || !content.tokens.length || !content.tokens.every(text) ||
      !Array.isArray(content.tags) || !content.tags.every(text) || !Array.isArray(content.alternatives) || !content.alternatives.every(text) ||
      !record(content.translations) || !Object.entries(content.translations).every(([lang, value]) => ['ru', 'en', 'de', 'es'].includes(lang) && text(value)) ||
      (content.explanation !== undefined && !text(content.explanation)) || (content.variantOf !== undefined && !text(content.variantOf)) ||
      (content.tense !== undefined && !text(content.tense)) ||
      (content.tenseVariants !== undefined && (!Array.isArray(content.tenseVariants) || !content.tenseVariants.every(text)))) return null;
  return content as unknown as SentenceContent;
}

/** v1 rule: whitespace and a final . ? ! are neutral; everything else (case, commas, order) counts. */
export const sentenceForm = (value: string): string => value.normalize('NFC').trim().replace(/\s+/gu, ' ').replace(/[.?!]\s*$/u, '');
export function isSentenceCorrect(answer: string, target: string, alternatives: readonly string[] = []): boolean {
  const given = sentenceForm(answer);
  return [target, ...alternatives].some(accepted => sentenceForm(accepted) === given);
}

/** Deterministic shuffle that never shows the solution order (when there is more than one token). */
export function sentenceTokenOrder(tokens: readonly string[], key: string): number[] {
  const order = tokens.map((_, index) => index).sort((a, b) => hash(`${key}:${a}`) - hash(`${key}:${b}`) || a - b);
  const solved = order.map(i => tokens[i]).join(' ') === tokens.join(' ');
  return solved && tokens.length > 1 ? [...order.slice(1), order[0]!] : order;
}

/** Build the card part of a sentence task: a translation prompt (or a family's own prompt) and shuffled tokens. */
export function buildSentenceExercise(item: LearningItem, context: BuildContext,
  prompt?: SentenceExercise['prompt']): SentenceExercise {
  const content = sentenceContent(item.content);
  if (!content) throw new RangeError(`${item.id}: not a sentence`);
  const translation = content.translations[context.answerLanguage];
  const shown = prompt ?? (translation ? { text: translation, lang: context.answerLanguage } : undefined);
  if (!shown) throw new RangeError(`${item.id}: missing ${context.answerLanguage} translation`);
  // Keyed by seed and item, not task: a retry with the same seed shows the same order (v1 reset).
  const order = sentenceTokenOrder(content.tokens, JSON.stringify([context.seed, item.id]));
  return { prompt: shown, tokens: order.map(i => ({ id: `t${i}`, text: content.tokens[i]! })), target: content.target,
    alternatives: content.alternatives, ...(content.explanation ? { explanation: content.explanation } : {}) };
}

/** The answer is the placed token IDs in order; it is checked as text against the target and alternatives. */
export function evaluateSentenceTokens(exercise: JsonValue, answer: JsonValue): 'correct' | 'incorrect' {
  if (!record(exercise) || !Array.isArray(exercise.tokens) || !text(exercise.target) || !Array.isArray(exercise.alternatives)) throw new RangeError('Invalid sentence exercise');
  const tokens = new Map((exercise.tokens as { id: string; text: string }[]).map(token => [token.id, token.text]));
  if (!Array.isArray(answer) || !answer.length || answer.length > tokens.size || new Set(answer).size !== answer.length ||
      !answer.every(id => typeof id === 'string' && tokens.has(id))) throw new RangeError('Invalid token answer');
  return isSentenceCorrect((answer as string[]).map(id => tokens.get(id)!).join(' '), exercise.target, exercise.alternatives as string[]) ? 'correct' : 'incorrect';
}

export const SENTENCE_ASSEMBLY: ItemExerciseDefinition = Object.freeze({
  id: 'sentence-assembly', version: 'sentence-assembly/1', targetKinds: Object.freeze(['sentence', 'video-segment'] as const),
  input: 'tokens', source: 'automatic',
  isApplicable: (item: LearningItem, context: BuildContext) => !!sentenceContent(item.content)?.translations[context.answerLanguage],
  build: (item: LearningItem, context: BuildContext): JsonValue => buildSentenceExercise(item, context) as unknown as JsonValue,
  evaluate: (_item: LearningItem, exercise: JsonValue, answer: JsonValue) => evaluateSentenceTokens(exercise, answer),
});
