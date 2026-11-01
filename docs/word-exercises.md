# Word exercise registry (X2 / #313, X3 / #314)

`createWordExerciseRegistry(publishedWords, catalogVersion)` is the shared,
DOM-free source of task construction and answer evaluation. Browser and server
import the same compiled core. Each definition implements `isApplicable`,
`assessedComponents`, `buildTask` and `evaluate`.

| Exercise | Prompt / response | Evidence |
| --- | --- | --- |
| meaning-choice | German → one of four RU/EN meanings | Automatic recognition |
| german-choice | RU/EN meaning → one of four German words | Automatic recognition, not productive recall |
| meaning-recall | German → reveal meaning → remembered/forgotten | Subjective recognition; daily policy requires its own prior reveal and caps success at Hard |
| german-type | RU/EN meaning → German word without article | Separate automatic recall and spelling |
| article-choice | Bare German noun → der/die/das | Automatic article only |
| german-with-article-type | RU/EN meaning → German word with article | Separate automatic recall, spelling and article |
| introduction | German, translation and published details → Continue | Unobserved; introduction initializes without a successful review |

The registry does not write progress. Consumers persist raw events and recompute
trusted evaluation before the existing evidence policy/projector runs. Practice
continues to leave SRS unchanged. Introduction is a separate event, never an
answer event; `evaluateWordAnswer` rejects introduction answers.

## Reproducible tasks and catalog ownership

A registry takes a deep-frozen copy of one published catalog snapshot. A task pins
its exercise version, word content version, catalog version, seed, task ID and
translation language. Option IDs are canonical word IDs; labels are display data.
Source array order, UI locale changes and rerenders cannot change an existing
task. JSON round trips preserve it. The meaning language is RU/EN independently
of interface locale or German response language.

Meaning/German choice candidates share the target part of speech. Common topic tags rank first;
seeded deterministic ranking selects candidates and orders the final four options.
Preferred/accepted translations, split senses and German forms are checked for
alias overlap against both the target and already selected distractors. Homonymous
German entries retain separate catalog identities but are excluded as ambiguous
distractors. The filter is conservative: greedy selection may report insufficient
options even when another combination exists. It cannot identify semantic synonyms
missing from the published aliases; content verification remains necessary.

`availability` returns explicit missing-translation, insufficient-options,
unknown-word or content-version reasons. Meaning/German choice requires four safe options; it
never pads duplicates or silently changes exercise. Article choice uses the three fixed article IDs and requires no translation; it
requires a noun with a known article. Other exercises require the requested
RU/EN translation. Reveal/introduction can still
be available with a small pool. The planner chooses a permitted alternative.

`validateTask` rebuilds the entire canonical task against its pinned snapshot and
rejects changed labels, order, solutions, languages or versions. This detects
inconsistent tasks; a client-supplied snapshot/version is not authentication.
`evaluateWordAnswer(registry, task, event)` additionally binds the strict answer
envelope to task ID, target, exercise/version, content version, translation language
and evidence policy before evaluating raw input. Ownership, session membership,
intent authorization and service limits remain authenticated service concerns.

## Storage and sync integration requirements (L2 / S0 / S1)

Persist the immutable task beside the session/event outbox, or persist a reference
to an immutable server-owned task archive. Retain the published catalog snapshot
and word revisions used to build it. `LearningEvent` alone has no seed/catalog
snapshot and cannot reconstruct choice options. A growing current catalog must
never replace the historical snapshot during replay. The server must resolve a
trusted archived task and catalog, check owner/session binding and then call the
shared evaluator; it must not trust an uploaded solution or evaluation. This task
provides the pure contracts/checks, not the archive or sync implementation.

## German production normalization (german-production/1)

Both text modes pin `normalizationVersion` in the canonical task. Rules live in
`german-answer.ts`, shared by browser/server, and never in DOM handlers. Changing
these semantics requires a new normalization/task version and retaining the old
evaluator for historical tasks.

- NFC, trimming and collapsing whitespace do not count as spelling mistakes.
  Unicode decomposed `Tür` is the same spelling as `Tür`.
- Strict spelling uses the lemma and explicitly published `acceptedGermanForms`,
  preserving case, umlauts and ß. Accepted forms are a curated set, not generated
  inflections or a fuzzy dictionary. Article prefixes in noun forms are removed
  before comparing the lexical part.
- Recall additionally ignores case and maps ä/ö/ü/ß to ae/oe/ue/ss. Thus `tisch`
  or `Tuer` can recall the word while failing strict spelling. `Tur`, `Tish`,
  punctuation changes, transliteration from another script and unlisted inflections
  do not match. No edit distance, stemming or removal of arbitrary accents applies.
- A tolerant match is rejected if its lexical spelling, ignoring case but keeping
  umlauts/ß, belongs to another published word. With both `Maße` and `Masse` in the
  pinned catalog, `Masse`, `masse` and `MASSE` cannot count as recall of `Maße`.
  Exact accepted target forms remain accepted, including homonymous word senses;
  sense identity is provided by the task's translation context.
- Bare-word mode requests no article. Combined mode separates a leading known
  definite/indefinite German article. Only the canonical der/die/das is successful;
  a missing or wrong article, including `den` or `ein`, fails article alone when
  the lexical word is known. Article casing is immaterial. With `die Tisch`, recall
  and spelling succeed while article fails. With `der Stuhl` for target Tisch,
  recall fails and target spelling/article are unobserved.
- Non-string/blank payloads, ASCII/C1 controls and strings longer than 256 UTF-16
  code units are invalid commands and throw; they are never coerced into answers.

Overall success requires every assessed component to succeed. Per-component
outcomes drive the existing shared daily evidence policy: correct lexical recall
can advance while incorrect spelling/article receives Again. Wrong-lexeme spelling
and article remain unobserved. Practice never updates SRS; earlier disclosure or
feedback makes a later circuit answer aided. Verbs and nouns with no known article
are unavailable for both article modes; german-type never assesses article.

## Shared UI adapter and preview

`wordTaskCard` validates and maps the task to the shared CardShell. The presentation
adapter grants details only for introduction or feedback. German-choice, both production modes and article-choice withhold
German speech until feedback, since it exposes the answer. Meaning recall permits
explicit reveal; UI locale updates preserve draft/reveal state and task content.
Introduction has a passive details view and a separate `onContinue` command with
no Check or remembered/forgotten controls. The future Runner must commit the
introduction/exposure before mounting the initially visible details. The UI adapter
itself creates neither events nor SRS transitions.

After `npm run build && npm start`, `/v2/word-exercises-demo.html` previews all seven
definitions using fixture words, actual shared evaluation and EN/RU/DE UI. It is
noindex, outside production navigation, and has no persistence/Supabase dependency.
It does not represent a completed learning session or verified catalog content.

Verification: `npm run verify`, `npx tsc -p test/tsconfig.json`, and
`npx playwright test test/card-ui.spec.ts test/word-exercises.spec.ts --workers=1`.
Browser tests cover real compiled tasks, both choice directions, subjective reveal,
passive introduction, production component feedback, locale preservation, speech
permissions and 360px layout. Production feedback localizes component names and
outcomes while retaining the pinned German canonical answer.
