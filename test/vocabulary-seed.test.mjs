import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDecks, assertPublishedWord, createWordExerciseRegistry, evaluateTargetProduction } from '../packages/vocabulary-core/dist/index.js';
import { IDENTITIES_PATH, REPORT_PATH, assignIdentities, buildSeed, duplicateReport, loadSources,
  normalizeEntry, sameSense } from '../scripts/vocabulary-seed.mjs';

const identities = JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8'));
const sources = loadSources();
const seed = buildSeed(identities, sources);
const byId = new Map(seed.words.map(word => [word.id, word]));
const wordOf = source => identities.words.find(word => word.sources.includes(source))?.id;
const entry = (patch, id = 'x1', deck = 'basic') => normalizeEntry(deck, { id, la: 'liber', pos: 'noun', ru: 'книга', en: 'book',
  exampleLa: 'Liber meus est.', exampleRu: 'Это моя книга.', exampleEn: 'The book is mine.', tags: [], ...patch });

test('the committed identity table and report are current: seed:assign would change nothing', () => {
  assert.deepEqual(assignIdentities(identities, sources), identities);
  assert.equal(readFileSync(REPORT_PATH, 'utf8'), duplicateReport(identities, sources));
});

test('the seed is repeatable and every source entry belongs to exactly one word', () => {
  assert.equal(JSON.stringify(buildSeed(identities, loadSources())), JSON.stringify(seed));
  const mapped = identities.words.flatMap(word => word.sources);
  assert.equal(new Set(mapped).size, mapped.length);
  assert.deepEqual(new Set(mapped), new Set(sources.entries.map(e => e.source)));
});

test('published words and decks are valid and contain no users, progress or SRS state', () => {
  seed.words.forEach(assertPublishedWord);
  assertDecks(seed.decks, seed.words);
  createWordExerciseRegistry(seed.words, seed.catalogVersion);
  assert.deepEqual(Object.keys(seed).sort(), ['catalogVersion', 'decks', 'provenance', 'retiredWordIds', 'schemaVersion', 'seedVersion',
    'source', 'translationSources', 'words']);
  const keys = new Set(); (function walk(v) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) keys.add(k); walk(x); } })({ ...seed, provenance: [], translationSources: [] });
  for (const forbidden of ['owner', 'progress', 'srs', 'dueAt', 'reviewCount', 'userId', 'components']) assert.ok(!keys.has(forbidden), forbidden);
  for (const e of sources.entries) assert.ok(seed.decks.find(d => d.id === e.deck).wordIds.includes(wordOf(e.source)), e.source);
  assert.deepEqual(seed.decks.map(d => d.id), ['l1-a', 'l1-b', 'l1-t', 'basic', 'verbs']);
});

test('one meaning in several decks is one wordId; homonyms stay apart', () => {
  const again = entry({}, 'x9', 'verbs');
  const home = entry({}, 'x1');
  const homonym = entry({ id: 'x2', pos: 'adjective', ru: 'свободный', en: 'free' }, 'x2');
  const table = assignIdentities(undefined, { files: {}, entries: [home, again, homonym] });
  assert.equal(table.words.length, 2);
  assert.deepEqual(table.words.find(w => w.sources.includes('basic:x1')).sources, ['basic:x1', 'verbs:x9']);
  assert.notEqual(wordOf('basic:w_basic_6'), undefined);
});

test('part of speech or meaning differences never merge automatically', () => {
  const base = entry({});
  assert.equal(sameSense(base, entry({ ru: 'книга, том' }, 'x2')), true);
  assert.equal(sameSense(base, entry({ ru: 'свободный', en: 'free' }, 'x3')), false, 'other meaning');
  assert.equal(sameSense(base, entry({ pos: 'adjective' }, 'x4')), false, 'same gloss, other part of speech');
  assert.equal(sameSense(base, entry({ la: 'libri' }, 'x5')), false, 'other lemma');
});

test('assignment keeps existing IDs, retires removed ones and versions content changes', () => {
  const small = { files: {}, entries: sources.entries.filter(e => e.deck === 'verbs') };
  const first = assignIdentities(undefined, small);
  assert.ok(first.words.every(word => word.contentVersion === 1));
  const [changed, ...rest] = small.entries;
  const edited = { ...changed, en: changed.en + ', extra' };
  const homonym = { ...changed, source: 'verbs:new', ru: 'другое', en: 'other', examples: [] };
  const second = assignIdentities(first, { files: {}, entries: [edited, ...rest, homonym] });
  const before = new Map(first.words.map(word => [word.id, word]));
  for (const word of second.words.filter(word => before.has(word.id)))
    assert.equal(word.contentVersion, before.get(word.id).contentVersion + (word.sources.includes(changed.source) ? 1 : 0), word.id);
  const fresh = second.words.find(word => word.sources.includes('verbs:new'));
  assert.ok(!before.has(fresh.id) && fresh.id !== first.words.find(w => w.sources.includes(changed.source)).id);
  const third = assignIdentities(second, { files: {}, entries: [edited, ...rest] });
  const retired = third.words.find(word => word.id === fresh.id);
  assert.deepEqual([retired.retired, retired.sources], [true, []]);
  const other = { ...homonym, source: 'verbs:other', ru: 'третье', en: 'third' };
  const fourth = assignIdentities(third, { files: {}, entries: [edited, ...rest, other, { ...homonym, source: 'verbs:again' }] });
  assert.notEqual(fourth.words.find(word => word.sources.includes('verbs:other')).id, fresh.id);
  assert.equal(fourth.words.find(word => word.sources.includes('verbs:again')).id, fresh.id);
  assert.ok(!buildSeed(third, { files: {}, entries: [edited, ...rest] }).words.some(word => word.id === fresh.id));
});

