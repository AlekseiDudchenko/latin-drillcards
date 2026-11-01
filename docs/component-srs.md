# Component scheduling (P1 / #309)

One `WordProgress` is keyed by owner and canonical word ID. Deck, exercise and
translation language never form a second progress identity. Recognition, recall,
spelling and article have independent schedules. `createWordProgress` includes
article only for a noun with a known article. Every applicable component starts
unintroduced with no memory baseline, reviews or due date.

## Version and algorithm

The initial implementation pins **FSRS-5 equations and published 19 default
weights**, with a separately documented DrillCards lifecycle adapter. It does not
reuse the mixed storage/network/algorithm module in the old client or claim to
implement the latest FSRS release. Source equations and defaults:

- [FSRS algorithm reference, FSRS-5 and inherited FSRS-4.5 equations](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-5)
- [Historical reference with the same defaults](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm/b52eba9dadc7d4ab51a70fa2f6b33bf20e48afd0)

`fsrs5-default-drillcards/1` identifies weights, forgetting curve, clamps, rounding,
learning steps and stage rules together. Exported parameters and weights are
frozen. Changing any rule requires a new version and explicit event replay;
`reviewComponent` rejects a snapshot with another scheduler version. The defaults
have not been fitted to this app's users, languages or exercise evidence.

Stability is measured in days until retention reaches 90%. The forgetting curve
is `R(t,S) = (1 + (19/81) * t/S)^(-0.5)`. Requested retention is 0.9; review intervals
are rounded to whole elapsed days and clamped to 1–36500 days. Stability is clamped
to 0.01–36500 days, difficulty to 1–10. Long-term updates use the published recall,
forgetting and damped difficulty equations. Below 24 elapsed hours, the short-term
FSRS-5 stability update is used; a non-failure cannot decrease stability. A lapse
cannot increase stability. No fuzz, random jitter or implicit current time is used.

## Lifecycle adapter

| Operation | Result |
| --- | --- |
| Unintroduced component | `dueAt=null`, `initializedAt=null`, retention query returns 0 |
| `initialize(at)` | Learning, conservative Again initial stability/difficulty, due in 10 minutes; zero reviews/lapses |
| Again in learning | Remains learning, due in 10 minutes |
| Again in review | Relearning, one new lapse episode, due in 10 minutes |
| Again in relearning | Remains relearning; counts another review, not another lapse episode |
| Hard in learning/relearning | Keeps that stage and the 10-minute step |
| Good/Easy in learning/relearning | Graduates to review using the updated stability |
| Hard/Good/Easy in review | Remains review using the updated stability |

`initializedAt` anchors the memory curve without fabricating a review timestamp.
`lastReviewedAt` is null until an actual authorized review transition. Retention
uses the latest review time, falling back to initialization. `WordProgress` gains
`introducedAt` on the first component introduction; introducing another component
does not make the word new again. Reintroducing an active component is a no-op.
Each real word transition increments revision once and preserves the other
components; callers must initialize every component they actually introduce.

All time inputs are canonical UTC strings with milliseconds. Intervals are elapsed
durations, not local calendar days. Invalid dates, backwards updates, unintroduced
reviews, unknown ratings, mismatched identities/versions and inconsistent cached
schedules throw explicitly. Late offline facts must be reordered and replayed,
not applied backwards to the current snapshot.

## Evidence is a separate layer

These are low-level memory transitions. They deliberately do not consume raw
answers, decide a grade, deduplicate attempts, inspect exercise/deck IDs, enforce
one transition per study date, or qualify assisted practice as an independent
review. [P2 (#310)](word-evidence.md) decides eligibility and exposure and aggregates
one date's facts from its pre-day baseline; P3 (#311) adds full multi-day replay. In particular,
ordinary practice must never call `reviewComponent` just because its answer is
correct. The 10-minute step is a scheduling parameter; it does not bypass that
daily evidence policy or require another SRS transition during the same session.

## Verification

`npm run verify` builds both outputs and runs the suite. Tests pin independent
numeric vectors for all four grades, the nonlinear curve, introduction with no
successful review, lapse/recovery, short-interval behavior, immutable inputs,
component isolation, invalid snapshots/time/version and a long review sequence.
No UI, database, data migration or old/new progress compatibility is introduced.
