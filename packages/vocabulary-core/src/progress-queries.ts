import type { Deck, Owner, PartOfSpeech, TranslationLanguage, Word } from './content.js';
import { applicableComponents, type Component, type WordProgress } from './progress.js';
import { scheduler, timestamp } from './scheduler.js';
import { EVIDENCE_POLICY_VERSION, studyDate, WORD_EXERCISE_RULES } from './word-evidence.js';
import { assertWordProgress } from './word-progress.js';

export const WORD_SUMMARY_POLICY = Object.freeze({
  version: 'word-summary/1', horizonDays: 7,
  weights: Object.freeze({ recognition: 1, recall: 1, spelling: 1, article: 1 }),
});
export interface ComponentSummary {
  readonly component: Component;
  readonly stage: 'unintroduced' | 'learning' | 'review' | 'relearning';
  readonly dueAt: string | null;
  readonly due: boolean;
  readonly retentionNow: number;
}
export interface WordSummary {
  readonly version: typeof WORD_SUMMARY_POLICY.version;
  readonly wordId: string;
  readonly state: 'new' | 'learning' | 'scheduled' | 'due';
  readonly applicableCount: number;
  readonly introducedCount: number;
  readonly coverage: number;
  readonly dueAt: string | null;
  readonly dueComponents: readonly Component[];
  readonly components: readonly ComponentSummary[];
  /** Weighted retention at a fixed future horizon; unintroduced contributes zero. Not synced. */
  readonly score: number;
  readonly scoreHorizonDays: number;
}

/** A component is never due on the study day it was introduced or last reviewed: the projector counts at most one
 * review per day and none on the introduction day, so offering it would silently discard the answers.
 * `studyTimezone` defaults to the runtime's, matching the zone sessions pin when they start.
 */
export function summarizeWord(word: Word, progress: WordProgress | undefined, at: string,
  studyTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): WordSummary {
  const now = timestamp(at);
  const today = studyDate(at, studyTimezone);
  if (progress) {
    assertWordProgress(progress, word);
    if (progress.evidencePolicyVersion !== EVIDENCE_POLICY_VERSION) throw new RangeError('Unsupported evidence policy');
  }
  const horizon = new Date(now + WORD_SUMMARY_POLICY.horizonDays * 86400000).toISOString();
  const components: ComponentSummary[] = [];
  let weightedRetention = 0;
  let weightSum = 0;
  for (const component of applicableComponents(word)) {
    const state = progress?.components[component];
    const active = state !== undefined && state.stage !== 'unintroduced';
    const weight = WORD_SUMMARY_POLICY.weights[component];
    weightSum += weight;
    if (active) weightedRetention += weight * scheduler.retention(state, horizon);
    components.push({ component, stage: state?.stage ?? 'unintroduced', dueAt: active ? state.dueAt : null,
      due: active && state.dueAt !== null && timestamp(state.dueAt) <= now &&
        [state.initializedAt, state.lastReviewedAt].every(time => time === null || studyDate(time, studyTimezone) < today),
      retentionNow: active ? scheduler.retention(state, at) : 0 });
  }
  const introducedCount = components.filter(component => component.stage !== 'unintroduced').length;
  const dueComponents = components.filter(component => component.due).map(component => component.component);
  const deadlines = components.flatMap(component => component.dueAt === null ? [] : [component.dueAt]).sort();
  const state = !progress || progress.introducedAt === null ? 'new' : dueComponents.length ? 'due'
    : introducedCount < components.length || components.some(component => component.stage === 'learning' || component.stage === 'relearning')
      ? 'learning' : 'scheduled';
  return { version: WORD_SUMMARY_POLICY.version, wordId: word.id, state, applicableCount: components.length,
    introducedCount, coverage: introducedCount / components.length, dueAt: deadlines[0] ?? null,
    dueComponents, components, score: weightedRetention / weightSum, scoreHorizonDays: WORD_SUMMARY_POLICY.horizonDays };
}

export interface WordQueryContext {
  readonly owner: Owner;
  readonly words: readonly Word[];
  readonly progress: readonly WordProgress[];
  readonly at: string;
  readonly answerLanguage: TranslationLanguage;
  readonly exerciseId?: keyof typeof WORD_EXERCISE_RULES;
  readonly studyTimezone?: string;
  readonly filter?: { readonly partOfSpeech?: readonly PartOfSpeech[]; readonly tags?: readonly string[] };
}
export interface DueWord {
  readonly word: Word;
  readonly dueAt: string;
  readonly dueComponents: readonly Component[];
  readonly priority: 'learning' | 'review';
  readonly retention: number;
}

