import { cardUiTranslations, type Lang } from '../i18n.js';
import type { CardSpeech } from './card-speech.js';
import { button, element } from './card-inputs.js';
import { autoSpeechEnabled, autoSpeechSwitch, speakerIcon, stopIcon } from './speech-ui.js';

export interface SpeechControl {
  /** The target-language text the button reads; `undefined` hides the control (nothing may be read yet). */
  setText(text: string | undefined): void;
  /** Reads the current text if the shared auto-speech switch is on. Silent on any failure. */
  autoRead(): void;
  /** Re-renders the labels, e.g. after the interface language changed. */
  refresh(): void;
  stop(): void;
}

/**
 * Audio controls for exercise pages that do not read through a card: the same switch, play/stop button
 * and messages as a word card. The switch is the one shared preference; pressing the button while the
 * same text is read stops it.
 */
export function createSpeechControl(host: HTMLElement, speech: CardSpeech, language: () => Lang): SpeechControl {
  let text: string | undefined;
  let playing = false;
  let message: 'ttsUnavailable' | 'ttsNoVoice' | 'ttsFailed' | null = null;
  let generation = 0;
  host.classList.add('dc-speech-bar');

  function render(): void {
    const labels = cardUiTranslations(language());
    host.hidden = text === undefined;
    const toggle = autoSpeechSwitch(labels.autoReadAloud, () => {
      if (!autoSpeechEnabled()) { generation++; playing = false; speech.cancel(); }
      render();
    });
    const play = button(labels.listen); play.className = 'dc-listen'; play.dataset.focusKey = 'speech';
    play.title = labels.listen; play.setAttribute('aria-label', labels.listen); play.setAttribute('aria-pressed', String(playing));
    play.prepend(playing ? stopIcon() : speakerIcon());
    play.addEventListener('click', () => { void start(false); });
    const status = element('p', message ? labels[message] : '', 'dc-speech-warning'); status.id = 'speechStatus';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const focused = host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
    host.replaceChildren(toggle, play, status);
    if (focused) host.querySelector<HTMLElement>(`[data-focus-key="${focused}"]`)?.focus();
  }

  async function start(auto: boolean): Promise<void> {
    if (text === undefined || !text) return;
    if (auto && (!autoSpeechEnabled() || playing)) return;
    if (playing && !auto) { generation++; playing = false; speech.cancel(); render(); return; }
    const mine = ++generation; playing = true; message = null; render();
    let result;
    try { result = await speech.speak(text); } catch { result = 'failed' as const; }
    if (mine !== generation) return;
    playing = false;
    message = auto ? null : result === 'unavailable' ? 'ttsUnavailable' : result === 'no-voice' ? 'ttsNoVoice' : result === 'failed' ? 'ttsFailed' : null;
    render();
  }

  host.hidden = true; // Nothing to read yet; the first text renders the controls (language may not be known at creation).
  return {
    setText(next) {
      if (next === text) return;
      generation++; playing = false; speech.cancel(); message = null; text = next; render();
    },
    autoRead() { void start(true); },
    refresh: render,
    stop() { generation++; playing = false; speech.cancel(); render(); },
  };
}
