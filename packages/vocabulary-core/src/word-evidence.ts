import type { Word } from './content.js';
import { isLearningEvent, type LearningEvent } from './event.js';
import type { Evaluation } from './exercise.js';
import { applicableComponents, type Component } from './progress.js';
import { timestamp, type Rating } from './scheduler.js';

export const EVIDENCE_POLICY_VERSION = 'evidence/1';
const ALL = Object.freeze(['recognition', 'recall', 'spelling', 'article'] as const);
const TARGET = Object.freeze(['recall', 'spelling', 'article'] as const);
const NONE = Object.freeze([] as const);
function wordRule(assessed: readonly Component[], prompt: readonly Component[], source: Evaluation['source']) {
  return Object.freeze({ assessed: Object.freeze([...assessed]), prompt: Object.freeze([...prompt]), source });
}

/** Shared with exercise adapters: intrinsic prompt exposure is never a client assertion. */
export const WORD_EXERCISE_RULES = Object.freeze({
  introduction: wordRule(['recognition'], ALL, 'automatic'),
  'meaning-choice': wordRule(['recognition'], TARGET, 'automatic'),
  'target-choice': wordRule(['recognition'], TARGET, 'automatic'),
  'meaning-recall': wordRule(['recognition'], TARGET, 'self-assessment'),
  'target-type': wordRule(['recall', 'spelling'], NONE, 'automatic'),
  'article-choice': wordRule(['article'], ['recall', 'spelling'], 'automatic'),
  'target-with-article-type': wordRule(['recall', 'spelling', 'article'], NONE, 'automatic'),
} satisfies Record<string, {
  assessed: readonly Component[]; prompt: readonly Component[]; source: Evaluation['source'];
}>);

/** Evaluations come from the trusted exercise adapter, never directly from synced client JSON. */
export interface EvaluatedWordFact {
  readonly event: LearningEvent;
  readonly evaluation?: Evaluation;
}

export interface WordEvidence {
  readonly eventId: string;
  readonly wordId: string;
  readonly component: Component;
  readonly at: string;
  readonly studyDate: string;
  readonly studyTimezone: string;
  readonly source: Evaluation['source'];
  readonly outcome: 'correct' | 'incorrect' | 'unobserved';
  readonly strength: 'independent' | 'subjective' | 'aided' | 'unobserved';
  readonly action: 'initialize' | 'review' | 'none';
  readonly rating: Rating | null;
}

