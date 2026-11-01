import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// M1 (#333): the v1 sentence decks as one immutable ItemDataset. Deterministic: the same
// sources give the same file and version; `--check` fails when the committed file is stale.
export const SENTENCE_DECKS = Object.freeze(['basic']);
export const SENTENCE_DATASET_PATH = 'public/data/items/sentences.json';
const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';

/** One v1 record as sentence content. Optional fields are omitted, never empty. */
export function sentenceItem(deck, source) {
  const tokens = (Array.isArray(source.tokens) && source.tokens.length === 1 ? String(source.tokens[0]).replace(/,/g, ' ').split(/\s+/)
    : Array.isArray(source.tokens) ? source.tokens.map(String) : String(source.tokens ?? '').replace(/,/g, ' ').split(/\s+/)).map(clean).filter(Boolean);
  const translations = Object.fromEntries(['ru', 'en', 'es'].map(lang => [lang, clean(source[`translation_${lang}`])]).filter(([, value]) => value));
  const content = { deck, level: clean(source.level) || deck.toUpperCase(), tags: [...new Set((source.tags ?? []).map(clean).filter(Boolean))],
    target: clean(source.target), tokens, alternatives: (source.alternatives ?? []).map(clean).filter(Boolean), translations,
    ...(clean(source.explanation) ? { explanation: clean(source.explanation) } : {}),
    ...(clean(source.variant_of) ? { variantOf: clean(source.variant_of) } : {}),
    ...(clean(source.tense) ? { tense: clean(source.tense) } : {}),
    ...(source.tense_variants?.length ? { tenseVariants: source.tense_variants.map(clean) } : {}) };
  return { id: clean(source.id), contentVersion: 1, wordIds: [], content };
}

export function buildSentenceDataset(root = '.') {
  const items = SENTENCE_DECKS.flatMap(deck => JSON.parse(readFileSync(`${root}/public/data/sentences-${deck}.json`, 'utf8')).map(s => sentenceItem(deck, s)));
  const ids = new Set(items.map(item => item.id));
  if (ids.size !== items.length) throw new RangeError('Duplicate sentence ID');
  for (const { id, content } of items) for (const ref of [content.variantOf, ...(content.tenseVariants ?? [])].filter(Boolean))
    if (!ids.has(ref)) throw new RangeError(`${id} references missing sentence ${ref}`);
  const version = `sentences-${createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16)}`;
  return { schemaVersion: 1, id: 'sentences', version, kind: 'sentence', title: 'Sentence builder', items };
}
/** One item per line: readable diffs, no indentation weight. */
export const serialize = ({ items, ...head }) => JSON.stringify(head).slice(0, -1) + ',"items":[\n' +
  items.map(item => JSON.stringify(item)).join(',\n') + '\n]}\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = serialize(buildSentenceDataset());
  if (process.argv.includes('--check')) {
    if (readFileSync(SENTENCE_DATASET_PATH, 'utf8') !== next) throw new Error(`${SENTENCE_DATASET_PATH} is stale; run npm run items:sentences`);
  } else { writeFileSync(SENTENCE_DATASET_PATH, next); console.log(`Wrote ${SENTENCE_DATASET_PATH}`); }
}
