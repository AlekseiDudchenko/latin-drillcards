import type { Lang } from '../i18n.js';
import { sessionUiTranslations } from '../i18n.js';
import { openLearningPage } from './account-bar.js';
import { HUBS, type Hub } from './site-nav-model.js';

/** Practice and Progress hubs: the exercises of a section as cards, grouped by skill. */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const hub: Hub = HUBS[document.querySelector<HTMLElement>('main')!.dataset.hub as Hub['id']];
const LANGUAGES: readonly Lang[] = ['ru', 'en', 'de'];
const stored = (): Lang => { try { const value = localStorage.getItem('dc_v2_lang'); return LANGUAGES.includes(value as Lang) ? value as Lang : 'ru'; } catch { return 'ru'; } };
let language = stored();

function render(): void {
  document.documentElement.lang = language;
  document.title = `Latin DrillCards · ${hub.title[language]}`;
  $('title').textContent = hub.title[language];
  $('languageLabel').textContent = sessionUiTranslations(language).interfaceLanguage;
  const groups = $('groups'); groups.replaceChildren();
  for (const group of hub.groups) {
    const section = document.createElement('section'); section.setAttribute('aria-labelledby', `group-${group.id}`);
    const heading = document.createElement('h2'); heading.id = `group-${group.id}`; heading.textContent = group.title[language];
    const list = document.createElement('ul'); list.className = 'dc-hub-list';
    for (const item of group.items) {
      const li = document.createElement('li'); const a = document.createElement('a'); a.href = item.href;
      const title = document.createElement('strong'); title.textContent = item.title[language];
      const hint = document.createElement('span'); hint.textContent = item.hint[language];
      a.append(title, hint); li.append(a); list.append(li);
    }
    section.append(heading, list); groups.append(section);
  }
}

const select = $<HTMLSelectElement>('language'); select.value = language;
select.addEventListener('change', () => {
  language = select.value as Lang;
  try { localStorage.setItem('dc_v2_lang', language); } catch { /* the choice then lasts for this page only */ }
  render();
});
render();
// The account bar and the learning store are the shared page start; the hub itself needs neither yet.
openLearningPage().catch(() => { /* the exercises below stay reachable without an account */ });
