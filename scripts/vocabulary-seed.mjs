import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// Seed of the shared v2 vocabulary catalog (F3 / #280), built from the v1 deck JSON.
//
// Identity is never derived at build time. content/vocabulary/identities.json is the
// explicit table wordId → source entries ("deck:entryId"); only `npm run seed:assign`
// adds entries, and an existing wordId never changes. The build then merges each
// word's sources into one published Word and fails if the table is stale.

export const DECKS = Object.freeze([
  ['a1', 'A1'], ['a2', 'A2'], ['b1', 'B1'], ['b2', 'B2'], ['c1', 'C1'],
  ['beruf', 'Beruf'], ['arch', 'Softwarearchitektur'], ['kollokationen', 'Kollokationen'],
]);
export const IDENTITIES_PATH = 'content/vocabulary/identities.json';
export const REPORT_PATH = 'content/vocabulary/duplicates.md';
export const SEED_VERSION = 'vocabulary-seed/1';

const ARTICLES = new Set(['der', 'die', 'das']);
const PHRASE_TAGS = new Set(['kollokation', 'nomen_verb', 'feste_wendung', 'adjektiv_nomen']);
const VERB_TAGS = new Set(['verb', 'verben', 'trennbar', 'reflexiv']);

const sha256 = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';

/** Read every deck in priority order (lowest CEFR first, themed decks last). */
export function loadSources(root = '.') {
  const files = {};
  const entries = [];
  for (const [deck] of DECKS) {
    const path = `public/data/words-${deck}.json`;
    const detailPath = `public/data/words-${deck}-detail.json`;
    const raw = readFileSync(`${root}/${path}`, 'utf8');
    files[path] = sha256(raw);
    const details = existsSync(`${root}/${detailPath}`) ? readFileSync(`${root}/${detailPath}`, 'utf8') : null;
    if (details !== null) files[detailPath] = sha256(details);
    const detail = details ? JSON.parse(details) : {};
    JSON.parse(raw).forEach((entry, position) => entries.push(normalizeEntry(deck, entry, detail[entry.id], position)));
  }
  return { files, entries };
}

/** One v1 entry as a candidate sense: lemma, article, part of speech, glosses and examples. */
export function normalizeEntry(deck, entry, detail, position = 0) {
  const de = clean(entry.de);
  const rawArticle = clean(entry.article);
  // "die (Pl.)" marks plural-only nouns; the article itself is "die".
  const article = rawArticle.split(' ')[0];
  if (article && !ARTICLES.has(article)) throw new RangeError(`${deck}:${entry.id}: unknown article ${rawArticle}`);
  const lemma = article && de.startsWith(`${article} `) ? de.slice(article.length + 1) : de;
  const tags = [...new Set((entry.tags ?? []).map(clean).filter(Boolean))];
  if (rawArticle.includes('Pl.') && !tags.includes('plural')) tags.push('plural');
  // v1 has no part of speech; it follows the article, then the deck's grammar tags. Phrases stay "other".
  const partOfSpeech = article ? 'noun' : tags.some(t => PHRASE_TAGS.has(t)) ? 'other'
    : tags.some(t => VERB_TAGS.has(t)) ? 'verb' : tags.includes('adjektiv') ? 'adjective'
    : tags.includes('adverb') ? 'adverb' : 'other';
  const examples = [{ id: `${deck}:${entry.id}:main`, de: entry.exampleDe, ru: entry.exampleRu, en: entry.exampleEn },
    // Detail example IDs follow the sentence, not its position: deleting one never renames another.
    ...(detail?.examples ?? []).map(example => ({ id: `${deck}:${entry.id}:detail:${sha256(clean(example.de)).slice(0, 8)}`, ...example }))]
    .map(example => ({ id: example.id, de: clean(example.de), translations: Object.fromEntries(
      [['ru', clean(example.ru)], ['en', clean(example.en)]].filter(([, value]) => value)) }))
    .filter(example => example.de && Object.keys(example.translations).length);
  return { source: `${deck}:${entry.id}`, deck, position, de, lemma, ...(article ? { article } : {}), partOfSpeech,
    ru: clean(entry.ru), en: clean(entry.en), tags, examples };
}

