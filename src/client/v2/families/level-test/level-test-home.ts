import type { Lang } from '../../../i18n.js';
import type { RecordedLearningFact } from '../../core/index.js';
import { fill, levelTestUiTranslations } from './level-test-i18n.js';
import { latestLevelResult, levelTestRuns, type LevelTestArchive, type LevelTestRun } from './level-test-model.js';

// M8 (#340): the home screen's line for the latest concluded level test. Read-only: it shows the
// result and links the recommended deck; it never writes progress and never starts a session.
let latest: LevelTestRun | undefined;

export function updateLevelResult(data: { readonly sessions: readonly LevelTestArchive[]; readonly facts: readonly RecordedLearningFact[] },
  context: Parameters<typeof levelTestRuns>[1]): void {
  try { latest = latestLevelResult(levelTestRuns(data, context)); } catch { latest = undefined; }
}

export function renderLevelResult(node: HTMLElement, language: Lang): void {
  const text = levelTestUiTranslations(language); const estimate = latest?.score.estimate;
  node.hidden = !estimate; node.replaceChildren();
  if (!estimate) return;
  const [before, after = ''] = text.homeResult.split('{start}');
  const link = document.createElement('a'); link.href = `#deck=${estimate.start}`; link.textContent = estimate.start.toUpperCase();
  node.append(fill(before!, { level: estimate.level.toUpperCase() }), link, fill(after, { level: estimate.level.toUpperCase() }));
}