function candidates(deck: Deck, context: WordQueryContext, limit: number): { word: Word; progress: WordProgress | undefined }[] {
  timestamp(context.at);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid query limit');
  if (!context.owner.id.trim() || !['guest', 'account'].includes(context.owner.kind)) throw new RangeError('Invalid owner');
  if (context.answerLanguage !== 'ru' && context.answerLanguage !== 'en') throw new RangeError('Invalid translation language');
  if (context.exerciseId !== undefined && !Object.prototype.hasOwnProperty.call(WORD_EXERCISE_RULES, context.exerciseId)) throw new RangeError('Unknown exercise');
  const catalog = new Map<string, Word>();
  for (const word of context.words) {
    if (catalog.has(word.id)) throw new RangeError('Duplicate catalog identity');
    catalog.set(word.id, word);
  }
  const projections = new Map<string, WordProgress>();
  for (const progress of context.progress) {
    if (progress.owner.id !== context.owner.id || progress.owner.kind !== context.owner.kind) throw new RangeError('Query owner mismatch');
    if (projections.has(progress.wordId)) throw new RangeError('Duplicate word projection');
    projections.set(progress.wordId, progress);
  }
  const result: { word: Word; progress: WordProgress | undefined }[] = [];
  for (const id of new Set(deck.wordIds)) {
    const word = catalog.get(id);
    if (!word) throw new RangeError('Deck references unknown word');
    const progress = projections.get(id);
    // Validate all referenced projections even if they will be filtered out.
    summarizeWord(word, progress, context.at, context.studyTimezone);
    if (context.filter?.partOfSpeech && !context.filter.partOfSpeech.includes(word.partOfSpeech)) continue;
    if (context.filter?.tags && !context.filter.tags.every(tag => word.tags.includes(tag))) continue;
    const articleOnly = context.exerciseId === 'article-choice';
    if ((articleOnly || context.exerciseId === 'german-with-article-type') &&
        !applicableComponents(word).includes('article')) continue;
    if (!articleOnly && !word.meanings[context.answerLanguage]?.preferred.trim()) continue;
    result.push({ word, progress });
  }
  return result;
}

/** Newness belongs to the word, not to whichever exercise is selected. */
export function selectNewWords(deck: Deck, context: WordQueryContext, limit = 20): readonly Word[] {
  return candidates(deck, context, limit).filter(item => !item.progress || item.progress.introducedAt === null)
    .slice(0, limit).map(item => item.word);
}

/** Explicit practice may include new, due and scheduled words; it never implies SRS intent. */
export function selectPracticeWords(deck: Deck, context: WordQueryContext, limit = 20): readonly Word[] {
  return candidates(deck, context, limit).slice(0, limit).map(item => item.word);
}

export function compareDueWords(a: DueWord, b: DueWord): number {
  return (a.priority === b.priority ? 0 : a.priority === 'learning' ? -1 : 1) ||
    timestamp(a.dueAt) - timestamp(b.dueAt) || a.retention - b.retention ||
    (a.word.id < b.word.id ? -1 : a.word.id > b.word.id ? 1 : 0);
}

/** Due results never pad a short queue with new words or unintroduced components. */
export function selectDueWords(deck: Deck, context: WordQueryContext, limit = 20): readonly DueWord[] {
  const result: DueWord[] = [];
  for (const { word, progress } of candidates(deck, context, limit)) {
    if (!progress) continue;
    const assessed = context.exerciseId === 'introduction' ? [] : context.exerciseId
      ? WORD_EXERCISE_RULES[context.exerciseId].assessed : applicableComponents(word);
    const components = summarizeWord(word, progress, context.at, context.studyTimezone).components.filter(component => component.due && assessed.includes(component.component));
    if (!components.length) continue;
    const dueAt = components.map(component => component.dueAt!).sort()[0]!;
    result.push({ word, dueAt, dueComponents: components.map(component => component.component),
      priority: components.some(component => component.stage === 'learning' || component.stage === 'relearning') ? 'learning' : 'review',
      retention: Math.min(...components.map(component => component.retentionNow)) });
  }
  result.sort(compareDueWords);
  return result.slice(0, limit);
}
