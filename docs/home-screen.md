# Home, deck, word card and summary (L4 / #318)

`public/v2/session.html` is the v2 vocabulary home (the "Words" section; the site entry is [Today](site-navigation.md#today)). One page, four screens chosen
by the URL hash, all reading the same owner-scoped projections and the same
queries as the [planner](session-planner.md):

| Hash | Screen |
| --- | --- |
| `#` (or none) | Public decks with search; "N words · started M" per deck |
| `#deck=<deckId>` | Counts, Learn new / Review due, format, exercise, translation language; the deck's words with search |
| `#word=<wordId>&deck=<deckId>` | Word card: per-component progress, next review, the decks that contain the word, published details |
| `#session` | The running session (card → [Runner](session-runner.md)) and, once it ends, the [summary](session-circuit.md#summary) |

`parseRoute`/`routeHash` in `src/client/v2/home-model.ts` own the hash format; the
module is DOM-free and unit-tested (`test/home-model.test.mjs`).

## Catalog

Until the client reads the published catalog from Supabase, `npm run build`
(`scripts/build-seed-catalog.mjs`) writes the vocabulary seed as static JSON next
to the page — gitignored build output, fetched relative to the module so it works
under any site base:

- `public/v2/catalog/index.json` — `{ catalogVersion, decks: Deck[] }`; word IDs
  give the started count and the word → deck lookup without loading every deck;
- `public/v2/catalog/deck-<id>.json` — `{ catalogVersion, deck, words }`.

On a configured build the home reads the published catalog (`catalog_release`,
`catalog_decks`, `catalog_words`) with the signed-in owner's access instead, and
its learning store is that owner's scope with sync after every saved answer (R1a,
[v2-environments.md](v2-environments.md#page-wiring-r1a)). Static JSON remains the
unconfigured local fallback; hosted errors are shown, never replaced by it.

A session pins the chosen deck's words and `catalogVersion` as its archive (the
choice-distractor pool); reload never reads a newer catalog.

## New, due and continue are separate

- **Learn new** and **Review due** are two buttons with their own counts. The
  counts come from `vocabularyQueues` (core), the planner's own candidate queues
  for the chosen format, exercise and translation language, so the home screen and
  the planner cannot disagree on what is new or due. **Learn new** has no format
  or exercise choice: it is always a circuit of five new words through every
  exercise, so only Review due follows the format, exercise and scope controls.
  The planner may still skip a queued word with no available task (too few
  choice options) — it never adds one.
- An empty queue disables its button and says why (`emptyQueueReason`): all words
  started, no translation in the chosen language, nothing started yet, nothing due
  yet (with the next deadline), or words exist but not for this exercise. A queue
  is never padded from the other one.
- An unfinished session shows a **Continue** panel (deck, task n of total) on the
  home, deck and word screens, with Continue and Finish. While it exists both start
  buttons are disabled: a new session never silently replaces or mixes with it.
  Leaving `#session` (Back, a link) releases the Runner; storage keeps the session.
  Reloading on `#session` reopens it, resuming a paused one.

## One word, one progress

Progress is keyed by owner + wordId. A word in several decks shows the same state
and components on every deck's list and word card, and counts as started in each of
those decks. The word card states that progress is shared and that familiar words
still return for review; it shows stages and dates, never "learned forever".

## Word status in the deck list

Each deck word has a collapsed "Exercise progress" block (`describeWordStatus`, `word-status.ts`,
policy `word-status/1`). It lists every exercise except the introduction with `reviews / required`, a pip per
required review and a "done" mark, plus the stability of every introduced component.

- Progress is stored per component, not per exercise, so a row shows the weakest component the exercise
  assesses (`WORD_EXERCISE_RULES[...].assessed`) and says which components it trains. Two exercises on one
  component therefore show the same count.
- A component is done when it is in `review` with at least 3 counted reviews and stability of 21 days or more.
  A word is **learned** when every applicable component is done; **not settled** when every component has
  the reviews but memory is not stable yet or a component is relearning; otherwise learning, or new before
  its introduction. A lapse (relearning) takes a learned word back out of that state.
- Article exercises are unavailable (with a reason) for words without a known article; the other exercises
  are unavailable when the selected answer language has no translation.
- The status is derived only from owner progress and the answer language, never from the deck, so a
  shared word shows the same rows in every deck. The word card is unchanged: stages and dates, no
  "learned forever" claim.

## Exercises

The exercise menu is built from `WORD_EXERCISE_IDS` (the shared registry), minus the
introduction, which is part of learning new words. Other exercise families join the
home navigation as they are ported (E9 / #329); the full set is accepted before
release (R1 / #325).

## Verification

`npm run verify`, `npx tsc -p test/tsconfig.json` and
`npx playwright test test/session-page.spec.ts`. The page spec stubs the catalog
with the 8-word preview deck plus a two-word deck sharing two of its words, and
covers deck search, counts and empty reasons, Continue/Finish of an unfinished
session, the summary → word card link, identical word progress from both decks,
word search and a 360 px phone layout.

### Deck list controls

The word and its progress share one expandable card. Its summary shows the headword,
translation, learned status, whether review is due, and counts for each applicable component.
Open the card to see exercise details and the link to the full word card.

Status filters (all, due, new, learning, not settled, learned) combine with search and part of
speech. The status buttons show whole-deck counts; the results line shows the combined
selection. Sorting supports deck order, German lemma (ignoring the article), weakest component
stability first, and learned words first (then stability descending). Equal values retain deck
order. Sorting retains open cards. Changing decks resets search, status and part-of-speech filters.
