import { KONJUNKTIV2_TRAINERS, konjunktiv2Content, konjunktiv2ExerciseId, konjunktiv2Form, selectItems, summarizeExercise,
  type ExerciseProgressResult, type ExerciseSummary, type ItemExerciseRegistry, type ItemExerciseTask, type Konjunktiv2Content,
  type Konjunktiv2Exercise, type Konjunktiv2Mode, type Konjunktiv2Trainer } from '../../core/index.js';
import type { TokenState } from '../../token-state.js';

/** M5 (#337): DOM-free part of the Konjunktiv II page: which dataset a trainer uses, what comes next,
 * how a draft moves between text and tokens, and the statistics. Unit-tested directly. */
export const KONJUNKTIV2_DATASET: Readonly<Record<Konjunktiv2Trainer, string>> = Object.freeze(
  Object.fromEntries(KONJUNKTIV2_TRAINERS.map(trainer => [trainer, `konjunktiv2-${trainer}`])) as Record<Konjunktiv2Trainer, string>);
export const trainerOfDataset = (datasetId: string): Konjunktiv2Trainer | undefined =>
  KONJUNKTIV2_TRAINERS.find(trainer => KONJUNKTIV2_DATASET[trainer] === datasetId);

export function parseTrainer(hash: string): Konjunktiv2Trainer {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('trainer');
  return (KONJUNKTIV2_TRAINERS as readonly string[]).includes(value ?? '') ? value as Konjunktiv2Trainer : 'transformation';
}
export const trainerHash = (trainer: Konjunktiv2Trainer): string => `#trainer=${trainer}`;

export const exerciseOf = (task: ItemExerciseTask): Konjunktiv2Exercise => task.specification.exercise as unknown as Konjunktiv2Exercise;
export const modeOf = (task: ItemExerciseTask): Konjunktiv2Mode => task.input === 'tokens' ? 'tokens' : 'text';
export function itemContent(registry: ItemExerciseRegistry, task: ItemExerciseTask): Konjunktiv2Content {
  const content = konjunktiv2Content(registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion).content);
  if (!content) throw new RangeError('Not a Konjunktiv II item');
  return content;
}

/** Next item of the trainer in this mode: never answered first, then last wrong, then the oldest; never the one just shown. */
export function nextItem(registry: ItemExerciseRegistry, progress: ExerciseProgressResult, trainer: Konjunktiv2Trainer,
  mode: Konjunktiv2Mode, currentId?: string): string | undefined {
  const ordered = selectItems(registry, konjunktiv2ExerciseId(trainer, mode), KONJUNKTIV2_DATASET[trainer], progress, Number.MAX_SAFE_INTEGER);
  return ordered.find(id => id !== currentId) ?? ordered[0];
}

/** The draft of one mode in the other. Typed words become the matching chips, in order (words without a free
 * chip are dropped); placed chips become their text. Nothing is graded here. */
export function tokensFromText(value: string, tokens: readonly { readonly id: string; readonly text: string }[]): TokenState {
  const free = tokens.map(token => ({ id: token.id, form: konjunktiv2Form(token.text, 'plain') }));
  const answer: string[] = [];
  for (const word of konjunktiv2Form(value, 'plain').split(' ').filter(Boolean)) {
    const index = free.findIndex(token => token.form === word);
    if (index >= 0) { answer.push(free[index]!.id); free.splice(index, 1); }
  }
  return { pool: tokens.map(token => token.id).filter(id => !answer.includes(id)), answer };
}
export function textFromTokens(state: TokenState, tokens: readonly { readonly id: string; readonly text: string }[]): string {
  const text = new Map(tokens.map(token => [token.id, token.text]));
  return state.answer.map(id => text.get(id) ?? '').filter(Boolean).join(' ');
}

export interface ItemStats { readonly answers: number; readonly independent: number }
/** This sentence in both modes of its trainer (each mode is its own exercise). */
export function itemStats(progress: ExerciseProgressResult, trainer: Konjunktiv2Trainer, itemId: string): ItemStats | undefined {
  const own = progress.items.filter(p => p.datasetId === KONJUNKTIV2_DATASET[trainer] && p.itemId === itemId &&
    (p.exerciseId === konjunktiv2ExerciseId(trainer, 'text') || p.exerciseId === konjunktiv2ExerciseId(trainer, 'tokens')));
  return own.length ? { answers: own.reduce((sum, p) => sum + p.answers, 0), independent: own.reduce((sum, p) => sum + p.independentCorrect, 0) } : undefined;
}
/** Per trainer and mode: answered of total and accuracy, from the shared journal. */
export function trainerStats(registry: ItemExerciseRegistry, progress: ExerciseProgressResult, trainer: Konjunktiv2Trainer): Record<Konjunktiv2Mode, ExerciseSummary> {
  const datasetId = KONJUNKTIV2_DATASET[trainer];
  return { text: summarizeExercise(registry, konjunktiv2ExerciseId(trainer, 'text'), datasetId, progress),
    tokens: summarizeExercise(registry, konjunktiv2ExerciseId(trainer, 'tokens'), datasetId, progress) };
}
