import type { Lang } from '../i18n.js';
import { sessionUiTranslations } from '../i18n.js';
import { storedLanguage, storeLanguage } from './interface-language.js';
import { INSTALL_GUIDE, installPlatform, platformOrder } from './install-guide.js';
import { hasInstallOffer, isStandalone, promptInstall, watchInstallOffer } from './install-prompt.js';
import { mountSiteFooter } from './site-footer.js';
import { mountSiteNav } from './site-nav.js';

/** "Get the app" (#420): the browser's own install dialog when it offers one, and the steps for every kind of device. */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let language = storedLanguage();
const current = installPlatform(navigator.userAgent, navigator.maxTouchPoints);

function render(): void {
  const guide = INSTALL_GUIDE[language];
  document.documentElement.lang = language;
  document.title = `Latin DrillCards · ${guide.title}`;
  $('title').textContent = guide.title;
  $('languageLabel').textContent = sessionUiTranslations(language).interfaceLanguage;
  $('lead').textContent = guide.lead;
  const installed = isStandalone();
  $('installed').textContent = guide.installed; $('installed').hidden = !installed;
  const install = $<HTMLButtonElement>('install'); install.textContent = guide.install; install.hidden = installed || !hasInstallOffer();
  const cards = platformOrder(current).map(platform => {
    const text = guide.platforms[platform];
    const card = document.createElement('section'); card.className = 'dc-install-platform'; card.dataset.platform = platform;
    const heading = document.createElement('h2'); heading.textContent = text.title;
    if (platform === current) { card.dataset.current = ''; const badge = document.createElement('span'); badge.textContent = guide.yourDevice; heading.append(' ', badge); }
    const steps = document.createElement('ol');
    for (const step of text.steps) { const li = document.createElement('li'); li.textContent = step; steps.append(li); }
    card.append(heading, steps);
    if (text.note) { const note = document.createElement('p'); note.className = 'dc-note'; note.textContent = text.note; card.append(note); }
    return card;
  });
  $('platforms').replaceChildren(...cards);
}

$<HTMLButtonElement>('install').addEventListener('click', () => { void promptInstall(); });
// The button follows the browser's offer: it appears when the offer arrives and goes once it is used.
watchInstallOffer(render);
const select = $<HTMLSelectElement>('language'); select.value = language;
select.addEventListener('change', () => {
  language = select.value as Lang;
  storeLanguage(language);
  render();
});
render();
// A static guide, like the legal pages: the section bar and the footer only, without opening the learning store.
mountSiteNav();
mountSiteFooter();
