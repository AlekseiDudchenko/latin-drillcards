# Vocabulary seed and canonical word IDs (F3 / #280)

The v2 shared catalog starts from the v1 deck JSON (`public/data/words-<deck>.json`,
plus `-detail.json` examples). This is a content transfer only: no users, accounts,
progress or SRS state are read or produced.

## Identity table

`content/vocabulary/identities.json` is the explicit, committed table of canonical
words. Each entry has:

- the `wordId`;
- its sources (`deck:entryId` of v1 entries, in deck priority order);
- `contentVersion` and a content hash;
- `senses`: the sense (lemma, article, part of speech, RU/EN gloss) of each entry
  when it joined the word, or when a change was confirmed;
- optionally `note`, which records a decision made by hand, and `partOfSpeech`,
  which overrides a part of speech the v1 tags got wrong.

ID rules:

- IDs are assigned once, as `w-<lemma slug>`, with a number when the slug is taken.
- An ID is never renamed or reused. A word whose entries all left the decks stays
  in the table as `retired` and is no longer published. When an entry of the same
  sense comes back, the word is revived under its old ID.
- The ID, not the slug, translation, JSON position or v1 entry ID, is the identity.
  One meaning in several decks is one wordId, so it has one progress. A renumbered
  entry, or one moved to another deck, keeps its wordId.

`npm run seed:assign` maintains the table:

- An unmapped entry joins an existing word only when the lemma, article and part
  of speech are equal **and** the two share a RU or EN gloss (glosses split on
  `,;/`, parentheses ignored). The comparison runs against every entry and every
  recorded sense of the word, including hand-decided words. Otherwise the entry
  revives a retired word of that sense, or gets a new ID.
- An edited entry must still match one of its word's recorded senses. A meaning
  change (der Löffel turned into die Gabel, Tisch turned into "spreadsheet") fails
  both the command and the build. Move the entry to another word in the table, or
  remove it there to get a new ID. If it really is the same meaning reworded
  without a shared gloss, run `npm run seed:assign -- --confirm <wordId>`.
  Rewording that keeps a shared gloss needs no decision.
- Spelling alone never merges: `ihr` (you / her), `sein` (his / to be) and
  `während` (during / while) stay apart. A different article or part of speech
  also stays apart.
- Changed content bumps that word's `contentVersion`; the wordId stays.
- The command rewrites `content/vocabulary/duplicates.md`. The report lists every
  merged word with its entries, the hand decisions, and the words kept apart
  although they share a lemma (ignoring case and article: `sie`/`Sie`,
  `der Morgen`/`morgen`).

To split or merge differently, move source entries between IDs in the table (add a
`note`) and run the command again. Hand decisions persist.

## Merging rules

- **Part of speech:** v1 has none. A noun follows from the article. Otherwise the
  tags decide: verb tags make a verb, `adjektiv` an adjective, `adverb` an adverb;
  collocations, fixed phrases and function words are `other`. Entries without a
  grammar tag (the Beruf adjectives, `agil`, `deshalb`) are fixed by hand in the
  table.
- **Disambiguated lemmas:** a lemma such as `sie (Plural)` keeps its label for
  display, and the bare form (`sie`) is an accepted German answer.
- **Article and lemma:** `die (Pl.)` becomes the article `die` plus a `plural` tag.
  Weekdays and months keep their article even though v1 prints them bare.
- **Meanings:** the preferred RU/EN meaning is the gloss of the first source, the
  lowest CEFR level, themed decks last. The other sources' distinct glosses become
  accepted alternatives, so the richer wording is kept.
- **Examples:** the main example and the detail examples of every source, in order.
  Repeated German sentences are removed, and an example without any translation
  is dropped. Each example ID names its source: `a2:w_a2_278:main`, or for detail
  examples a hash of the sentence (`a2:w_a2_278:detail:1f0c…`), so deleting one
  example never renames another.
- **Tags:** the union in order. The v1 detail fields `family`, `synonyms`,
  `antonyms` and `wendungen`, and the entry `level`, are not part of the v2 read
  model.

## Seed

`buildSeed` (scripts/vocabulary-seed.mjs) turns the table and decks into the seed:

- published `Word`s and one `Deck` per v1 deck, with `wordIds` in deck order and
  deduplicated;
- `provenance` (wordId → source entries), `translationSources` (wordId → language
  → gloss text → the entries that wrote it) and the SHA-256 of each source file;
- `retiredWordIds`, which the catalog keeps reserved;
- a content-derived `catalogVersion`.

It is not written to the site. `npm run build` validates it: every word passes
`assertPublishedWord`, decks pass `assertDecks` (core), every word belongs to a deck,
and the catalog loads into the exercise registry. `npm run catalog:bootstrap`
(F2) turns the same seed into SQL, and `npm run catalog:import` (#356) applies a
newer seed to a live catalog as a diff. Building twice gives identical output.

The build fails when the table is stale (an unmapped or missing source, changed
content, an entry that no longer matches its sense) instead of guessing; run
`npm run seed:assign` after editing a deck. The command validates the words
before it writes the table.

A word present in two CEFR decks (e.g. `der Löffel` in A1 and A2) stays a member
of both decks but is the same wordId, so the v1 problem of two independent SRS
cards is gone. Pruning deck membership is a curriculum decision, not part of the
seed. The fresh Supabase bootstrap and loading of this seed are described in
[catalog-schema.md](catalog-schema.md) (F2 / #307).

## Verification

`npm run verify` runs `test/vocabulary-seed.test.mjs`:

- the table and report are current;
- repeatable output, every source mapped exactly once, referential integrity;
- no user or progress fields;
- merged words and homonyms;
- article, part-of-speech and meaning differences are never merged;
- stable IDs, versioning, retirement and revival;
- renumbered or moved entries keep their ID;
- meaning changes fail until moved or confirmed;
- new entries join hand-decided words;
- disambiguated lemmas accept the bare form;
- stable detail example IDs;
- stale tables fail;
- examples are unique per word and keep their provenance.
