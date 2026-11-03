import type { Lang } from '../i18n.js';
import { APP_VERSION } from './app-version.js';
import { INSTALL_GUIDE } from './install-guide.js';
import { hasInstallOffer, isStandalone, promptInstall, watchInstallOffer } from './install-prompt.js';
import { CONTACT, LEGAL, LEGAL_PAGES, type LegalPageId } from './legal-content.js';
import { SECTIONS } from './site-nav-model.js';

/** #408: the footer after every v2 page's <main> — sections, contact, legal pages, author, copyright and the build's version;
 * #420: "Get the app" opens the browser's install dialog when it offers one, the install guide otherwise. */
export const FOOTER_LABELS = {
  ru: { tagline: 'Бесплатный тренажёр латинского языка: слова и предложения.', author: 'Автор:',
    sections: 'Разделы', contact: 'Связь', legal: 'Правовая информация', email: 'Написать нам', version: 'Версия' },
  en: { tagline: 'A free Latin trainer: words and sentences.', author: 'Made by',
    sections: 'Sections', contact: 'Contact', legal: 'Legal', email: 'Email us', version: 'Version' },
  de: { tagline: 'Kostenloser Lateintrainer: Wörter und Sätze.', author: 'Von',
    sections: 'Bereiche', contact: 'Kontakt', legal: 'Rechtliches', email: 'Schreib uns', version: 'Version' },
} satisfies Record<Lang, Record<string, string>>;

type Label = keyof typeof FOOTER_LABELS.ru;

function link(href: string, external = false): HTMLAnchorElement {
  const a = document.createElement('a'); a.href = href;
  if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  return a;
}

/** One titled column of links; `render` fills the texts. */
function column(links: readonly HTMLAnchorElement[]): { root: HTMLElement; title: HTMLHeadingElement } {
  const root = document.createElement('div'); root.className = 'dc-footer-col';
  const title = document.createElement('h2'); const list = document.createElement('ul');
  for (const a of links) { const li = document.createElement('li'); li.append(a); list.append(li); }
  root.append(title, list);
  return { root, title };
}

export function mountSiteFooter(): () => void {
  const main = document.querySelector('main.dc-demo');
  if (!main || document.getElementById('site-footer')) return () => {};
  const footer = document.createElement('footer'); footer.id = 'site-footer'; footer.className = 'dc-footer';

  const about = document.createElement('div'); about.className = 'dc-footer-about';
  const brand = link('./today.html'); brand.className = 'dc-footer-brand'; brand.textContent = 'Latin DrillCards';
  const tagline = document.createElement('p');
  const credit = document.createElement('p'); const authorLabel = document.createElement('span');
  const author = link(CONTACT.authorUrl, true); author.textContent = CONTACT.author;
  credit.append(authorLabel, ' ', author);
  about.append(brand, tagline, credit);
  // Inside the installed app there is nothing left to install.
  const install = link('./install.html'); install.className = 'dc-footer-install';
  if (!isStandalone()) about.append(install);
  install.addEventListener('click', event => { if (!hasInstallOffer()) return; event.preventDefault(); void promptInstall(); });
  const unwatchInstall = watchInstallOffer(() => {});

  const sectionLinks = SECTIONS.map(section => ({ a: link(`./${section.page}`), section }));
  const email = link(`mailto:${CONTACT.email}`);
  const legalLinks = (Object.keys(LEGAL_PAGES) as LegalPageId[]).map(id => ({ a: link(`./${LEGAL_PAGES[id]}`), id }));
  const columns: [Label, ReturnType<typeof column>][] = [
    ['sections', column(sectionLinks.map(({ a }) => a))], ['contact', column([email])], ['legal', column(legalLinks.map(({ a }) => a))]];

  const grid = document.createElement('div'); grid.className = 'dc-footer-grid';
  grid.append(about, ...columns.map(([, col]) => col.root));
  const bottom = document.createElement('div'); bottom.className = 'dc-footer-bottom';
  const copyright = document.createElement('span'); copyright.textContent = `© ${new Date().getFullYear()} Latin DrillCards`;
  const version = document.createElement('span'); version.className = 'dc-footer-version';
  bottom.append(copyright, version);
  footer.append(grid, bottom);
  // A page may carry a static footer for readers without JS (the site entry's legal links): the full one takes its place.
  const placeholder = document.querySelector('footer[data-static-footer]');
  if (placeholder) placeholder.replaceWith(footer); else main.after(footer);

  function render(): void {
    const lang = document.documentElement.lang as Lang; const key: Lang = lang in FOOTER_LABELS ? lang : 'ru'; const t = FOOTER_LABELS[key];
    footer.lang = key;
    tagline.textContent = t.tagline; authorLabel.textContent = t.author;
    for (const [label, col] of columns) col.title.textContent = t[label];
    for (const { a, section } of sectionLinks) a.textContent = section.label[key];
    email.textContent = t.email;
    for (const { a, id } of legalLinks) a.textContent = LEGAL[id][key].title;
    install.textContent = INSTALL_GUIDE[key].title;
    version.textContent = `${t.version} ${APP_VERSION}`;
  }
  // Pages set <html lang> when the interface language changes.
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render();
  return () => { observer.disconnect(); unwatchInstall(); footer.remove(); };
}
