# Learning sync: server intake (S1 / #319) and client queue (S2 / #294)

The server half: an Edge Function receives LearningEvents, re-evaluates them with
the shared core and commits the journal and the replayed word projection in one
transaction. The client half ([below](#client-syncservice-s2--294)) sends each
account's local outbox and merges the server journal back. Every other exercise
family uses the same journal, outbox, RPC and `SyncService`
([shared journal, G3 / #332](#shared-journal-for-every-target-g3--332)).

## Objects (`supabase/v2/migrations/003_learning.sql`)

| Object | Purpose |
| --- | --- |
| `catalog_private.catalog_snapshot_words` | Immutable `(catalog_version, word_id, content_version)` of every import. Filled at the commit of each `catalog_imports` insert (deferred trigger); on install it pins the latest existing import |
| `public.learning_owners` | Per-owner journal cursor `journal_revision`; every commit of one owner locks this row |
| `public.learning_tasks` | Archived canonical Task per `(user_id, task_id)`, bound to its session and to a snapshot word revision (FK) |
| `public.learning_events` | Append-only journal, PK `(user_id, event_id)`, `sequence` = per-owner cursor, unique command/attempt IDs, server evaluation |
| `public.word_progress` | Rebuildable projection, PK `(user_id, word_id)`; `revision` is the CAS generation, `journal_revision` the cursor it saw, plus `next_due_at` / `introduced_at` for queries |

Browsers (`authenticated`) may only SELECT their own rows (RLS on `auth.uid()`);
`anon` has no access. Nobody has INSERT/UPDATE/DELETE grants on these tables, not
even `service_role`; journal and task rows reject UPDATE by trigger. Account
deletion cascades.

## Service RPCs

All three are executable only by `service_role` (EXECUTE revoked from PUBLIC,
`anon`, `authenticated`). PostgREST exposes them; a browser call gets 42501.

- `v2_catalog_snapshot(catalog_version)` — published Word models of that snapshot, or NULL.
- `v2_learning_state(user, word_ids, task_ids, event_ids, command_ids, attempt_ids)` —
  environment epoch, cursor, each word's full journal and CAS revision, archived
  tasks and stored events that share an identity with the incoming ones.
- `v2_commit_learning(user, data_epoch, received_at, events, projections)` —
  `SECURITY DEFINER`, the only write path. It checks: the owner exists; the epoch is
  the current `v2_environment`; `received_at` is within the service clock window;
  each event is bound to its task (ID, target, exercise, task/content version) and
  carries an evaluation exactly when it is an answer; the task is in the declared
  catalog snapshot and equal to an already archived task of that ID/session; each
  affected word has exactly one projection for this owner whose expected revision
  is current. A stale revision raises **40001**. Any failure rolls back the whole
  batch. Duplicate identical events are skipped; differing payloads under one
  event/command/attempt ID raise 23505.

## Edge Function `v2-learning-events`

`POST { events: [{ event, task }] }` (1–100 items, ≤ 512 KB) with the user's
`Authorization: Bearer`. Gateway JWT verification is off, as for `v2-health`; the
handler verifies the token with Auth `/auth/v1/user` and uses only that user ID.
Any owner field in the body is ignored, and an event with an extra field fails the
strict `isLearningEvent` check. Origins are allow-listed.

Per event, `ingestLearningEvents`:

1. checks the strict envelope and the current data epoch;
2. sends non-word targets down the item path ([G3](#shared-journal-for-every-target-g3--332));
3. loads the immutable snapshot named by `task.specification.catalogVersion`
   (`unknown-catalog`), rebuilds the canonical task with `validateTask`
   (`invalid-task`) and binds the event to it (`task-mismatch`);
4. for answers, computes the evaluation with `evaluateWordAnswer`; an uploaded
   `evaluation`/solution is never read (`invalid-answer` on bad input);
5. compares with stored identities: the same payload is `duplicate`, a different
   one under the same event/command/attempt ID is `event-conflict`, and a task ID
   already archived with other content or another session is `task-conflict`;
6. replays every affected word from its complete journal plus the new facts with
   `replayWord` (owner `{kind:'account', id}`, receipt = service clock, asOf = now).
   A calendar/identity error rejects only that word's new events (`projection-conflict`).

Then one `v2_commit_learning` call commits all accepted events with their
projections. On 40001 the function re-reads the state and replays again (up to 5
attempts), so two concurrent answers to one word both end up in the journal and in
the projection. The response is
`{ ok, journalRevision, results: [{ eventId, status: 'accepted'|'duplicate'|'rejected', reason? }] }`.
Accepted and duplicate events can be removed from the outbox; rejected ones will not
succeed on retry. 409/503 responses are retryable.

Deferred and quarantined facts (`word-clock/1`) are stored and listed in
`word_progress.replay`; they are applied when a later commit of that word replays
after their time. A periodic re-projection is not part of S1.

## Deployment

`npm run v2:prepare` writes `build/v2/<env>/learning.sql` (preflight + 003), copies
the compiled core to `supabase/functions/_shared/vocabulary-core/` and adds
`[functions.v2-learning-events] verify_jwt = false`. Apply `learning.sql` after the
transition (see the runbook); it refuses a database without the catalog or with
existing learning tables. Nothing here is applied automatically.

## Verification

`node --test test/learning-sync.test.mjs test/v2-existing-project.test.mjs` runs the
real migrations in PGlite: commit/RLS reads, duplicate and conflicting identities,
an interleaved commit that forces a retry, forged tasks/solutions/content versions,
unknown catalogs, forged owners, client calls of service RPCs, direct writes by
browser and service roles, RPC re-checks and all-or-nothing rollback, and the
prepared `learning.sql` on top of the existing-project transition. Auth and HTTP
are fixtures; a live preview check of the deployed function is still needed.

```sh
npx --yes --package=deno deno check --check-js supabase/v2/functions/v2-learning-events/handler.js
node --env-file=.env.v2.production scripts/prepare-v2-deployment.mjs
npx --yes --package=deno deno check build/v2/preview/supabase/functions/v2-learning-events/index.ts
```

## Client SyncService (S2 / #294)

`src/client/v2/sync-service.ts`. One `SyncService` serves one captured account
`LearningScope`; guests never sync. Nothing but raw events goes to the server: no
counters, projections or progress snapshots. Every device and the server replay the
same union of events.

**Outbox.** The S0 store already writes event + session cursor + projection + outbox
ID in one IndexedDB transaction, so a closed tab or reload loses nothing.
`outboxItems` resolves each pending ID to its event and its archived immutable task
(the S1 intake rebuilds the task from it).

**Push.** Batches of ≤ 100, in commit order, to `POST /functions/v1/v2-learning-events`
with the captured owner's access token. Each result acknowledges only its own event
ID in one transaction (`acknowledge`): `accepted`/`duplicate` leave the outbox,
`rejected` leave it into `sync.rejected` with the server's reason (never resent).
A missing result, an HTTP error or a lost response leaves the event pending; the
retry is answered `duplicate` by S1, so delivery is at-least-once without double
results.

**Pull.** After pushing, `GET /rest/v1/learning_events?sequence=gt.<cursor>` (RLS: own
rows), ascending, 500 per page, until a short page. `mergeRemote` unions records by
eventId in one transaction: a server record replaces the local copy of the same
event with the server's receipt time and evaluation (and removes it from the outbox
— the server has it); a new record from another device is added. Words this device
never had in a session are fetched from `catalog_words` and kept in `sync.words`.
All affected words are replayed. `sync.cursor` only grows; a delayed or repeated
older page changes nothing, so an older response can never overwrite newer
records. A server record that conflicts with a different local event under the same
event/command/attempt ID is resolved in the server's favour (see S3 below).

**Triggers and retry.** `sync()` is single-flight (a call during a run schedules one
more pass). The environment page calls it at startup with a restored session, after
sign-in (both are an Auth identity → ready), on `online`, and from "Send now". While
`navigator.onLine` is false it reports `offline` without requests. Failures schedule
a retry with exponential backoff (2 s doubling to 5 min, jitter 50–100 %).

**Owner switch.** Identity changes call `stop()` synchronously before the next scope
exists: the timer is cleared and no further request is made; the old owner's outbox
stays in its local partition. Each request first reads the current Auth session and
refuses (`owner`, which stops the service) when it is not the captured owner, so an
old queue is never sent or read with a new account's token. Pulled rows whose
`user_id` differs are refused too.

**UI.** `syncLabel(status)` separates `saved-locally`/`offline`/`retrying`/`sending`
(pending answers exist only on this device) from `sent` (server confirmed all).
The environment page shows it with the pending count and refused answers.

Partition fields `sync.{cursor,rejected,words,conflicts}` are additive to local data version 1
and absent until the first acknowledgement or merge.

### Verification (S2)

- `node --test test/sync-service.test.mjs`: two in-memory devices running the exact
  partition transaction bodies of the IndexedDB adapter (`commitInPartition`,
  `acknowledgeInPartition`, `mergeRemoteInPartition`) against the real S1 handler,
  migrations and RLS reads in PGlite: offline → online, reload, lost response
  (duplicate, no second row or projection revision), partial results and 503 with
  backoff, permanent rejection, two devices with late delivery converging on the
  server projection, a server-only word, a stale page, account switch and a foreign row.
- `npx playwright test test/sync-service.spec.ts`: the environment page with the real
  SDK session and Chromium IndexedDB: saved-locally → retrying → reload sends at
  startup → sent, repeated send, localized status, and sign-out stopping the queue
  while its answer stays on the device.

The session home (`/v2/session.html`) still runs as a local guest until R3 (#327)
connects it to Auth; R3 must start a `SyncService` there and call `sync()` after each
committed answer.

## Races and recovery (S3 / #295)

**Acknowledge exactly what was sent.** An acknowledgement removes only the event IDs
that have their own result in the response; it never clears the outbox or the journal.
An answer saved while a batch is in flight — to a new word or to the word being sent —
is still pending after that batch's late ACK, and the same pass sends it next. A
failure after the acknowledgements were stored (for example, the pull) removes nothing
local: facts, projections and cursor stay as they were and the pass is retried.

**Retired scope.** `LearningDatabase.reset` (new epoch) and the guest → account transfer
make the old scope unwritable; its store calls throw `RetiredScopeError` (a `RangeError`
with the previous messages). A sync pass that meets it stops for good — no retry loop, no
write into the retired or the new partition. A request already delivered stays on the
server; its acknowledgement is simply dropped with the old epoch.

**Tabs.** `SyncOptions.lock` serializes passes per owner (`drillcards-v2-sync:<kind>:<id>`);
the environment page passes `navigator.locks.request` where available. The waiting tab's
pass starts from a fresh snapshot, finds the outbox already acknowledged, and only pulls.
Without Web Locks, both tabs may send the same events; S1 answers the second copy
`duplicate`.

**Idle and visibility.** With `SyncOptions.idleSyncMs` (60 s on the environment page) a
successful run schedules the next one while the page stays open, which also brings in
other devices' answers. The page also syncs when the tab becomes visible. `stop()` and any
`sync()` clear the pending timer.

**Refused answers.** Events the server rejected stay in the local journal (history) but
are excluded from local replay, so local progress equals the server's. The status line
says they do not count. If the server journal later holds a record with the same ID, it
names the accepted server event and leaves the refused list. The account bar shows a
warning for every new refusal (dismissed per count in `localStorage`); the environment
page lists the reasons (`sync.rejectedReasons`).

**Requeued choice answers (`choice-options/1`).** Meaning/target choice answers that an
older server refused as `invalid-task` (deck options rebuilt from the whole catalog) are
moved back to the outbox once per partition by `restore`, in journal order and with their
original study time; `sync.requeued` records that it ran. Deploy the
`v2-learning-events` function before a site that carries this, or the resend is refused again.

**Server/local conflicts.** A server record whose event ID matches a different local
event, or whose command/attempt ID is used by a different local event, no longer stops
synchronization. The server's journal wins (every other device converges on it): the
local event moves to `sync.conflicts` (`event-conflict` / `command-conflict`, with the
original event kept for display), leaves the outbox and replay, and the server record is
merged. The status line shows "replaced by the server version: N". A session whose
current task loses its answer this way cannot advance past it; it can be abandoned.

**Word revision for replay.** Local replay uses the same rule as S1: the published revision
at the highest `contentVersion` among the word's counted facts. All downloaded revisions
are kept in `sync.words`. Limitation: `catalog_words` serves only the current revision, so
a server-only fact answered on an older revision than the current catalog falls back to
the newest revision on this device; an exact read of historical revisions needs a public
view (a future migration).

### Verification (S3)

- `node --test test/sync-races.test.mjs` (shared harness `test/helpers/sync-harness.mjs`):
  real S1 handler, migrations and RLS in PGlite behind a network whose requests are held
  until released, failed with 503 or cut to a partial result per request kind. Covers a new
  item and a new answer to the item being sent during a held ACK, partial ACK then a
  failing pull, owner switch and epoch reset during an in-flight request, two tabs under a
  lock (and twice without), server conflicts by event ID and command ID, the idle pass,
  refused answers and the revision rule.
- `npx playwright test test/sync-races.spec.ts`: on the environment page with Chromium
  IndexedDB, the first batch's response is held while a new answer is saved; after its
  ACK the new answer is the only pending one, then it is sent.

## Shared journal for every target (G3 / #332)

Sentences, audio, grammar (gaps, Passiv, Kasus, Konjunktiv II), phrases, video
segments and tests use the same `LearningEvent`, the same `learning_events` journal,
the same local transaction and outbox, the same `SyncService` and the same
`v2_commit_learning` RPC as words. No family has its own RPC, queue or progress
table. Targets are `{ kind: 'word', wordId }` or
`{ kind: 'sentence'|'grammar-item'|'phrase'|'video-segment'|'assessment', datasetId, itemId }`.

**Content port** (`packages/vocabulary-core/src/item-exercises.ts`).
- An `ItemDataset` is immutable and versioned: `id`, `version`, `kind`, `title` and
  `items` (`id`, `contentVersion`, the family's own `content` JSON, and the
  `wordIds` it mentions, which are used for links only).
- A family implements an `ItemExerciseDefinition`: `targetKinds`, `input`, `source`,
  `isApplicable`, a deterministic `build` and an `evaluate` that returns
  `correct`/`incorrect` and throws on a malformed answer.
- `createItemExerciseRegistry(datasets)` builds tasks. Each task pins
  `specification.datasetVersion`, and `validateTask` rebuilds it canonically.
- The local store and the server both call the same functions: `bindItemEvent`
  (binding, policy `item-evidence/1`, intent) and `evaluateItemAnswer` (outcome,
  with empty word components).
- Sample adapters: `item-choice`, `item-text`, `item-self-check`. Register a new
  adapter in `ITEM_EXERCISES` so the server can evaluate it.
- `planItemSession` and `summarizeItemSession` (`item-session.ts`) give an
  `ItemSessionPlan` (`family: 'items'`) for the shared `SessionRunner`.

**Intents.** An `assessment` target always has intent `assessment`. Every other item
has intent `practice`. `learn-new` and `review-due` belong to words only, so an item
event can never be SRS evidence.

**Projections** (`item-progress.ts`). All of them are rebuilt from the journal and
are never stored or synced. They share `acceptJournal`: one record per eventId,
first receipt, the `word-clock/1` quarantine and deferral.

| Projection | Built from | Result |
| --- | --- | --- |
| `WordProgressProjector` (`replayWord`) | Word targets only. It refuses an item fact; words that an item mentions are untouched | SRS components |
| `projectExerciseProgress` | Non-assessment item events | Per `exerciseId, datasetId, itemId`: tasks, answers, independent first-answer correct, last outcome. `summarizeExercise` adds coverage and accuracy, `selectItems` the selection order (unseen, then last wrong, then oldest) |
| `projectDailyActivity` | Answer events of every target | Answers per study date, goal and streak. Reveals, introductions, repeated deliveries and `excludeEventIds` (the server's rejections) do not count, and a publication writes no event |
| `projectAssessments` | `assessment` targets | One result per session: first answer per question, and a question revealed or assisted before its answer is `unobserved`. It changes no WordProgress or exercise statistics |

**Server.** `supabase/v2/migrations/004_item_learning.sql` refuses to run before 003
or twice. It adds:
- `catalog_private.item_datasets`: immutable, service SELECT/INSERT only;
- the public view `catalog_item_datasets`;
- the target kind and dataset/item/version columns on `learning_tasks`, with a
  CHECK and an FK to the dataset version;
- the service RPC `v2_item_dataset`;
- `v2_commit_learning` for every target kind.

Only words get a projection row. Item events are journal rows with a server
evaluation. The intake loads the pinned dataset version (`unknown-dataset`),
rebuilds the task (`invalid-task`), binds the event (`task-mismatch`) and evaluates
it (`invalid-answer`). Owner, idempotency, task archive and RLS stay as in S1.
`npm run catalog:datasets -- --output FILE dataset.json…` writes the SQL that
publishes dataset versions. It writes the same JSON again as a no-op, and other
content under a published version fails.

**Client.** A `SessionArchive` of an item session carries exactly the pinned
`datasets` and no words; it is additive to local data version 1. `SessionRunner` runs
both families. `view.family` is `'vocabulary'` or `'items'`, and
`latestOpenSession(store, family)` resumes only the requested family. Pulled item
events from other devices merge into the journal without a word projection.

**Deployment.** `npm run v2:prepare` also writes `learning-items.sql` (004). Apply it
after `learning.sql`.

**Verification.** `node --test test/item-learning.test.mjs` covers the adapters and
forged tasks, all projections (no SRS from mentioned words or word assessments,
daily dedup, test results), the local transaction and remote merge, the Runner on an
item session, and the 004 intake in PGlite (dataset immutability, RLS, rejections).
`test/fixtures/item-datasets.json` has one sample dataset for sentences, grammar,
video segments and a test.

M1–M8 (#333–#340) bring the real datasets, their adapters and pages. Where pages
load datasets (`catalog_item_datasets` or static files pinned by version) is their
decision, as long as the archive pins the version the server has.
