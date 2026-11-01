import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// M8 (#340): the v1 level test words (public/data/words-a1…b2.json, src/client/pages/level-test.ts)
// as one immutable assessment ItemDataset. Each deck word is one question; its three distractors
// come from the same deck, as in v1, but are fixed here instead of drawn per run, so the server can
// re-evaluate the answer. Deterministic: the same sources give the same file and version;
// `--check` fails when the committed file is stale.
export const LEVEL_TEST_DECKS = Object.freeze(['a1', 'a2', 'b1', 'b2']);
export const LEVEL_TEST_DATASET_PATH = 'public/data/items/level-test.json';
export const OPTIONS_PER_QUESTION = 4;
const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  // FNV-1a alone keeps IDs that differ in the last character next to each other; the murmur3 finalizer spreads them.
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b); result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
  return (result ^ (result >>> 16)) >>> 0;
}
/** v1 `translationSenses`: comma/semicolon/slash parts without parentheses or a leading "to". */
export const senses = translation => translation.replace(/\([^)]*\)/g, ' ').split(/[,;/]/)
  .map(part => part.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^to\s+/, '')).filter(Boolean);
const keys = word => ['ru', 'en'].flatMap(lang => [word[lang].toLowerCase(), ...senses(word[lang])]);

/** v1 `pickOptionIds` in both answer languages: a candidate sharing a label or sense (RU or EN)
 * with an option already chosen is skipped, so no option is a second correct answer. */
export function pickDistractors(word, deck) {
  const seen = new Set(keys(word));
  const chosen = [];
  const order = deck.filter(other => other.id !== word.id)
    .sort((a, b) => hash(`${word.id}:${a.id}`) - hash(`${word.id}:${b.id}`) || (a.id < b.id ? -1 : 1));
  for (const other of order) {
    if (keys(other).some(key => seen.has(key))) continue;
    keys(other).forEach(key => seen.add(key)); chosen.push(other);
    if (chosen.length === OPTIONS_PER_QUESTION - 1) break;
  }
  if (chosen.length !== OPTIONS_PER_QUESTION - 1) throw new RangeError(`Not enough distractors for ${word.id}`);
  return chosen;
}

/** v1 word source `<deck>:<id>` → v2 word ID, for links only (an assessment never feeds WordProgress). */
function wordIdsBySource(root) {
  const identities = JSON.parse(readFileSync(`${root}/content/vocabulary/identities.json`, 'utf8'));
  return new Map(identities.words.flatMap(word => word.sources.map(source => [source, word.id])));
}

export function buildLevelTestDataset(root = '.') {
  const wordIds = wordIdsBySource(root);
  const items = LEVEL_TEST_DECKS.flatMap(deck => {
    const words = JSON.parse(readFileSync(`${root}/public/data/words-${deck}.json`, 'utf8'))
      .map(w => ({ id: clean(w.id), de: clean(w.de), ru: clean(w.ru), en: clean(w.en) || clean(w.ru) }));
    for (const w of words) if (!w.id || !w.de || !w.ru) throw new RangeError(`Incomplete ${deck} word ${w.id}`);
    return words.map(word => {
      const options = [word, ...pickDistractors(word, words)].map(({ id, ru, en }) => ({ id, ru, en }));
      const wordId = wordIds.get(`${deck}:${word.id}`);
      return { id: word.id, contentVersion: 1, wordIds: wordId ? [wordId] : [],
        content: { level: deck, prompt: { text: word.de, lang: 'de' }, options, correctOptionId: word.id } };
    });
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new RangeError('Duplicate level test question ID');
  const version = `level-test-${createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16)}`;
  return { schemaVersion: 1, id: 'level-test', version, kind: 'assessment', title: 'Einstufungstest A1–B2', items };
}
/** One item per line: readable diffs, no indentation weight. */
export const serialize = ({ items, ...head }) => JSON.stringify(head).slice(0, -1) + ',"items":[\n' +
  items.map(item => JSON.stringify(item)).join(',\n') + '\n]}\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = serialize(buildLevelTestDataset());
  if (process.argv.includes('--check')) {
    if (readFileSync(LEVEL_TEST_DATASET_PATH, 'utf8') !== next) throw new Error(`${LEVEL_TEST_DATASET_PATH} is stale; run npm run items:level-test`);
  } else { writeFileSync(LEVEL_TEST_DATASET_PATH, next); console.log(`Wrote ${LEVEL_TEST_DATASET_PATH}`); }
}
