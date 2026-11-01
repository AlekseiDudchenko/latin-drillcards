import { phraseContent, projectExerciseProgress, selectItems, type ItemExerciseRegistry, type ItemExerciseTask, type ItemSessionSummary,
  type JsonValue, type PhraseContent, type PhraseDeck, type PhraseExercise, type PhraseRating, type RecordedLearningFact,
  type ReplayContext, type TranslationLanguage } from '../../core/index.js';
import type { CardDefinition, CardPresentation } from '../../card-shell.js';
import type { Lang } from '../../../i18n.js';

/** M7 (#339): DOM-free part of the Redemittel page: what a session contains, how a task becomes
 * a RevealInput card, and the per-deck statistics of the self-ratings. */
export const PHRASE_EXERCISE = 'phrase-recall';
export const PHRASE_DATASET = 'redemittel';
export const PHRASE_DATASET_FILE = 'redemittel.json';
export const PHRASE_SESSION_SIZE = 10;

export function itemContent(registry: ItemExerciseRegistry, task: ItemExerciseTask): PhraseContent {
  const content = phraseContent(registry.getItem(task.target.datasetId, task.target.itemId, task.specification.datasetVersion).content);
  if (!content) throw new RangeError('Not a phrase item');
  return content;
}
export const exerciseOf = (task: ItemExerciseTask): PhraseExercise => task.specification.exercise as unknown as PhraseExercise;
export const ratingOf = (raw: JsonValue | undefined): PhraseRating | undefined => raw === 'remembered' || raw === 'forgotten' ? raw : undefined;

/** Phrases of one deck for the next session: never rated (deck order), then last rated "forgotten",
 * then the rest by oldest rating (selectItems over the shared journal). */
export function planPhraseItems(registry: ItemExerciseRegistry, deck: PhraseDeck, records: readonly RecordedLearningFact[],
  context: ReplayContext, limit = PHRASE_SESSION_SIZE): string[] {
  const dataset = registry.dataset(PHRASE_DATASET);
  const inDeck = new Set(dataset.items.filter(item => phraseContent(item.content)?.deck === deck).map(item => item.id));
  return selectItems(registry, PHRASE_EXERCISE, PHRASE_DATASET, projectExerciseProgress(records, context), dataset.items.length)
    .filter(id => inDeck.has(id)).slice(0, limit);
}

/** The shared RevealInput card: meaning as prompt, the German phrase as the revealed answer, TTS of the phrase. */
export function phraseCard(task: ItemExerciseTask, title: Readonly<Record<Lang, string>>): CardDefinition {
  const exercise = exerciseOf(task);
  return { id: task.id, title, prompt: { ...exercise.prompt }, input: { kind: 'reveal', answer: exercise.answer.text, answerLang: 'de' },
    translationLanguage: task.specification.answerLanguage, speechText: exercise.answer.text };
}
/** Speech would read the phrase aloud, so it is offered only once the phrase is revealed. */
export function phrasePresentation(language: Lang, state: { readonly revealed: boolean; readonly busy: boolean; readonly rating?: PhraseRating },
  feedback?: CardPresentation['feedback']): CardPresentation {
  return { language, busy: state.busy, permissions: { reveal: true, details: false, speech: state.revealed || !!state.rating },
    ...(feedback ? { feedback } : {}) };
}
/** The translation in the other language, shown with the phrase details after the reveal. */
export const otherLanguage = (lang: TranslationLanguage): TranslationLanguage => lang === 'ru' ? 'en' : 'ru';

export interface DeckStats {
  readonly applicable: number;
  /** Phrases rated at least once, and how many of them were last rated remembered / forgotten. */
  readonly rated: number;
  readonly remembered: number;
  readonly forgotten: number;
}
/** Own statistics of the phrases of one deck, rebuilt from the shared journal (subjective self-ratings). */
export function deckStats(registry: ItemExerciseRegistry, deck: PhraseDeck, records: readonly RecordedLearningFact[], context: ReplayContext): DeckStats {
  const dataset = registry.dataset(PHRASE_DATASET);
  const ids = new Set(dataset.items.filter(item => phraseContent(item.content)?.deck === deck).map(item => item.id));
  const own = projectExerciseProgress(records, context).items.filter(p => p.exerciseId === PHRASE_EXERCISE && p.datasetId === PHRASE_DATASET && ids.has(p.itemId));
  return { applicable: ids.size, rated: own.length, remembered: own.filter(p => p.lastOutcome === 'correct').length,
    forgotten: own.filter(p => p.lastOutcome === 'incorrect').length };
}
/** Summary rows: the rating of each task's first stored answer, or none. */
export function summaryRows(registry: ItemExerciseRegistry, tasks: readonly ItemExerciseTask[], summary: ItemSessionSummary) {
  return summary.tasks.map(entry => {
    const task = tasks.find(candidate => candidate.id === entry.taskId)!;
    const rating: PhraseRating | undefined = entry.outcome === 'correct' ? 'remembered' : entry.outcome === 'incorrect' ? 'forgotten' : undefined;
    return { itemId: entry.itemId, de: itemContent(registry, task).de, rating };
  });
}
export const deckOf = (registry: ItemExerciseRegistry, task: ItemExerciseTask): PhraseDeck => itemContent(registry, task).deck;
