import type { Lang } from '../../../i18n.js';
import type { PhraseDeck, PhraseRating } from '../../core/index.js';

/** The Redemittel page's own keys (M7, #339); shared session and card labels come from i18n.ts. */
export interface RedemittelUiTranslations {
  title: string; deck: string; decks: Record<PhraseDeck, string>; start: string; empty: string;
  continueTitle: string; continueLine: string; continue: string;
  statsTitle: string; statsLine: string; statsLineNone: string; subjective: string;
  cardTitle: string; keyboard: string; rated: Record<PhraseRating, string>; autoSpeak: string;
  detailsTitle: string; translationIn: string; deckLabel: string;
  summaryTitle: string; summaryLine: string; unrated: string;
}

const EN: RedemittelUiTranslations = {
  title: 'Redemittel', deck: 'Deck', decks: { beruf: 'Speaking gambits', daily: 'Daily stand-up phrases' }, start: 'Start',
  empty: 'This deck has no phrases.', continueTitle: 'Unfinished session', continueLine: '{deck} · phrase {n} of {total}', continue: 'Continue',
  statsTitle: 'Your statistics', statsLine: '{rated} of {applicable} phrases rated · last rating: remembered {remembered}, not remembered {forgotten}',
  statsLineNone: 'No ratings yet ({applicable} phrases)',
  subjective: 'Self-assessment: you rate yourself; nothing is checked automatically.',
  cardTitle: 'Recall the German phrase', keyboard: 'Keys: Space or Enter shows the phrase, 1 — didn\'t remember, 2 — remembered.',
  rated: { remembered: 'Your rating: remembered (self-assessment)', forgotten: 'Your rating: didn\'t remember (self-assessment)' },
  autoSpeak: 'Speak the phrase when it is shown', detailsTitle: 'About the phrase', translationIn: 'Translation ({lang})', deckLabel: 'Deck',
  summaryTitle: 'Session summary', summaryLine: 'Remembered (self-assessment): {remembered} of {total}', unrated: 'not rated',
};
const RU: RedemittelUiTranslations = {
  title: 'Redemittel', deck: 'Набор', decks: { beruf: 'Речевые клише', daily: 'Фразы для дейли' }, start: 'Начать',
  empty: 'В этом наборе нет фраз.', continueTitle: 'Незаконченная сессия', continueLine: '{deck} · фраза {n} из {total}', continue: 'Продолжить',
  statsTitle: 'Ваша статистика', statsLine: 'Оценено {rated} из {applicable} фраз · последняя оценка: помню {remembered}, не помню {forgotten}',
  statsLineNone: 'Оценок ещё нет ({applicable} фраз)',
  subjective: 'Самооценка: вы оцениваете себя сами, автоматической проверки нет.',
  cardTitle: 'Вспомните фразу по-немецки', keyboard: 'Клавиши: пробел или Enter — показать фразу, 1 — не помню, 2 — помню.',
  rated: { remembered: 'Ваша оценка: помню (самооценка)', forgotten: 'Ваша оценка: не помню (самооценка)' },
  autoSpeak: 'Озвучивать фразу при показе', detailsTitle: 'О фразе', translationIn: 'Перевод ({lang})', deckLabel: 'Набор',
  summaryTitle: 'Итоги сессии', summaryLine: 'Помню (самооценка): {remembered} из {total}', unrated: 'без оценки',
};
const DE: RedemittelUiTranslations = {
  title: 'Redemittel', deck: 'Set', decks: { beruf: 'Redemittel', daily: 'Redemittel fürs Daily' }, start: 'Starten',
  empty: 'Dieses Set enthält keine Redemittel.', continueTitle: 'Nicht beendete Sitzung', continueLine: '{deck} · Redemittel {n} von {total}', continue: 'Fortsetzen',
  statsTitle: 'Deine Statistik', statsLine: '{rated} von {applicable} Redemitteln bewertet · letzte Bewertung: gewusst {remembered}, nicht gewusst {forgotten}',
  statsLineNone: 'Noch keine Bewertungen ({applicable} Redemittel)',
  subjective: 'Selbsteinschätzung: Du bewertest dich selbst, nichts wird automatisch geprüft.',
  cardTitle: 'Erinnere dich an die deutsche Wendung', keyboard: 'Tasten: Leertaste oder Enter zeigt die Wendung, 1 — nicht gewusst, 2 — gewusst.',
  rated: { remembered: 'Deine Bewertung: gewusst (Selbsteinschätzung)', forgotten: 'Deine Bewertung: nicht gewusst (Selbsteinschätzung)' },
  autoSpeak: 'Wendung beim Aufdecken vorlesen', detailsTitle: 'Zur Wendung', translationIn: 'Übersetzung ({lang})', deckLabel: 'Set',
  summaryTitle: 'Zusammenfassung', summaryLine: 'Gewusst (Selbsteinschätzung): {remembered} von {total}', unrated: 'nicht bewertet',
};
const TABLES: Record<Lang, RedemittelUiTranslations> = { en: EN, ru: RU, de: DE };
export const redemittelUiTranslations = (lang: Lang): RedemittelUiTranslations => TABLES[lang];
/** Placeholder substitution without String.replace patterns ($&, $', …) in values. */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