export function studyDate(at: string, timezone: string): string {
  const time = timestamp(at);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(time));
  const get = (type: string): string => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ruleFor(exerciseId: string): typeof WORD_EXERCISE_RULES[keyof typeof WORD_EXERCISE_RULES] {
  if (!Object.prototype.hasOwnProperty.call(WORD_EXERCISE_RULES, exerciseId)) throw new RangeError('Unknown word exercise');
  return WORD_EXERCISE_RULES[exerciseId as keyof typeof WORD_EXERCISE_RULES];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

export function normalizeWordFacts(word: Word, facts: readonly EvaluatedWordFact[]): readonly EvaluatedWordFact[] {
  const unique = new Map<string, EvaluatedWordFact>();
  const commands = new Map<string, string>();
  const attempts = new Map<string, string>();
  let epoch: string | undefined;
  const applicable = applicableComponents(word);
  for (const fact of facts) {
    const { event, evaluation } = fact;
    if (!isLearningEvent(event) || event.target.kind !== 'word' || event.target.wordId !== word.id) throw new RangeError('Invalid word event');
    if (event.policyVersion !== EVIDENCE_POLICY_VERSION) throw new RangeError('Unsupported evidence policy');
    if (epoch !== undefined && epoch !== event.dataEpoch) throw new RangeError('Mixed data epochs');
    epoch = event.dataEpoch;
    const rule = ruleFor(event.exerciseId);
    if (event.exposure.some(component => !applicable.includes(component))) throw new RangeError('Inapplicable exposure');
    if (event.kind === 'answer') {
      if (event.exerciseId === 'introduction' || !evaluation || evaluation.source !== rule.source ||
          !['correct', 'incorrect', 'unobserved'].includes(evaluation.outcome)) throw new RangeError('Invalid exercise evaluation');
      const assessed = rule.assessed as readonly Component[];
      for (const [component, outcome] of Object.entries(evaluation.components)) {
        if (!applicable.includes(component as Component) || !assessed.includes(component as Component) ||
            !['correct', 'incorrect', 'unobserved'].includes(outcome)) throw new RangeError('Unsupported component evaluation');
      }
    } else if (evaluation !== undefined) throw new RangeError('Non-answer has an evaluation');
    if (event.kind === 'introduction' && event.exerciseId !== 'introduction') throw new RangeError('Invalid introduction exercise');
    const previous = unique.get(event.eventId);
    if (previous && canonical(previous) !== canonical(fact)) throw new RangeError('Conflicting event identity');
    if (commands.has(event.commandId) && commands.get(event.commandId) !== event.eventId) throw new RangeError('Command reused by another event');
    commands.set(event.commandId, event.eventId);
    if (event.kind === 'answer') {
      if (attempts.has(event.attemptId) && attempts.get(event.attemptId) !== event.eventId) throw new RangeError('Attempt reused by another event');
      attempts.set(event.attemptId, event.eventId);
    }
    unique.set(event.eventId, fact);
  }
  return [...unique.values()].sort((a, b) => timestamp(a.event.occurredAt) - timestamp(b.event.occurredAt) ||
    (a.event.eventId < b.event.eventId ? -1 : a.event.eventId > b.event.eventId ? 1 : 0));
}

interface Exposure {
  readonly taskId: string;
  readonly reason: 'prompt' | 'hint' | 'feedback' | 'reveal' | 'introduction';
}

/** Replay session history, including earlier dates when a session resumes after midnight.
 * At equal timestamps all prompts/reveals precede evaluation, and feedback follows the group.
 */
export function deriveWordEvidence(word: Word, facts: readonly EvaluatedWordFact[]): readonly WordEvidence[] {
  const ordered = normalizeWordFacts(word, facts);
  const applicable = applicableComponents(word);
  const exposures = new Map<string, Map<Component, Exposure[]>>();
  const attempted = new Set<string>();
  const taskDefinitions = new Map<string, string>();
  const result: WordEvidence[] = [];
  const taskKey = (event: LearningEvent): string => JSON.stringify([event.sessionId, event.taskId]);
  function expose(event: LearningEvent, components: readonly Component[], reason: Exposure['reason']): void {
    let session = exposures.get(event.sessionId);
    if (!session) { session = new Map(); exposures.set(event.sessionId, session); }
    for (const component of components) {
      if (!applicable.includes(component)) continue;
      const items = session.get(component) ?? [];
      items.push({ taskId: event.taskId, reason });
      session.set(component, items);
    }
  }
  function evidence(event: LearningEvent, component: Component, fields: Pick<WordEvidence, 'source' | 'outcome' | 'strength' | 'action' | 'rating'>): void {
    result.push({ eventId: event.eventId, wordId: word.id, component, at: event.occurredAt,
      studyDate: studyDate(event.occurredAt, event.studyTimezone), studyTimezone: event.studyTimezone, ...fields });
  }
  for (let index = 0; index < ordered.length;) {
    const group: EvaluatedWordFact[] = [];
    const at = ordered[index]!.event.occurredAt;
    while (index < ordered.length && ordered[index]!.event.occurredAt === at) group.push(ordered[index++]!);
    for (const { event } of group) {
      const key = taskKey(event);
      const definition = canonical([event.exerciseId, event.taskVersion, event.contentVersion, event.intent, event.answerLanguage]);
      if (taskDefinitions.has(key) && taskDefinitions.get(key) !== definition) throw new RangeError('Task context changed during session');
      taskDefinitions.set(key, definition);
      if (event.kind !== 'answer') {
        // Revealing a word conservatively exposes every applicable memory component.
        expose(event, ALL, event.kind);
        if (event.kind === 'introduction') evidence(event, 'recognition', {
          source: 'automatic', outcome: 'unobserved', strength: 'unobserved',
          action: event.intent === 'learn-new' ? 'initialize' : 'none', rating: null,
        });
      } else {
        expose(event, ruleFor(event.exerciseId).prompt as readonly Component[], 'prompt');
        expose(event, event.exposure, 'hint');
      }
    }
    for (const { event, evaluation } of group) {
      if (event.kind !== 'answer' || !evaluation) continue;
      const firstAttempt = !attempted.has(taskKey(event));
      const rule = ruleFor(event.exerciseId);
      for (const component of rule.assessed as readonly Component[]) {
        if (!applicable.includes(component)) continue;
        let outcome = evaluation.components[component] ?? 'unobserved';
        // A wrong lexical answer is not evidence about spelling/article of the target word.
        if ((component === 'spelling' || component === 'article') &&
            (rule.assessed as readonly Component[]).includes('recall') && evaluation.components.recall !== 'correct') outcome = 'unobserved';
        const prior = exposures.get(event.sessionId)?.get(component) ?? [];
        if (event.exerciseId === 'meaning-recall' && !prior.some(item => item.reason === 'reveal' && item.taskId === event.taskId)) {
          outcome = 'unobserved'; // incomplete self-assessment workflow; replay when its reveal arrives
        }
        const exposed = prior.some(item => !(event.exerciseId === 'meaning-recall' &&
          evaluation.source === 'self-assessment' && component === 'recognition' &&
          item.reason === 'reveal' && item.taskId === event.taskId));
        const aided = event.assisted || exposed || !firstAttempt;
        const strength = outcome === 'unobserved' ? 'unobserved' : aided ? 'aided'
          : evaluation.source === 'self-assessment' ? 'subjective' : 'independent';
        const eligible = event.intent === 'review-due' && !aided && outcome !== 'unobserved';
        evidence(event, component, { source: evaluation.source, outcome, strength,
          action: event.intent === 'learn-new' && outcome !== 'unobserved' ? 'initialize' : eligible ? 'review' : 'none',
          rating: eligible ? outcome === 'incorrect' ? 'again' : evaluation.source === 'self-assessment' ? 'hard' : 'good' : null });
      }
    }
    for (const { event } of group) if (event.kind === 'answer') {
      attempted.add(taskKey(event));
      // The exercise feedback is treated as disclosure even when the client omits exposure.
      expose(event, ALL, 'feedback');
    }
  }
  return result;
}
