// M5 (#337): converts the four v1 Konjunktiv II trainers (public/data/konjunktiv2-<trainer>.json) into
// the committed v2 item datasets public/data/items/konjunktiv2-<trainer>.json. Deterministic: the same
// sources and the same committed datasets give byte-identical output. An item whose content changed
// gets a new contentVersion and the dataset a new version; unchanged items keep theirs.
//   node scripts/build-konjunktiv2-datasets.mjs          write the datasets
//   node scripts/build-konjunktiv2-datasets.mjs --check  exit 1 if the committed datasets are stale
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertItemDataset, createItemExerciseRegistry, konjunktiv2Content } from '../packages/vocabulary-core/dist/index.js';
import { formatDataset } from './build-gap-datasets.mjs';

export const KONJUNKTIV2_DATASETS = Object.freeze({
  transformation: { id: 'konjunktiv2-transformation', title: 'Konjunktiv II: Umformung' },
  conditional: { id: 'konjunktiv2-conditional', title: 'Konjunktiv II: Bedingungssätze' },
  polite: { id: 'konjunktiv2-polite', title: 'Konjunktiv II: Höflichkeit' },
  past: { id: 'konjunktiv2-past', title: 'Konjunktiv II: Vergangenheit' },
});
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const LONE_WUERDE = /^würde(?:st|n|t)?$/iu;

/** The complete sentence with the first answer, for speech. "(reisen) ___" answered with a lone "würde"
 * whose hint reads "reisen → würde … reisen" also gets the infinitive at the end of its clause. */
export function solvedSentence(template, answer, hint) {
  const parts = template.split('___');
  const gaps = parts.length - 1;
  const forms = gaps > 1 ? answer.split(/\s*,\s*/u) : [answer];
  if (forms.length !== gaps) throw new RangeError(`"${answer}" does not fill ${gaps} gaps of "${template}"`);
  let out = '';
  for (let index = 0; index < gaps; index++) {
    const before = out + parts[index];
    const verb = before.match(/\(([^)]+)\)\s*$/u)?.[1];
    if (!verb) throw new RangeError(`No (verb) before gap ${index + 1} of "${template}"`);
    out = before.replace(/\(([^)]+)\)\s*$/u, '') + forms[index];
    if (LONE_WUERDE.test(forms[index]) && hint.toLowerCase().includes(`… ${verb.toLowerCase()}`)) {
      const rest = parts[index + 1]; const end = rest.search(/[,.?!]/u);
      parts[index + 1] = end < 0 ? `${rest} ${verb}` : `${rest.slice(0, end).trimEnd()} ${verb}${rest.slice(end)}`;
    }
  }
  return out + parts[gaps];
}

/** v1 chips plus any word of the first answer they lack: in v1 some conditional items needed "würde" twice
 * but offered it once (k2c_012, k2c_013, k2c_018), so they could not be solved with chips. */
export function answerChips(tokens, answer) {
  const pool = [...tokens]; const missing = [];
  for (const word of answer.replace(/,/gu, ' ').split(/\s+/u).filter(Boolean)) {
    const index = pool.findIndex(token => token.toLowerCase() === word.toLowerCase());
    if (index < 0) missing.push(word); else pool.splice(index, 1);
  }
  return [...tokens, ...missing];
}

export function konjunktiv2Items(trainer, source) {
  return source.map(record => {
    const template = clean(record.sentence); const answers = record.answers.map(clean).filter(Boolean); const hint = clean(record.hint);
    return { id: clean(record.id), content: { trainer, template, answers, tokens: answerChips(record.tokens.map(clean).filter(Boolean), answers[0]), hint,
      solution: solvedSentence(template, answers[0], hint) } };
  });
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
  for (const item of dataset.items) if (!konjunktiv2Content(item.content)) throw new RangeError(`Unusable Konjunktiv II item ${dataset.id}/${item.id}`);
  createItemExerciseRegistry([dataset]);
  return dataset;
}
/** `sources`: the v1 arrays per trainer; `previous`: the committed datasets per trainer. */
export function convertKonjunktiv2Datasets(sources, previous = {}) {
  return Object.fromEntries(Object.entries(KONJUNKTIV2_DATASETS).map(([trainer, meta]) =>
    [trainer, versionDataset(meta, konjunktiv2Items(trainer, sources[trainer]), previous[trainer])]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const out = new URL('public/data/items/', root);
  const files = Object.fromEntries(Object.entries(KONJUNKTIV2_DATASETS).map(([trainer, meta]) => [trainer, new URL(`${meta.id}.json`, out)]));
  const previous = Object.fromEntries(Object.entries(files).filter(([, file]) => existsSync(file)).map(([trainer, file]) => [trainer, JSON.parse(readFileSync(file, 'utf8'))]));
  const sources = Object.fromEntries(Object.keys(KONJUNKTIV2_DATASETS).map(trainer => [trainer, read(`public/data/konjunktiv2-${trainer}.json`)]));
  const converted = convertKonjunktiv2Datasets(sources, previous);
  const stale = Object.entries(converted).filter(([trainer, dataset]) => !existsSync(files[trainer]) || readFileSync(files[trainer], 'utf8') !== formatDataset(dataset));
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error(`Stale Konjunktiv II datasets: ${stale.map(([, d]) => d.id).join(', ')}. Run node scripts/build-konjunktiv2-datasets.mjs`); process.exit(1); }
  } else {
    mkdirSync(out, { recursive: true });
    for (const [trainer, dataset] of stale) writeFileSync(files[trainer], formatDataset(dataset));
    console.log(`Konjunktiv II datasets: ${stale.length ? stale.map(([, d]) => `${d.id}@${d.version}`).join(', ') : 'up to date'}`);
  }
}
