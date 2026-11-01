import type { Lang } from '../i18n.js';

/** Site structure of v2 (DOM-free): five sections, and the hub pages that list their exercises. */
export type SectionId = 'today' | 'words' | 'practice' | 'progress';
export type Labels = Record<Lang, string>;

export interface Section { readonly id: SectionId; readonly page: string; readonly pages: readonly string[]; readonly label: Labels }

/** `page` is the section's landing page; `pages` are all files that highlight it. */
export const SECTIONS: readonly Section[] = [
  { id: 'today', page: 'today.html', pages: ['today'], label: { ru: 'Сегодня', en: 'Today', de: 'Heute' } },
  { id: 'words', page: 'session.html', pages: ['session'], label: { ru: 'Слова', en: 'Words', de: 'Wörter' } },
  { id: 'practice', page: 'practice.html', pages: ['practice', 'sentences'],
    label: { ru: 'Практика', en: 'Practice', de: 'Üben' } },
  { id: 'progress', page: 'progress.html', pages: ['progress'], label: { ru: 'Прогресс', en: 'Progress', de: 'Fortschritt' } },
];

const labelOf = (id: SectionId): Labels => SECTIONS.find(section => section.id === id)!.label;

export const NAV_LABEL: Labels = { ru: 'Разделы', en: 'Sections', de: 'Bereiche' };

/** `/v2/session`, `/v2/session.html` and `./session.html` are one page (the worker serves both spellings). */
export function pageName(pathname: string): string {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  return last.replace(/\.html$/, '');
}

export function sectionFor(pathname: string): SectionId | undefined {
  const name = pageName(pathname);
  return SECTIONS.find(section => section.pages.includes(name))?.id;
}

export interface HubItem { readonly href: string; readonly title: Labels; readonly hint: Labels }
export interface HubGroup { readonly id: string; readonly title: Labels; readonly items: readonly HubItem[] }
export interface Hub { readonly id: 'practice' | 'progress'; readonly title: Labels; readonly groups: readonly HubGroup[] }

export const HUBS: Readonly<Record<Hub['id'], Hub>> = {
  practice: {
    id: 'practice', title: labelOf('practice'),
    groups: [
      { id: 'sentences', title: { ru: 'Предложения', en: 'Sentences', de: 'Sätze' }, items: [
        { href: './sentences.html', title: { ru: 'Сборка предложений', en: 'Sentence building', de: 'Satzbau' },
          hint: { ru: 'Расставьте слова по порядку; колоды и грамматические темы', en: 'Put the words in order; decks and grammar topics', de: 'Wörter ordnen; Decks und Grammatikthemen' } }] },
    ],
  },
  progress: {
    id: 'progress', title: labelOf('progress'),
    groups: [
      { id: 'words', title: { ru: 'Слова', en: 'Words', de: 'Wörter' }, items: [
        { href: './session.html', title: { ru: 'Мои слова', en: 'My words', de: 'Meine Wörter' },
          hint: { ru: 'Колоды уроков и прогресс по каждому слову', en: 'Lesson decks and progress for every word', de: 'Lektionsdecks und der Fortschritt je Wort' } }] },
    ],
  },
};
