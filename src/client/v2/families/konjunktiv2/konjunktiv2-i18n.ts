import type { Lang } from '../../../i18n.js';
import type { Konjunktiv2Mode, Konjunktiv2Trainer } from '../../core/index.js';

/** Konjunktiv II (M5 / #337) labels. Kept with the family; every key exists in EN, RU and DE. */
export interface Konjunktiv2UiTranslations {
  title: string; interfaceLanguage: string; trainer: string; trainers: Record<Konjunktiv2Trainer, string>;
  /** Card titles: what to do, per trainer and mode (the v1 task hints). */
  tasks: Record<Konjunktiv2Trainer, Record<Konjunktiv2Mode, string>>;
  mode: string; modes: Record<Konjunktiv2Mode, string>; modeLater: string;
  next: string; previous: string; tryAgain: string; retrySave: string; autoSpeak: string;
  correct: string; wrong: string; hint: string; alternatives: string;
  itemStats: string; itemNew: string; trainerStats: string; trainerStatsNone: string;
  noData: string; loadError: string; saveError: string; keyboard: string;
}
const EN: Konjunktiv2UiTranslations = {
  title: 'Konjunktiv II', interfaceLanguage: 'Interface language', trainer: 'Trainer',
  trainers: { transformation: 'Transform', conditional: 'Conditional sentences', polite: 'Polite forms', past: 'Unreal past' },
  tasks: {
    transformation: { text: 'Put the verb in Konjunktiv II form.', tokens: 'Build the Konjunktiv II form from the words.' },
    conditional: { text: 'Fill in both Konjunktiv II forms (comma-separated).', tokens: 'Place both Konjunktiv II forms in order.' },
    polite: { text: 'Put the verb into the polite Konjunktiv II form.', tokens: 'Choose the polite Konjunktiv II form.' },
    past: { text: 'Form the Konjunktiv II Perfekt (e.g. gewusst hätte).', tokens: 'Build the Konjunktiv II Perfekt (e.g. gewusst hätte).' },
  },
  mode: 'Mode', modes: { text: 'Type', tokens: 'Words' }, modeLater: 'The new mode starts with the next sentence.',
  next: 'Next', previous: 'Previous', tryAgain: 'Try again', retrySave: 'Save again', autoSpeak: 'Read aloud after a correct answer',
  correct: 'Correct!', wrong: 'Not quite. Correct: {answer}', hint: 'Hint: {hint}', alternatives: 'Also correct: {forms}',
  itemStats: 'This sentence: {answers} answers, {independent} right on the first try', itemNew: 'This sentence: not answered yet',
  trainerStats: '{mode}: {attempted} of {total} answered, accuracy {accuracy}', trainerStatsNone: '{mode}: no answers yet ({total} sentences)',
  noData: 'No sentences in this trainer.', loadError: 'The sentences could not be loaded.', saveError: 'The answer was not saved.',
  keyboard: '← previous · → next · Enter: check, then next',
};
const RU: Konjunktiv2UiTranslations = {
  title: 'Konjunktiv II', interfaceLanguage: 'Язык интерфейса', trainer: 'Тренажёр',
  trainers: { transformation: 'Трансформация', conditional: 'Условные предложения', polite: 'Вежливые формы', past: 'Нереальное прошлое' },
  tasks: {
    transformation: { text: 'Поставь глагол в Konjunktiv II.', tokens: 'Собери форму Konjunktiv II из слов.' },
    conditional: { text: 'Заполни обе формы Konjunktiv II (через запятую).', tokens: 'Расставь обе формы Konjunktiv II по порядку.' },
    polite: { text: 'Поставь глагол в вежливую форму Konjunktiv II.', tokens: 'Выбери вежливую форму Konjunktiv II.' },
    past: { text: 'Образуй Konjunktiv II Perfekt (напр. gewusst hätte).', tokens: 'Собери Konjunktiv II Perfekt (напр. gewusst hätte).' },
  },
  mode: 'Режим', modes: { text: 'Ввод', tokens: 'Слова' }, modeLater: 'Новый режим начнётся со следующего предложения.',
  next: 'Дальше', previous: 'Назад', tryAgain: 'Ещё раз', retrySave: 'Сохранить ещё раз', autoSpeak: 'Озвучивать после правильного ответа',
  correct: 'Верно!', wrong: 'Не совсем. Правильно: {answer}', hint: 'Подсказка: {hint}', alternatives: 'Тоже верно: {forms}',
  itemStats: 'Это предложение: ответов {answers}, с первой попытки {independent}', itemNew: 'Это предложение: ещё без ответа',
  trainerStats: '{mode}: отвечено {attempted} из {total}, точность {accuracy}', trainerStatsNone: '{mode}: ещё нет ответов ({total} предложений)',
  noData: 'В этом тренажёре нет предложений.', loadError: 'Не удалось загрузить предложения.', saveError: 'Ответ не сохранён.',
  keyboard: '← назад · → дальше · Enter: проверить, затем дальше',
};
const DE: Konjunktiv2UiTranslations = {
  title: 'Konjunktiv II', interfaceLanguage: 'Sprache der Oberfläche', trainer: 'Trainer',
  trainers: { transformation: 'Umformung', conditional: 'Bedingungssätze', polite: 'Höflichkeitsformen', past: 'Irreale Vergangenheit' },
  tasks: {
    transformation: { text: 'Setze das Verb in den Konjunktiv II.', tokens: 'Bilde die Konjunktiv-II-Form aus den Wörtern.' },
    conditional: { text: 'Fülle beide Konjunktiv-II-Formen aus (kommagetrennt).', tokens: 'Lege beide Konjunktiv-II-Formen in der richtigen Reihenfolge.' },
    polite: { text: 'Setze das Verb in die höfliche Konjunktiv-II-Form.', tokens: 'Wähle die höfliche Konjunktiv-II-Form.' },
    past: { text: 'Bilde den Konjunktiv II Perfekt (z.B. gewusst hätte).', tokens: 'Lege den Konjunktiv II Perfekt (z.B. gewusst hätte).' },
  },
  mode: 'Modus', modes: { text: 'Tippen', tokens: 'Wörter' }, modeLater: 'Der neue Modus gilt ab dem nächsten Satz.',
  next: 'Weiter', previous: 'Zurück', tryAgain: 'Noch einmal', retrySave: 'Erneut speichern', autoSpeak: 'Nach richtiger Antwort vorlesen',
  correct: 'Richtig!', wrong: 'Nicht ganz. Richtig: {answer}', hint: 'Hinweis: {hint}', alternatives: 'Auch richtig: {forms}',
  itemStats: 'Dieser Satz: {answers} Antworten, {independent} beim ersten Versuch richtig', itemNew: 'Dieser Satz: noch nicht beantwortet',
  trainerStats: '{mode}: {attempted} von {total} beantwortet, Genauigkeit {accuracy}', trainerStatsNone: '{mode}: noch keine Antworten ({total} Sätze)',
  noData: 'Keine Sätze in diesem Trainer.', loadError: 'Die Sätze konnten nicht geladen werden.', saveError: 'Die Antwort wurde nicht gespeichert.',
  keyboard: '← zurück · → weiter · Enter: prüfen, dann weiter',
};
const TABLES: Record<Lang, Konjunktiv2UiTranslations> = { en: EN, ru: RU, de: DE };
export const konjunktiv2UiTranslations = (lang: Lang): Konjunktiv2UiTranslations => TABLES[lang];
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
