import type { Lang } from '../i18n.js';

/** The interface language every v2 page shares: one key, one fallback, storage failures tolerated. */
const KEY = 'dc_v2_lang';
const LANGUAGES: readonly Lang[] = ['ru', 'en', 'de'];

export function storedLanguage(): Lang {
  try { const value = localStorage.getItem(KEY); return LANGUAGES.includes(value as Lang) ? value as Lang : 'ru'; } catch { return 'ru'; }
}

export function storeLanguage(language: Lang): void {
  try { localStorage.setItem(KEY, language); } catch { /* the choice then lasts for this page only */ }
}
