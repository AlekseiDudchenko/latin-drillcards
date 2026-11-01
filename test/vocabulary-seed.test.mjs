import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDecks, assertPublishedWord, createWordExerciseRegistry } from '../packages/vocabulary-core/dist/index.js';
import { IDENTITIES_PATH, REPORT_PATH, assignIdentities, buildSeed, duplicateReport, loadSources,
  normalizeEntry, sameSense } from '../scripts/vocabulary-seed.mjs';
import { evaluateGermanProduction } from '../packages/vocabulary-core/dist/index.js';

const identities = JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8'));
const sources = loadSources();
const seed = buildSeed(identities, sources);
const byId = new Map(seed.words.map(word => [word.id, word]));
const wordOf = source => identities.words.find(word => word.sources.includes(source))?.id;

test('the committed identity table and report are current: seed:assign would change nothing', () => {
  assert.deepEqual(assignIdentities(identities, sources), identities);
  assert.equal(readFileSync(REPORT_PATH, 'utf8'), duplicateReport(identities, sources));
});

test('the seed is repeatable and every source entry belongs to exactly one word', () => {
  assert.equal(JSON.stringify(buildSeed(identities, loadSources())), JSON.stringify(seed));
  const mapped = identities.words.flatMap(word => word.sources);
  assert.equal(new Set(mapped).size, mapped.length);
  assert.deepEqual(new Set(mapped), new Set(sources.entries.map(entry => entry.source)));
});

test('published words and decks are valid and contain no users, progress or SRS state', () => {
  seed.words.forEach(assertPublishedWord);
  assertDecks(seed.decks, seed.words);
  createWordExerciseRegistry(seed.words, seed.catalogVersion);
  assert.deepEqual(Object.keys(seed).sort(), ['catalogVersion', 'decks', 'provenance', 'retiredWordIds', 'schemaVersion', 'seedVersion',
    'source', 'translationSources', 'words']);
  const keys = new Set(); (function walk(v) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) keys.add(k); walk(x); } })({ ...seed, provenance: [], translationSources: [] }); // keyed by data, not structure
  for (const forbidden of ['owner', 'progress', 'srs', 'dueAt', 'reviewCount', 'userId', 'components']) assert.ok(!keys.has(forbidden), forbidden);
  // Every deck entry is reachable through its deck.
  for (const entry of sources.entries) assert.ok(seed.decks.find(d => d.id === entry.deck).wordIds.includes(wordOf(entry.source)), entry.source);
});

test('one meaning in several decks is one wordId; homonyms stay apart', () => {
  // Same word in A1 and A2: one ID referenced by both decks, so it has one progress.
  const loeffel = wordOf('a1:' + sources.entries.find(e => e.deck === 'a1' && e.de === 'der Löffel').source.split(':')[1]);
  for (const deck of ['a1', 'a2']) assert.ok(seed.decks.find(d => d.id === deck).wordIds.includes(loeffel), deck);
  // Different meanings of one spelling keep separate IDs.
  for (const de of ['ihr', 'sein', 'während']) {
    const ids = new Set(sources.entries.filter(e => e.de === de).map(e => wordOf(e.source)));
    assert.equal(ids.size, 2, de);
  }
  // The richer glosses survive as accepted translations of the first (lowest-level) entry.
  const hose = byId.get(wordOf(sources.entries.find(e => e.de === 'die Hose').source));
  assert.equal(hose.meanings.ru.preferred, 'брюки');
  assert.deepEqual(hose.meanings.ru.accepted, ['брюки, штаны']);
});

test('article, part of speech or meaning differences never merge automatically', () => {
  const entry = (patch, id) => normalizeEntry('a1', { id, de: 'der Band', article: 'der', ru: 'том', en: 'volume',
    exampleDe: 'Der Band ist dick.', exampleRu: 'Том толстый.', exampleEn: 'The volume is thick.', tags: [], ...patch });
  const base = entry({}, 'x1');
  assert.equal(sameSense(base, entry({ ru: 'том, книга' }, 'x2')), true);
  assert.equal(sameSense(base, entry({ de: 'das Band', article: 'das', ru: 'лента', en: 'ribbon' }, 'x3')), false);
  assert.equal(sameSense(base, entry({ de: 'das Band', article: 'das' }, 'x4')), false, 'same gloss, other article');
  assert.equal(sameSense(base, entry({ ru: 'группа', en: 'band' }, 'x5')), false, 'other meaning');
  const verb = normalizeEntry('a1', { id: 'v1', de: 'laufen', article: '', ru: 'бежать', en: 'to run', exampleDe: 'Ich laufe.', exampleRu: 'Я бегу.', exampleEn: 'I run.', tags: ['verb'] });
  const other = normalizeEntry('a1', { id: 'v2', de: 'laufen', article: '', ru: 'бежать', en: 'to run', exampleDe: 'Es läuft.', exampleRu: 'Идёт.', exampleEn: 'It runs.', tags: ['kollokation'] });
  assert.equal(sameSense(verb, other), false, 'other part of speech');
});

