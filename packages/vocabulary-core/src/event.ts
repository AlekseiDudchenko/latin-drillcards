import type { LearningTarget, StudyIntent, TranslationLanguage } from './content.js';
import type { JsonValue } from './exercise.js';
import { COMPONENTS, type Component } from './progress.js';

export const EVENT_SCHEMA_VERSION = 1 as const;

interface EventContext {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly commandId: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly target: LearningTarget;
  readonly exerciseId: string;
  readonly intent: StudyIntent;
  /** Language of the translated meaning used by the task, even when the response is German. */
  readonly answerLanguage: TranslationLanguage;
  readonly occurredAt: string;
  readonly studyTimezone: string;
  readonly taskVersion: string;
  readonly contentVersion: number;
  readonly policyVersion: string;
  readonly dataEpoch: string;
}

/** Client facts, not trusted evaluations. Authenticated owner is assigned by the server. */
export type LearningEvent = EventContext & (
  | { readonly kind: 'answer'; readonly attemptId: string; readonly rawAnswer: JsonValue;
      readonly assisted: boolean; readonly exposure: readonly Component[] }
  | { readonly kind: 'introduction' | 'reveal'; readonly exposure: readonly Component[] }
);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function json(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => json(item, depth + 1));
  return record(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(item => json(item, depth + 1));
}
function target(value: unknown): value is LearningTarget {
  if (!record(value)) return false;
  if (value.kind === 'word') return text(value.wordId) &&
    Object.keys(value).every(key => key === 'kind' || key === 'wordId');
  return typeof value.kind === 'string' && ['sentence', 'grammar-item', 'phrase', 'video-segment', 'assessment'].includes(value.kind) &&
    text(value.datasetId) && text(value.itemId) &&
    Object.keys(value).every(key => ['kind', 'datasetId', 'itemId'].includes(key));
}

/** Strict boundary check; unknown versions/fields fail instead of silently changing replay. */
export function isLearningEvent(value: unknown): value is LearningEvent {
  if (!record(value) || value.schemaVersion !== EVENT_SCHEMA_VERSION || !target(value.target)) return false;
  if (typeof value.intent !== 'string' || !['learn-new', 'review-due', 'practice', 'assessment'].includes(value.intent)) return false;
  if (value.answerLanguage !== 'ru' && value.answerLanguage !== 'en') return false;
  const strings = ['eventId', 'commandId', 'sessionId', 'taskId', 'exerciseId', 'occurredAt',
    'studyTimezone', 'taskVersion', 'policyVersion', 'dataEpoch'];
  if (!strings.every(key => text(value[key]))) return false;
  if (typeof value.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurredAt)) return false;
  const timestamp = Date.parse(value.occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value.occurredAt) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: String(value.studyTimezone) }); } catch { return false; }
  if (!Number.isSafeInteger(value.contentVersion) || Number(value.contentVersion) < 1) return false;
  if (!Array.isArray(value.exposure) || !value.exposure.every(component => COMPONENTS.includes(component)) ||
      new Set(value.exposure).size !== value.exposure.length) return false;
  const keys = ['schemaVersion', 'target', 'contentVersion', 'kind', 'exposure', 'intent', 'answerLanguage', ...strings];
  if (value.kind === 'answer') {
    keys.push('attemptId', 'rawAnswer', 'assisted');
    if (!text(value.attemptId) || typeof value.assisted !== 'boolean' || !json(value.rawAnswer)) return false;
  } else if (value.kind !== 'introduction' && value.kind !== 'reveal') return false;
  return Object.keys(value).every(key => keys.includes(key));
}
