# Session runner (L2 / #316)

`SessionRunner` in `src/client/v2/session-runner.ts` drives one persisted session
through the S0 [`LearningScope`](local-learning-store.md) port. It is DOM-free:
cards and pages subscribe to its view and send commands. It has no clock, random
source, network or auth lookup of its own: `RunnerEnvironment` supplies `now()`
(event time and first local receipt) and `id()` (event/command/attempt IDs).
The production page is `public/v2/session.html` ([home screen](home-screen.md)):
deck → card → Runner → IndexedDB → reload → continue.

## States and commands

Stored `SessionState.status` is the only state and the view's phase. `ready` is
visible only when saving the start failed (`retry()` repeats it); `answered` is
shown as feedback. All commands return promises and reject, never throw synchronously.

```
ready ─start─▶ presenting ─submit─▶ feedback ─next─▶ presenting … ─next(last)─▶ completed
                 │  ▲ reveal (self-assessment, stays presenting)
  presenting/feedback ─pause─▶ paused ─resume─▶ presenting | feedback
  any non-terminal ─finish─▶ abandoned
```

| Command | Writes | Precondition |
| --- | --- | --- |
| `start(store, env, archive)` | `startSession` (idempotent by sessionId), then ready → presenting | Planner result with its catalog snapshot |
| `open(store, env, sessionId)` | `restore(now)`, then the same settling as start | Session exists in this owner/epoch |
| `submit(rawAnswer)` | answer event + `feedback` in one `commit` | presenting, not an introduction; meaning-recall revealed |
| `reveal()` | reveal event, stays `presenting`; a second reveal is a no-op | Task with a reveal input |
| `next()` | cursor +1 via `saveSession`, or `completed` after the last task | feedback (a persisted answer/introduction) |
| `pause()` / `resume()` | `saveSession`; resume returns to feedback only if the task has a persisted answer | presenting/feedback; paused |
| `finish()` | `abandoned`; recorded answers remain | non-terminal |
| `retry()` | the last failed command, unchanged | a failed command exists |

**Introductions** are committed by the Runner as soon as an introduction task
becomes current (start, open, next), before the card may show the word. Its
phase is then `feedback` and the card's Continue sends `next()`. A page shows no
introduction card while that event is not saved.

Answers carry no hints yet (`assisted: false`, `exposure: []`); the shared evidence
policy adds prompt, reveal and feedback disclosure itself. Events use the plan's
request intent and the task's answer language. Only vocabulary plans are accepted;
other families join through G1–G3.

## Atomicity, identity and retry

Each command is built **once**: event/command/attempt IDs, occurrence time,
expected session revision and the complete next state. The S0 transaction stores
the event, its evaluation, projection, session cursor and outbox ID together and
resolves only after completion. The Runner then re-reads the stored session and
its facts; the view (phase, answer, evaluation, revealed) is derived from them,
never from UI state.

- One command at a time. Re-sending the in-flight command returns its promise;
  any other command is rejected while a save is pending.
- A failed write retains the command and reports `error: 'save'`. `retry()` and
  submitting the same raw answer again re-send the identical command.
- If the write succeeded but its acknowledgement was lost, the event retry is a
  store `duplicate`; a state-only retry sees a revision conflict with exactly the
  intended state saved and is also treated as `duplicate`. No second answer exists.
- Before building a *different* command while one has failed, the Runner re-reads
  storage. If the failed write was in fact stored, it is cleared and the new command
  starts from the real state: a second `reveal()` returns `duplicate`, and a different
  answer after a lost acknowledgement returns `duplicate` with the stored first answer.
- A real conflict (another tab advanced the session) reloads the stored state and
  reports `error: 'conflict'`; the stale command is dropped, not replayed. The page
  treats a conflicting submit/reveal as not saved, so the card stays answerable.
- Event commands are idempotent by eventId/commandId/attemptId in the store.
  State-only commands (next, pause, resume, finish) have no commandId in the S0
  contract: they are idempotent by session CAS, and a retry whose conflict shows
  exactly the intended state is treated as already applied.

## Reload and leaving the page

Reload in any phase calls `open`: the archived plan, tasks, choice options and
catalog are used, never the current catalog. Presenting shows the same task;
feedback shows the stored answer and evaluation; a self-assessment reveal stays
revealed; paused stays paused (the page resumes it when reopened on `#session`).
`latestOpenSession(scope)` finds the newest non-terminal session.

`dispose()` stops notifications and rejects further commands. A write already in
the transaction may finish in storage; its completion no longer reaches the UI.
The page disposes the runner and card, aborts its DOM listeners and closes the
database on `pagehide`; a back/forward-cache restore reloads from storage.

## Preview wiring and limits

Until F4 (#308) the page uses one local guest (`dc_v2_preview_guest` in
localStorage) and a fixed preview epoch; decks come from the static seed catalog
([home-screen.md](home-screen.md)). Circuits, the correction round and the summary are
[session-circuit.md](session-circuit.md) (L3); home page, deck choice and the word card are
L4 (#318); server sync and the outbox worker are S1/S2 ([learning-sync.md](learning-sync.md)); the session page connects to them at R3.

## Verification

`npm run verify`, `npx tsc -p test/tsconfig.json` and
`npx playwright test test/session-runner.spec.ts test/session-page.spec.ts --workers=1`.
Runner specs use the compiled adapter on Chromium IndexedDB and wrap the port to
fail before a write or lose the acknowledgement after it (answers, reveals, start,
introduction, next), and cover a second tab and dispose. Page specs reload on a saved
introduction, a question, feedback and pause, compare pinned options, inject an
IndexedDB write failure and retry, keep the card answerable after a cross-tab
conflict, guard a double Start and switch interface language.
