import type { BuildContext, JsonValue } from '../exercise.js';
// Types only: item-exercises.ts registers this definition, so a value import would be circular.
import type { ItemDataset, ItemExerciseDefinition, LearningItem } from '../item-exercises.js';

/** M8 (#340): the level test (FC12) on the shared choice card, Runner and journal.
 * One item is one v1 deck word: the German headword and four translations (the answer and
 * three distractors of the same level). It is an assessment, never practice: its answers are
 * projected by `projectAssessments` only and never reach WordProgress or exercise statistics.
 * The block structure, pass threshold, early finish and recommendation are the policy below,
 * kept apart from the adapter so the test cannot turn into SRS practice.
 */
export const LEVEL_TEST_DATASET = 'level-test';
export const LEVEL_TEST_EXERCISE = 'level-test-choice';
export const LEVEL_TEST_LEVELS = Object.freeze(['a1', 'a2', 'b1', 'b2'] as const);
export type LevelTestLevel = typeof LEVEL_TEST_LEVELS[number];
/** The v1 rules: blocks of 10 from A1 up, a block passes at 70 %, the test stops at the first failed block. */
export const LEVEL_TEST_POLICY = Object.freeze({ version: 'level-test-policy/1', questionsPerBlock: 10, passThreshold: 0.7 });

export interface LevelTestOption { readonly id: string; readonly ru: string; readonly en: string }
export interface LevelTestContent {
  readonly level: LevelTestLevel;
  readonly prompt: { readonly text: string; readonly lang: 'de' };
  readonly options: readonly LevelTestOption[];
  readonly correctOptionId: string;
}
/** What the card shows: labels in the task's answer language, order fixed per task. The correct
 * option is not part of the task; evaluation reads it from the pinned item. */
export interface LevelTestExercise {
  readonly level: LevelTestLevel;
  readonly prompt: { readonly text: string; readonly lang: 'de' };
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const isLevel = (value: unknown): value is LevelTestLevel => (LEVEL_TEST_LEVELS as readonly unknown[]).includes(value);
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  // FNV-1a alone keeps IDs that differ in the last character next to each other; the murmur3 finalizer spreads them.
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b); result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
  return (result ^ (result >>> 16)) >>> 0;
}
const byHash = <T>(key: string, id: (value: T) => string) => (a: T, b: T): number =>
  hash(`${key}:${id(a)}`) - hash(`${key}:${id(b)}`) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);

/** Content check shared by the definition and the dataset converter; null when unusable. */
export function levelTestContent(content: JsonValue): LevelTestContent | null {
  if (!record(content) || !isLevel(content.level) || !record(content.prompt) || !text(content.prompt.text) || content.prompt.lang !== 'de' ||
      !Array.isArray(content.options) || content.options.length < 2 || !text(content.correctOptionId)) return null;
  const options = content.options as unknown[];
  if (!options.every(o => record(o) && text(o.id) && text(o.ru) && text(o.en))) return null;
  const ids = (options as LevelTestOption[]).map(o => o.id);
  if (new Set(ids).size !== ids.length || !ids.includes(content.correctOptionId)) return null;
  return content as unknown as LevelTestContent;
}
function levelTestExercise(value: JsonValue): LevelTestExercise | null {
  if (!record(value) || !isLevel(value.level) || !record(value.prompt) || !text(value.prompt.text) || !Array.isArray(value.options)) return null;
  const options = value.options as unknown[];
  return options.length >= 2 && options.every(o => record(o) && text(o.id) && text(o.label)) ? value as unknown as LevelTestExercise : null;
}

export const LEVEL_TEST_CHOICE: ItemExerciseDefinition = Object.freeze({
  id: LEVEL_TEST_EXERCISE, version: `${LEVEL_TEST_EXERCISE}/1`, targetKinds: Object.freeze(['assessment'] as const),
  input: 'choice' as const, source: 'automatic' as const,
  isApplicable: (item: LearningItem) => levelTestContent(item.content) !== null,
  build(item: LearningItem, context: BuildContext): JsonValue {
    const content = levelTestContent(item.content)!;
    const options = [...content.options].sort(byHash(JSON.stringify([context.seed, context.taskId, item.id]), o => o.id));
    return { level: content.level, prompt: { ...content.prompt },
      options: options.map(o => ({ id: o.id, label: o[context.answerLanguage] })) };
  },
  evaluate(item: LearningItem, exercise: JsonValue, answer: JsonValue) {
    const content = levelTestContent(item.content); const built = levelTestExercise(exercise);
    if (!content || !built || typeof answer !== 'string' || !built.options.some(o => o.id === answer)) throw new RangeError('Unknown answer option');
    return answer === content.correctOptionId ? 'correct' : 'incorrect';
  },
});

