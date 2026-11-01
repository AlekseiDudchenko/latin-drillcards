import { selectItems, sentenceContent, summarizeExercise, type ExerciseProgressResult, type ItemDataset, type ItemExerciseRegistry,
  type LearningItem, type SentenceContent } from '../../core/index.js';

// Pure model of the sentence page (M1 / #333): filters, selection, linked variants and statistics.
// No DOM and no storage, so it is unit-tested directly.
export const SENTENCE_EXERCISE = 'sentence-assembly';
export const SENTENCE_DATASET = 'sentences';
/** v1 "all" covers the CEFR decks; the themed decks are chosen explicitly. */
export const LEVEL_DECKS = Object.freeze(['basic']);
export const SENTENCE_DECKS = LEVEL_DECKS;
export interface SentenceFilter { readonly deck: string; readonly tag?: string }

const content = (item: LearningItem): SentenceContent => sentenceContent(item.content)!;
export function parseFilter(hash: string): SentenceFilter {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const deck = params.get('deck') ?? 'all';
  const tag = params.get('tag')?.trim();
  return { deck: deck === 'all' || SENTENCE_DECKS.includes(deck) ? deck : 'all', ...(tag ? { tag } : {}) };
}
export function filterHash(filter: SentenceFilter): string {
  const params = new URLSearchParams({ deck: filter.deck, ...(filter.tag ? { tag: filter.tag } : {}) });
  return `#${params.toString()}`;
}
export function inDeck(item: LearningItem, deck: string): boolean {
  return deck === 'all' ? LEVEL_DECKS.includes(content(item).deck) : content(item).deck === deck;
}
export function tagsOf(dataset: ItemDataset, deck: string): string[] {
  return [...new Set(dataset.items.filter(item => inDeck(item, deck)).flatMap(item => content(item).tags))].sort();
}
export function pool(dataset: ItemDataset, filter: SentenceFilter): LearningItem[] {
  const tag = filter.tag?.toLowerCase();
  return dataset.items.filter(item => inDeck(item, filter.deck) && (!tag || content(item).tags.some(t => t.toLowerCase() === tag)));
}
/** v1 label: snake_case words capitalized, "ii" as roman numeral. */
export const formatTag = (tag: string): string => tag.split('_')
  .map(part => part.toLowerCase() === 'ii' ? 'II' : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

/** Next sentence of the filter: never answered first, then last wrong, then the oldest; never the one just shown. */
export function nextSentence(registry: ItemExerciseRegistry, progress: ExerciseProgressResult, filter: SentenceFilter,
  currentId?: string, exerciseId = SENTENCE_EXERCISE): string | undefined {
  const allowed = new Set(pool(registry.dataset(SENTENCE_DATASET), filter).map(item => item.id));
  const ordered = selectItems(registry, exerciseId, SENTENCE_DATASET, progress, Number.MAX_SAFE_INTEGER).filter(id => allowed.has(id));
  return ordered.find(id => id !== currentId) ?? ordered[0];
}

export interface LinkedSentences {
  readonly variant?: string;
  /** Tense family in display order with its labels, the current one included; empty unless there are two or more. */
  readonly tenses: readonly { readonly id: string; readonly label: string }[];
}
export function linkedSentences(dataset: ItemDataset, itemId: string): LinkedSentences {
  const byId = new Map(dataset.items.map(item => [item.id, item]));
  const own = content(byId.get(itemId)!);
  const tenses = (own.tenseVariants ?? []).flatMap(id => byId.has(id) ? [{ id, label: content(byId.get(id)!).tense ?? id }] : []);
  return { ...(own.variantOf && byId.has(own.variantOf) ? { variant: own.variantOf } : {}), tenses: tenses.length > 1 ? tenses : [] };
}

export interface SentenceStats { readonly answers: number; readonly independent: number }
export function sentenceStats(progress: ExerciseProgressResult, itemId: string, exerciseId = SENTENCE_EXERCISE): SentenceStats | undefined {
  const own = progress.items.find(p => p.exerciseId === exerciseId && p.datasetId === SENTENCE_DATASET && p.itemId === itemId);
  return own ? { answers: own.answers, independent: own.independentCorrect } : undefined;
}
/** Coverage of the current filter (the dataset-wide summary restricted to the pool). */
export function poolStats(registry: ItemExerciseRegistry, progress: ExerciseProgressResult, filter: SentenceFilter, exerciseId = SENTENCE_EXERCISE) {
  const ids = new Set(pool(registry.dataset(SENTENCE_DATASET), filter).map(item => item.id));
  const restricted = { ...progress, items: progress.items.filter(p => ids.has(p.itemId)) };
  const all = summarizeExercise(registry, exerciseId, SENTENCE_DATASET, restricted);
  return { total: ids.size, attempted: all.attempted, accuracy: all.accuracy };
}