/** Gloss parts used to decide whether two entries name the same meaning (parentheses ignored). */
function glossParts(gloss) {
  return new Set(gloss.replace(/\([^)]*\)/g, ' ').split(/[,;/]/).map(part => part.trim().toLowerCase()).filter(Boolean));
}
const overlaps = (a, b) => [...a].some(item => b.has(item));
/** What identifies a sense: lemma, article, part of speech and glosses. Stored as each word's snapshot. */
export const senseOf = (entry, partOfSpeech = entry.partOfSpeech) =>
  ({ lemma: entry.lemma, ...(entry.article ? { article: entry.article } : {}), partOfSpeech, ru: entry.ru, en: entry.en });
/** Same lemma, article and part of speech, plus a shared RU or EN gloss. Spelling alone never merges.
 * `ignorePartOfSpeech` is only for words whose part of speech was decided by hand. */
export function sameSense(a, b, { ignorePartOfSpeech = false } = {}) {
  return a.lemma === b.lemma && a.article === b.article && (ignorePartOfSpeech || a.partOfSpeech === b.partOfSpeech) &&
    (overlaps(glossParts(a.ru), glossParts(b.ru)) || overlaps(glossParts(a.en), glossParts(b.en)));
}
/** Entries of a word that match none of its accepted senses: a meaning change needs a decision, not a version bump.
 * `senses` records the sense of each entry when it joined the word (or when a change was confirmed). */
export function senseConflicts(word, bySource) {
  const known = sense => (word.senses ?? []).some(accepted => sameSense(accepted, sense, { ignorePartOfSpeech: !!word.note }));
  return word.sources.filter(source => !known(bySource.get(source)));
}
const accepted = (word, entry) => {
  const sense = senseOf(entry, word.partOfSpeech ?? entry.partOfSpeech);
  if (!word.senses.some(other => canonical(other) === canonical(sense))) word.senses.push(sense);
};
const conflictError = (word, conflicts, bySource) => new RangeError(conflicts.map(source => {
  const e = bySource.get(source);
  const known = word.senses.map(sense => `${sense.lemma} / ${sense.ru} / ${sense.en}`).join('; ');
  return `${word.id}: ${source} (${e.de} / ${e.ru} / ${e.en}) no longer matches its sense (${known})`;
}).join('\n') + '\nMove the entry to another word in identities.json (or remove it there to get a new ID), ' +
  `or confirm the same meaning: npm run seed:assign -- --confirm ${word.id}`);
/** Display lemmas may carry a disambiguator ("sie (Plural)"); the typed answer is the bare form. */
const bareLemma = lemma => lemma.replace(/\s*\([^)]*\)/g, '').trim();

function slug(lemma) {
  return lemma.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wort';
}

/** Merge the sources of one wordId into a published Word (without contentVersion).
 * A hand decision in the identity table may fix the part of speech the v1 tags left unclear. */
export function mergeWord(id, sources, partOfSpeech = sources[0].partOfSpeech) {
  const [first] = sources;
  const gloss = lang => {
    const values = [...new Set(sources.map(s => s[lang]).filter(Boolean))];
    return values.length ? { preferred: values[0], accepted: values.slice(1) } : undefined;
  };
  const meanings = Object.fromEntries(['ru', 'en'].map(lang => [lang, gloss(lang)]).filter(([, value]) => value));
  const examples = []; const seen = new Set();
  for (const example of sources.flatMap(s => s.examples)) if (!seen.has(example.de)) { seen.add(example.de); examples.push(example); }
  const bare = bareLemma(first.lemma);
  return { schemaVersion: 1, id, lemma: first.lemma, partOfSpeech, senseId: id,
    ...(first.article ? { article: first.article } : {}), meanings, acceptedGermanForms: bare !== first.lemma ? [bare] : [],
    examples, tags: [...new Set(sources.flatMap(s => s.tags))] };
}
export const contentHash = word => sha256(canonical(word)).slice(0, 16);

