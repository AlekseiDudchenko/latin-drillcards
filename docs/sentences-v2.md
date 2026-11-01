# Sentence builder on the shared Runner (M1 / #333)

FC03 of the [capability matrix](exercise-capability-matrix.ru.md), built on the G3 item
contracts ([learning-sync.md](learning-sync.md#shared-journal-for-every-target-g3--332)).
Page: `/v2/sentences.html`. The old `sentences.ts` writer (`recordAnswer`) is not used.

## Content

`npm run items:sentences` (`scripts/build-sentence-dataset.mjs`) converts the v1 decks
`public/data/sentences-<deck>.json` (a1…c2, beruf, arch) into one immutable `ItemDataset`
at `public/data/items/sentences.json`. The file is committed, and its `version`
(`sentences-<hash>`) is derived from the content. `test/sentences.test.mjs` fails when
the file is stale and checks that every v1 field is kept: target, tokens, alternatives,
RU/EN/ES translations, explanation, `variant_of`, tense and `tense_variants`, level and
tags. It also checks that every sentence is solvable. Publish a version for the server
with `npm run catalog:datasets -- --output FILE public/data/items/sentences.json`.

## Adapter (`packages/vocabulary-core/src/families/sentences.ts`)

`SENTENCE_ASSEMBLY` (`sentence-assembly/1`) is registered in `ITEM_EXERCISES`, so the
Edge Function re-evaluates it.
- **Task:** the translation prompt and the tokens in a deterministic order, keyed by
  seed and item. The order is never the solution, and a retry with the same seed keeps
  it.
- **Answer:** the placed token IDs. They are checked as text against the target and
  every alternative. Only whitespace and a final `. ? !` are neutral; case, commas and
  order count.
- **Reuse:** the target kinds are `sentence` and `video-segment`. M2 (audio) and M6
  (video) can call `buildSentenceExercise(item, context, prompt)` with their own prompt
  and reuse the token answer and `evaluateSentenceTokens`.
- **No word progress:** `wordIds` are empty, and an item answer never reaches the
  WordProgress projector.

## Page

- **Sessions:** each shown sentence is one single-task item session on the shared
  `SessionRunner`, in the same journal and outbox as words. Before Next, Previous, a
  tense button, the word-order variant or a filter change shows another sentence, the
  shown session is completed if it has an answer or abandoned if it has none (no
  event). So switching never loses an answer or writes one twice, and a reload
  continues the shown sentence.
- **Check / Next:** use the shared `createCardShell` action slot, as word cards do.
  Placing the last token does not submit: Check saves the answer, then Next replaces
  it in the same place and receives focus, for both correct and incorrect answers.
- **Retries:** "Try again" after a wrong answer, and Previous, start the same sentence
  with the same token order. They are submitted as `assisted`, so a retry never counts
  as an independent first answer.
- **Filters:** level (all A1–C2, or one deck including Beruf and Architektur) and
  topic, kept in the URL hash (`#deck=b1&tag=passiv`). The next sentence is chosen by
  `selectItems`: never answered first, then last wrong, then the oldest.
- **Statistics:** per sentence (answers, right on the first try) and per filter
  (answered of total, accuracy), from `projectExerciseProgress`.
- **Text and sound:** the explanation, the other translations (RU/EN/ES) and German
  speech once the answer is saved, plus an optional auto-speak after a correct answer.
  The interface is RU/EN/DE without replacing the shown task. The translation language
  applies from the next sentence.
- **Keyboard:** the TokenInput keys, → next, ← previous, and Enter after the answer
  (next for either outcome; Try again remains a separate action).

Verification: `node --test test/sentences.test.mjs` and
`npx playwright test test/sentences-v2.spec.ts`.
