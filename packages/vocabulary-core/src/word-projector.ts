import type { Owner, Word } from './content.js';
import { projectEvidenceDay, type DailyEvidenceResult, type StudyDay } from './daily-evidence.js';
import type { WordProgress } from './progress.js';
import { timestamp } from './scheduler.js';
import { deriveWordEvidence, EVIDENCE_POLICY_VERSION, normalizeWordFacts, studyDate, type EvaluatedWordFact } from './word-evidence.js';
import { createWordProgress } from './word-progress.js';

export const WORD_PROJECTOR_VERSION = 'word-projector/1';
export const CLOCK_POLICY = Object.freeze({ version: 'word-clock/1', maxFutureSkewMinutes: 5 });

/** receivedAt is the authoritative FIRST receipt/persist time, never a retry's delivery time. */
export interface RecordedWordFact extends EvaluatedWordFact {
  readonly owner: Owner;
  readonly receivedAt: string;
}
export interface ReplayContext {
  readonly owner: Owner;
  readonly dataEpoch: string;
  readonly epochStartedAt: string;
  readonly asOf: string;
}
export interface WordDayCheckpoint extends DailyEvidenceResult {
  readonly day: StudyDay;
  readonly before: WordProgress;
  readonly eventIds: readonly string[];
}
export interface WordReplayResult {
  readonly version: typeof WORD_PROJECTOR_VERSION;
  readonly clockPolicyVersion: typeof CLOCK_POLICY.version;
  readonly progress: WordProgress;
  readonly days: readonly WordDayCheckpoint[];
  readonly processedEventIds: readonly string[];
  readonly quarantined: readonly { readonly eventId: string; readonly reason: 'before-epoch' | 'future-clock' }[];
  readonly deferredEventIds: readonly string[];
}

/** Rebuild from the complete journal. Late facts recompute their date and every later date.
 * Previous projections/counters are never merged or used as an authoritative input.
 */
export function replayWord(word: Word, records: readonly RecordedWordFact[], context: ReplayContext): WordReplayResult {
  if (!context.dataEpoch.trim()) throw new RangeError('Missing data epoch');
  const now = timestamp(context.asOf);
  const start = timestamp(context.epochStartedAt);
  if (start > now) throw new RangeError('Epoch starts after replay time');
  let progress = createWordProgress(word, context.owner, EVIDENCE_POLICY_VERSION);
  const receipts = new Map<string, number>();
  const facts: EvaluatedWordFact[] = [];
  for (const record of records) {
    if (record.owner.kind !== context.owner.kind || record.owner.id !== context.owner.id ||
        record.event.dataEpoch !== context.dataEpoch) throw new RangeError('Replay owner/epoch mismatch');
    const receipt = timestamp(record.receivedAt);
    receipts.set(record.event.eventId, Math.min(receipt, receipts.get(record.event.eventId) ?? receipt));
    facts.push(record.evaluation === undefined ? { event: record.event } : { event: record.event, evaluation: record.evaluation });
  }
  const normalized = normalizeWordFacts(word, facts);
  const quarantined: { eventId: string; reason: 'before-epoch' | 'future-clock' }[] = [];
  const deferredEventIds: string[] = [];
  const accepted: EvaluatedWordFact[] = [];
  for (const fact of normalized) {
    const event = fact.event;
    const occurred = timestamp(event.occurredAt);
    const received = receipts.get(event.eventId)!;
    if (occurred < start || received < start) quarantined.push({ eventId: event.eventId, reason: 'before-epoch' });
    else if (occurred > received + CLOCK_POLICY.maxFutureSkewMinutes * 60000) quarantined.push({ eventId: event.eventId, reason: 'future-clock' });
    else if (occurred > now || received > now) deferredEventIds.push(event.eventId);
    else accepted.push(fact);
  }
  const groups = new Map<string, { day: StudyDay; eventIds: string[]; firstAt: string }>();
  let latestDate = '';
  let previousTime = -Infinity;
  for (const { event } of accepted) {
    const date = studyDate(event.occurredAt, event.studyTimezone);
    if (date < latestDate) throw new RangeError('Overlapping study calendar; resolve pinned timezone before replay');
    latestDate = date;
    let group = groups.get(date);
    if (!group) {
      if (timestamp(event.occurredAt) <= previousTime) throw new RangeError('Overlapping study calendar; simultaneous dates');
      group = { day: { date, timezone: event.studyTimezone }, eventIds: [], firstAt: event.occurredAt };
      groups.set(date, group);
    }
    if (group.day.timezone !== event.studyTimezone) throw new RangeError('Study timezone changed within date');
    group.eventIds.push(event.eventId);
    previousTime = timestamp(event.occurredAt);
  }
  // Session exposure is derived once over all accepted history, including previous dates.
  const evidence = deriveWordEvidence(word, accepted);
  const byDate = new Map<string, typeof evidence[number][]>();
  for (const item of evidence) {
    const items = byDate.get(item.studyDate) ?? [];
    items.push(item); byDate.set(item.studyDate, items);
  }
  const days: WordDayCheckpoint[] = [];
  let previousDate: string | undefined;
  for (const { day, eventIds, firstAt } of groups.values()) {
    const before = progress;
    const result = projectEvidenceDay(before, word, day, byDate.get(day.date) ?? [],
      previousDate === undefined ? undefined : { previousDate, firstOccurredAt: firstAt });
    progress = result.progress;
    days.push({ day, before, ...result, eventIds });
    previousDate = day.date;
  }
  return { version: WORD_PROJECTOR_VERSION, clockPolicyVersion: CLOCK_POLICY.version, progress, days,
    processedEventIds: accepted.map(fact => fact.event.eventId), quarantined, deferredEventIds };
}