/**
 * Add unmapped sources to the identity table and version changed content. Existing assignments stay.
 * - A word keeps the sense snapshot it was created (or last confirmed) with; an entry that no longer
 *   matches it fails unless its ID is in `confirm` (same meaning, reworded).
 * - An unmapped entry joins a word of the same sense (any of its entries or its snapshot), revives a
 *   retired word of that sense (moved or renumbered entries keep their ID), or gets a new ID.
 */
export function assignIdentities(previous, { entries }, { confirm = [] } = {}) {
  const bySource = new Map(entries.map(entry => [entry.source, entry]));
  // A word whose entries all left the decks is retired, never deleted: its ID must not be reused.
  const words = (previous?.words ?? []).map(word => {
    const sources = word.sources.filter(source => bySource.has(source));
    if (sources.length) { const { retired, ...rest } = word; return { ...rest, sources }; }
    return { ...word, sources: [], retired: true };
  });
  const errors = [];
  for (const word of words.filter(word => !word.retired)) {
    if (!word.senses || confirm.includes(word.id)) { word.senses = []; for (const source of word.sources) accepted(word, bySource.get(source)); }
    const conflicts = senseConflicts(word, bySource);
    if (conflicts.length) errors.push(conflictError(word, conflicts, bySource).message);
  }
  if (errors.length) throw new RangeError(errors.join('\n'));
  const mapped = new Set(words.flatMap(word => word.sources));
  const taken = new Set(words.map(word => word.id));
  const matches = (word, entry) => word.senses.some(sense => sameSense(sense, entry, { ignorePartOfSpeech: !!word.note })) ||
    word.sources.some(source => sameSense(bySource.get(source), entry));
  for (const entry of entries) {
    if (mapped.has(entry.source)) continue;
    const target = words.find(word => !word.retired && matches(word, entry)) ?? words.find(word => word.retired && matches(word, entry));
    if (target) {
      if (target.retired) delete target.retired;
      target.sources.push(entry.source); accepted(target, entry);
    } else {
      let id = `w-${slug(bareLemma(entry.lemma))}`;
      for (let n = 2; taken.has(id); n++) id = `w-${slug(bareLemma(entry.lemma))}-${n}`;
      taken.add(id);
      const word = { id, sources: [entry.source], senses: [], contentVersion: 0, contentHash: '' };
      accepted(word, entry); words.push(word);
    }
    mapped.add(entry.source);
  }
  const order = new Map(entries.map((entry, index) => [entry.source, index]));
  for (const word of words.filter(word => !word.retired)) {
    word.sources.sort((a, b) => order.get(a) - order.get(b));
    const hash = contentHash(mergeWord(word.id, word.sources.map(source => bySource.get(source)), word.partOfSpeech));
    if (hash !== word.contentHash) { word.contentHash = hash; word.contentVersion += 1; }
  }
  words.sort((a, b) => (a.retired ? 1 : 0) - (b.retired ? 1 : 0) ||
    (a.retired ? (a.id < b.id ? -1 : 1) : order.get(a.sources[0]) - order.get(b.sources[0])));
  return { schemaVersion: 1, seedVersion: SEED_VERSION, words };
}

