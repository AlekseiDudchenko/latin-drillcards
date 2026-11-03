import type { Lang } from '../i18n.js';
import { sessionUiTranslations } from '../i18n.js';
import { storedLanguage, storeLanguage } from './interface-language.js';
import { LEGAL, type LegalPageId, type Paragraph } from './legal-content.js';
import { mountSiteFooter } from './site-footer.js';
import { mountSiteNav } from './site-nav.js';

/** Privacy policy and terms of use (#408): one static text per interface language, linked from the site footer. */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const page = document.querySelector<HTMLElement>('main')!.dataset.legal as LegalPageId;
let language = storedLanguage();

function paragraph(parts: Paragraph): HTMLParagraphElement {
  const p = document.createElement('p');
  for (const part of parts) {
    if (typeof part === 'string') { p.append(part); continue; }
    const a = document.createElement('a'); a.href = part.href; a.textContent = part.text;
    if (/^https?:/.test(part.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    p.append(a);
  }
  return p;
}

function render(): void {
  const text = LEGAL[page][language];
  document.documentElement.lang = language;
  document.title = `Latin DrillCards · ${text.title}`;
  $('title').textContent = text.title;
  $('languageLabel').textContent = sessionUiTranslations(language).interfaceLanguage;
  const updated = document.createElement('p'); updated.className = 'dc-note'; updated.textContent = text.updated;
  const body = [updated, paragraph([text.intro])];
  for (const section of text.sections) {
    const heading = document.createElement('h2'); heading.textContent = section.title;
    body.push(heading, paragraph(section.body));
  }
  $('legal').replaceChildren(...body);
}

const select = $<HTMLSelectElement>('language'); select.value = language;
select.addEventListener('change', () => {
  language = select.value as Lang;
  storeLanguage(language);
  render();
});
render();
// A static text: the section bar and the footer only. Opening the learning store (and the account bar) here would
// cost every visitor, Google's verification included, the whole sync start and could fail with the text still needed.
mountSiteNav();
mountSiteFooter();
