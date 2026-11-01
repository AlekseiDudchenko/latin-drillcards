import type { Lang } from '../i18n.js';
import { NAV_LABEL, SECTIONS, sectionFor } from './site-nav-model.js';

/** The section bar under every v2 page header: Words · Practice · Video · Progress, the current one marked. */
export function mountSiteNav(): () => void {
  const header = document.querySelector('.dc-demo > header');
  if (!header || document.getElementById('site-nav')) return () => {};
  const nav = document.createElement('nav'); nav.id = 'site-nav'; nav.className = 'dc-sitenav';
  const current = sectionFor(location.pathname);
  const links = SECTIONS.map(section => {
    const a = document.createElement('a'); a.href = `./${section.page}`; a.dataset.section = section.id;
    if (section.id === current) a.setAttribute('aria-current', 'page');
    nav.append(a); return { a, section };
  });
  header.after(nav);

  function render(): void {
    const lang = document.documentElement.lang as Lang; const key: Lang = lang in NAV_LABEL ? lang : 'ru';
    nav.setAttribute('aria-label', NAV_LABEL[key]);
    for (const { a, section } of links) { a.textContent = section.label[key]; a.lang = key; }
  }
  // Pages set <html lang> when the interface language changes.
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render();
  return () => { observer.disconnect(); nav.remove(); };
}
