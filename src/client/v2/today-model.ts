/** "Today" home (DOM-free): the daily goal, the streak, and which deck to suggest. */

/** Answers per day that count as the goal. */
export const DAILY_GOAL = 25;

export interface AnswerFact { readonly event: { readonly kind: string; readonly occurredAt: string; readonly studyTimezone: string } }

export interface DailyProgress {
  /** Answers given today, all exercise families together. */
  readonly today: number;
  readonly goal: number;
  /** Consecutive days that reached the goal, ending today or, while today is still open, yesterday. */
  readonly streak: number;
  readonly best: number;
}

/** `YYYY-MM-DD` of an instant in a time zone; an unknown zone falls back to UTC. */
export function dayOf(iso: string, timeZone: string): string {
  const at = new Date(iso);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
  catch { return at.toISOString().slice(0, 10); }
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Each answer counts on the day (in the zone) it was given; reveals and introductions do not. */
export function dailyProgress(facts: readonly AnswerFact[], nowIso: string, timeZone: string, goal = DAILY_GOAL): DailyProgress {
  const perDay = new Map<string, number>();
  for (const { event } of facts) {
    if (event.kind !== 'answer') continue;
    const day = dayOf(event.occurredAt, event.studyTimezone || timeZone);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const reached = (day: string): boolean => (perDay.get(day) ?? 0) >= goal;
  const today = dayOf(nowIso, timeZone);
  let streak = 0;
  for (let day = reached(today) ? today : previousDay(today); reached(day); day = previousDay(day)) streak++;
  // The longest run of consecutive goal days anywhere in the history.
  const days = [...perDay.keys()].filter(reached).sort();
  let best = 0; let run = 0; let last = '';
  for (const day of days) { run = last && previousDay(day) === last ? run + 1 : 1; last = day; best = Math.max(best, run); }
  return { today: perDay.get(today) ?? 0, goal, streak, best: Math.max(best, streak) };
}

export interface DeckStat { readonly id: string; readonly total: number; readonly started: number }

/** The deck for "Learn new": the last one studied, then the level-test recommendation, then the first with words left. */
export function focusDeck(decks: readonly DeckStat[], last?: string, recommended?: string): string | undefined {
  const open = (id: string | undefined): string | undefined => decks.find(deck => deck.id === id && deck.started < deck.total)?.id;
  return open(last) ?? open(recommended) ?? decks.find(deck => deck.started < deck.total)?.id ?? decks[0]?.id;
}

/** The deck with the most words due, so "Review" lands where it matters; ties keep the catalog order. */
export function dueDeck(dueByDeck: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined; let max = 0;
  for (const [id, count] of dueByDeck) if (count > max) { best = id; max = count; }
  return best;
}
