import { cardPrimaryAction } from './card-actions.js';
import { cardUiTranslations, type Lang, type CardUiTranslations } from '../i18n.js';
import { button, element, ChoiceInput, TextInput, emptyCardInput } from './card-inputs.js';
import type { CardPresentation } from './card-shell.js';
import { emptyClozeState, hasClozeDraft, isClozeComplete, nextEmptySlot, resetCloze, setSlotValue,
  validateClozeDefinition, validateClozeState, type ClozeDefinition, type ClozeSlot, type ClozeState, type SlotOutcome } from './cloze-model.js';

export * from './cloze-model.js';

export interface ClozeCardDefinition extends ClozeDefinition {
  /** Custom instructional title in every UI language; defaults to the localized cloze title. */
  readonly title?: Readonly<Record<Lang, string>>;
  /** Optional content cue shown above the sentence, e.g. a translation. */
  readonly prompt?: { readonly text: string; readonly lang: string };
}
export interface ClozeSlotResult { readonly outcome: SlotOutcome; readonly expected?: string }
export interface ClozePresentation {
  readonly language: Lang;
  readonly feedback?: CardPresentation['feedback'];
  /** Per-slot results supplied by the exercise adapter; `expected` is shown only when given. */
  readonly slotResults?: Readonly<Record<string, ClozeSlotResult>>;
  readonly busy?: boolean;
}
export interface ClozeAnswer { readonly taskId: string; readonly kind: 'cloze'; readonly values: Readonly<Record<string, string>> }
export interface ClozeActions {
  onChange?(state: ClozeState): void;
  /** Resolve after acceptance/commit, reject on failure. No grading happens in the component. */
  onSubmit(answer: ClozeAnswer): void | Promise<void>;
  /** After acceptance, Next takes Check's place, as on regular cards. */
  onNext?(taskId: string): void | Promise<void>;
}
export interface ClozeAdapters { readonly labels: (language: Lang) => CardUiTranslations }

export function slotCaption(labels: CardUiTranslations, index: number, total: number): string {
  return labels.clozeSlot.replace('{n}', String(index + 1)).replace('{total}', String(total));
}

interface ClozeInputHandlers { change(slotId: string, value: string): void; focusSlot(slotId: string): void }

/** Sentence with inline slots plus one ChoiceInput per choice slot. Stateless: renders the given state. */
export function ClozeInput(definition: ClozeDefinition, state: ClozeState, labels: CardUiTranslations, disabled: boolean,
  results: ClozePresentation['slotResults'], name: string, signal: AbortSignal, handlers: ClozeInputHandlers): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const total = definition.slots.length;
  const sentence = element('div', undefined, 'dc-cloze-sentence'); sentence.lang = definition.answerLang;
  const choices = element('div', undefined, 'dc-cloze-choices');
  const slotIndex = new Map(definition.slots.map((slot, index) => [slot.slotId, index]));
  for (const segment of definition.segments) {
    if (segment.kind === 'text') { sentence.append(element('span', segment.text)); continue; }
    const index = slotIndex.get(segment.slotId)!;
    const slot = definition.slots[index]!;
    const caption = slotCaption(labels, index, total);
    const value = state.values[slot.slotId] ?? '';
    const wrapper = element('span', undefined, 'dc-cloze-slot'); wrapper.dataset.slotId = slot.slotId;
    const outcome = results?.[slot.slotId]?.outcome; if (outcome) wrapper.dataset.result = outcome;
    if (slot.input === 'text') wrapper.append(textSlot(slot, value, caption));
    else {
      const chosen = slot.options.find(option => option.id === value)?.label;
      const marker = button(chosen ?? '___'); marker.className = 'dc-cloze-marker'; marker.disabled = disabled;
      marker.dataset.focusKey = `marker-${slot.slotId}`; marker.setAttribute('aria-label', `${caption}: ${chosen ?? labels.clozeEmpty}`);
      marker.addEventListener('click', () => handlers.focusSlot(slot.slotId), { signal });
      wrapper.append(marker); choices.append(choiceSlot(slot, value, caption));
    }
    sentence.append(wrapper);
  }
  fragment.append(sentence);
  if (choices.childElementCount) fragment.append(choices);
  return fragment;

  function textSlot(slot: ClozeSlot, value: string, caption: string): HTMLElement {
    const field = TextInput({ kind: 'text', answerLang: definition.answerLang }, { ...emptyCardInput(), value }, labels, disabled, signal,
      next => handlers.change(slot.slotId, next));
    field.classList.add('dc-cloze-text');
    const label = field.firstElementChild as HTMLElement; label.textContent = caption; label.className = 'dc-visually-hidden';
    const input = field.querySelector('input')!; input.dataset.slotId = slot.slotId; input.dataset.focusKey = `slot-${slot.slotId}`;
    return field;
  }
  function choiceSlot(slot: Extract<ClozeSlot, { input: 'choice' }>, value: string, caption: string): HTMLElement {
    const group = ChoiceInput({ kind: 'choice', answerLang: definition.answerLang, options: slot.options }, { ...emptyCardInput(), value },
      labels, disabled, `${name}-${slot.slotId}`, signal, next => handlers.change(slot.slotId, next));
    group.dataset.slotId = slot.slotId; group.querySelector('legend')!.textContent = caption;
    group.querySelectorAll<HTMLInputElement>('input').forEach((radio, index) => { radio.dataset.slotId = slot.slotId; radio.dataset.focusKey = `slot-${slot.slotId}-${index}`; });
    return group;
  }
}

