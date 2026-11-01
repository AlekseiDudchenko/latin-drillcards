// M4 (#336): converts the v1 Kasus data (public/data/kasus-a2.json) into the committed v2 item
// dataset public/data/items/kasus-a2.json. The rules and tables stay shared in public/data/kasus-rules.json;
// every item names its rule and the table row (gender) that decides it. Deterministic: the same sources
// and the same committed dataset give byte-identical output. A changed item gets a new contentVersion
// and the dataset a new version; unchanged items keep theirs.
//   node scripts/build-kasus-dataset.mjs          write the dataset
//   node scripts/build-kasus-dataset.mjs --check  exit 1 if the committed dataset is stale
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertItemDataset, createItemExerciseRegistry, kasusContent, KASUS_GENDERS } from '../packages/vocabulary-core/dist/index.js';
import { formatDataset } from './build-gap-datasets.mjs';

export const KASUS_DATASET = Object.freeze({ id: 'kasus-a2', file: 'kasus-a2.json', title: 'Kasus: Akkusativ und Dativ' });
// Rows of every rule table, in order: maskulin, feminin, neutrum, Plural.
const TABLE_GENDERS = Object.freeze({ maskulin: 'm', feminin: 'f', neutrum: 'n', plural: 'pl' });
// The noun of each highlighted phrase (case/question items). The article items name their gender in the
// explanation; for the others the article alone is ambiguous (dem: m/n, die: f/pl), so it is stated here.
// A new phrase needs its noun here, or the conversion fails.
export const FOCUS_NOUN_GENDER = Object.freeze({
  Arbeit: 'f', Auto: 'n', Chef: 'm', 'E-Mail': 'f', Eltern: 'pl', Frau: 'f', Gästen: 'pl', Großeltern: 'pl', Hund: 'm', Kaffee: 'm',
  Kinder: 'pl', Kindern: 'pl', Kino: 'n', Lehrer: 'm', Mann: 'm', Schwester: 'f', Sofa: 'n', Stuhl: 'm', Tisch: 'm', Uhr: 'f',
  Vase: 'f', Vater: 'm', Wald: 'm', Wohnung: 'f', Zug: 'm',
});

/** Gender of the noun that decides the item: from the German explanation (article) or the focus noun. */
export function kasusGender(item) {
  if (item.type === 'article') {
    const named = item.explanation.de.match(/\b(maskulin|feminin|neutrum|Plural)\b/u);
    if (!named) throw new RangeError(`No gender in the explanation of ${item.id}`);
    return TABLE_GENDERS[named[1].toLowerCase()];
  }
  const noun = item.focus.split(' ').at(-1);
  const gender = FOCUS_NOUN_GENDER[noun];
  if (!gender) throw new RangeError(`Unknown noun "${noun}" in ${item.id}: add it to FOCUS_NOUN_GENDER`);
  return gender;
}

export function kasusItems(source, rules) {
  return source.map(item => {
    const rule = rules[item.rule];
    if (!rule || rule.table.rows.length !== KASUS_GENDERS.length) throw new RangeError(`Unknown rule ${item.rule} in ${item.id}`);
    return { id: item.id, content: { variant: item.type, sentence: item.sentence, ...(item.focus !== undefined ? { focus: item.focus } : {}),
      options: [...item.options], answer: item.answer, case: item.case, rule: item.rule, gender: kasusGender(item),
      explanation: { de: item.explanation.de, ru: item.explanation.ru, en: item.explanation.en },
      translations: { en: item.translation_en, ru: item.translation_ru }, level: item.level } };
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Version the converted items against the previously committed dataset (or start at 1). */
export function convertKasusDataset({ items, rules }, previous) {
  const old = new Map((previous?.items ?? []).map(item => [item.id, item]));
  const versioned = kasusItems(items, rules).map(({ id, content }) => {
    const prior = old.get(id);
    const contentVersion = !prior ? 1 : same(prior.content, content) ? prior.contentVersion : prior.contentVersion + 1;
    return { id, contentVersion, wordIds: [], content };
  });
  const changed = !previous || previous.title !== KASUS_DATASET.title || !same(previous.items, versioned);
  const dataset = { schemaVersion: 1, id: KASUS_DATASET.id, version: changed ? String(previous ? Number(previous.version) + 1 : 1) : previous.version,
    kind: 'grammar-item', title: KASUS_DATASET.title, items: versioned };
  assertItemDataset(dataset);
  for (const item of dataset.items) if (!kasusContent(item.content)) throw new RangeError(`Unusable Kasus item ${item.id}`);
  createItemExerciseRegistry([dataset]);
  return dataset;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const out = new URL('public/data/items/', root);
  const file = new URL(KASUS_DATASET.file, out);
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  const dataset = convertKasusDataset({ items: read('public/data/kasus-a2.json'), rules: read('public/data/kasus-rules.json') }, previous);
  const stale = !existsSync(file) || readFileSync(file, 'utf8') !== formatDataset(dataset);
  if (process.argv.includes('--check')) {
    if (stale) { console.error(`Stale Kasus dataset: ${KASUS_DATASET.file}. Run node scripts/build-kasus-dataset.mjs`); process.exit(1); }
  } else {
    mkdirSync(out, { recursive: true });
    if (stale) writeFileSync(file, formatDataset(dataset));
    console.log(`Kasus dataset: ${stale ? `${dataset.id}@${dataset.version}` : 'up to date'}`);
  }
}
