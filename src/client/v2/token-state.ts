// Pure token assembly state (G1 / #330). No DOM: the Runner may persist it and
// unit tests import the compiled module directly.
//
// Identity is the token ID, never its text: a sentence repeating "ich" carries
// two distinct IDs, so moving either instance cannot desynchronise the answer.
// Every operation keeps the invariant that pool + answer is exactly a
// permutation of the definition's IDs; nothing is ever lost or duplicated.

export interface AnswerToken { readonly id: string; readonly text: string }
export interface TokenState { readonly pool: readonly string[]; readonly answer: readonly string[] }
export interface TokenRect { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

/** Stable IDs from the source position, so they do not depend on display order. */
export function answerTokens(prefix: string, texts: readonly string[]): AnswerToken[] {
  return texts.map((text, index) => ({ id: `${prefix}:${index}`, text }));
}

/** A random permutation of 0..length-1 (Fisher–Yates). */
export function shuffledOrder(length: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** Applies a display order; refuses anything but a full permutation. */
export function arrangeTokens(tokens: readonly AnswerToken[], order: readonly number[]): AnswerToken[] {
  if (order.length !== tokens.length || new Set(order).size !== order.length || order.some(index => !tokens[index])) throw new RangeError('Invalid token order');
  return order.map(index => tokens[index]!);
}

export function validateTokens(tokens: readonly AnswerToken[]): void {
  if (tokens.length === 0 || tokens.some(token => !token.id || typeof token.text !== 'string' || !token.text.trim())
      || new Set(tokens.map(token => token.id)).size !== tokens.length) throw new RangeError('Invalid answer tokens');
}

/** Everything in the pool, in definition (display) order. */
export function initialTokenState(tokens: readonly AnswerToken[]): TokenState {
  return { pool: tokens.map(token => token.id), answer: [] };
}

export function validateTokenState(tokens: readonly AnswerToken[], state: TokenState): TokenState {
  if (!state || !Array.isArray(state.pool) || !Array.isArray(state.answer)) throw new RangeError('Invalid token state');
  const all = [...state.pool, ...state.answer];
  const known = new Set(tokens.map(token => token.id));
  if (all.length !== known.size || new Set(all).size !== all.length || all.some(id => !known.has(id))) throw new RangeError('Invalid token state');
  // The pool is canonical: definition order, whatever order a snapshot claims.
  return { pool: tokens.map(token => token.id).filter(id => state.pool.includes(id)), answer: [...state.answer] };
}

function ensureKnown(tokens: readonly AnswerToken[], id: string) {
  if (!tokens.some(token => token.id === id)) throw new RangeError(`Unknown token ${id}`);
}

/**
 * Puts a token into the answer at `index` (default: the end), taking it from
 * the pool or moving it within the answer. Out-of-range indexes are clamped.
 */
export function placeToken(tokens: readonly AnswerToken[], state: TokenState, id: string, index = Infinity): TokenState {
  ensureKnown(tokens, id);
  const answer = state.answer.filter(other => other !== id);
  const at = Number.isFinite(index) ? Math.max(0, Math.min(answer.length, Math.trunc(index))) : answer.length;
  answer.splice(at, 0, id);
  if (answer.length === state.answer.length && answer.every((other, i) => other === state.answer[i])) return state;
  return { pool: state.pool.filter(other => other !== id), answer };
}

/** Returns a token to its original pool slot (not the end), so the layout stays familiar. */
export function returnToken(tokens: readonly AnswerToken[], state: TokenState, id: string): TokenState {
  ensureKnown(tokens, id);
  if (!state.answer.includes(id)) return state;
  const pool = new Set([...state.pool, id]);
  return { pool: tokens.map(token => token.id).filter(other => pool.has(other)), answer: state.answer.filter(other => other !== id) };
}

/** Pool click places, answer click returns. */
export function toggleToken(tokens: readonly AnswerToken[], state: TokenState, id: string): TokenState {
  return state.answer.includes(id) ? returnToken(tokens, state, id) : placeToken(tokens, state, id);
}

/** Shifts an answer token by `delta` positions; pool tokens are unaffected. */
export function shiftToken(tokens: readonly AnswerToken[], state: TokenState, id: string, delta: number): TokenState {
  const index = state.answer.indexOf(id);
  return index < 0 ? state : placeToken(tokens, state, id, Math.max(0, index + delta));
}

export const resetTokens = initialTokenState;

export function tokenAnswerText(tokens: readonly AnswerToken[], state: TokenState): string {
  return state.answer.map(id => tokens.find(token => token.id === id)!.text).join(' ');
}

/** True when the move emptied a non-empty pool: the only moment autocheck may fire. */
export function becameFilled(previous: TokenState, next: TokenState): boolean {
  return previous.pool.length > 0 && next.pool.length === 0 && next.answer.length > 0;
}

/**
 * Insertion index for a pointer drop among answer token rectangles in reading
 * order (wrapped rows top to bottom). The dragged token itself is excluded by
 * the caller, so the index applies to the answer after its removal.
 */
export function dropIndex(rects: readonly TokenRect[], x: number, y: number): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    if (y < rect.top) return i;
    if (y <= rect.bottom && x < (rect.left + rect.right) / 2) return i;
  }
  return rects.length;
}