test('assignment keeps existing IDs, retires removed ones and versions content changes', () => {
  const small = { files: {}, entries: sources.entries.filter(e => e.deck === 'c1') };
  const first = assignIdentities(undefined, small);
  assert.ok(first.words.every(word => word.contentVersion === 1));
  // Changing one gloss bumps only that word; a new entry with a known spelling but another sense gets a new ID.
  const [changed, ...rest] = small.entries;
  const edited = { ...changed, en: changed.en + ', extra' };
  const homonym = { ...changed, source: 'c1:new', ru: 'другое', en: 'other', examples: [] };
  const second = assignIdentities(first, { files: {}, entries: [edited, ...rest, homonym] });
  const before = new Map(first.words.map(word => [word.id, word]));
  for (const word of second.words.filter(word => before.has(word.id)))
    assert.equal(word.contentVersion, before.get(word.id).contentVersion + (word.sources.includes(changed.source) ? 1 : 0), word.id);
  const fresh = second.words.find(word => word.sources.includes('c1:new'));
  assert.ok(!before.has(fresh.id) && fresh.id !== wordOf(changed.source));
  // Removing an entry retires its word; the ID is never handed to a word of another sense,
  // while the same sense coming back revives it.
  const third = assignIdentities(second, { files: {}, entries: [edited, ...rest] });
  const retired = third.words.find(word => word.id === fresh.id);
  assert.deepEqual([retired.retired, retired.sources], [true, []]);
  const other = { ...homonym, source: 'c1:other', ru: 'третье', en: 'third' };
  const fourth = assignIdentities(third, { files: {}, entries: [edited, ...rest, other, { ...homonym, source: 'c1:again' }] });
  assert.notEqual(fourth.words.find(word => word.sources.includes('c1:other')).id, fresh.id);
  assert.equal(fourth.words.find(word => word.sources.includes('c1:again')).id, fresh.id);
  assert.ok(!buildSeed(third, { files: {}, entries: [edited, ...rest] }).words.some(word => word.id === fresh.id));
});

test('a stale identity table fails the build instead of guessing', () => {
  const extra = { ...sources.entries[0], source: 'a1:unmapped' };
  assert.throws(() => buildSeed(identities, { ...sources, entries: [...sources.entries, extra] }), /unmapped/);
  const changed = sources.entries.map((e, i) => i === 0 ? { ...e, en: e.en + '!' } : e);
  assert.throws(() => buildSeed(identities, { ...sources, entries: changed }), /changed; run npm run seed:assign/);
});

test('examples keep translations, are unique per word and carry their source entry', () => {
  for (const word of seed.words) {
    assert.equal(new Set(word.examples.map(e => e.de)).size, word.examples.length, word.id);
    for (const example of word.examples) assert.ok(seed.provenance[word.id].some(source => example.id.startsWith(source + ':')), example.id);
  }
  const tisch = byId.get(wordOf('a1:w_a1_1'));
  assert.deepEqual(tisch.examples[0], { id: 'a1:w_a1_1:main', de: 'Der Tisch ist groß.', translations: { ru: 'Стол большой.', en: 'The table is big.' } });
});

const patched = (source, patch) => ({ ...sources, entries: sources.entries.map(e => e.source === source ? { ...e, ...patch } : e) });

