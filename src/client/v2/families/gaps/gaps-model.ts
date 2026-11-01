import { gapContent, gradeGapAnswer, projectExerciseProgress, selectItems, summarizeExercise, type ExerciseSummary, type GapContent,
  type GapExercise, type GapExerciseId, type ItemDataset, type ItemExerciseRegistry, type ItemExerciseTask, type JsonValue,
  type PassivTense, type RecordedLearningFact, type ReplayContext } from '../../core/index.js';
import { parseClozeTemplate, type ClozeDefinition } from '../../cloze-model.js';

/** M3 (#335): DOM-free part of the gap page: which datasets, what a session contains,
 * how a task becomes a ClozeInput definition and how a stored answer is shown again. */
export const GAP_FAMILIES = Object.freeze({
  relative: { datasetId: 'relative-pronoun-gaps', file: 'relative-pronoun-gaps.json' },
  passiv: { datasetId: 'passiv-gaps', file: 'passiv-gaps.json' },
} as const);
export type GapFamily = keyof typeof GAP_FAMILIES;
export type GapMode = 'select' | 'type';
export const GAP_EXERCISE: Readonly<Record<GapMode, GapExerciseId>> = Object.freeze({ select: 'gap-select', type: 'gap-type' });
export const GAP_SESSION_SIZE = 10;
export const familyOf = (datasetId: string): GapFamily | undefined =>
  (Object.keys(GAP_FAMILIES) as GapFamily[]).find(family => GAP_FAMILIES[family].datasetId === datasetId);

export function itemContent(registry: ItemExerciseRegistry, task: ItemExerciseTask): GapContent {
  const content = gapContent(registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion).content);
  if (!content) throw new RangeError('Not a gap item');
  return content;
}
export const exerciseOf = (task: ItemExerciseTask): GapExercise => task.specification.exercise as unknown as GapExercise;

/** Items of the next session: never answered, then last answered wrong, then the oldest (selectItems).
 * A tense filter keeps only that tense. Without one, the tenses of one Passiv sentence in the same queue
 * stay together in the dataset's tense order, so its linked variants are practised in a row. */
export function planGapItems(registry: ItemExerciseRegistry, exerciseId: GapExerciseId, datasetId: string,
  records: readonly RecordedLearningFact[], context: ReplayContext, options: { readonly tense?: PassivTense; readonly limit?: number } = {}): string[] {
  const dataset = registry.dataset(datasetId);
  const content = new Map(dataset.items.map(item => [item.id, gapContent(item.content)]));
  const progress = projectExerciseProgress(records, context);
  const ranked = selectItems(registry, exerciseId, datasetId, progress, dataset.items.length)
    .filter(id => !options.tense || content.get(id)?.tense === options.tense);
  const limit = options.limit ?? GAP_SESSION_SIZE;
  if (options.tense) return ranked.slice(0, limit);
  const order = new Map(dataset.items.map((item, index) => [item.id, index]));
  // Only variants in the same queue (new, last wrong, last right) join a group: grouping never moves a practised tense forward.
  const outcome = new Map(progress.items.filter(p => p.exerciseId === exerciseId && p.datasetId === datasetId).map(p => [p.itemId, p.lastOutcome]));
  const status = (id: string) => outcome.get(id) === 'incorrect' ? 'incorrect' : outcome.has(id) ? 'answered' : 'new';
  const result: string[] = []; const seen = new Set<string>();
  for (const id of ranked) {
    if (result.length >= limit) break;
    if (seen.has(id)) continue;
    const variants = content.get(id)?.tenseVariants ?? [id];
    const group = variants.filter(variant => ranked.includes(variant) && !seen.has(variant) && status(variant) === status(id)).sort((a, b) => order.get(a)! - order.get(b)!);
    for (const variant of group.slice(0, limit - result.length)) { seen.add(variant); result.push(variant); }
  }
  return result;
}

/** The shared ClozeInput definition of a task (G2 API unchanged): one slot per gap, typed or chosen. */
export function clozeDefinition(task: ItemExerciseTask): ClozeDefinition {
  const exercise = exerciseOf(task);
  const { segments, slotIds } = parseClozeTemplate(exercise.template);
  if (slotIds.length !== exercise.slots.length) throw new RangeError('Gap task does not match its template');
  return { id: task.id, answerLang: 'de', segments, slots: exercise.slots.map(slot => slot.input === 'choice'
    ? { slotId: slot.slotId, input: 'choice' as const, options: slot.options.map(option => ({ ...option })) }
    : { slotId: slot.slotId, input: 'text' as const }) };
}
/** The submitted values as the Runner stores them: `{ "slot-1": "…", … }`. */
export const values = (raw: JsonValue | undefined): Record<string, string> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};

/** Per-slot results of a stored answer, graded by the same core rule as the server. The expected form is
 * shown only after the hint is opened (or for a correct slot, where it is the learner's own answer). */
export function slotResults(registry: ItemExerciseRegistry, task: ItemExerciseTask, raw: JsonValue, hint: boolean) {
  const item = registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion);
  const grade = gradeGapAnswer(item, task.specification.exercise, raw);
  const answers = exerciseOf(task).answers;
  return Object.fromEntries(exerciseOf(task).slots.map((slot, index) => {
    const outcome = grade.slots[slot.slotId]!;
    return [slot.slotId, outcome === 'incorrect' && hint ? { outcome, expected: answers[index]![0]! } : { outcome }];
  }));
}
/** The sentence with every gap filled by its first accepted form (speech, hint, tense variants). */
export function solvedSentence(content: Pick<GapContent, 'template' | 'answers'>): string {
  return content.template.split('___').map((part, index) => index ? content.answers[index - 1]![0]! + part : part).join('');
}
export const answerText = (content: Pick<GapContent, 'answers'>): string => content.answers.map(forms => forms[0]).join(' + ');

/** Linked tense variants of a Passiv item, in the dataset's tense order; empty for other items. */
export function tenseVariants(dataset: ItemDataset, itemId: string): { readonly itemId: string; readonly tense: PassivTense; readonly content: GapContent }[] {
  const own = gapContent(dataset.items.find(item => item.id === itemId)?.content ?? null);
  if (!own?.tenseVariants) return [];
  return dataset.items.filter(item => own.tenseVariants!.includes(item.id)).flatMap(item => {
    const content = gapContent(item.content);
    return content?.tense ? [{ itemId: item.id, tense: content.tense, content }] : [];
  });
}

/** Statistics per family: one row per mode (each mode is its own exercise) over the family's dataset. */
export function familyStats(registry: ItemExerciseRegistry, family: GapFamily, records: readonly RecordedLearningFact[],
  context: ReplayContext): Record<GapMode, ExerciseSummary> {
  const progress = projectExerciseProgress(records, context);
  const datasetId = GAP_FAMILIES[family].datasetId;
  return { select: summarizeExercise(registry, GAP_EXERCISE.select, datasetId, progress),
    type: summarizeExercise(registry, GAP_EXERCISE.type, datasetId, progress) };
}