/** AssessmentPlanner: every block of the run is planned up front, A1 → B2, `questionsPerBlock`
 * words per level chosen by the seed. The policy decides how far the run goes; unreached tasks stay
 * unanswered and the session is ended early (the Runner's `finish`). */
export function planLevelTest(dataset: Pick<ItemDataset, 'items'>, seed: string,
  policy: typeof LEVEL_TEST_POLICY = LEVEL_TEST_POLICY): readonly { readonly itemId: string; readonly exerciseId: string }[] {
  if (!text(seed)) throw new RangeError('Invalid level test seed');
  return LEVEL_TEST_LEVELS.flatMap(level => {
    const pool = dataset.items.filter(item => levelTestContent(item.content)?.level === level);
    if (pool.length < policy.questionsPerBlock) throw new RangeError(`Not enough ${level} questions`);
    return [...pool].sort(byHash(`${seed}:${level}`, item => item.id)).slice(0, policy.questionsPerBlock)
      .map(item => ({ itemId: item.id, exerciseId: LEVEL_TEST_EXERCISE }));
  });
}

export type LevelTestOutcome = 'correct' | 'incorrect' | 'unobserved';
export interface LevelTestBlock {
  readonly level: LevelTestLevel;
  readonly total: number;
  readonly answered: number;
  readonly correct: number;
  /** null while the block still has unanswered questions. */
  readonly passed: boolean | null;
}
export interface LevelEstimate {
  /** Highest passed block, `b2+` when every block passed, `a1` when none did. */
  readonly level: LevelTestLevel | 'b2+';
  /** Level to start practising: one above the estimate (B2 at most). */
  readonly start: LevelTestLevel;
}
export interface LevelTestScore {
  readonly policyVersion: string;
  /** Blocks reached so far, in order; blocks after a failed one are never reached. */
  readonly blocks: readonly LevelTestBlock[];
  /** `concluded` once a block failed or the last block passed; the estimate exists only then. */
  readonly status: 'in-progress' | 'concluded';
  readonly estimate?: LevelEstimate;
  /** Planned tasks that will not be asked because the test concluded early. */
  readonly skipped: number;
}

/** v1 estimate: blocks run easiest → hardest and stop at the first failed one. */
export function estimateLevel(blocks: readonly Pick<LevelTestBlock, 'level' | 'passed'>[]): LevelEstimate {
  let passed = -1;
  for (let i = 0; i < blocks.length && blocks[i]!.passed === true; i++) passed = i;
  if (passed < 0) return { level: 'a1', start: 'a1' };
  if (blocks[passed]!.level === LEVEL_TEST_LEVELS[LEVEL_TEST_LEVELS.length - 1]) return { level: 'b2+', start: 'b2' };
  return { level: blocks[passed]!.level, start: LEVEL_TEST_LEVELS[LEVEL_TEST_LEVELS.indexOf(blocks[passed]!.level) + 1]! };
}

/** ScoringPolicy over the planned tasks (their levels, in plan order) and the first outcome of each
 * answered one. Only an independent correct answer counts: revealed/assisted answers are `unobserved`.
 * A block is decided when all its questions are answered; passing needs `passThreshold` of them. */
export function scoreLevelTest(tasks: readonly { readonly itemId: string; readonly level: LevelTestLevel }[],
  outcomes: ReadonlyMap<string, LevelTestOutcome>, policy: typeof LEVEL_TEST_POLICY = LEVEL_TEST_POLICY): LevelTestScore {
  const groups: { level: LevelTestLevel; itemIds: string[] }[] = [];
  for (const task of tasks) {
    const last = groups[groups.length - 1];
    if (last?.level === task.level) last.itemIds.push(task.itemId); else groups.push({ level: task.level, itemIds: [task.itemId] });
  }
  if (new Set(groups.map(g => g.level)).size !== groups.length) throw new RangeError('A level test block must be contiguous');
  const blocks: LevelTestBlock[] = [];
  let status: LevelTestScore['status'] = 'in-progress'; let reached = 0;
  for (const [index, group] of groups.entries()) {
    const answered = group.itemIds.filter(id => outcomes.has(id));
    const correct = answered.filter(id => outcomes.get(id) === 'correct').length;
    const passed = answered.length < group.itemIds.length ? null : correct / group.itemIds.length >= policy.passThreshold;
    blocks.push({ level: group.level, total: group.itemIds.length, answered: answered.length, correct, passed });
    reached += group.itemIds.length;
    if (passed === null) break;
    if (!passed || index === groups.length - 1) { status = 'concluded'; break; }
  }
  return { policyVersion: policy.version, blocks, status, skipped: status === 'concluded' ? tasks.length - reached : 0,
    ...(status === 'concluded' ? { estimate: estimateLevel(blocks) } : {}) };
}
