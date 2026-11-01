// M3 (#335): converts the v1 gap data (public/data/gaps.json, passiv-gaps.json) into the
// committed v2 item datasets in public/data/items/<dataset-id>.json. Deterministic: the same sources and the
// same committed datasets give byte-identical output. An item whose content changed gets a new
// contentVersion and the dataset a new version; unchanged items keep theirs.
//   node scripts/build-gap-datasets.mjs          write the datasets
//   node scripts/build-gap-datasets.mjs --check  exit 1 if the committed datasets are stale
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertItemDataset, createItemExerciseRegistry, gapContent } from '../packages/vocabulary-core/dist/index.js';

const RELATIVE_PRONOUNS = ['der', 'die', 'das', 'den', 'dem', 'dessen', 'deren', 'denen'];
// The v1 Passiv chips (src/client/pages/grammar/passiv-gap.ts), in the same order.
const PASSIV_CHIPS = ['wird', 'wurde', 'ist', 'war', 'worden', 'werden'];
export const GAP_DATASETS = Object.freeze({
  relative: { id: 'relative-pronoun-gaps', file: 'relative-pronoun-gaps.json', title: 'Relativpronomen: Lücken' },
  passiv: { id: 'passiv-gaps', file: 'passiv-gaps.json', title: 'Passiv: Hilfsverben' },
});

/** "vor dem" → the same preposition with every relative pronoun, so the chip does not give it away. */
function relativeChoices(answer) {
  const words = answer.split(' ');
  const prefix = words.slice(0, -1).join(' ');
  return RELATIVE_PRONOUNS.map(pronoun => prefix ? `${prefix} ${pronoun}` : pronoun);
}
// Typed answers also accept the equivalent form of "welcher" (none exists for dessen/deren).
const WELCH = { der: 'welcher', die: 'welche', das: 'welches', den: 'welchen', dem: 'welchem', denen: 'welchen' };
function relativeAccepted(answer) {
  const words = answer.split(' ');
  const welch = WELCH[words[words.length - 1]];
  return welch ? [answer, [...words.slice(0, -1), welch].join(' ')] : [answer];
}
export function relativeItems(gaps) {
  return gaps.map(gap => ({ id: `rel-${gap.id}`, content: { template: gap.sentence, answers: [relativeAccepted(gap.answer)], choices: [relativeChoices(gap.answer)] } }));
}
export function passivItems(passiv) {
  return passiv.map(item => ({ id: item.id, content: { template: item.template, answers: item.answers.map(answer => [answer]),
    choices: item.answers.map(() => [...PASSIV_CHIPS]), translations: { en: item.translation_en, ru: item.translation_ru },
    tense: item.tense, tenseVariants: [...item.tense_variants], level: item.level } }));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Version the converted items against the previously committed dataset (or start at 1). */
export function versionDataset(meta, items, previous) {
  const old = new Map((previous?.items ?? []).map(item => [item.id, item]));
  const versioned = items.map(({ id, content }) => {
    const prior = old.get(id);
    const contentVersion = !prior ? 1 : same(prior.content, content) ? prior.contentVersion : prior.contentVersion + 1;
    return { id, contentVersion, wordIds: [], content };
  });
  const changed = !previous || previous.title !== meta.title || !same(previous.items, versioned);
  const dataset = { schemaVersion: 1, id: meta.id, version: changed ? String(previous ? Number(previous.version) + 1 : 1) : previous.version,
    kind: 'grammar-item', title: meta.title, items: versioned };
  assertItemDataset(dataset);
  for (const item of dataset.items) if (!gapContent(item.content)) throw new RangeError(`Unusable gap item ${dataset.id}/${item.id}`);
  createItemExerciseRegistry([dataset]);
  return dataset;
}
export function convertGapDatasets({ gaps, passiv }, previous = {}) {
  return { relative: versionDataset(GAP_DATASETS.relative, relativeItems(gaps), previous.relative),
    passiv: versionDataset(GAP_DATASETS.passiv, passivItems(passiv), previous.passiv) };
}
/** One item per line keeps reviews of content changes readable. */
export function formatDataset(dataset) {
  const { items, ...head } = dataset;
  return `${JSON.stringify(head).slice(0, -1)},"items":[\n${items.map(item => JSON.stringify(item)).join(',\n')}\n]}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const out = new URL('public/data/items/', root);
  const files = Object.fromEntries(Object.entries(GAP_DATASETS).map(([key, meta]) => [key, new URL(meta.file, out)]));
  const previous = Object.fromEntries(Object.entries(files).filter(([, file]) => existsSync(file)).map(([key, file]) => [key, JSON.parse(readFileSync(file, 'utf8'))]));
  const converted = convertGapDatasets({ gaps: read('public/data/gaps.json'), passiv: read('public/data/passiv-gaps.json') }, previous);
  const stale = Object.entries(converted).filter(([key, dataset]) => !existsSync(files[key]) || readFileSync(files[key], 'utf8') !== formatDataset(dataset));
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error(`Stale gap datasets: ${stale.map(([key]) => GAP_DATASETS[key].file).join(', ')}. Run node scripts/build-gap-datasets.mjs`); process.exit(1); }
  } else {
    mkdirSync(out, { recursive: true });
    for (const [key, dataset] of stale) writeFileSync(files[key], formatDataset(dataset));
    console.log(`Gap datasets: ${stale.length ? stale.map(([key, d]) => `${d.id}@${d.version}`).join(', ') : 'up to date'}`);
  }
}
