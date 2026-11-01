import type { ComponentProgress } from './progress.js';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface Scheduler {
  readonly version: string;
  initialize(at: string): ComponentProgress;
  review(state: ComponentProgress, rating: Rating, at: string): ComponentProgress;
  retention(state: ComponentProgress, at: string): number;
  nextDue(state: ComponentProgress): string | null;
}

// Published FSRS-5 defaults; frozen separately from application evidence policy.
// https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-5
const W = Object.freeze([
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898, 0.51655, 0.6621,
] as const);

export const SCHEDULER_VERSION = 'fsrs5-default-drillcards/1';
export const SCHEDULER_PARAMETERS = Object.freeze({
  weights: W,
  requestedRetention: 0.9,
  learningMinutes: 10,
  relearningMinutes: 10,
  minStabilityDays: 0.01,
  maxStabilityDays: 36500,
  minReviewDays: 1,
  maxReviewDays: 36500,
});

const DAY = 86400000;
const FACTOR = 19 / 81;
const DECAY = -0.5;
const GRADES = { again: 1, hard: 2, good: 3, easy: 4 } as const;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function timestamp(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new RangeError('Expected canonical UTC timestamp');
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new RangeError('Invalid timestamp');
  return result;
}

function iso(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 253402300799999) throw new RangeError('Timestamp outside supported range');
  return new Date(value).toISOString();
}

export function unintroducedComponent(): ComponentProgress {
  return { stage: 'unintroduced', stability: 0, difficulty: 5, initializedAt: null,
    lastReviewedAt: null, dueAt: null, reviewCount: 0, lapseCount: 0 };
}

function baseline(state: ComponentProgress): string {
  const at = state.lastReviewedAt ?? state.initializedAt;
  if (at === null) throw new RangeError('Component has no memory baseline');
  return at;
}

function scheduledDue(state: ComponentProgress): string | null {
  if (state.stage === 'unintroduced') return null;
  const parameters = SCHEDULER_PARAMETERS;
  const interval = state.stage === 'review'
    ? clamp(Math.round(state.stability / FACTOR * (parameters.requestedRetention ** (1 / DECAY) - 1)),
      parameters.minReviewDays, parameters.maxReviewDays) * DAY
    : (state.stage === 'learning' ? parameters.learningMinutes : parameters.relearningMinutes) * 60000;
  return iso(timestamp(baseline(state)) + interval);
}

/** Reject corrupted snapshots; callers must replay out-of-order facts instead of reviewing backwards. */
function assertState(state: ComponentProgress): void {
  if (!['unintroduced', 'learning', 'review', 'relearning'].includes(state.stage) ||
      !Number.isFinite(state.stability) || !Number.isFinite(state.difficulty) ||
      state.difficulty < 1 || state.difficulty > 10 ||
      !Number.isSafeInteger(state.reviewCount) || state.reviewCount < 0 ||
      !Number.isSafeInteger(state.lapseCount) || state.lapseCount < 0 || state.lapseCount > state.reviewCount) {
    throw new RangeError('Invalid component state');
  }
  if (state.stage === 'unintroduced') {
    if (state.stability !== 0 || state.initializedAt !== null || state.lastReviewedAt !== null ||
        state.dueAt !== null || state.reviewCount !== 0 || state.lapseCount !== 0) throw new RangeError('Invalid unintroduced component');
    return;
  }
  if (state.stability < SCHEDULER_PARAMETERS.minStabilityDays || state.stability > SCHEDULER_PARAMETERS.maxStabilityDays ||
      state.initializedAt === null || state.dueAt === null) throw new RangeError('Invalid memory baseline');
  const initialized = timestamp(state.initializedAt);
  if ((state.lastReviewedAt === null) !== (state.reviewCount === 0) ||
      (state.lastReviewedAt !== null && timestamp(state.lastReviewedAt) < initialized) ||
      ((state.stage === 'review' || state.stage === 'relearning') && state.reviewCount === 0) ||
      state.dueAt !== scheduledDue(state)) throw new RangeError('Inconsistent component schedule');
}

function initialDifficulty(grade: number): number {
  return clamp(W[4] - Math.exp(W[5] * (grade - 1)) + 1, 1, 10);
}

function retentionAt(state: ComponentProgress, at: string): number {
  const now = timestamp(at);
  if (state.stage === 'unintroduced') return 0;
  const elapsed = (now - timestamp(baseline(state))) / DAY;
  if (elapsed < 0) throw new RangeError('Time precedes component memory baseline');
  return (1 + FACTOR * elapsed / state.stability) ** DECAY;
}

export const scheduler: Scheduler = Object.freeze({
  version: SCHEDULER_VERSION,
  initialize(at: string): ComponentProgress {
    timestamp(at);
    const state: ComponentProgress = {
      stage: 'learning', stability: W[0], difficulty: initialDifficulty(1),
      initializedAt: at, lastReviewedAt: null, dueAt: null, reviewCount: 0, lapseCount: 0,
    };
    return { ...state, dueAt: scheduledDue(state) };
  },
  retention(state: ComponentProgress, at: string): number {
    assertState(state);
    return retentionAt(state, at);
  },
  nextDue(state: ComponentProgress): string | null {
    assertState(state);
    return scheduledDue(state);
  },
  review(state: ComponentProgress, rating: Rating, at: string): ComponentProgress {
    assertState(state);
    if (state.stage === 'unintroduced') throw new RangeError('Introduce component before review');
    if (typeof rating !== 'string' || !Object.prototype.hasOwnProperty.call(GRADES, rating)) throw new RangeError('Invalid rating');
    const grade = GRADES[rating];
    const r = retentionAt(state, at);
    const elapsed = (timestamp(at) - timestamp(baseline(state))) / DAY;
    const s = state.stability;
    const d = state.difficulty;
    let stability: number;
    if (elapsed < 1) {
      const change = Math.exp(W[17] * (grade - 3 + W[18]));
      stability = s * (grade >= 2 ? Math.max(1, change) : change);
    } else if (grade === 1) {
      stability = Math.min(s, W[11] * d ** -W[12] * ((s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)));
    } else {
      const hard = grade === 2 ? W[15] : 1;
      const easy = grade === 4 ? W[16] : 1;
      stability = s * (1 + Math.exp(W[8]) * (11 - d) * s ** -W[9] *
        (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
    }
    const delta = -W[6] * (grade - 3);
    const difficulty = clamp(W[7] * initialDifficulty(4) + (1 - W[7]) * (d + delta * (10 - d) / 9), 1, 10);
    const failed = grade === 1;
    const wasMature = state.stage === 'review' || state.stage === 'relearning';
    const stage = failed ? (wasMature ? 'relearning' : 'learning')
      : grade === 2 && state.stage !== 'review' ? state.stage : 'review';
    const next: ComponentProgress = {
      ...state, stage, stability: clamp(stability, SCHEDULER_PARAMETERS.minStabilityDays, SCHEDULER_PARAMETERS.maxStabilityDays),
      difficulty, lastReviewedAt: at, reviewCount: state.reviewCount + 1,
      lapseCount: state.lapseCount + (failed && state.stage === 'review' ? 1 : 0), dueAt: null,
    };
    if (!Number.isSafeInteger(next.reviewCount)) throw new RangeError('Review counter overflow');
    return { ...next, dueAt: scheduledDue(next) };
  },
});
