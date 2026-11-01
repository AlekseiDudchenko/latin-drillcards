# Five-word circuit, corrections and summary (L3 / #317)

A circuit is a vocabulary plan with `format: 'circuit'` from the
[planner](session-planner.md): at most five words, fixed for the whole session, run
stage by stage. The same [SessionRunner](session-runner.md) drives single sessions,
full circuits (`all-exercises`) and adaptive review circuits (`due-components`);
the plan alone decides which tasks exist.

## Stages and diagnostics

- **Learning:** introduction → meaning choice → German choice → article choice →
  German typing → typing with article → meaning recall, each stage across all five
  words in a seeded order. Inapplicable exercises are left out by the planner and
  listed in `plan.skippedExercises`; an unavailable stage never pulls in a new word.
- **Review:** a diagnostic stage comes first, with one task per word. Any feedback
  discloses all of a word's components, so only that first task can be independent
  evidence.
  - The task is chosen by the word's **most overdue** due component; ties prefer
    productive checks (recall, spelling, article, then recognition). Recall,
    spelling and article get typing with article, or plain typing for words
    without one. Recognition gets meaning choice, then German choice, then recall.
  - The remaining stages follow in productive-first order, without repeating the
    diagnostic.
  - Recognition and recall therefore alternate between sessions instead of
    recognition never being reviewed. (Planner `vocabulary-planner/2`; stored
    `/1` plans are unchanged.)
  - `due-components` keeps only exercises assessing due components;
    `all-exercises` keeps every applicable one.
  - Another word's choice options may show a word before its diagnostic only when
    the diagnostic is itself a choice.

- **Earlier disclosures:** the Runner sends no hints of its own. The shared
  [evidence policy](word-evidence.md) replays every fact of the session per word.
  Prompts, reveals, introductions and feedback of earlier stages therefore make
  later tasks of that word aided: they can initialize learning, but never add a
  second review on the same day.

## Correction round

`SessionState.corrections` is an append-only list of extra tasks after
`plan.tasks`; the plan itself is never changed. `sessionTasks(state)` is the
cursor's task list.

- When the cursor leaves a circuit's last planned task, `buildCorrectionTasks`
  takes every planned task answered incorrectly, in plan order. Each one is
  presented once more as a new task for the same word and exercise, with its own
  ID (`correctionTaskId`) and seed, so choice options are reshuffled.
- There is one round only: a wrong correction answer is reported, not corrected
  again. Single sessions have no round, and a circuit without mistakes completes
  directly.
- Correction answers use the plan's intent and are stored like any other answer.
  The evidence policy treats them as repeated, aided attempts, so they cannot
  inflate SRS.
- The S0 store enforces the round:
  - Never at start, never empty, and only on circuits.
  - The save that leaves the last planned task must carry exactly
    `buildCorrectionTasks`, rebuilt from the stored journal, with status
    `presenting`. Without mistakes the round is absent.
  - Once stored, the round can never be replaced.
  - Every correction task is validated against the archived catalog like a
    planned task.
  - The number of tasks can grow; the batch of words cannot.

## Summary

`summarizeVocabularySession(state, registry, facts)` is a pure core function; the
Runner exposes it as `view.summary` once the session has ended.

- **Totals:** the number of tasks, answers and mistakes.
- **For each batch word, per component:**
  - result: `correct`, `incorrect`, `corrected` (a later correct observation of
    that component) or `unobserved`;
  - the strength of its first observation, e.g. `independent` for a clean
    diagnostic and `aided` after a disclosure. Whether it changes the schedule
    is decided by the daily projection across all of that day's sessions, so the
    summary does not predict SRS transitions.
- **For each batch word, every incorrect answer:** the given answer as shown, the
  expected answer, their language, and whether a later answer to the same exercise
  was correct.
- The Runner caches the summary per stored revision. The page inserts answers as
  text nodes with their `lang`.

Spelling and article stay unobserved after a wrong lexical answer, as defined by
the evidence policy.

## Page and verification

The deck screen of `public/v2/session.html` ([home-screen.md](home-screen.md)) offers the
format (one exercise or a full set) and, for a review set, due components or all exercises. During corrections the progress line
shows "Mistake review"; a finished session shows the summary.

Tests:

- `test/session-review.test.mjs`: stages and words, corrections, summary,
  per-word diagnostics, several review circuits in a row reviewing every
  component, and a verb skipping inapplicable stages;
- `test/session-runner.spec.ts`: circuit, correction round, reload inside it,
  storage rejection of forged, empty, early, missing or abandoning corrections,
  and a due-components review circuit through the Runner;
- `test/session-page.spec.ts`: a five-word circuit through stages, mistake review
  and summary.
