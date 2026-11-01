# Vocabulary session planning (L1 / #315)

`planVocabularySession(input)` is a pure core function, shared by browser/server.
It fixes one word batch before constructing exercises and returns either a
deeply frozen `ready` plan or an explicit `empty` reason. It never writes
progress, imports v1 data, reads a clock or falls back to another study intent.

## Request and selection

Supply a published catalog/version, deck, owner-scoped active-epoch projections,
owner, dataEpoch, unique sessionId, seed, explicit UTC time and study timezone.
The repository is responsible for the active-epoch provenance of WordProgress;
the planner rejects foreign owners and invalid projections/deck references.
No interface locale is part of the request: answerLanguage is the task's RU/EN
meaning language, even when the response itself is German.

| Intent/format | Selection |
| --- | --- |
| learn-new / single | Globally unintroduced words for the selected applicable exercise; at most 5 |
| learn-new / circuit | One globally new batch, at most 5; all applicable stages |
| review-due / single | Due components actually assessed by the requested exercise; at most 20 |
| review-due / circuit, due-components | At most 5 due words; exercises assessing at least one of their due components |
| review-due / circuit, all-exercises | The same due-word selection, followed by all applicable exercises |
| practice | Explicit request with wordIds in the deck, in user order, deduplicated; may contain new, due or scheduled words |

The two circuit scopes share batch selection. Due words retain the common P3
priority: learning/relearning first, then deadline, retention and word ID.
New words follow deck order. Filters use an allowed POS list and AND tag matching,
before capacity. A word with several due components occupies one slot.
Single review capacity is 20; circuit and every new-word batch are 5 **different words**, never tasks.
A queue of seven due words stays seven; new words never pad review.
`vocabularyQueues` returns these new and due queues for a request's deck, exercise
and answer language before capacity and availability; the planner selects from it,
and the [home screen](home-screen.md) counts it.

Single never changes the requested exercise. Availability is checked against the
registry before consuming a batch slot: a word with insufficient safe choice
options is omitted, and later eligible words may fill the slot. Choice distractors
come from the pinned catalog, not just the target batch or filtered deck.
Circuit skips unavailable modes and reports their reasons. Article-only review/
practice can use untranslated nouns; translation-dependent tasks cannot.
New study requires an applicable introduction, including the requested translation.

Practice requires `intent: 'practice'` and explicit `wordIds`; absent IDs and
IDs outside the deck fail. It is never an automatic response to an empty due
queue. Capacity still applies and no introduction is added automatically.
The existing evidence policy leaves practice SRS unchanged. Empty explicit
selection returns `empty-practice`.

## Fixed tasks, stages and versions

Plans pin schemaVersion, plannerVersion (`vocabulary-planner/2`), catalogVersion,
word contentVersions, request/filters, seed, owner/epoch, createdAt, timezone,
evidence policy and complete immutable Tasks. Each task pins its exercise,
normalization, catalog and option content versions through the registry.
Task IDs encode session ID, word ID and exercise ID without delimiter ambiguity;
session IDs must not be reused for different requests. Per-task seeds derive
from the plan seed, word and exercise. Source catalog order cannot alter options.

Learning begins with introduction for every selected word, then meaning choice,
German choice, article choice, German typing, combined article/typing and meaning
recall. A single-exercise learning session introduces its batch before that
exercise; selecting introduction itself does not duplicate it.
Circuit runs each stage across the fixed batch, shuffling word order
deterministically from the seed. An unavailable stage never selects another word.

Review has no introductions. A review circuit starts with one diagnostic task per
word, chosen by its most overdue due component; then productive modes come before
German disclosures (`vocabulary-planner/2`, see [session-circuit.md](session-circuit.md)). Due-components includes only exercises assessing the word's due
components; all-exercises includes every available mode. This is a fixed initial
queue. The correction round and session summary are described in
[session-circuit.md](session-circuit.md) (L3); this planner does not claim every
circuit answer is independent SRS evidence.
The shared exposure/daily policy still governs all events.

The result's omissions explain rejected candidate/exercise pairs.
`plan.skippedExercises` retains omissions for selected words, so explanations
survive storage/reload. No applicable tasks returns an empty result, never a
zero-task session. No candidate words returns no-new-words/no-due-words.

## Persistence and integration

Store the returned plan with the **same catalog snapshot** via S0
`startSession({state: {plan, status:'ready', taskIndex:0, revision:0}, words,
catalogVersion})`. Never reconstruct a saved plan from current progress/catalog.
New catalog content, UI language, later server progress and caller mutation do not
change an existing plan. Start a separate session to change answerLanguage.
The Runner must commit introduction before displaying its initially visible
details, and it must create events with the plan request's intent.

The planner has no UI or persistence side effects. The
[session runner](session-runner.md) (#316) supplies commands/card wiring;
[session-circuit.md](session-circuit.md) (#317) adds corrections and the summary;
[home-screen.md](home-screen.md) (#318) is the deck choice and word card.
Run `npm run verify` for domain regressions. Tests cover 7/20/5 selection,
due-component applicability, filters, insufficient options, introductions,
explicit practice, immutable/versioned tasks, seed repeatability and bad input.
