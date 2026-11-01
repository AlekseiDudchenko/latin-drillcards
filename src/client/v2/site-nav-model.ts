import type { Lang } from '../i18n.js';

/** Site structure of v2 (DOM-free): five sections, and the hub pages that list their exercises. */
export type SectionId = 'today' | 'words' | 'practice' | 'video' | 'progress';
export type Labels = Record<Lang, string>;

export interface Section { readonly id: SectionId; readonly page: string; readonly pages: readonly string[]; readonly label: Labels }

/** `page` is the section's landing page; `pages` are all files that highlight it. */
export const SECTIONS: readonly Section[] = [
  { id: 'today', page: 'today.html', pages: ['today'], label: { ru: 'Сегодня', en: 'Today', de: 'Heute' } },
  { id: 'words', page: 'session.html', pages: ['session'], label: { ru: 'Слова', en: 'Words', de: 'Wörter' } },
  { id: 'practice', page: 'practice.html', pages: ['practice', 'sentences', 'listening', 'gaps', 'kasus', 'konjunktiv2', 'redemittel'],
    label: { ru: 'Практика', en: 'Practice', de: 'Üben' } },
  { id: 'video', page: 'video.html', pages: ['video'], label: { ru: 'Видео', en: 'Video', de: 'Video' } },
  { id: 'progress', page: 'progress.html', pages: ['progress', 'level-test'], label: { ru: 'Прогресс', en: 'Progress', de: 'Fortschritt' } },
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
          hint: { ru: 'Расставьте слова по порядку; уровни и грамматические темы', en: 'Put the words in order; levels and grammar topics', de: 'Wörter ordnen; Niveaus und Grammatikthemen' } }] },
      { id: 'listening', title: { ru: 'Аудирование', en: 'Listening', de: 'Hören' }, items: [
        { href: './listening.html', title: { ru: 'Аудирование', en: 'Listening', de: 'Hören' },
          hint: { ru: 'Услышьте предложение и восстановите его на слух', en: 'Hear a sentence and write it from memory', de: 'Einen Satz hören und aufschreiben' } }] },
      { id: 'grammar', title: { ru: 'Грамматика', en: 'Grammar', de: 'Grammatik' }, items: [
        { href: './kasus.html', title: { ru: 'Аккузатив или датив?', en: 'Accusative or dative?', de: 'Akkusativ oder Dativ?' },
          hint: { ru: 'Артикль, падеж и вопрос к фразе', en: 'Article, case and the question to ask', de: 'Artikel, Kasus und Frage' } },
        { href: './konjunktiv2.html', title: { ru: 'Konjunktiv II', en: 'Konjunktiv II', de: 'Konjunktiv II' },
          hint: { ru: 'Четыре тренажёра: формы, условия, вежливые просьбы, прошедшее', en: 'Four trainers: forms, conditions, polite requests, past', de: 'Vier Trainer: Formen, Bedingungen, Höflichkeit, Vergangenheit' } },
        { href: './gaps.html', title: { ru: 'Пропуски: относительные местоимения и Passiv', en: 'Gaps: relative pronouns and Passiv', de: 'Lücken: Relativpronomen · Passiv' },
          hint: { ru: 'Вставьте пропущенную форму', en: 'Fill in the missing form', de: 'Die fehlende Form einsetzen' } }] },
      { id: 'phrases', title: { ru: 'Фразы', en: 'Phrases', de: 'Phrasen' }, items: [
        { href: './redemittel.html', title: { ru: 'Redemittel', en: 'Redemittel', de: 'Redemittel' },
          hint: { ru: 'Вспомните готовую фразу по значению и оцените себя', en: 'Recall a set phrase from its meaning and rate yourself', de: 'Eine feste Wendung aus der Bedeutung abrufen' } }] },
    ],
  },
  progress: {
    id: 'progress', title: labelOf('progress'),
    groups: [
      { id: 'level', title: { ru: 'Уровень', en: 'Level', de: 'Niveau' }, items: [
        { href: './level-test.html', title: { ru: 'Тест уровня', en: 'Level test', de: 'Einstufungstest' },
          hint: { ru: 'Четыре блока по 10 слов, A1 → B2: узнайте, с какой колоды начать', en: 'Four blocks of 10 words, A1 → B2: find the deck to start with', de: 'Vier Blöcke mit je 10 Wörtern, A1 → B2: der passende Einstieg' } }] },
      { id: 'words', title: { ru: 'Слова', en: 'Words', de: 'Wörter' }, items: [
        { href: './session.html', title: { ru: 'Мои слова', en: 'My words', de: 'Meine Wörter' },
          hint: { ru: 'Колоды A1–B2 и прогресс по каждому слову', en: 'Decks A1–B2 and progress for every word', de: 'Decks A1–B2 und der Fortschritt je Wort' } }] },
    ],
  },
};