/** Deterministic seed from the identity table. Throws when the table no longer matches the sources. */
export function buildSeed(identities, { files, entries }) {
  const bySource = new Map(entries.map(entry => [entry.source, entry]));
  const owner = new Map();
  const published = identities.words.filter(word => !word.retired);
  for (const word of published) for (const source of word.sources) {
    if (!bySource.has(source)) throw new RangeError(`Identity ${word.id} references missing source ${source}; run npm run seed:assign`);
    if (owner.has(source)) throw new RangeError(`Source ${source} is mapped twice`);
    owner.set(source, word.id);
  }
  const unmapped = entries.filter(entry => !owner.has(entry.source));
  if (unmapped.length) throw new RangeError(`${unmapped.length} unmapped source entries (e.g. ${unmapped[0].source}); run npm run seed:assign`);
  for (const identity of published) {
    if (!identity.senses?.length) throw new RangeError(`Identity ${identity.id} has no recorded senses; run npm run seed:assign`);
    const conflicts = senseConflicts(identity, bySource);
    if (conflicts.length) throw conflictError(identity, conflicts, bySource);
  }
  const words = published.map(identity => {
    const word = mergeWord(identity.id, identity.sources.map(source => bySource.get(source)), identity.partOfSpeech);
    if (contentHash(word) !== identity.contentHash) throw new RangeError(`Content of ${identity.id} changed; run npm run seed:assign`);
    return { ...word, contentVersion: identity.contentVersion };
  });
  const decks = DECKS.map(([id, title]) => ({ id, title,
    wordIds: [...new Set(entries.filter(entry => entry.deck === id).map(entry => owner.get(entry.source)))] }));
  const provenance = Object.fromEntries(published.map(word => [word.id, word.sources]));
  // Each published gloss credits only the entries that actually wrote it.
  const translationSources = Object.fromEntries(published.map(identity => [identity.id, Object.fromEntries(['ru', 'en'].map(lang => {
    const byText = {};
    for (const source of identity.sources) { const text = bySource.get(source)[lang]; if (text) (byText[text] ??= []).push(source); }
    return [lang, byText];
  }).filter(([, byText]) => Object.keys(byText).length))]));
  // Retired IDs are reserved by the catalog too, so no later word can take them.
  const retiredWordIds = identities.words.filter(word => word.retired).map(word => word.id).sort();
  const catalogVersion = `seed-${contentHash({ words, decks })}`;
  return { schemaVersion: 1, seedVersion: SEED_VERSION, catalogVersion,
    source: { files, identities: IDENTITIES_PATH }, words, decks, provenance, translationSources, retiredWordIds };
}

/** Human-readable decisions: merged sources and same spellings kept apart. */
export function duplicateReport(identities, { entries }) {
  const bySource = new Map(entries.map(entry => [entry.source, entry]));
  const live = identities.words.filter(word => !word.retired);
  const merged = live.filter(word => word.sources.length > 1 && !word.note);
  const decided = live.filter(word => word.note);
  // Grouped by bare lemma, ignoring case and article: sie / Sie, der Morgen / morgen, sie (Plural).
  const spellings = new Map();
  for (const word of live) {
    const key = bareLemma(bySource.get(word.sources[0]).lemma).toLowerCase();
    spellings.set(key, [...(spellings.get(key) ?? []), word]);
  }
  const apart = [...spellings].filter(([, words]) => words.length > 1);
  const gloss = source => { const e = bySource.get(source); return `${source} — ${e.ru} / ${e.en}`; };
  return [
    '# Vocabulary seed: duplicates',
    '',
    'Generated by `npm run seed:assign` from `content/vocabulary/identities.json`; do not edit by hand.',
    'To split or merge a word, move its source entries between IDs in the identity table and run the',
    'command again. An existing wordId is never renamed or reused.',
    '',
    `Sources: ${entries.length} entries, ${live.length} words (${identities.words.length - live.length} retired). Merged: ${merged.length} words from`,
    `${merged.reduce((sum, word) => sum + word.sources.length, 0)} entries. Decided by hand: ${decided.length}. Same lemma kept apart: ${apart.length}.`,
    '',
    '## Merged: same German form, article, part of speech and a shared translation',
    '',
    ...merged.flatMap(word => [`- \`${word.id}\` ${bySource.get(word.sources[0]).de}`, ...word.sources.map(s => `  - ${gloss(s)}`)]),
    '',
    '## Decided by hand in the identity table',
    '',
    ...decided.flatMap(word => [`- \`${word.id}\` ${bySource.get(word.sources[0]).de}: ${word.note}`, ...word.sources.map(s => `  - ${gloss(s)}`)]),
    '',
    '## Kept apart: same lemma, different meaning, article or part of speech',
    '',
    ...apart.flatMap(([key, words]) => [`- ${key}`, ...words.map(word => `  - \`${word.id}\` ${bySource.get(word.sources[0]).de}: ${word.sources.map(gloss).join('; ')}`)]),
    '',
  ].join('\n');
}
