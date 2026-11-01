import type { CardUiTranslations } from '../i18n.js';
import { button, element, type InputDefinition } from './card-inputs.js';
import { dropIndex, placeToken, returnToken, shiftToken, resetTokens, type TokenState } from './token-state.js';

type TokenDefinition = Extract<InputDefinition, { kind: 'tokens' }>;
/** `focus` is the data-focus-key the shell should focus after rerendering. */
export type TokenChange = (next: TokenState, focus?: string) => void;

const DRAG_THRESHOLD = 6;
export const tokenFocusKey = (id: string) => `token:${id}`;

/**
 * Answer zone + pool of token buttons. Click/Enter/Space toggles a token,
 * Shift+←/→ reorders within the answer, Backspace/Delete returns, ←/→ moves
 * focus, and pointer drag (mouse and touch) inserts at the drop position.
 * Every handler is scoped to the shell's per-render AbortSignal.
 */
export function TokenInput(definition: TokenDefinition, state: TokenState, labels: CardUiTranslations,
  disabled: boolean, uid: string, signal: AbortSignal, change: TokenChange): HTMLElement {
  const tokens = definition.tokens;
  const text = new Map(tokens.map(token => [token.id, token.text]));
  const group = element('div', undefined, 'dc-tokens');
  const hint = element('p', labels.tokenHint, 'dc-token-hint'); hint.id = `${uid}-token-hint`;

  function zone(name: 'answer' | 'pool', ids: readonly string[], label: string) {
    const box = element('div', undefined, 'dc-token-zone'); box.dataset.tokenZone = name;
    const heading = element('p', label, 'dc-token-label'); heading.id = `${uid}-token-${name}`;
    const list = element('ul', undefined, 'dc-token-list'); list.setAttribute('aria-labelledby', heading.id);
    for (const id of ids) {
      const item = element('li');
      const token = button(text.get(id)!); token.className = 'dc-token'; token.lang = definition.answerLang;
      token.dataset.tokenId = id; token.dataset.focusKey = tokenFocusKey(id); token.disabled = disabled;
      token.setAttribute('aria-describedby', hint.id);
      item.append(token); list.append(item);
    }
    box.append(heading, list);
    if (name === 'answer' && ids.length === 0) box.append(element('p', labels.tokenEmpty, 'dc-token-empty'));
    return box;
  }
  const answerZone = zone('answer', state.answer, labels.tokenAnswer);
  const poolZone = zone('pool', state.pool, labels.tokenPool);
  const reset = button(labels.tokenReset); reset.className = 'dc-token-reset'; reset.dataset.focusKey = 'token-reset';
  reset.disabled = disabled || state.answer.length === 0;
  reset.addEventListener('click', () => change(resetTokens(tokens), tokenFocusKey(tokens[0]!.id)), { signal });
  group.append(answerZone, poolZone, hint, reset);
  if (disabled) return group;

  // Focus stays where the learner keeps working: the next pool token after a
  // placement, the neighbouring answer token after a return.
  function toggle(id: string) {
    const poolIndex = state.pool.indexOf(id);
    if (poolIndex >= 0) {
      const next = placeToken(tokens, state, id);
      const focusId = next.pool[poolIndex] ?? next.pool[poolIndex - 1];
      change(next, focusId ? tokenFocusKey(focusId) : 'submit');
    } else giveBack(id);
  }
  function giveBack(id: string) {
    const index = state.answer.indexOf(id);
    const next = returnToken(tokens, state, id);
    const focusId = next.answer[index] ?? next.answer[index - 1] ?? id;
    change(next, tokenFocusKey(focusId));
  }

  let suppressClick = false;
  group.addEventListener('click', event => {
    const token = (event.target as Element).closest<HTMLElement>('[data-token-id]');
    if (!token) return;
    // Keyboard activation (detail 0) is never swallowed by a preceding drag.
    if (suppressClick && event.detail > 0) { suppressClick = false; return; }
    toggle(token.dataset.tokenId!);
  }, { signal });

  group.addEventListener('keydown', event => {
    const token = (event.target as Element).closest<HTMLElement>('[data-token-id]');
    if (!token || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const id = token.dataset.tokenId!;
    const inAnswer = state.answer.includes(id);
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.shiftKey) {
      if (!inAnswer) return;
      event.preventDefault();
      change(shiftToken(tokens, state, id, event.key === 'ArrowLeft' ? -1 : 1), tokenFocusKey(id));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const siblings = Array.from(token.closest('ul')!.querySelectorAll<HTMLElement>('[data-token-id]'));
      siblings[siblings.indexOf(token) + (event.key === 'ArrowLeft' ? -1 : 1)]?.focus();
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && inAnswer) {
      event.preventDefault(); giveBack(id);
    }
  }, { signal });

  group.addEventListener('pointerdown', event => {
    const token = (event.target as Element).closest<HTMLElement>('[data-token-id]');
    if (!token || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    startDrag(token, event);
  }, { signal });

  function startDrag(token: HTMLElement, start: PointerEvent) {
    const id = token.dataset.tokenId!;
    const drag = new AbortController();
    signal.addEventListener('abort', () => drag.abort(), { signal: drag.signal });
    let dragging = false;
    let target: HTMLElement | null = null;
    const zoneAt = (x: number, y: number) => {
      const hit = document.elementsFromPoint(x, y).find(node => node !== token && !token.contains(node));
      const found = hit?.closest<HTMLElement>('[data-token-zone]') ?? null;
      return found && group.contains(found) ? found : null;
    };
    const finish = () => {
      token.classList.remove('dc-dragging'); token.style.transform = '';
      target?.classList.remove('dc-drop-target'); drag.abort();
    };
    window.addEventListener('pointermove', event => {
      if (event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.clientX, dy = event.clientY - start.clientY;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging = true; token.classList.add('dc-dragging');
      token.style.transform = `translate(${dx}px, ${dy}px)`;
      const over = zoneAt(event.clientX, event.clientY);
      if (over !== target) { target?.classList.remove('dc-drop-target'); over?.classList.add('dc-drop-target'); target = over; }
    }, { signal: drag.signal });
    window.addEventListener('pointerup', event => {
      if (event.pointerId !== start.pointerId) return;
      const over = dragging ? zoneAt(event.clientX, event.clientY) : null;
      const wasDragging = dragging;
      finish();
      if (!wasDragging) return;
      // The click that follows a drag must not toggle the token back.
      suppressClick = true;
      if (over?.dataset.tokenZone === 'answer') {
        const others = Array.from(answerZone.querySelectorAll<HTMLElement>('[data-token-id]')).filter(node => node !== token);
        const index = dropIndex(others.map(node => node.getBoundingClientRect()), event.clientX, event.clientY);
        change(placeToken(tokens, state, id, index), tokenFocusKey(id));
      } else if (over?.dataset.tokenZone === 'pool' && state.answer.includes(id)) change(returnToken(tokens, state, id), tokenFocusKey(id));
    }, { signal: drag.signal });
    window.addEventListener('pointercancel', event => { if (event.pointerId === start.pointerId) finish(); }, { signal: drag.signal });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && dragging) { event.preventDefault(); suppressClick = true; finish(); }
    }, { signal: drag.signal });
    drag.signal.addEventListener('abort', () => { token.classList.remove('dc-dragging'); token.style.transform = ''; });
  }
  return group;
}
