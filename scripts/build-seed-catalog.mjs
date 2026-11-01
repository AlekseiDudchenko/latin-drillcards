import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { assertDecks, assertPublishedWord, createWordExerciseRegistry } from '../packages/vocabulary-core/dist/index.js';
import { IDENTITIES_PATH, buildSeed, loadSources } from './vocabulary-seed.mjs';

// Validates the v2 vocabulary seed on every build: published Words, Decks of wordIds and provenance,
// rebuilt from the identity table. Fails when the table is stale; run `npm run seed:assign` after editing a deck.
// `npm run catalog:bootstrap` turns the same seed into SQL. Until the client reads the published catalog
// from Supabase, the v2 home reads this seed as static JSON (gitignored build output, docs/home-screen.md):
// public/v2/catalog/index.json lists the decks; deck-<id>.json holds one deck and its published words.
const seed = buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')), loadSources());
seed.words.forEach(assertPublishedWord);
assertDecks(seed.decks, seed.words);
const members = new Set(seed.decks.flatMap(deck => deck.wordIds));
const orphan = seed.words.find(word => !members.has(word.id));
if (orphan) throw new RangeError(`Word ${orphan.id} belongs to no deck`);
createWordExerciseRegistry(seed.words, seed.catalogVersion);
const merged = Object.values(seed.provenance).filter(sources => sources.length > 1).length;
console.log(`Vocabulary seed ${seed.catalogVersion}: ${seed.words.length} words, ${seed.decks.length} decks, ${merged} merged across decks`);

const out = 'public/v2/catalog';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const byId = new Map(seed.words.map(word => [word.id, word]));
const json = value => JSON.stringify(value);
writeFileSync(`${out}/index.json`, json({ catalogVersion: seed.catalogVersion,
  decks: seed.decks.map(({ id, title, wordIds }) => ({ id, title, wordIds })) }));
for (const deck of seed.decks)
  writeFileSync(`${out}/deck-${deck.id}.json`, json({ catalogVersion: seed.catalogVersion, deck, words: deck.wordIds.map(id => byId.get(id)) }));
