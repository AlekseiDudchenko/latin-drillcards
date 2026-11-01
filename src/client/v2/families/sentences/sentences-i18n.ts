import type { Lang } from '../../../i18n.js';

/** Sentence builder (M1 / #333) labels. Kept with the family; every key exists in EN, RU and DE. */
export interface SentenceUiTranslations {
  title: string; interfaceLanguage: string; translation: string; deck: string; allLevels: string; topic: string; allTopics: string;
  next: string; previous: string; variant: string; tryAgain: string; tenses: string; autoSpeak: string; otherTranslations: string;
  correct: string; wrong: string; explanation: string; sentenceStats: string; sentenceNew: string; poolStats: string;
  noData: string; loadError: string; saveError: string; retrySave: string; keyboard: string; level: string;
}
const EN: SentenceUiTranslations = {
  title: 'Sentence builder', interfaceLanguage: 'Interface language', translation: 'Translation language', deck: 'Deck', allLevels: 'All decks',
  topic: 'Topic', allTopics: 'All topics', next: 'Next', previous: 'Previous', variant: 'Other word order', tryAgain: 'Try again',
  tenses: 'Tenses', autoSpeak: 'Read aloud after a correct answer', otherTranslations: 'Other translations', correct: 'Correct!',
  wrong: 'Not quite. Correct: {target}', explanation: 'Explanation', sentenceStats: 'This sentence: {answers} answers, {independent} right on the first try',
  sentenceNew: 'This sentence: not answered yet', poolStats: 'This set: {attempted} of {total} sentences answered, accuracy {accuracy}',
  noData: 'No sentences for this filter.', loadError: 'Sentences could not be loaded.', saveError: 'The answer was not saved.', retrySave: 'Save again',
  keyboard: '← previous · → next · Enter: next', level: 'Deck {level}',
};
const RU: SentenceUiTranslations = {
  title: 'Сборка предложений', interfaceLanguage: 'Язык интерфейса', translation: 'Язык перевода', deck: 'Колода', allLevels: 'Все колоды',
  topic: 'Тема', allTopics: 'Все темы', next: 'Дальше', previous: 'Назад', variant: 'Другой порядок слов', tryAgain: 'Ещё раз',
  tenses: 'Времена', autoSpeak: 'Озвучивать после правильного ответа', otherTranslations: 'Другие переводы', correct: 'Верно!',
  wrong: 'Не совсем. Правильно: {target}', explanation: 'Объяснение', sentenceStats: 'Это предложение: ответов {answers}, с первой попытки {independent}',
  sentenceNew: 'Это предложение: ещё без ответа', poolStats: 'Этот набор: отвечено {attempted} из {total}, точность {accuracy}',
  noData: 'Для этого фильтра нет предложений.', loadError: 'Не удалось загрузить предложения.', saveError: 'Ответ не сохранён.', retrySave: 'Сохранить ещё раз',
  keyboard: '← назад · → дальше · Enter: дальше', level: 'Колода {level}',
};
const DE: SentenceUiTranslations = {
  title: 'Sätze bauen', interfaceLanguage: 'Sprache der Oberfläche', translation: 'Übersetzungssprache', deck: 'Deck', allLevels: 'Alle Decks',
  topic: 'Thema', allTopics: 'Alle Themen', next: 'Weiter', previous: 'Zurück', variant: 'Andere Wortstellung', tryAgain: 'Noch einmal',
  tenses: 'Zeitformen', autoSpeak: 'Nach richtiger Antwort vorlesen', otherTranslations: 'Weitere Übersetzungen', correct: 'Richtig!',
  wrong: 'Nicht ganz. Richtig: {target}', explanation: 'Erklärung', sentenceStats: 'Dieser Satz: {answers} Antworten, {independent} beim ersten Versuch richtig',
  sentenceNew: 'Dieser Satz: noch nicht beantwortet', poolStats: 'Diese Auswahl: {attempted} von {total} Sätzen beantwortet, Genauigkeit {accuracy}',
  noData: 'Keine Sätze für diesen Filter.', loadError: 'Die Sätze konnten nicht geladen werden.', saveError: 'Die Antwort wurde nicht gespeichert.', retrySave: 'Erneut speichern',
  keyboard: '← zurück · → weiter · Enter: weiter', level: 'Deck {level}',
};
const TABLES: Record<Lang, SentenceUiTranslations> = { en: EN, ru: RU, de: DE };
export const sentenceUiTranslations = (lang: Lang): SentenceUiTranslations => TABLES[lang];
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
