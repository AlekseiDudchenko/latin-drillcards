import type { Lang } from '../../../i18n.js';
import type { KasusVariant } from '../../core/index.js';
import type { KasusFilter } from './kasus-model.js';

/** The Kasus family's own keys (M4, #336); shared session and card labels come from i18n.ts. */
export interface KasusUiTranslations {
  title: string; filter: string; filters: Record<KasusFilter, string>; taskTitles: Record<KasusVariant, string>;
  start: string; empty: string; continueTitle: string; continueLine: string; continue: string;
  statsTitle: string; statsLine: string; statsLineNone: string; itemStats: string; itemNew: string;
  correct: string; wrong: string; explanationTitle: string; translation: string; listen: string;
  ruleOpen: string; ruleClose: string; ruleRow: string; examples: string;
  previous: string; backToCurrent: string; reviewing: string; summaryTitle: string; summaryLine: string; unanswered: string; keyboard: string;
}

const EN: KasusUiTranslations = {
  title: 'Accusative or dative?', filter: 'Tasks', filters: { all: 'All', article: 'Article', case: 'Case', question: 'Question' },
  taskTitles: { article: 'Which article fits in the gap?', case: 'Which case is the highlighted phrase in?',
    question: 'Which question does the highlighted phrase answer?' },
  start: 'Start', empty: 'No tasks for this filter.', continueTitle: 'Unfinished session', continueLine: '{filter} · task {n} of {total}', continue: 'Continue',
  statsTitle: 'Your statistics', statsLine: '{variant}: {attempted} of {applicable} sentences · first-try accuracy {accuracy}',
  statsLineNone: '{variant}: no answers yet ({applicable} sentences)', itemStats: 'This sentence: {answers} answers, {independent} right on the first try',
  itemNew: 'This sentence: first answer', correct: 'Correct!', wrong: 'Wrong. Correct: {answer}', explanationTitle: 'Why',
  translation: 'Translation', listen: 'Listen in German', ruleOpen: 'Rule', ruleClose: 'Close', ruleRow: 'the row for this task', examples: 'Examples',
  previous: 'Previous', backToCurrent: 'Back to the current task', reviewing: 'Reviewing task {n} (already saved)',
  summaryTitle: 'Session summary', summaryLine: 'Correct: {correct} of {total}', unanswered: 'not answered',
  keyboard: 'Keys: 1–4 choose · Enter checks · → next · ← previous · Esc closes the rule',
};
const RU: KasusUiTranslations = {
  title: 'Аккузатив или датив?', filter: 'Задания', filters: { all: 'Все', article: 'Артикль', case: 'Падеж', question: 'Вопрос' },
  taskTitles: { article: 'Какой артикль подходит в пропуск?', case: 'В каком падеже выделенная группа слов?',
    question: 'На какой вопрос отвечает выделенная группа слов?' },
  start: 'Начать', empty: 'Нет заданий для этого фильтра.', continueTitle: 'Незаконченная сессия', continueLine: '{filter} · задание {n} из {total}', continue: 'Продолжить',
  statsTitle: 'Ваша статистика', statsLine: '{variant}: {attempted} из {applicable} предложений · верно с первой попытки {accuracy}',
  statsLineNone: '{variant}: ответов ещё нет ({applicable} предложений)', itemStats: 'Это предложение: ответов {answers}, верно с первой попытки {independent}',
  itemNew: 'Это предложение: первый ответ', correct: 'Правильно!', wrong: 'Неверно. Правильно: {answer}', explanationTitle: 'Почему',
  translation: 'Перевод', listen: 'Прослушать по-немецки', ruleOpen: 'Правило', ruleClose: 'Закрыть', ruleRow: 'строка этого задания', examples: 'Примеры',
  previous: 'Назад', backToCurrent: 'К текущему заданию', reviewing: 'Просмотр задания {n} (ответ уже сохранён)',
  summaryTitle: 'Итоги сессии', summaryLine: 'Верно: {correct} из {total}', unanswered: 'без ответа',
  keyboard: 'Клавиши: 1–4 выбор · Enter проверить · → дальше · ← назад · Esc закрывает правило',
};
const DE: KasusUiTranslations = {
  title: 'Akkusativ oder Dativ?', filter: 'Aufgaben', filters: { all: 'Alle', article: 'Artikel', case: 'Kasus', question: 'Frage' },
  taskTitles: { article: 'Welcher Artikel passt in die Lücke?', case: 'In welchem Kasus steht die markierte Wortgruppe?',
    question: 'Auf welche Frage antwortet die markierte Wortgruppe?' },
  start: 'Starten', empty: 'Keine Aufgaben für diesen Filter.', continueTitle: 'Nicht beendete Sitzung', continueLine: '{filter} · Aufgabe {n} von {total}', continue: 'Fortsetzen',
  statsTitle: 'Deine Statistik', statsLine: '{variant}: {attempted} von {applicable} Sätzen · beim ersten Versuch richtig {accuracy}',
  statsLineNone: '{variant}: noch keine Antworten ({applicable} Sätze)', itemStats: 'Dieser Satz: {answers} Antworten, {independent} beim ersten Versuch richtig',
  itemNew: 'Dieser Satz: erste Antwort', correct: 'Richtig!', wrong: 'Falsch. Richtig: {answer}', explanationTitle: 'Warum',
  translation: 'Übersetzung', listen: 'Auf Deutsch anhören', ruleOpen: 'Regel', ruleClose: 'Schließen', ruleRow: 'die Zeile dieser Aufgabe', examples: 'Beispiele',
  previous: 'Zurück', backToCurrent: 'Zur aktuellen Aufgabe', reviewing: 'Ansicht von Aufgabe {n} (Antwort gespeichert)',
  summaryTitle: 'Zusammenfassung', summaryLine: 'Richtig: {correct} von {total}', unanswered: 'nicht beantwortet',
  keyboard: 'Tasten: 1–4 wählen · Enter prüft · → weiter · ← zurück · Esc schließt die Regel',
};
const TABLES: Record<Lang, KasusUiTranslations> = { en: EN, ru: RU, de: DE };
export const kasusUiTranslations = (lang: Lang): KasusUiTranslations => TABLES[lang];
/** Placeholder substitution without String.replace patterns ($&, $', …) in values. */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
