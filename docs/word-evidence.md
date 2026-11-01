# Word evidence and daily projection (P2 / #310)

`evidence/1` is the first application evidence policy. It is separate from the
FSRS scheduler version, and is a conservative product decision, not an FSRS rule.
Its inputs are immutable `LearningEvent` facts plus evaluations produced by a
trusted exercise adapter. The server must reconstruct/validate an exercise and
evaluate raw answers itself; this API does not turn a client-supplied evaluation
into trusted knowledge. Other content families use their own projections.

## What each exercise establishes

| Exercise | Components | Prompt discloses | Source |
| --- | --- | --- | --- |
| meaning-choice | recognition | German recall, spelling, article | automatic |
| german-choice | recognition | German recall, spelling, article | automatic |
| meaning-recall | recognition | German recall, spelling, article | subjective self-assessment |
| german-type | recall, spelling | none | automatic |
| article-choice | article | German recall and spelling | automatic |
| german-with-article-type | recall, spelling, article | none | automatic |
| introduction | initializes recognition only | all applicable components | exposure, no review |

`WORD_EXERCISE_RULES` is deeply frozen and shared with future content adapters.
The policy rejects an evaluator's claim for a component outside the exercise's
scope. It also rejects the wrong evaluation source. An article result applies
only to words with an article. For typed German, spelling/article are unobserved
unless recall is explicitly correct: another word or an ambiguous lexical answer
does not establish writing or gender of the target. A wrong article with correct
recall and spelling leaves those two positive observations intact. Checking raw
strings, allowed alternatives, normalization and typos belongs to X2/X3.

## Exposure and first attempts

`deriveWordEvidence(word, facts)` sorts and derives observations without mutating
facts. Its input contains the history of each relevant session for that word,
including previous dates when a session resumes after midnight. Exposure is
scoped by session and word, shared across exercise stages, and survives a task
change. The caller partitions history by owner and dataEpoch before calling;
mixed epochs and other target words are rejected here as a further guard.

- Intrinsic prompt disclosure comes from the shared exercise rules; the client
  cannot remove it by sending an empty `event.exposure`.
- On an answer, `event.exposure` lists component-specific hints already used;
  `event.assisted` means global assistance and blocks all independent components.
- A reveal or introduction conservatively discloses all applicable components.
- Completed answer feedback also discloses all applicable components. An adapter
  may give less feedback in the future only under a new evidence policy version.
- A later attempt on the same session/task cannot become independent by changing
  attemptId. A correction in another task still inherits earlier disclosure.
- The first self-assessment of meaning-recall may follow its own mandatory reveal.
  That reveal alone does not disqualify its recognition result; explicit hints,
  earlier feedback, another card's reveal and repeat attempts still do. This
  exception trusts the user's subjective report; it is never automatic evidence.
  Without an own-task reveal at or before its timestamp, self-assessment is
  unobserved and cannot initialize or review a component. A reveal arriving late
  in sync can enable that observation on replay only if its study time precedes
  the rating; another task/session or a later reveal cannot complete it.

Equal UTC timestamps are handled conservatively: all prompts, hints, reveals and
introductions in a time group precede its evaluations; feedback follows the
whole group. Simultaneous first attempts are combined, so an error cannot be
hidden by choosing a favourable event-ID order. Input order does not affect the
result. Exact duplicate delivery is ignored. Conflicting event identities or
reuse of a command/attempt for another event are errors requiring reconciliation,
not a last-write-wins decision. Session/task exercise, version, content, intent
and language context cannot change mid-task.

Every component observation retains event identity, time, study date/timezone,
source, outcome and strength (`independent`, `subjective`, `aided`, `unobserved`).
Raw events remain in the journal; deriving evidence does not delete failed,
assisted or repeated attempts.

## SRS eligibility

| Situation | Action |
| --- | --- |
| learn-new introduction | Initialize recognition; zero successful reviews |
| learn-new observed answer | Initialize its applicable observed components, even in aided training; no reviews |
| review-due, independent automatic result | Correct → Good; incorrect → Again |
| review-due, subjective self-assessment | Correct → Hard; incorrect → Again; source remains subjective |
| review-due but assisted, retry or unobserved | No SRS transition |
| practice or assessment | History/statistics only; no initialization or schedule change |
| reveal alone | Exposure only; no schedule change |

There is no automatic Easy grade in this policy. Low-confidence subjective success
cannot produce the same growth as an independently checked correct response.
Unintroduced components cannot gain review credit in review-due mode. Additional
learning must be explicit. An early response before the pre-day component's due
time is retained but cannot advance a review schedule.

## One transition from the pre-day baseline

`projectWordDay(beforeDay, word, { date, timezone }, sessionHistory)` returns
progress, that date's evidence and an auditable transition list. **Always pass the
snapshot before that study date**, plus the union of known facts; never pass the
previous call's result for the same date. A same-day or future component baseline
is rejected. `assertWordProgress` validates the full snapshot even on a no-op day.

Study dates are calculated from event time in the pinned IANA timezone, including
DST. A date cannot be split by changing timezone within its facts; such a batch
is rejected, including a mismatched-zone reveal with no direct observation.
Server assignment/validation of the study timezone and correction of unreasonable
client clocks belongs to S1/P3. This function uses caller-supplied validated times;
sync receipt time never substitutes for study time.

For each component independently:

1. If unintroduced at the start of the date, its first explicit learning evidence
   initializes conservative learning state. No review is allowed on that date.
2. If already active, only eligible, due review observations participate. The
   combined grade is Again if any independent/eligible subjective error exists,
   otherwise Hard if a subjective success exists, otherwise Good.
3. Exactly one scheduler transition is computed from the pre-day state. Its time
   is the first observation supporting the chosen grade: a later failure is not
   backdated to an earlier success, and subsequent aided success cannot postpone
   the failure's next due time.

New independent facts from another session/device can change the day's combined
grade after replay; they cannot increment its review count repeatedly. A failed
independent diagnostic remains Again after a reveal and successful correction.
An aided failure is retained but does not by itself establish independent failure.
Revisions count actual component transitions, not raw button presses.

## Remaining integration

[P3 (#311)](word-projector.md) provides full multi-day replay, query/summary APIs
and derived day baselines. Persisting them belongs to the repository/server tasks.
Runner (#316/#317) must retain session history/exposure across reloads and use the
shared rules for task prompts. S0/S1/S2 own atomic storage, server re-evaluation,
owner isolation and delivery. The UI is not connected to this policy by this PR.

Run `npm run verify`. Regression coverage includes choice versus recall, split
article grading, ambiguous lexical answers, cross-stage hints, first/repeat
attempts, subjective reveal, practice, learning without reviews, due eligibility,
cross-session daily merging, conflicting IDs, input permutation, simultaneous
timestamps, midnight, DST, unsupported versions and malformed baselines.
