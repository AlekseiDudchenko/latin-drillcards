import type { CardUiTranslations } from '../i18n.js';
import { button } from './card-inputs.js';

/** One primary action slot shared by regular and cloze cards. Acceptance unlocks Next. */
export function cardPrimaryAction(labels: CardUiTranslations, state: {
  readonly submitted: boolean; readonly canSubmit: boolean; readonly busy: boolean;
  readonly onNext?: () => void;
}, signal: AbortSignal): HTMLButtonElement {
  const advance = state.submitted && !!state.onNext;
  const action = button(advance ? labels.next : labels.submit);
  action.type = advance ? 'button' : 'submit';
  action.dataset.focusKey = advance ? 'next' : 'submit';
  action.disabled = state.busy || (!advance && (state.submitted || !state.canSubmit));
  if (advance) {
    action.className = 'dc-next';
    action.addEventListener('click', () => state.onNext!(), { signal });
  }
  return action;
}
