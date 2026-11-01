# Listening on the shared Runner (M2 / #334)

FC04 of the [capability matrix](exercise-capability-matrix.ru.md). It runs on the G3 item
contracts and the M1 sentence corpus ([sentences-v2.md](sentences-v2.md)).
Page: `/v2/listening.html`, linked from `/v2/session.html`. It replaces v1 `hoeren.ts`.

## Content

There is no new dataset. Listening uses `public/data/items/sentences.json`, the same
`ItemDataset` as the sentence builder. Statistics stay apart because the journal keys
progress by exercise. An answer to `listening-text` or `listening-tokens` never counts
as `sentence-assembly`, and the two listening modes are counted separately too.

## Adapter (`packages/vocabulary-core/src/families/listening.ts`)

`LISTENING_TOKENS` (`listening-tokens/1`) and `LISTENING_TEXT` (`listening-text/1`) are
registered in `ITEM_EXERCISES`, so the Edge Function re-evaluates them. Their target
kinds are `sentence` and `video-segment`.

- **Task:** `audio` is the prompt (`{ text, lang: 'de' }`). There is no text prompt. The
  tokens (assembly mode only) have the same deterministic order as the sentence builder
  for a seed. The translation and explanation are part of the task for display after
  the answer. A sentence without a translation in the chosen language can still be
  heard.
- **Assembly:** the placed token IDs, checked by the shared `evaluateSentenceTokens`.
  The alternatives apply, and case and commas count.
- **Typing:** the v1 dictation rule, `listeningForm`. Case, punctuation and spacing are
  neutral; letters (umlauts, ß) and digits count. An empty answer, a punctuation-only
  answer, an answer over 500 characters or one with control characters is invalid.
- **Reuse for video (M6 #338):** `buildListeningExercise(item, context, mode, audio)`
  takes its own audio source, and a `video-segment` dataset gets the same exercises.

## Page

- **Hidden text:** the card shows only the instruction. The German text, the
  translation, the other translations, the explanation and the topics appear only once
  the answer is saved. The card has no listen button of its own (no `speechText`).
- **Audio:**
  - The page's Play button replays the sound with its own `createCardSpeech` instance.
  - Playing is never a command: it writes no event and doesn't change the shown answer
    or its evaluation.
  - A new sentence plays automatically, unless that is switched off. A reload of an
    open sentence doesn't play.
  - Next, Previous, a mode switch and leaving the page (`pagehide`) stop the sound.
- **Unavailable voice:** `unavailable`, `no-german-voice` and `failed` show a notice
  that says what to do, with a link to `../hilfe/vorlesen` and the Play again button.
  The task stays answerable.
- **Modes:** Assembling or Typing, remembered in `hoeren_mode` (v1 key and values
  `drag`/`type`). Switching an unanswered sentence abandons its session (no event) and
  starts the same sentence and token order in the other mode. After an answer, the new
  attempt is `assisted`.
- **Sessions, retries and statistics:** as in the sentence builder. There is one
  single-task item session per sentence. Try again and Previous are `assisted`. The
  statistics (per sentence and per level) are those of the current mode. A reload
  resumes only a listening session, and the builder resumes only its own.
- **Levels:** all A1–C2 or one level, in `#deck=b1` (as in v1, without the themed
  decks).
- **Keyboard and screens:** the TokenInput/TextInput keys, Enter to check, → next,
  ← previous, and Enter after the answer (next or try again). The interface is RU/EN/DE
  without replacing the task, and the page works at 360 px.

Verification: `node --test test/listening.test.mjs` and
`npx playwright test test/listening-v2.spec.ts`.