let nextCloze = 0;
/**
 * Cloze card controller: one or several slots, typed or chosen, explicit check of all slots at once.
 * Same lifecycle contract as createCardShell (getState/setPresentation/restoreState/dispose).
 */
export function createClozeCard(host: HTMLElement, source: ClozeCardDefinition, initial: ClozePresentation, actions: ClozeActions,
  initialState?: ClozeState, adapters: ClozeAdapters = { labels: cardUiTranslations }) {
  const definition = validateClozeDefinition(source);
  const title = source.title ? { ...source.title } : undefined;
  const prompt = source.prompt ? { ...source.prompt } : undefined;
  const uid = `dc-cloze-${++nextCloze}`;
  let presentation = initial;
  let state = validateClozeState(definition, initialState ?? emptyClozeState(definition));
  let disposed = false;
  let pending = false;
  let operationError = false;
  let renderEvents = new AbortController();

  const locked = () => disposed || pending || !!presentation.busy || state.submitted;
  const slotOf = (slotId: string) => definition.slots.find(slot => slot.slotId === slotId)!;
  function notify() {
    try { actions.onChange?.({ values: { ...state.values }, submitted: state.submitted }); } catch { operationError = true; }
  }
  function updateControls() {
    const check = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (check) check.disabled = locked() || !isClozeComplete(definition, state);
    const reset = host.querySelector<HTMLButtonElement>('.dc-cloze-reset');
    if (reset) reset.disabled = locked() || !hasClozeDraft(state);
  }
  function change(slotId: string, value: string) {
    if (locked()) return;
    state = setSlotValue(definition, state, slotId, value); operationError = false; notify();
    // Typing keeps the input DOM and caret; a choice repaints its inline marker.
    if (slotOf(slotId).input === 'choice') render(); else updateControls();
  }
  function focusSlot(slotId: string | null) {
    const root = host.querySelector('.dc-cloze');
    if (!root) return;
    if (slotId === null) { root.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')?.focus(); return; }
    const controls = Array.from(root.querySelectorAll<HTMLInputElement>('input')).filter(input => input.dataset.slotId === slotId);
    (controls.find(input => input.checked) ?? controls[0])?.focus();
  }
  async function submit() {
    if (locked() || !isClozeComplete(definition, state)) return;
    pending = true; operationError = false; render();
    try {
      await actions.onSubmit({ taskId: definition.id, kind: 'cloze', values: { ...state.values } });
      if (disposed) return;
      state = { ...state, submitted: true }; notify();
    } catch { if (!disposed) operationError = true; }
    finally { if (!disposed) { pending = false; render(true); } }
  }
  async function next() {
    if (disposed || pending || presentation.busy || !state.submitted || !actions.onNext) return;
    pending = true; operationError = false; render();
    try { await actions.onNext(definition.id); }
    catch { if (!disposed) operationError = true; }
    finally { if (!disposed) { pending = false; render(true); } }
  }
  function reset() {
    if (locked() || !hasClozeDraft(state)) return;
    state = resetCloze(definition, state); operationError = false; notify(); render();
    focusSlot(definition.slots[0]!.slotId);
  }
  function render(afterCommand = false) {
    if (disposed) return;
    const focused = document.activeElement as HTMLInputElement | null;
    const focusInside = focused !== null && host.contains(focused);
    const focusKey = focusInside ? focused.dataset.focusKey : undefined;
    const start = focusInside && focused.type === 'text' ? focused.selectionStart : null;
    const end = focusInside && focused.type === 'text' ? focused.selectionEnd : null;
    renderEvents.abort(); renderEvents = new AbortController();
    const signal = renderEvents.signal;
    const labels = adapters.labels(presentation.language);
    const disabled = pending || !!presentation.busy || state.submitted;
    const root = element('article', undefined, 'dc-card dc-cloze'); root.lang = presentation.language;
    root.setAttribute('aria-labelledby', `${uid}-title`); root.setAttribute('aria-busy', String(pending || !!presentation.busy));
    const heading = element('h2', title?.[presentation.language] ?? labels.clozeTitle); heading.id = `${uid}-title`;
    root.append(heading);
    if (prompt) { const cue = element('p', prompt.text, 'dc-cloze-prompt'); cue.lang = prompt.lang; root.append(cue); }
    const form = element('form');
    form.append(ClozeInput(definition, state, labels, disabled, presentation.slotResults, uid, signal, { change, focusSlot }));
    const buttons = element('div', undefined, 'dc-cloze-actions');
    const check = cardPrimaryAction(labels, { submitted: state.submitted, canSubmit: isClozeComplete(definition, state),
      busy: pending || !!presentation.busy, ...(actions.onNext ? { onNext: () => { void next(); } } : {}) }, signal);
    const clear = button(labels.clozeReset); clear.className = 'dc-cloze-reset'; clear.dataset.focusKey = 'reset';
    clear.disabled = disabled || !hasClozeDraft(state);
    clear.addEventListener('click', reset, { signal });
    buttons.append(check);
    if (!state.submitted || !actions.onNext) buttons.append(clear);
    form.append(buttons);
    form.addEventListener('submit', event => { event.preventDefault(); void submit(); }, { signal });
    form.addEventListener('keydown', event => {
      const target = event.target as HTMLInputElement;
      const slotId = target.dataset?.slotId;
      if (!slotId || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Enter') {
        // Enter checks only a complete answer; otherwise it moves on to the next empty slot.
        event.preventDefault();
        if (event.repeat || locked()) return;
        if (isClozeComplete(definition, state)) void submit(); else focusSlot(nextEmptySlot(definition, state, slotId));
        return;
      }
      if (target.type !== 'radio' || event.repeat || locked() || !/^[1-9]$/.test(event.key)) return;
      const slot = slotOf(slotId); const option = slot.input === 'choice' ? slot.options[Number(event.key) - 1] : undefined;
      if (!option) return;
      event.preventDefault(); change(slotId, option.id);
      focusSlot(nextEmptySlot(definition, state, slotId));
    }, { signal });
    root.append(form);
    if (presentation.slotResults) {
      const list = element('ul', undefined, 'dc-cloze-results'); list.setAttribute('aria-label', labels.clozeResults);
      definition.slots.forEach((slot, index) => {
        const result = presentation.slotResults![slot.slotId];
        if (!result) return;
        const item = element('li', `${slotCaption(labels, index, definition.slots.length)}: ${result.outcome === 'correct' ? labels.clozeSlotCorrect : labels.clozeSlotIncorrect}`);
        item.dataset.slotId = slot.slotId; item.dataset.result = result.outcome;
        if (result.expected !== undefined) {
          const expected = element('span', result.expected); expected.lang = definition.answerLang;
          item.append(` · ${labels.expectedAnswer}: `, expected);
        }
        list.append(item);
      });
      root.append(list);
    }
    const status = element('p', undefined, 'dc-status'); status.setAttribute('role', operationError ? 'alert' : 'status'); status.setAttribute('aria-live', 'polite');
    if (operationError) status.textContent = labels.error;
    else if (pending || presentation.busy) status.textContent = labels.saving;
    else if (presentation.feedback) {
      status.dataset.kind = presentation.feedback.kind;
      status.textContent = presentation.feedback.message ?? labels[presentation.feedback.kind];
    } else if (state.submitted) status.textContent = labels.submitted;
    status.tabIndex = -1; root.append(status);
    host.replaceChildren(root);
    if (focusKey) {
      const target = Array.from(root.querySelectorAll<HTMLInputElement>('[data-focus-key]')).find(node => node.dataset.focusKey === focusKey);
      if (target && !target.disabled) { target.focus(); if (target.type === 'text' && start !== null && end !== null) target.setSelectionRange(start, end); }
    }
    if (afterCommand && document.activeElement === document.body) {
      if (state.submitted && !operationError) (root.querySelector<HTMLElement>('[data-focus-key="next"]:not(:disabled)') ?? status).focus();
      else if (operationError) status.focus();
      else focusSlot(nextEmptySlot(definition, state) ?? definition.slots[0]!.slotId);
    }
  }
  render();
  return {
    getState(): ClozeState { return { values: { ...state.values }, submitted: state.submitted }; },
    setPresentation(next: ClozePresentation) { if (disposed) return; presentation = next; render(); },
    restoreState(next: ClozeState) {
      if (disposed) return;
      if (pending) throw new Error('Cannot restore while a command is pending');
      state = validateClozeState(definition, next); render();
    },
    dispose() { if (disposed) return; disposed = true; renderEvents.abort(); host.replaceChildren(); },
  };
}
