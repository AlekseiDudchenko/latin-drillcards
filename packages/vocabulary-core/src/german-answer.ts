import type { Word } from './content.js';
import type { Evaluation, JsonValue } from './exercise.js';

export const GERMAN_NORMALIZATION_VERSION = 'german-production/1';
export const MAX_GERMAN_ANSWER_LENGTH = 256;

/** Only presentation whitespace and canonical Unicode equivalence are spelling-neutral. */
export const germanSpellingForm = (value: string): string => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
const articlePrefix = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/iu;
/** No edit distance, accent removal, stemming or arbitrary punctuation removal. */
const recallForm = (value: string): string => germanSpellingForm(value).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
function forms(word: Word): string[] {
  return [word.lemma, ...word.acceptedGermanForms].map(value => {
    const form = germanSpellingForm(value);
    return word.partOfSpeech === 'noun' ? form.replace(articlePrefix, '') : form;
  }).filter(Boolean);
}

/** Shared production policy; callers supply the pinned published catalog, never live UI data. */
export function evaluateGermanProduction(word: Word, raw: JsonValue, withArticle: boolean,
  catalog: readonly Word[]): Evaluation {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_GERMAN_ANSWER_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) {
    throw new RangeError('Invalid German text answer');
  }
  if (withArticle && (word.partOfSpeech !== 'noun' || !word.article)) throw new RangeError('Article is inapplicable');
  const text = germanSpellingForm(raw);
  const article = withArticle ? articlePrefix.exec(text)?.[1]?.toLowerCase() : undefined;
  const lexical = withArticle ? text.replace(articlePrefix, '') : text;
  const accepted = forms(word);
  const exact = accepted.includes(lexical);
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
