import type { Word } from './content.js';
import { applicableComponents, type Component, type WordProgress } from './progress.js';
import { scheduler, timestamp, type Rating } from './scheduler.js';
import { assertWordProgress, initializeComponent, reviewComponent } from './word-progress.js';
import { deriveWordEvidence, EVIDENCE_POLICY_VERSION, studyDate, type EvaluatedWordFact, type WordEvidence } from './word-evidence.js';

export interface StudyDay { readonly date: string; readonly timezone: string }
export interface DailyTransition {
  readonly component: Component;
  readonly kind: 'initialize' | 'review';
  readonly at: string;
  readonly rating: Rating | null;
  readonly eventIds: readonly string[];
}
export interface DailyEvidenceResult {
  readonly progress: WordProgress;
  readonly evidence: readonly WordEvidence[];
  readonly transitions: readonly DailyTransition[];
}
export interface ReplayDayBoundary {
  readonly previousDate: string;
  readonly firstOccurredAt: string;
}

/** Always recompute from the PRE-DAY snapshot and the union of that day's facts.
 * Never feed yesterday's call result back into this function for the same date.
 */
export function projectWordDay(beforeDay: WordProgress, word: Word, day: StudyDay,
  sessionHistory: readonly EvaluatedWordFact[]): DailyEvidenceResult {
  const evidence = deriveWordEvidence(word, sessionHistory).filter(item => item.studyDate === day.date);
  if (sessionHistory.some(({ event }) => studyDate(event.occurredAt, event.studyTimezone) === day.date &&
      event.studyTimezone !== day.timezone)) throw new RangeError('Study timezone changed within date');
  return projectEvidenceDay(beforeDay, word, day, evidence);
}

/** Trusted derived observations only; replay derives once, then projects each day.
 * replayBoundary is provenance from a validated monotonic replay chain, not client input.
 */
export function projectEvidenceDay(beforeDay: WordProgress, word: Word, day: StudyDay,
  evidence: readonly WordEvidence[], replayBoundary?: ReplayDayBoundary): DailyEvidenceResult {
  assertWordProgress(beforeDay, word);
  if (beforeDay.wordId !== word.id || beforeDay.evidencePolicyVersion !== EVIDENCE_POLICY_VERSION ||
      beforeDay.schedulerVersion !== scheduler.version) throw new RangeError('Progress identity/version mismatch');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || studyDate(`${day.date}T12:00:00.000Z`, 'UTC') !== day.date) throw new RangeError('Invalid study date');
  // Validate timezone even when there are no facts.
  studyDate(`${day.date}T12:00:00.000Z`, day.timezone);
  if (replayBoundary && (!/^\d{4}-\d{2}-\d{2}$/.test(replayBoundary.previousDate) ||
      studyDate(`${replayBoundary.previousDate}T12:00:00.000Z`, 'UTC') !== replayBoundary.previousDate ||
      replayBoundary.previousDate >= day.date || studyDate(replayBoundary.firstOccurredAt, day.timezone) !== day.date)) {
    throw new RangeError('Invalid replay day boundary');
  }
  for (const component of applicableComponents(word)) {
    const state = beforeDay.components[component];
    if (!state) throw new RangeError('Missing component baseline');
    scheduler.nextDue(state);
    for (const at of [state.initializedAt, state.lastReviewedAt]) {
      if (at !== null && (replayBoundary ? timestamp(at) >= timestamp(replayBoundary.firstOccurredAt)
        : studyDate(at, day.timezone) >= day.date)) throw new RangeError('Expected pre-day baseline; replay required');
    }
  }
  if (evidence.some(item => item.wordId !== word.id || item.studyDate !== day.date || item.studyTimezone !== day.timezone)) {
    throw new RangeError('Evidence day/word mismatch');
  }
  let progress = beforeDay;
  const transitions: DailyTransition[] = [];
  // Initialize chronologically so the word's introducedAt is the earliest component baseline.
  const introductions = applicableComponents(word).flatMap(component => {
    if (beforeDay.components[component]!.stage !== 'unintroduced') return [];
    const first = evidence.find(item => item.component === component && item.action === 'initialize');
    return first ? [first] : [];
  }).sort((a, b) => timestamp(a.at) - timestamp(b.at) || a.component.localeCompare(b.component));
  for (const item of introductions) {
    progress = initializeComponent(progress, word, item.component, item.at);
    transitions.push({ component: item.component, kind: 'initialize', at: item.at, rating: null, eventIds: [item.eventId] });
  }
  for (const component of applicableComponents(word)) {
    const state = beforeDay.components[component]!;
    if (state.stage === 'unintroduced') continue; // no review on the introduction date
    const eligible = evidence.filter(item => item.component === component && item.action === 'review' &&
      state.dueAt !== null && timestamp(item.at) >= timestamp(state.dueAt));
    if (!eligible.length) continue;
    const rating = eligible.some(item => item.rating === 'again') ? 'again'
      : eligible.some(item => item.rating === 'hard') ? 'hard' : 'good';
    const at = eligible.find(item => item.rating === rating)!.at;
    progress = reviewComponent(progress, word, component, rating, at);
    transitions.push({ component, kind: 'review', at, rating, eventIds: eligible.map(item => item.eventId) });
  }
  return { progress, evidence, transitions };
}
