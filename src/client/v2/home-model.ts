import { summarizeWord, timestamp, vocabularyQueues, type Deck, type Owner, type SessionRequest, type Word,
  type WordProgress, type WordSummary } from './core/index.js';

/** public/v2/catalog/index.json: every public deck, with word IDs for counts and word → deck lookup. */
export interface CatalogIndex {
  readonly catalogVersion: string;
  readonly decks: readonly Deck[];
}
/** public/v2/catalog/deck-<id>.json: one deck and its published words, in deck order. */
export interface DeckFile {
  readonly catalogVersion: string;
  readonly deck: Deck;
  readonly words: readonly Word[];
}

export type Route =
  | { readonly view: 'home' }
  | { readonly view: 'session' }
  | { readonly view: 'deck'; readonly deckId: string }
  | { readonly view: 'word'; readonly wordId: string; readonly deckId?: string };

/** `#deck=a1`, `#word=w-tisch&deck=a1`, `#session`; anything else is the home screen. */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  if (raw === 'session') return { view: 'session' };
  const params = new URLSearchParams(raw);
  const deckId = params.get('deck')?.trim(); const wordId = params.get('word')?.trim();
  if (wordId) return { view: 'word', wordId, ...(deckId ? { deckId } : {}) };
  if (deckId) return { view: 'deck', deckId };
  return { view: 'home' };
}
export function routeHash(route: Route): string {
  if (route.view === 'home') return '#';
  if (route.view === 'session') return '#session';
  const params = new URLSearchParams();
  if (route.view === 'word') params.set('word', route.wordId);
  if (route.deckId) params.set('deck', route.deckId);
  return `#${params}`;
}

const fold = (value: string): string => value.normalize('NFC').toLocaleLowerCase('de').trim();

export function searchDecks(decks: readonly Deck[], query: string): readonly Deck[] {
  const q = fold(query);
  return q ? decks.filter(deck => fold(deck.title).includes(q) || fold(deck.id).includes(q)) : decks;
}

/** German headword (with article) or any published translation. */
export function searchWords(words: readonly Word[], query: string): readonly Word[] {
  const q = fold(query);
  if (!q) return words;
  return words.filter(word => [[word.article, word.lemma].filter(Boolean).join(' '), ...word.acceptedForms,
    ...Object.values(word.meanings).flatMap(meaning => meaning ? [meaning.preferred, ...meaning.accepted] : [])]
    .some(text => fold(text).includes(q)));
}

export function decksOfWord(decks: readonly Deck[], wordId: string): readonly Deck[] {
  return decks.filter(deck => deck.wordIds.includes(wordId));
}

/** Introduced words of a deck. Progress belongs to the word, so a word started elsewhere counts here too. */
export function startedCount(deck: Deck, progress: readonly WordProgress[]): number {
  const members = new Set(deck.wordIds);
  return progress.filter(item => members.has(item.wordId) && item.introducedAt !== null).length;
}

export interface DeckOverview {
  readonly total: number;
  readonly started: number;
  /** The planner's queues for the chosen format, exercise and answer language. */
  readonly fresh: number;
  readonly due: number;
  /** The same queues for a full set: tells "nothing new/due" apart from "not for this exercise". */
  readonly freshAnyExercise: number;
  readonly dueAnyExercise: number;
  /** The earliest component deadline still in the future, if nothing else is due. */
  readonly nextDueAt: string | null;
}

export function deckOverview(input: { readonly request: SessionRequest; readonly deck: Deck; readonly words: readonly Word[];
  readonly progress: readonly WordProgress[]; readonly owner: Owner; readonly at: string }): DeckOverview {
  const queues = vocabularyQueues(input);
  const any = vocabularyQueues({ ...input, request: { deckId: input.request.deckId, answerLanguage: input.request.answerLanguage,
    intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises' } });
  const now = timestamp(input.at);
  let nextDueAt: string | null = null;
  const byId = new Map(input.progress.map(item => [item.wordId, item]));
  for (const word of input.words) {
    const progress = byId.get(word.id);
    if (!progress || !input.deck.wordIds.includes(word.id)) continue;
    for (const component of summarizeWord(word, progress, input.at).components)
      if (component.dueAt !== null && timestamp(component.dueAt) > now && (nextDueAt === null || component.dueAt < nextDueAt))
        nextDueAt = component.dueAt;
  }
  return { total: new Set(input.deck.wordIds).size, started: startedCount(input.deck, input.progress),
    fresh: queues.fresh.length, due: queues.due.length, freshAnyExercise: any.fresh.length, dueAnyExercise: any.due.length, nextDueAt };
}

export type EmptyQueueReason = 'all-started' | 'nothing-started' | 'not-for-exercise' | 'not-due-yet' | 'no-translation';

/** Why a queue is empty; undefined when it is not. Queues are never padded from each other. */
export function emptyQueueReason(intent: 'learn-new' | 'review-due', overview: DeckOverview): EmptyQueueReason | undefined {
  if (intent === 'learn-new') {
    if (overview.fresh) return undefined;
    if (overview.freshAnyExercise) return 'not-for-exercise';
    return overview.started >= overview.total ? 'all-started' : 'no-translation';
  }
  if (overview.due) return undefined;
  if (!overview.started) return 'nothing-started';
  return overview.dueAnyExercise ? 'not-for-exercise' : 'not-due-yet';
}

/** The same summary for a word whichever deck shows it: only owner + wordId identify progress. */
export function wordSummary(word: Word, progress: readonly WordProgress[], at: string): WordSummary {
  return summarizeWord(word, progress.find(item => item.wordId === word.id), at);
}
