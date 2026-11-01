import type { Deck, Word } from './core/index.js';

// Small published-model fixture for the Runner and home e2e specs; the page itself reads the seed catalog.
export const PREVIEW_CATALOG_VERSION = 'preview-session/1';
export const PREVIEW_WORDS: readonly Word[] = ([
  ['tisch', 'Tisch', 'der', 'стол', 'table'], ['stuhl', 'Stuhl', 'der', 'стул', 'chair'],
  ['fenster', 'Fenster', 'das', 'окно', 'window'], ['tuer', 'Tür', 'die', 'дверь', 'door'],
  ['lampe', 'Lampe', 'die', 'лампа', 'lamp'], ['bett', 'Bett', 'das', 'кровать', 'bed'],
  ['schrank', 'Schrank', 'der', 'шкаф', 'wardrobe'], ['kueche', 'Küche', 'die', 'кухня', 'kitchen'],
] as const).map(([id, lemma, article, ru, en]): Word => ({ schemaVersion: 1, contentVersion: 1, id, lemma, article,
  partOfSpeech: 'noun', senseId: id, meanings: { ru: { preferred: ru, accepted: [] }, en: { preferred: en, accepted: [] } },
  acceptedForms: [lemma], tags: ['home'], examples: [] }));
export const PREVIEW_DECK: Deck = { id: 'preview-home', title: 'Zuhause', wordIds: PREVIEW_WORDS.map(word => word.id) };
