import type { Lang } from '../i18n.js';

/** Interface texts of the Today page; deck and continue texts come from the shared home translations. */
export interface TodayText {
  readonly title: string; readonly goal: string; readonly goalOf: string; readonly goalLeft: string; readonly goalDone: string;
  readonly streak: string; readonly best: string;
  readonly due: string; readonly dueNone: string; readonly review: string;
  readonly fresh: string; readonly freshLeft: string; readonly freshDone: string; readonly learn: string; readonly started: string;
  readonly practice: string; readonly decks: string; readonly dueBadge: string; readonly loadError: string; readonly finishError: string;
}
/** Count nouns by plural category (Intl.PluralRules): [one, few, many, other]. */
export interface Plurals { readonly day: readonly string[]; readonly word: readonly string[]; readonly answer: readonly string[] }

export const TODAY_TEXT: Record<Lang, TodayText> = {
  ru: { title: 'Сегодня', goal: 'Цель дня', goalOf: 'из {goal}', goalLeft: 'осталось {n}', goalDone: 'Цель выполнена',
    streak: 'Серия', best: 'Рекорд: {n}', due: 'К повторению', dueNone: 'Пока нечего повторять', review: 'Повторить',
    fresh: 'Новые слова · колода {deck}', freshLeft: '{n} доступно', freshDone: 'Все слова начаты', learn: 'Учить новые',
    started: 'Начато {started} из {total}', practice: 'Практика', decks: 'Колоды', dueBadge: '{n} к повторению',
    loadError: 'Не удалось загрузить данные. Обновите страницу.', finishError: 'Не удалось завершить сессию. Попробуйте ещё раз.' },
  en: { title: 'Today', goal: 'Daily goal', goalOf: 'of {goal}', goalLeft: '{n} to go', goalDone: 'Goal reached',
    streak: 'Streak', best: 'Best: {n}', due: 'Due for review', dueNone: 'Nothing to review yet', review: 'Review',
    fresh: 'New words · deck {deck}', freshLeft: '{n} available', freshDone: 'Every word started', learn: 'Learn new',
    started: 'Started {started} of {total}', practice: 'Practice', decks: 'Decks', dueBadge: '{n} due',
    loadError: 'Could not load your data. Reload the page.', finishError: 'Could not finish the session. Try again.' },
  de: { title: 'Heute', goal: 'Tagesziel', goalOf: 'von {goal}', goalLeft: 'noch {n}', goalDone: 'Ziel erreicht',
    streak: 'Serie', best: 'Rekord: {n}', due: 'Zu wiederholen', dueNone: 'Noch nichts zu wiederholen', review: 'Wiederholen',
    fresh: 'Neue Wörter · Deck {deck}', freshLeft: '{n} verfügbar', freshDone: 'Alle Wörter begonnen', learn: 'Neue lernen',
    started: '{started} von {total} begonnen', practice: 'Üben', decks: 'Decks', dueBadge: '{n} fällig',
    loadError: 'Die Daten konnten nicht geladen werden. Seite neu laden.', finishError: 'Die Sitzung konnte nicht beendet werden. Bitte erneut versuchen.' },
};

export const TODAY_PLURALS: Record<Lang, Plurals> = {
  ru: { day: ['день', 'дня', 'дней', 'дня'], word: ['слово', 'слова', 'слов', 'слова'], answer: ['ответ', 'ответа', 'ответов', 'ответа'] },
  en: { day: ['day', 'days', 'days', 'days'], word: ['word', 'words', 'words', 'words'], answer: ['answer', 'answers', 'answers', 'answers'] },
  de: { day: ['Tag', 'Tage', 'Tage', 'Tage'], word: ['Wort', 'Wörter', 'Wörter', 'Wörter'], answer: ['Antwort', 'Antworten', 'Antworten', 'Antworten'] },
};

const CATEGORY: Record<string, number> = { one: 0, few: 1, many: 2, other: 3 };

/** "6 дней", "1 day", "3 Wörter". */
export function count(lang: Lang, n: number, noun: keyof Plurals): string {
  return `${n} ${TODAY_PLURALS[lang][noun][CATEGORY[new Intl.PluralRules(lang).select(n)] ?? 3]}`;
}

/** Placeholder substitution without String.replace patterns in the values. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