test('an edited entry that changes meaning fails until moved or confirmed; rewording keeps the ID', () => {
  // A merged entry turned into another word must not stay merged (der Löffel A2 → die Gabel).
  const gabel = patched('a2:w_a2_278', { de: 'die Gabel', lemma: 'Gabel', article: 'die', ru: 'вилка', en: 'fork' });
  assert.throws(() => assignIdentities(identities, gabel), /w-loeffel: a2:w_a2_278 .* no longer matches its sense/);
  assert.throws(() => buildSeed({ ...identities, words: identities.words.map(w => ({ ...w })) }, gabel), /no longer matches/);
  // A single-entry meaning change is a decision too, not a silent version bump.
  const table = patched('a1:w_a1_1', { ru: 'таблица', en: 'spreadsheet' });
  assert.throws(() => assignIdentities(identities, table), /w-tisch: .* no longer matches/);
  const confirmed = assignIdentities(identities, table, { confirm: ['w-tisch'] }).words.find(w => w.id === 'w-tisch');
  assert.equal(confirmed.contentVersion, identities.words.find(w => w.id === 'w-tisch').contentVersion + 1);
  // Rewording with a shared gloss is the same meaning: same ID, next version, no decision needed.
  const reworded = assignIdentities(identities, patched('a1:w_a1_1', { ru: 'стол, столик' })).words.find(w => w.id === 'w-tisch');
  assert.equal(reworded.contentVersion, identities.words.find(w => w.id === 'w-tisch').contentVersion + 1);
});

test('renumbered, moved or removed-and-restored entries keep their wordId', () => {
  const renumbered = patched('a1:w_a1_1', { source: 'a1:w_a1_9999' });
  assert.equal(assignIdentities(identities, renumbered).words.find(w => w.sources.includes('a1:w_a1_9999')).id, 'w-tisch');
  const moved = patched('a1:w_a1_2', { source: 'a2:w_a2_9999', deck: 'a2' });
  assert.equal(assignIdentities(identities, moved).words.find(w => w.sources.includes('a2:w_a2_9999')).id, 'w-stuhl');
  const without = { ...sources, entries: sources.entries.filter(e => e.source !== 'a1:w_a1_3') };
  const removed = assignIdentities(identities, without);
  assert.equal(removed.words.find(w => w.id === 'w-lampe').retired, true);
  const restored = assignIdentities(removed, sources).words.find(w => w.id === 'w-lampe');
  assert.deepEqual([restored.retired, restored.sources], [undefined, ['a1:w_a1_3']]);
});

test('new entries join hand-decided words and use their part of speech', () => {
  const b1 = sources.entries.find(e => e.source === 'b1:w_b1_065');
  const extra = { ...sources, entries: [...sources.entries, { ...b1, source: 'c1:trotzdem', deck: 'c1' }] };
  assert.equal(assignIdentities(identities, extra).words.find(w => w.sources.includes('c1:trotzdem')).id, 'w-trotzdem');
  for (const id of ['w-teamfaehig', 'w-flexibel', 'w-agil']) assert.equal(seed.words.find(w => w.id === id).partOfSpeech, 'adjective', id);
  assert.equal(seed.words.find(w => w.id === 'w-deshalb').partOfSpeech, 'adverb');
});

test('a disambiguated lemma accepts the bare typed form and the report groups same lemmas', () => {
  const sie = seed.words.find(w => w.id === 'w-sie-singular');
  assert.deepEqual([sie.lemma, sie.acceptedGermanForms], ['sie (Singular)', ['sie']]);
  assert.equal(evaluateGermanProduction(sie, 'sie', false, seed.words).components.recall, 'correct');
  const report = readFileSync(REPORT_PATH, 'utf8');
  assert.match(report, /- morgen\n  - `w-morgen` der Morgen[^\n]*\n  - `w-morgen-2` morgen/);
  assert.match(report, /- sie\n(  - .*\n){3}/);
});

test('detail example IDs follow the sentence, so deleting one never renames another', () => {
  const entry = sources.entries.find(e => e.source === 'a2:w_a2_278');
  const ids = entry.examples.map(e => e.id);
  const detail = JSON.parse(readFileSync('public/data/words-a2-detail.json', 'utf8'))['w_a2_278'];
  const raw = JSON.parse(readFileSync('public/data/words-a2.json', 'utf8')).find(e => e.id === 'w_a2_278');
  const fewer = normalizeEntry('a2', raw, { ...detail, examples: detail.examples.slice(1) });
  assert.deepEqual(fewer.examples.map(e => e.id), [ids[0], ...ids.slice(2)]);
});

test('each published gloss credits only the entries that wrote it', () => {
  const hose = seed.words.find(w => w.id === wordOf(sources.entries.find(e => e.de === 'die Hose').source));
  const [a1, a2] = seed.provenance[hose.id];
  assert.deepEqual(seed.translationSources[hose.id].ru, { 'брюки': [a1], 'брюки, штаны': [a2] });
  for (const word of seed.words) for (const [lang, meaning] of Object.entries(word.meanings))
    for (const text of [meaning.preferred, ...meaning.accepted]) assert.ok(seed.translationSources[word.id][lang][text]?.length, `${word.id} ${lang} ${text}`);
});
