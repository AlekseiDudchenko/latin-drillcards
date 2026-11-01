import type { Word, TranslationLanguage } from '../../../packages/vocabulary-core/dist/index.js';
import type { CardUiTranslations } from '../i18n.js';
import { element } from './card-inputs.js';

/** Published content only; no fetches, grading, progress writes or arbitrary HTML. */
export function WordDetails(word: Word, language: TranslationLanguage, labels: CardUiTranslations, showHeadword = true): HTMLElement {
  const root = element('section', undefined, 'dc-word-details');
  root.setAttribute('aria-label', labels.wordDetails);
  if (showHeadword) { const title = element('h3', [word.article, word.lemma].filter(Boolean).join(' ')); title.lang = 'de'; root.append(title); }
  const meaning = element('p', word.meanings[language]?.preferred ?? labels.missingTranslation); meaning.lang = language; root.append(meaning);
  if (word.examples.length) root.append(element('h4', labels.examples));
  for (const example of word.examples) {
    const block = element('blockquote');
    const de = element('p', example.de); de.lang = 'de'; block.append(de);
    if (example.translations[language]) {
      const translation = element('p', example.translations[language]); translation.lang = language; block.append(translation);
    }
    root.append(block);
  }
  return root;
}
