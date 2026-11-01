# Word replay, queries and summary (P3 / #311)

`replayWord` rebuilds one owner's word projection from the complete immutable
journal. It composes the [component scheduler](component-srs.md) and
[daily evidence policy](word-evidence.md). It never merges counters or full
snapshots, and does not depend on delivery order, current UI exercise or deck.
`word-projector/1`, `word-clock/1` and `word-summary/1` pin the additional rules.

## Input and trust boundary

Each `RecordedWordFact` contains a LearningEvent, its trusted exercise evaluation
when applicable, an owner and authoritative first `receivedAt`. `ReplayContext`
supplies owner, active dataEpoch, its start time and explicit asOf time. The server
derives ownership from authentication, assigns receipt times and re-evaluates
canonical exercise content; the domain function is not an authorization layer.
Local repositories likewise partition facts/projections by owner and epoch.

Cross-owner and cross-epoch facts, conflicting event/command/attempt identities,
unsupported versions and invalid content/evaluation envelopes fail explicitly.
Identical event delivery is idempotent; if copies have different receipt times,
the earliest authoritative receipt wins. Retry delivery cannot legitimize an
event whose original timestamp was impossible. A caller must provide the whole
word history, including previous dates of resumed sessions, not only new outbox
records or current-day answers. Missing history cannot be inferred by this API.

Only word targets enter this projector: `normalizeWordFacts` refuses any other
target. Sentence, grammar, audio, video and test answers have their own projections
(`item-progress.ts`, see [learning-sync.md](learning-sync.md#shared-journal-for-every-target-g3--332)).
A word that an item only mentions gets no SRS progress, and a word answered with
intent `assessment` is never SRS evidence.

## Clock policy

| Fact condition | Projection behavior |
| --- | --- |
| Occurred or first received before epochStartedAt | Quarantine: before-epoch |
| Occurred over five minutes after first receipt | Quarantine: future-clock |
| Within tolerance but occurred after asOf | Deferred until its time arrives |
| First receipt is after asOf | Deferred; not available to that historical projection |
| Old occurrence, received much later | Normal offline fact; replay its original study date |

These rules use canonical UTC milliseconds and no implicit clock. They do not
guess corrections or rewrite occurredAt. The result lists quarantined and deferred
IDs so the service can expose and reconcile them while retaining raw records.
A five-minute tolerance never permits early SRS advancement. Implausibly old
timestamps *within* an epoch cannot reliably be distinguished from valid offline
study here; additional evidence/correction workflows belong to the service.

Receipt time on the server must come from the server, not a client claim. A local
clock cannot independently prove its own correctness. `processedEventIds` names
facts used by this projection; it is **not** an outbox ACK list. Storage/transport
can persist and acknowledge a quarantined fact without applying it to SRS.

## Calendar, replay and checkpoints

Dates are computed once from the timezone retained by each event. One date has
one pinned timezone; changing timezone within that date is rejected. Dates must
increase monotonically as effective study timestamps advance. Interleaving or
simultaneous different dates is an explicit calendar conflict requiring service
reconciliation, never silent reordering or a second transition on the same date.
Ordinary travel across successive dates is supported.

Exposure is derived once over the accepted session history. Observations are then
grouped by study date and each day is projected once from the preceding day's
result. At a timezone change, the projector provides a verified previous-date
boundary to `projectEvidenceDay`: older snapshots retain their original study
date rather than being reinterpreted in the new zone. Baseline timestamps must
still precede the first fact of the next date. The ordinary `projectWordDay` API
retains its strict pre-day check when no replay-chain boundary is supplied.

The result includes per-date checkpoints: pinned day, original before snapshot,
after progress, evidence, transitions and event IDs. These are derived values;
S0/S1 will persist them atomically where needed. Initial implementation always
rebuilds from the complete journal. On a late fact, unchanged earlier checkpoints
remain equivalent and the affected date and all later dates are recomputed.
Incremental checkpoint reuse is an optimization for a future task, not a second
source of truth. The revision is the number of deterministic component transitions,
not a storage CAS generation: adding a late failure can change a projection while
leaving its transition count unchanged. S1 therefore uses a separate server
generation (`word_progress.revision`) for compare-and-swap and a per-owner journal
cursor ([learning-sync.md](learning-sync.md)).

`projectEvidenceDay` accepts only trusted observations produced by
`deriveWordEvidence`, and a replay boundary only from this validated chain. It is
not a decoder for arbitrary client-supplied observations or baselines.

## New and due queries

`selectNewWords` and `selectDueWords` receive a deck, canonical catalog, owner-scoped
active-epoch projections, language, explicit time, optional exercise and filters.

- New means no word introduction, regardless of which components/exercises are
  still unintroduced. New order follows the deck; duplicate membership is counted
  once. A word shared across decks uses the same progress.
- Due means a started component has reached dueAt. The selected exercise must
  actually assess that component. German choice cannot select a word solely for
  overdue recall; introduction cannot select a due queue. Pending components never
  enter review, and a short due queue is never padded with new words.
- Relearning/learning due words precede review words, then deadlines ascending,
  lowest retention and stable word ID break ties. One word appears once even when
  several assessed components are overdue.
- Translation-dependent exercises require the requested RU/EN meaning.
  Article-only choice can work without that translation. Article exercises require
  a noun with a known article. POS filters apply before selection; selected tags
  use AND semantics. These are per-word eligibility checks, not a guarantee that
  the planner can construct enough nonambiguous distractors for a choice task.
- Limit defaults to 20, is a nonnegative safe integer, and is applied after ordering.
  The 20/5 format policy and task plans remain in L1; these queries can also serve
  other limits for a dashboard. Unknown deck references, duplicate catalog IDs,
  duplicate projections and foreign-owner projections are errors.

Catalog content is the published read model. Candidate verification and catalog
revision loading belong to F2/F3/C tasks; queries never promote pending content.
Query results are references to immutable domain inputs; callers must not mutate
them. Projections for catalog words outside the selected deck are not selected.

## Derived summary

`summarizeWord` returns applicable/introduced component counts, coverage, current
retention, next word deadline and due components. The word deadline is the minimum
of **started** component deadlines. New words have no deadline. States are new,
due, learning (including pending components), and scheduled. All require explicit
time; invalid/future-baseline snapshots fail instead of inventing retention.

The optional score is an equal-weight mean of component retention **seven days
in the future**, under `word-summary/1`. Unintroduced components contribute zero;
inapplicable article is excluded from both numerator and denominator. The score
is between 0 and 1 and is not saved, synced, used as a due selector or presented
as a calibrated probability for the whole word. It cannot become 100% just from
revealing the word. Coverage and due components remain the primary UI metrics.

## Validation and remaining integration

Run `npm run verify`. Regressions cover delivery permutations/duplicates, a late
error altering later days, late reveal/self-assessment, owner/epoch isolation,
clock quarantine and retry, historical asOf, midnight/DST/travel, calendar
conflicts, exercise applicability, queue ordering and summary invariants.

This is pure domain code. UI, IndexedDB persistence, checkpoint storage, server
CAS, authentication, outbox and task planning are subsequent work. No old progress
or API compatibility is introduced.
