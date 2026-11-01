import { CONTENT_SCHEMA_VERSION, type Deck, type Word } from './content.js';

const POS = ['noun', 'verb', 'adjective', 'adverb', 'other'];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0;

/** Structural check of the published read model, shared by seed tooling, server publishing and tests. */
export function assertPublishedWord(word: Word): void {
  const fail = (reason: string): never => { throw new RangeError(`Invalid word ${String(word?.id)}: ${reason}`); };
  if (word.schemaVersion !== CONTENT_SCHEMA_VERSION) fail('schema version');
  if (!text(word.id) || !text(word.lemma) || !text(word.senseId)) fail('identity');
  if (!POS.includes(word.partOfSpeech)) fail('part of speech');
  if (word.article !== undefined && (word.partOfSpeech !== 'noun' || !['der', 'die', 'das'].includes(word.article))) fail('article');
  if (!Number.isSafeInteger(word.contentVersion) || word.contentVersion < 1) fail('content version');
  const languages = Object.keys(word.meanings);
  if (!languages.length || !languages.every(lang => lang === 'ru' || lang === 'en')) fail('meaning languages');
  for (const meaning of Object.values(word.meanings)) {
    if (!meaning || !text(meaning.preferred) || !meaning.accepted.every(text) ||
        new Set([meaning.preferred, ...meaning.accepted]).size !== meaning.accepted.length + 1) fail('meaning');
  }
  if (!word.acceptedGermanForms.every(text) || !word.tags.every(text) || new Set(word.tags).size !== word.tags.length) fail('forms/tags');
  const ids = new Set<string>(); const sentences = new Set<string>();
  for (const example of word.examples) {
    if (!text(example.id) || ids.has(example.id) || !text(example.de) || sentences.has(example.de)) fail('example identity/sentence');
    const translations = Object.entries(example.translations);
    if (!translations.length || !translations.every(([lang, value]) => (lang === 'ru' || lang === 'en') && text(value))) fail('example translation');
    ids.add(example.id); sentences.add(example.de);
  }
}

/** Decks only reference published words, once each. */
export function assertDecks(decks: readonly Deck[], words: readonly Word[]): void {
  const known = new Set(words.map(word => word.id));
  if (known.size !== words.length) throw new RangeError('Duplicate word ID');
  const deckIds = new Set<string>();
  for (const deck of decks) {
    if (!text(deck.id) || deckIds.has(deck.id) || !text(deck.title)) throw new RangeError(`Invalid deck ${String(deck.id)}`);
    deckIds.add(deck.id);
    if (new Set(deck.wordIds).size !== deck.wordIds.length) throw new RangeError(`Deck ${deck.id} repeats a word`);
    const missing = deck.wordIds.find(id => !known.has(id));
    if (missing !== undefined) throw new RangeError(`Deck ${deck.id} references unknown word ${missing}`);
  }
}
