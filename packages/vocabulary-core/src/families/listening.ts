import type { BuildContext, JsonValue } from '../exercise.js';
import type { ItemExerciseDefinition, LearningItem } from '../item-exercises.js';
import { buildSentenceExercise, evaluateSentenceTokens, sentenceContent } from './sentences.js';
import { videoSegmentContent } from './video.js';

/** M2 (#334): listening (FC04). The sentence corpus with audio as the prompt: assemble the
 * heard sentence from tokens (the shared sentence check) or type it (the v1 dictation rule).
 * The audio source is part of the exercise, so video segments (M6 #338) pass their own.
 * Separate exercise IDs keep listening statistics apart from assembly of the same sentence. */
export type ListeningMode = 'tokens' | 'text';
export interface ListeningExercise {
  readonly mode: ListeningMode;
  /** What is played. Never rendered as text before the answer. */
  readonly audio: { readonly text: string; readonly lang: 'de' };
  /** Video segments (M6 #338): the clip that is the prompt; `audio` stays the spoken fallback. */
  readonly media?: { readonly kind: 'youtube'; readonly videoId: string; readonly start: number; readonly end: number };
  readonly tokens?: readonly { readonly id: string; readonly text: string }[];
  readonly target: string;
  readonly alternatives: readonly string[];
  /** Shown only after the answer, as in v1. */
  readonly translation?: { readonly text: string; readonly lang: string };
  readonly explanation?: string;
}

/** v1 dictation rule: case, punctuation and spacing are neutral; letters (umlauts, ß) and digits count. */
export const listeningForm = (value: string): string => value.normalize('NFC').trim()
  .replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/gu, ' ').toLowerCase();
export function isListeningTextCorrect(answer: string, target: string, alternatives: readonly string[] = []): boolean {
  const given = listeningForm(answer);
  return given.length > 0 && [target, ...alternatives].some(accepted => listeningForm(accepted) === given);
}

export function buildListeningExercise(item: LearningItem, context: BuildContext, mode: ListeningMode,
  audio?: ListeningExercise['audio']): ListeningExercise {
  const content = sentenceContent(item.content);
  if (!content) throw new RangeError(`${item.id}: not a sentence`);
  const translation = content.translations[context.answerLanguage];
  // The sentence builder needs a prompt; here the "prompt" is the audio, the translation is a later hint.
  const built = buildSentenceExercise(item, context, { text: content.target, lang: 'de' });
  const clip = videoSegmentContent(item.content)?.video;
  return { mode, audio: audio ?? { text: content.target, lang: 'de' },
    ...(clip ? { media: { kind: 'youtube' as const, videoId: clip.videoId, start: clip.start, end: clip.end } } : {}),
    ...(mode === 'tokens' ? { tokens: built.tokens } : {}),
    target: content.target, alternatives: content.alternatives,
    ...(translation ? { translation: { text: translation, lang: context.answerLanguage } } : {}),
    ...(content.explanation ? { explanation: content.explanation } : {}) };
}

const MAX_TEXT = 500;
export function evaluateListening(exercise: JsonValue, answer: JsonValue): 'correct' | 'incorrect' {
  const value = exercise as unknown as ListeningExercise;
  if (value?.mode === 'tokens') return evaluateSentenceTokens(exercise, answer);
  if (value?.mode !== 'text' || typeof value.target !== 'string' || !Array.isArray(value.alternatives)) throw new RangeError('Invalid listening exercise');
  if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_TEXT || /[\u0000-\u001f\u007f-\u009f]/u.test(answer)) throw new RangeError('Invalid text answer');
  return isListeningTextCorrect(answer, value.target, value.alternatives) ? 'correct' : 'incorrect';
}

function definition(mode: ListeningMode): ItemExerciseDefinition {
  return Object.freeze({
    id: `listening-${mode}`, version: `listening-${mode}/1`, targetKinds: Object.freeze(['sentence', 'video-segment'] as const),
    input: mode === 'tokens' ? 'tokens' as const : 'text' as const, source: 'automatic' as const,
    isApplicable: (item: LearningItem) => sentenceContent(item.content) !== null,
    build: (item: LearningItem, context: BuildContext): JsonValue => buildListeningExercise(item, context, mode) as unknown as JsonValue,
    evaluate: (_item: LearningItem, exercise: JsonValue, answer: JsonValue) => evaluateListening(exercise, answer),
  });
}
export const LISTENING_TOKENS: ItemExerciseDefinition = definition('tokens');
export const LISTENING_TEXT: ItemExerciseDefinition = definition('text');
