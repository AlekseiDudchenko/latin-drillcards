import { isItemSessionPlan, LEVEL_TEST_DATASET, levelTestContent, projectAssessments, scoreLevelTest, type ItemDataset,
  type ItemSessionPlan, type LevelTestLevel, type LevelTestOutcome, type LevelTestScore, type Owner, type RecordedLearningFact,
  type SessionState } from '../../core/index.js';

// Pure model of the level test page (M8 / #340): one result per run from the journal, the step after
// an answer and the result the home screen shows. No DOM and no storage, so it is unit-tested directly.
export interface LevelTestArchive {
  readonly state: SessionState;
  readonly datasets?: readonly ItemDataset[];
}
export interface LevelTestRun {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly lastAnsweredAt: string | null;
  readonly status: SessionState['status'];
  readonly score: LevelTestScore;
}
type Context = { readonly owner: Owner; readonly dataEpoch: string; readonly epochStartedAt: string; readonly asOf: string };

export const isLevelTestPlan = (plan: SessionState['plan']): plan is ItemSessionPlan =>
  isItemSessionPlan(plan) && plan.datasets.length === 1 && plan.datasets[0]!.datasetId === LEVEL_TEST_DATASET;

/** Planned tasks with their level, read from the dataset pinned in the session archive. */
export function plannedLevels(archive: LevelTestArchive): { itemId: string; level: LevelTestLevel }[] {
  const plan = archive.state.plan as ItemSessionPlan;
  const items = new Map((archive.datasets?.[0]?.items ?? []).map(item => [item.id, item]));
  return plan.tasks.map(task => {
    const content = levelTestContent(items.get(task.target.itemId)?.content ?? null);
    if (!content) throw new RangeError(`Level test question ${task.target.itemId} is missing from its archive`);
    return { itemId: task.target.itemId, level: content.level };
  });
}

/** Every level test run of the scope, oldest first. Scores come from `projectAssessments` (first
 * answer per question, revealed/assisted → unobserved) and the policy; nothing else is stored. */
export function levelTestRuns(data: { readonly sessions: readonly LevelTestArchive[]; readonly facts: readonly RecordedLearningFact[] },
  context: Context): LevelTestRun[] {
  const results = new Map(projectAssessments(data.facts, context).map(result => [result.sessionId, result]));
  return data.sessions.filter(archive => isLevelTestPlan(archive.state.plan))
    .map(archive => {
      const result = results.get(archive.state.plan.sessionId);
      const outcomes = new Map<string, LevelTestOutcome>((result?.questions ?? []).map(q => [q.itemId, q.outcome]));
      return { sessionId: archive.state.plan.sessionId, createdAt: archive.state.plan.createdAt, lastAnsweredAt: result?.lastAnsweredAt ?? null,
        status: archive.state.status, score: scoreLevelTest(plannedLevels(archive), outcomes) };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sessionId < b.sessionId ? -1 : 1));
}

/** The result the home screen shows: the latest concluded run. A run left half-way has no estimate. */
export function latestLevelResult(runs: readonly LevelTestRun[]): LevelTestRun | undefined {
  return [...runs].reverse().find(run => run.score.status === 'concluded');
}

/** What follows a stored answer: the next question, or the end of the run. When the policy concludes
 * before the last planned task, the remaining tasks are skipped (`finish`); the last task completes. */
export function stepAfterAnswer(score: LevelTestScore, taskIndex: number, total: number): 'next' | 'finish' | 'complete' {
  if (taskIndex >= total - 1) return 'complete';
  return score.status === 'concluded' ? 'finish' : 'next';
}

/** Question number shown as "n / max", as in v1: max is every question the run can still ask. */
export function progressOf(score: LevelTestScore, taskIndex: number, total: number): { n: number; max: number } {
  const max = total - score.skipped;
  return { n: Math.min(taskIndex + 1, max), max };
}
