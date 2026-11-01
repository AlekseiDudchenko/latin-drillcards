# Local learning storage (S0 / #293)

`LearningDatabase` in `src/client/v2/storage/learning-db.ts` implements the
shared `LearningStore` port with real browser IndexedDB. Database
`drillcards-learning-v2` starts at schema version 1; partition payloads independently
pin `LOCAL_DATA_VERSION=1`. Unknown versions fail rather than being decoded as
current data. Version changes close open connections; a blocked upgrade reports
an error. There is no localStorage/old guest queue import and no v1 write path.

## Ownership and epochs

Call `scope({kind: 'account' | 'guest', id}, {dataEpoch, epochStartedAt})`.
Keys encode structured tuples, including owner kind, ID and epoch. Identical
guest/account IDs remain different owners. Scope handles capture and clone this
identity before asynchronous work, and every transaction validates the owner's
current epoch. A mismatch requires explicit `reset(scope, nextEpoch)`; reset
starts empty, rejects old handles across tabs and forbids reusing prior epochs.
Old handles fail with `RetiredScopeError` (also after a guest transfer), which long-running
work such as the sync service treats as final.
Inactive partitions are retained locally, never returned by an active scope.
This is application isolation, not protection from scripts executing on the same origin.

`ActiveLearningContext.switchTo(scope | undefined)` invalidates pending UI work
and synchronously invokes the supplied clearing callback. Auth integration must
clear rendered/in-memory learning state and stop its current sync worker there.
Use `run(captured => ...)` for asynchronous UI loads/commands; stale completions
reject and cannot repopulate a different owner's view. A write already running
may finish in its original scope. Never resolve a new owner inside its callback.
S0 provides this integration point; production auth/Runner wiring is L2/F4. The
network worker and ACK protocol are S2: `acknowledge` and `mergeRemote` update the
outbox, server cursor and journal in one transaction ([learning-sync.md](learning-sync.md)).
The transaction bodies are exported pure functions (`startInPartition`,
`commitInPartition`, `acknowledgeInPartition`, `mergeRemoteInPartition`) so tests
can run the same logic without IndexedDB. This change does
not claim that the still-published v1 runtime uses the v2 store.

## Atomic writes and restoration

1. `startSession` persists a ready revision-zero state, the complete immutable
   plan/tasks and the published catalog snapshot/version. Tasks are validated
   against that snapshot. Session IDs cannot replace a different archive.
2. `commit` takes owner, epoch, raw event, next session state, expected session
   revision and explicit first local `receivedAt`. Receipt must come from the
   adapter's clock, independently of the event's occurrence time. The server
   will assign its own authoritative receipt in S1.
3. One readwrite transaction checks identities and session CAS, recomputes the
   answer with the archived registry, replays the complete affected word journal,
   and saves facts, projection/checkpoints, session cursor and outbox IDs.
   An optional supplied WordProgress must equal replay; no independent exercise
   progress is accepted. Session storage revision is independent of SRS revision.
4. Resolve `committed` only on transaction completion, never request success.
   Quota, replay/validation errors and aborts reject and leave all fields unchanged.
   The Runner may display saved feedback only after resolution and must retain a
   retry command on failure. Exact event retries return `duplicate` even after
   CAS advances; identity reuse with different event content fails.
5. `snapshot()` reads owner-scoped sessions, immutable tasks/catalog, raw facts
   with local evaluation/first receipt, projections with checkpoints and outbox.
   On reload/resume use `restore(asOf)` to rebuild projections at an explicit
   current time and apply previously deferred facts. Persisted `projectionAsOf`
   never decreases, including when a delayed commit has an older first receipt.
   Use the archived catalog to render/re-evaluate, never today's larger catalog.
   `saveSession` persists pause/resume/next with the same CAS and unchanged plan,
   without inventing evidence. Cursor advance requires a persisted answer or
   introduction, and state-only saves cannot create feedback. Cursor rewinds/skips
   and terminal-state writes fail.
   A circuit's correction round (`SessionState.corrections`, L3) may be appended
   once, by the save that leaves the last planned task, and must equal the round
   rebuilt from the stored journal ([session-circuit.md](session-circuit.md)).

The first adapter deliberately stores each owner's complete epoch partition as
one IndexedDB value, with owner heads in a second store. Both stores participate
in the same transaction. This keeps the event/projection/session/outbox invariant
explicit and serializes concurrent writers across connections. Reads and writes
copy the partition; cost grows with history. Indexed per-event records and
incremental replay can replace this layout with a schema migration when needed.
No async network or other external wait is allowed inside a transaction.

## Explicit guest transfer

`transferGuest(guestScope, accountScope, asOf)` moves only newly created v2 data,
only within the same global epoch and epoch start. It merges journals, rewrites
local owner bindings, replays shared words from facts, retains session/task
archives and transfers pending outbox IDs in one transaction. Session/event/
command/attempt collisions reject the entire operation. A durable source marker
makes retries idempotent, retires guest reads/writes, and forbids assigning that
guest to a second account. Create a fresh guest ID after logout. A guest from a
previous epoch cannot resurrect reset progress. This is a local move; authenticated
server acceptance/ownership reconciliation is S1/S2.

## Verification

`npm run verify`, `npx tsc -p test/tsconfig.json` and
`npx playwright test test/learning-db.spec.ts --workers=1`.
Browser tests exercise Chromium IndexedDB, including abort **after** successful
put, reopening, pinned choice options, mutation after dispatch, multi-connection
CAS, command collisions, owner switches with delayed completion, guest transfer
and epoch invalidation. L2 adds the production card → Runner → reload UI: [session-runner.md](session-runner.md).
