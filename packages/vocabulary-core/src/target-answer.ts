import type { Word } from './content.js';
import type { Evaluation, JsonValue } from './exercise.js';

export const TARGET_NORMALIZATION_VERSION = 'latin-production/1';
export const MAX_ANSWER_LENGTH = 256;

/** Only presentation whitespace and canonical Unicode equivalence are spelling-neutral. */
export const spellingForm = (value: string): string => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
/** Macrons and breves only mark vowel length: ordinary Latin text omits them, so they never decide spelling. */
const dropLength = (value: string): string => spellingForm(value).normalize('NFD').replace(/[\u0304\u0306]/gu, '').normalize('NFC');
const articlePrefix = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/iu;
/** Latin tolerance: case, u/v, i/j and ligatures. No edit distance, stemming or punctuation removal. */
const recallForm = (value: string): string => dropLength(value).toLowerCase()
  .replace(/j/g, 'i').replace(/v/g, 'u').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
function forms(word: Word): string[] {
  return [word.lemma, ...word.acceptedForms].map(value => {
    const form = spellingForm(value);
    return word.partOfSpeech === 'noun' && word.article ? form.replace(articlePrefix, '') : form;
  }).filter(Boolean);
}

/** Shared production policy; callers supply the pinned published catalog, never live UI data. */
export function evaluateTargetProduction(word: Word, raw: JsonValue, withArticle: boolean,
  catalog: readonly Word[]): Evaluation {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_ANSWER_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) {
    throw new RangeError('Invalid text answer');
  }
  if (withArticle && (word.partOfSpeech !== 'noun' || !word.article)) throw new RangeError('Article is inapplicable');
  const text = spellingForm(raw);
  const article = withArticle ? articlePrefix.exec(text)?.[1]?.toLowerCase() : undefined;
  const lexical = withArticle ? text.replace(articlePrefix, '') : text;
  const accepted = forms(word);
  const exact = accepted.some(form => dropLength(form) === dropLength(lexical));
  // A tolerant spelling must not turn another published lexeme into this target.
  const otherLexeme = !exact && catalog.some(candidate => candidate.id !== word.id && forms(candidate).some(form => form.toLowerCase() === lexical.toLowerCase()));
  const recalled = exact || (!otherLexeme && accepted.some(form => recallForm(form) === recallForm(lexical)));
  const components: Evaluation['components'] = {
    recall: recalled ? 'correct' : 'incorrect',
    spelling: recalled ? exact ? 'correct' : 'incorrect' : 'unobserved',
    ...(withArticle ? { article: recalled ? article === word.article ? 'correct' : 'incorrect' : 'unobserved' } : {}),
  };
  return { outcome: recalled && exact && (!withArticle || article === word.article) ? 'correct' : 'incorrect',
    source: 'automatic', components };
}
