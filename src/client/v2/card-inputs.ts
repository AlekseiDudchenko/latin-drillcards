import type { CardUiTranslations } from '../i18n.js';
import type { AnswerToken, TokenState } from './token-state.js';

export type InputDefinition =
  | { readonly kind: 'introduction' }
  | { readonly kind: 'choice'; readonly answerLang: string; readonly options: readonly { readonly id: string; readonly label: string }[] }
  | { readonly kind: 'text'; readonly answerLang: string }
  | { readonly kind: 'reveal'; readonly answer: string; readonly answerLang: string }
  /** Tokens in display order; `autoSubmit` checks once when the pool empties (no distractors). */
  | { readonly kind: 'tokens'; readonly answerLang: string; readonly tokens: readonly AnswerToken[]; readonly autoSubmit: boolean };
export interface CardInputState {
  readonly value: string;
  readonly revealed: boolean;
  readonly submitted: boolean;
  readonly detailsOpen: boolean;
  /** Token input only: placement by ID. `value` is then the answer text, derived from it. */
  readonly tokens?: TokenState;
}
export const emptyCardInput = (): CardInputState => ({ value: '', revealed: false, submitted: false, detailsOpen: false });

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(label: string): HTMLButtonElement {
  const node = element('button', label); node.type = 'button'; return node;
}

export function ChoiceInput(definition: Extract<InputDefinition, { kind: 'choice' }>, state: CardInputState,
  labels: CardUiTranslations, disabled: boolean, name: string, signal: AbortSignal, change: (value: string) => void): HTMLElement {
  const group = element('fieldset', undefined, 'dc-choices');
  group.append(element('legend', labels.choose));
  definition.options.forEach((option, index) => {
    const label = element('label', undefined, 'dc-choice');
    const input = element('input'); input.type = 'radio'; input.name = name; input.value = option.id;
    input.lang = definition.answerLang;
    input.checked = state.value === option.id; input.disabled = disabled;
    input.dataset.choiceIndex = String(index);
    input.addEventListener('change', () => change(option.id), { signal });
    const text = element('span', option.label); text.lang = definition.answerLang;
    label.append(input, text); group.append(label);
  });
  return group;
}

export function TextInput(definition: Extract<InputDefinition, { kind: 'text' }>, state: CardInputState,
  labels: CardUiTranslations, disabled: boolean, signal: AbortSignal, change: (value: string) => void): HTMLElement {
  const label = element('label', undefined, 'dc-text');
  label.append(element('span', labels.yourAnswer));
  const input = element('input'); input.type = 'text'; input.value = state.value; input.lang = definition.answerLang;
  input.autocomplete = 'off'; input.spellcheck = false; input.autocapitalize = 'off'; input.disabled = disabled;
  input.addEventListener('input', () => change(input.value), { signal });
  input.addEventListener('keydown', event => { if (event.isComposing && event.key === 'Enter') event.preventDefault(); }, { signal });
  label.append(input); return label;
}

export function RevealInput(definition: Extract<InputDefinition, { kind: 'reveal' }>, state: CardInputState,
  labels: CardUiTranslations, disabled: boolean, allowed: boolean, signal: AbortSignal,
  reveal: () => void, rate: (value: string) => void): HTMLElement {
  const group = element('div', undefined, 'dc-reveal');
  if (!state.revealed || !allowed) {
    const show = button(labels.reveal); show.disabled = disabled || !allowed;
    show.addEventListener('click', reveal, { signal }); group.append(show);
  } else {
    const answer = element('p', definition.answer, 'dc-revealed-answer'); answer.lang = definition.answerLang;
    answer.setAttribute('role', 'status');
    const ratings = element('div', undefined, 'dc-ratings');
    for (const [value, label] of [['forgotten', labels.forgotten], ['remembered', labels.remembered]]) {
      const control = button(label); control.disabled = disabled; control.setAttribute('aria-pressed', String(state.value === value));
      control.addEventListener('click', () => rate(value), { signal }); ratings.append(control);
    }
    group.append(answer, ratings);
  }
  return group;
}