test('a stale identity table fails the build instead of guessing', () => {
  const extra = { ...sources.entries[0], source: 'basic:unmapped' };
  assert.throws(() => buildSeed(identities, { ...sources, entries: [...sources.entries, extra] }), /unmapped/);
  const changed = sources.entries.map((e, i) => i === 0 ? { ...e, en: e.en + '!' } : e);
  assert.throws(() => buildSeed(identities, { ...sources, entries: changed }), /changed; run npm run seed:assign/);
});

test('examples keep translations, are unique per word and carry their source entry', () => {
  for (const word of seed.words) {
    assert.equal(new Set(word.examples.map(e => e.text)).size, word.examples.length, word.id);
    for (const example of word.examples) assert.ok(seed.provenance[word.id].some(source => example.id.startsWith(source + ':')), example.id);
  }
  assert.deepEqual(byId.get('w-rosa').examples[0], { id: 'basic:w_basic_1:main', text: 'Rosa pulchra est.',
    translations: { ru: 'Роза прекрасна.', en: 'The rose is beautiful.' } });
});

const patched = (source, patch) => ({ ...sources, entries: sources.entries.map(e => e.source === source ? { ...e, ...patch } : e) });

test('an edited entry that changes meaning fails until confirmed; rewording keeps the ID', () => {
  const table = patched('basic:w_basic_1', { ru: 'таблица', en: 'spreadsheet' });
  assert.throws(() => assignIdentities(identities, table), /w-rosa: .* no longer matches/);
  assert.throws(() => buildSeed(identities, table), /no longer matches/);
  const version = identities.words.find(w => w.id === 'w-rosa').contentVersion;
  assert.equal(assignIdentities(identities, table, { confirm: ['w-rosa'] }).words.find(w => w.id === 'w-rosa').contentVersion, version + 1);
  const reworded = assignIdentities(identities, patched('basic:w_basic_1', { ru: 'роза, розовый куст' })).words.find(w => w.id === 'w-rosa');
  assert.equal(reworded.contentVersion, version + 1);
});

test('renumbered, moved or removed-and-restored entries keep their wordId', () => {
  const renumbered = patched('basic:w_basic_1', { source: 'basic:w_basic_9999' });
  assert.equal(assignIdentities(identities, renumbered).words.find(w => w.sources.includes('basic:w_basic_9999')).id, 'w-rosa');
  const moved = patched('basic:w_basic_2', { source: 'verbs:w_verbs_9999', deck: 'verbs' });
  assert.equal(assignIdentities(identities, moved).words.find(w => w.sources.includes('verbs:w_verbs_9999')).id, 'w-aqua');
  const without = { ...sources, entries: sources.entries.filter(e => e.source !== 'basic:w_basic_3') };
  const removed = assignIdentities(identities, without);
  assert.equal(removed.words.find(w => w.id === 'w-terra').retired, true);
  const restored = assignIdentities(removed, sources).words.find(w => w.id === 'w-terra');
  assert.deepEqual([restored.retired, restored.sources], [undefined, ['basic:w_basic_3']]);
});

test('a disambiguated lemma accepts the bare typed form', () => {
  const word = { ...byId.get('w-rosa'), lemma: 'liber (book)', acceptedForms: ['liber'] };
  assert.equal(evaluateTargetProduction(word, 'liber', false, seed.words).components.recall, 'correct');
});

test('Latin answers: macrons are optional, case and u/v, i/j are recalled but not spelled', () => {
  const rosa = byId.get('w-rosa'); const vir = byId.get('w-vir');
  const check = (word, answer) => evaluateTargetProduction(word, answer, false, seed.words);
  assert.equal(check(rosa, 'rosa').outcome, 'correct');
  assert.equal(check(rosa, 'rosā').outcome, 'correct', 'a macron never decides spelling');
  assert.equal(check({ ...rosa, lemma: 'rosā' }, 'rosa').outcome, 'correct');
  assert.deepEqual([check(rosa, 'Rosa').components.recall, check(rosa, 'Rosa').components.spelling, check(rosa, 'Rosa').outcome], ['correct', 'incorrect', 'incorrect']);
  assert.equal(check(vir, 'uir').components.recall, 'correct');
  assert.equal(check(vir, 'uir').outcome, 'incorrect');
  assert.equal(check(rosa, 'rosae').components.recall, 'incorrect');
  assert.throws(() => check(rosa, ''), RangeError);
});

test('detail example IDs follow the sentence, so deleting one never renames another', () => {
  const detail = { examples: [{ text: 'Liber magnus est.', ru: 'Книга большая.' }, { text: 'Librum lego.', ru: 'Я читаю книгу.' }] };
  const raw = { id: 'x1', la: 'liber', pos: 'noun', ru: 'книга', en: 'book', exampleLa: 'Liber meus est.', exampleRu: 'Это моя книга.' };
  const ids = normalizeEntry('basic', raw, detail).examples.map(e => e.id);
  const fewer = normalizeEntry('basic', raw, { examples: detail.examples.slice(1) });
  assert.deepEqual(fewer.examples.map(e => e.id), [ids[0], ids[2]]);
});

test('each published gloss credits only the entries that wrote it', () => {
  for (const word of seed.words) for (const [lang, meaning] of Object.entries(word.meanings))
    for (const text of [meaning.preferred, ...meaning.accepted]) assert.ok(seed.translationSources[word.id][lang][text]?.length, `${word.id} ${lang} ${text}`);
});
