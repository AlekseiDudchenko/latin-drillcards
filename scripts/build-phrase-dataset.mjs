// M7 (#339): converts every v1 Redemittel deck (public/data/phrases-<deck>.json: the job-interview
// deck "beruf" and the IT daily stand-up deck "daily") into the committed v2 item dataset
// public/data/items/redemittel.json. Deterministic: the same sources and the same committed dataset
// give byte-identical output. An item whose content changed gets a new contentVersion and the
// dataset a new version; unchanged items keep theirs.
//   node scripts/build-phrase-dataset.mjs          write the dataset
//   node scripts/build-phrase-dataset.mjs --check  exit 1 if the committed dataset is stale
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertItemDataset, createItemExerciseRegistry, phraseContent, PHRASE_DECKS } from '../packages/vocabulary-core/dist/index.js';

export const PHRASE_DATASET = Object.freeze({ id: 'redemittel', file: 'redemittel.json', title: 'Redemittel' });
const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';

/** One v1 phrase as phrase content; the v1 ID stays the item ID. */
export function phraseItems(deck, phrases) {
  return phrases.map(phrase => ({ id: clean(phrase.id),
    content: { de: clean(phrase.de), translations: { en: clean(phrase.en), ru: clean(phrase.ru) }, deck } }));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Version the converted items against the previously committed dataset (or start at 1). */
export function versionDataset(items, previous) {
  const old = new Map((previous?.items ?? []).map(item => [item.id, item]));
  const versioned = items.map(({ id, content }) => {
    const prior = old.get(id);
    const contentVersion = !prior ? 1 : same(prior.content, content) ? prior.contentVersion : prior.contentVersion + 1;
    return { id, contentVersion, wordIds: [], content };
  });
  const changed = !previous || previous.title !== PHRASE_DATASET.title || !same(previous.items, versioned);
  const dataset = { schemaVersion: 1, id: PHRASE_DATASET.id, version: changed ? String(previous ? Number(previous.version) + 1 : 1) : previous.version,
    kind: 'phrase', title: PHRASE_DATASET.title, items: versioned };
  assertItemDataset(dataset);
  for (const item of dataset.items) if (!phraseContent(item.content)) throw new RangeError(`Unusable phrase ${item.id}`);
  createItemExerciseRegistry([dataset]);
  return dataset;
}
/** `decks`: the v1 deck files by deck key, in PHRASE_DECKS order. */
export function convertPhraseDataset(decks, previous) {
  return versionDataset(PHRASE_DECKS.flatMap(deck => phraseItems(deck, decks[deck] ?? [])), previous);
}
/** One item per line keeps reviews of content changes readable. */
export function formatDataset(dataset) {
  const { items, ...head } = dataset;
  return `${JSON.stringify(head).slice(0, -1)},"items":[\n${items.map(item => JSON.stringify(item)).join(',\n')}\n]}\n`;
}
export const readPhraseDecks = (root = new URL('../', import.meta.url)) => Object.fromEntries(PHRASE_DECKS.map(deck =>
  [deck, JSON.parse(readFileSync(new URL(`public/data/phrases-${deck}.json`, root), 'utf8'))]));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const out = new URL('public/data/items/', root);
  const file = new URL(PHRASE_DATASET.file, out);
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  const dataset = convertPhraseDataset(readPhraseDecks(root), previous);
  const stale = !existsSync(file) || readFileSync(file, 'utf8') !== formatDataset(dataset);
  if (process.argv.includes('--check')) {
    if (stale) { console.error(`Stale phrase dataset ${PHRASE_DATASET.file}. Run npm run items:phrases`); process.exit(1); }
  } else {
    mkdirSync(out, { recursive: true });
    if (stale) writeFileSync(file, formatDataset(dataset));
    console.log(`Phrase dataset: ${stale ? `${dataset.id}@${dataset.version}` : 'up to date'}`);
  }
}
