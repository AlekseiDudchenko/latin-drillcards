import type { Lang } from '../../../i18n.js';
import type { PassivTense } from '../../core/index.js';
import type { GapFamily, GapMode } from './gaps-model.js';

/** The gap family's own keys (M3, #335); shared session and card labels come from i18n.ts. */
export interface GapsUiTranslations {
  title: string; family: string; families: Record<GapFamily, string>; taskTitles: Record<GapFamily, string>;
  mode: string; modes: Record<GapMode, string>; tense: string; allTenses: string; start: string; empty: string;
  continueTitle: string; continueLine: string; continue: string; statsTitle: string; statsLine: string; statsLineNone: string;
  hint: string; hintAnswer: string; explanationTitle: string; relativeRule: string; passivRules: Record<PassivTense, string>;
  translation: string; listen: string; autoSpeak: string; variantsTitle: string; variantCurrent: string;
  previous: string; backToCurrent: string; reviewing: string; summaryTitle: string; summaryLine: string; unanswered: string;
}

const EN: GapsUiTranslations = {
  title: 'Gaps', family: 'Topic', families: { relative: 'Relative pronouns', passiv: 'Passive: auxiliary verbs' },
  taskTitles: { relative: 'Type the missing relative pronoun', passiv: 'Fill in the auxiliary verbs of the passive' },
  mode: 'Mode', modes: { select: 'Select', type: 'Type' }, tense: 'Tense', allTenses: 'All tenses (linked variants in a row)',
  start: 'Start', empty: 'No tasks match this filter.', continueTitle: 'Unfinished session', continueLine: '{family} · task {n} of {total}',
  continue: 'Continue', statsTitle: 'Your statistics', statsLine: '{mode}: {attempted} of {applicable} sentences · first-try accuracy {accuracy}',
  statsLineNone: '{mode}: no answers yet ({applicable} sentences)', hint: 'Show answer', hintAnswer: 'Answer: {answer}', explanationTitle: 'Rule',
  relativeRule: 'Gender and number come from the noun the pronoun refers to; the case comes from its role in the relative clause.',
  passivRules: { 'Präs.': 'Present: werden (wird/werden) + Partizip II.', 'Prät.': 'Simple past: wurde/wurden + Partizip II.',
    'Perf.': 'Present perfect: sein (ist/sind) + Partizip II + worden.', 'Plusq.': 'Past perfect: war/waren + Partizip II + worden.',
    'Fut. I': 'Future I: werden (wird/werden) + Partizip II + werden.' },
  translation: 'Translation ({lang})', listen: 'Listen in German', autoSpeak: 'Speak automatically', variantsTitle: 'The same sentence in other tenses',
  variantCurrent: 'this task', previous: 'Previous', backToCurrent: 'Back to the current task', reviewing: 'Reviewing task {n} (already saved)',
  summaryTitle: 'Session summary', summaryLine: 'Correct: {correct} of {total}', unanswered: 'not answered',
};
const RU: GapsUiTranslations = {
  title: 'Пропуски', family: 'Тема', families: { relative: 'Относительные местоимения', passiv: 'Passiv: вспомогательные глаголы' },
  taskTitles: { relative: 'Впишите относительное местоимение', passiv: 'Вставьте вспомогательные глаголы пассива' },
  mode: 'Режим', modes: { select: 'Выбор', type: 'Ввод' }, tense: 'Время', allTenses: 'Все времена (варианты одного предложения подряд)',
  start: 'Начать', empty: 'Нет заданий для этого фильтра.', continueTitle: 'Незаконченная сессия', continueLine: '{family} · задание {n} из {total}',
  continue: 'Продолжить', statsTitle: 'Ваша статистика', statsLine: '{mode}: {attempted} из {applicable} предложений · верно с первой попытки {accuracy}',
  statsLineNone: '{mode}: ответов ещё нет ({applicable} предложений)', hint: 'Показать ответ', hintAnswer: 'Ответ: {answer}', explanationTitle: 'Правило',
  relativeRule: 'Род и число — как у существительного, к которому относится местоимение; падеж — по его роли в придаточном предложении.',
  passivRules: { 'Präs.': 'Präsens: werden (wird/werden) + Partizip II.', 'Prät.': 'Präteritum: wurde/wurden + Partizip II.',
    'Perf.': 'Perfekt: sein (ist/sind) + Partizip II + worden.', 'Plusq.': 'Plusquamperfekt: war/waren + Partizip II + worden.',
    'Fut. I': 'Futur I: werden (wird/werden) + Partizip II + werden.' },
  translation: 'Перевод ({lang})', listen: 'Прослушать по-немецки', autoSpeak: 'Озвучивать автоматически', variantsTitle: 'То же предложение в других временах',
  variantCurrent: 'это задание', previous: 'Назад', backToCurrent: 'К текущему заданию', reviewing: 'Просмотр задания {n} (ответ уже сохранён)',
  summaryTitle: 'Итоги сессии', summaryLine: 'Верно: {correct} из {total}', unanswered: 'без ответа',
};
const DE: GapsUiTranslations = {
  title: 'Lücken', family: 'Thema', families: { relative: 'Relativpronomen', passiv: 'Passiv: Hilfsverben' },
  taskTitles: { relative: 'Setze das Relativpronomen ein', passiv: 'Setze die Hilfsverben des Passivs ein' },
  mode: 'Modus', modes: { select: 'Auswahl', type: 'Eingabe' }, tense: 'Zeitform', allTenses: 'Alle Zeitformen (Varianten eines Satzes nacheinander)',
  start: 'Starten', empty: 'Keine Aufgaben für diesen Filter.', continueTitle: 'Nicht beendete Sitzung', continueLine: '{family} · Aufgabe {n} von {total}',
  continue: 'Fortsetzen', statsTitle: 'Deine Statistik', statsLine: '{mode}: {attempted} von {applicable} Sätzen · beim ersten Versuch richtig {accuracy}',
  statsLineNone: '{mode}: noch keine Antworten ({applicable} Sätze)', hint: 'Antwort zeigen', hintAnswer: 'Antwort: {answer}', explanationTitle: 'Regel',
  relativeRule: 'Genus und Numerus richten sich nach dem Bezugswort, der Kasus nach der Funktion im Relativsatz.',
  passivRules: { 'Präs.': 'Präsens: werden (wird/werden) + Partizip II.', 'Prät.': 'Präteritum: wurde/wurden + Partizip II.',
    'Perf.': 'Perfekt: sein (ist/sind) + Partizip II + worden.', 'Plusq.': 'Plusquamperfekt: war/waren + Partizip II + worden.',
    'Fut. I': 'Futur I: werden (wird/werden) + Partizip II + werden.' },
  translation: 'Übersetzung ({lang})', listen: 'Auf Deutsch anhören', autoSpeak: 'Automatisch vorlesen', variantsTitle: 'Derselbe Satz in anderen Zeitformen',
  variantCurrent: 'diese Aufgabe', previous: 'Zurück', backToCurrent: 'Zur aktuellen Aufgabe', reviewing: 'Ansicht von Aufgabe {n} (Antwort gespeichert)',
  summaryTitle: 'Zusammenfassung', summaryLine: 'Richtig: {correct} von {total}', unanswered: 'nicht beantwortet',
};
const TABLES: Record<Lang, GapsUiTranslations> = { en: EN, ru: RU, de: DE };
export const gapsUiTranslations = (lang: Lang): GapsUiTranslations => TABLES[lang];
/** Placeholder substitution without String.replace patterns ($&, $', …) in values. */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
