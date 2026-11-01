import type { Owner, Word } from './content.js';
import { applicableComponents, type Component, type ComponentProgress, type WordProgress } from './progress.js';
import { scheduler, timestamp, unintroducedComponent, type Rating } from './scheduler.js';

export function createWordProgress(word: Word, owner: Owner, evidencePolicyVersion: string): WordProgress {
  if (!owner.id.trim() || !['guest', 'account'].includes(owner.kind) || !word.id.trim() || !evidencePolicyVersion.trim()) throw new RangeError('Missing progress identity/version');
  const components: Partial<Record<Component, ComponentProgress>> = {};
  for (const component of applicableComponents(word)) components[component] = unintroducedComponent();
  return { owner: { ...owner }, wordId: word.id, introducedAt: null, components, revision: 0,
    schedulerVersion: scheduler.version, evidencePolicyVersion };
}

export function assertWordProgress(progress: WordProgress, word: Word): void {
  if (progress.wordId !== word.id) throw new RangeError('Word identity mismatch');
  if (progress.schedulerVersion !== scheduler.version) throw new RangeError('Unsupported scheduler version; replay required');
  const applicable = applicableComponents(word);
  if (!progress.owner.id.trim() || !['guest', 'account'].includes(progress.owner.kind) || !progress.evidencePolicyVersion.trim()) {
    throw new RangeError('Missing progress identity/version');
  }
  if (Object.keys(progress.components).some(key => !applicable.includes(key as Component))) throw new RangeError('Unexpected component');
  const baselines: number[] = [];
  for (const key of applicable) {
    const item = progress.components[key];
    if (!item) throw new RangeError('Applicable component is missing');
    scheduler.nextDue(item);
    if (item.initializedAt !== null) baselines.push(timestamp(item.initializedAt));
  }
  if (baselines.length === 0 ? progress.introducedAt !== null
    : progress.introducedAt === null || timestamp(progress.introducedAt) !== Math.min(...baselines)) {
    throw new RangeError('Word introduction does not match component history');
  }
  if (!Number.isSafeInteger(progress.revision) || progress.revision < 0) {
    throw new RangeError('Invalid progress revision');
  }
}

function componentState(progress: WordProgress, word: Word, component: Component): ComponentProgress {
  assertWordProgress(progress, word);
  if (!applicableComponents(word).includes(component)) throw new RangeError('Component does not apply to word');
  if (progress.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid progress revision');
  const state = progress.components[component]!;
  return state;
}

/** Introduction is idempotent and creates no successful review or lapse. */
export function initializeComponent(progress: WordProgress, word: Word, component: Component, at: string): WordProgress {
  timestamp(at);
  const state = componentState(progress, word, component);
  if (state.stage !== 'unintroduced') return progress;
  if (progress.introducedAt !== null && timestamp(at) < timestamp(progress.introducedAt)) throw new RangeError('Replay earlier introductions first');
  return { ...progress, introducedAt: progress.introducedAt ?? at, revision: progress.revision + 1,
    components: { ...progress.components, [component]: scheduler.initialize(at) } };
}

/** Low-level transition: P2/P3 authorize evidence and deduplicate daily facts before calling. */
export function reviewComponent(progress: WordProgress, word: Word, component: Component, rating: Rating, at: string): WordProgress {
  const state = componentState(progress, word, component);
  return { ...progress, revision: progress.revision + 1,
    components: { ...progress.components, [component]: scheduler.review(state, rating, at) } };
}
