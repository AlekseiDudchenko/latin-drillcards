import type { TranslationLanguage } from '../../../packages/vocabulary-core/dist/index.js';
import { cardUiTranslations, type Lang } from '../i18n.js';
import type { CardDefinition } from './card-shell.js';
import { answerTokens, arrangeTokens, shuffledOrder } from './token-state.js';

// Pure content → card mappings for the token-assembly families. Both feed the
// one shared TokenInput through CardShell; neither grades nor writes progress.
// `order` is the display permutation of the source tokens: pass the persisted
// one to restore a task, omit it to shuffle once when the task is created.

/** Sentence assembly (FC03) record as published in `sentences-<level>.json`. */
export interface SentenceSource {
  readonly id: string;
  readonly target: string;
  readonly tokens: readonly string[];
  readonly translation_en?: string;
  readonly translation_ru?: string;
}
/** Konjunktiv II (FC08) record as published in `konjunktiv2-<kind>.json`; tokens include distractors. */
export interface KonjunktivSource {
  readonly id: string;
  readonly sentence: string;
  readonly tokens?: readonly string[];
}

function titles(key: 'sentenceAssemblyTitle' | 'konjunktivTokenTitle'): Record<Lang, string> {
  return Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, cardUiTranslations(lang)[key]])) as Record<Lang, string>;
}

function tokensOf(prefix: string, texts: readonly string[] | undefined, order?: readonly number[]) {
  if (!texts?.length) throw new RangeError(`${prefix}: no tokens`);
  return arrangeTokens(answerTokens(prefix, texts), order ?? shuffledOrder(texts.length));
}

/** All source tokens make up the answer, so filling the answer checks it. */
export function sentenceAssemblyCard(item: SentenceSource, translationLanguage: TranslationLanguage, order?: readonly number[]): CardDefinition {
  const prompt = translationLanguage === 'ru' ? item.translation_ru : item.translation_en;
  if (!prompt?.trim()) throw new RangeError(`${item.id}: missing ${translationLanguage} translation`);
  return { id: `sentence:${item.id}`, title: titles('sentenceAssemblyTitle'), prompt: { text: prompt, lang: translationLanguage },
    input: { kind: 'tokens', answerLang: 'la', tokens: tokensOf(item.id, item.tokens, order), autoSubmit: true },
    translationLanguage, speechText: item.target };
}

/**
 * Distractors stay in the pool, so the answer is never "filled": the learner
 * checks explicitly. No speech: the prompt is a gapped sentence.
 */
export function konjunktivTokenCard(item: KonjunktivSource, translationLanguage: TranslationLanguage, order?: readonly number[]): CardDefinition {
  return { id: `konjunktiv2:${item.id}`, title: titles('konjunktivTokenTitle'), prompt: { text: item.sentence, lang: 'la' },
    input: { kind: 'tokens', answerLang: 'la', tokens: tokensOf(item.id, item.tokens, order), autoSubmit: false },
    translationLanguage };
}
