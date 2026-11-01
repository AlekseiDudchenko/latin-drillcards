import { cardPrimaryAction } from './card-actions.js';
import type { Word, TranslationLanguage } from '../../../packages/vocabulary-core/dist/index.js';
import { cardUiTranslations, type Lang, type CardUiTranslations } from '../i18n.js';
import { button, element, ChoiceInput, TextInput, RevealInput, emptyCardInput, type CardInputState, type InputDefinition } from './card-inputs.js';
import { createCardSpeech, type CardSpeech } from './card-speech.js';
import { TokenInput } from './card-tokens.js';
import { becameFilled, initialTokenState, tokenAnswerText, validateTokens, validateTokenState, type TokenState } from './token-state.js';
import { WordDetails } from './word-details.js';

export interface CardDefinition {
  readonly id: string;
  readonly title?: Readonly<Record<Lang, string>>;
  /** `focus` (optional): a phrase of the prompt to highlight, e.g. the phrase a grammar question is about. */
  readonly prompt: { readonly text: string; readonly lang: string; readonly focus?: string };
  readonly input: InputDefinition;
  readonly word?: Word;
  readonly translationLanguage: TranslationLanguage;
  readonly speechText?: string;
  /** Read the text aloud by itself: when the card appears (`start`) or once the answer is accepted as correct (`correct`). */
  readonly autoSpeak?: 'start' | 'correct';
}
export interface CardPresentation {
  readonly language: Lang;
  readonly permissions: { readonly reveal: boolean; readonly details: boolean; readonly speech: boolean };
  readonly feedback?: { readonly kind: 'correct' | 'incorrect' | 'info'; readonly message?: string };
  readonly busy?: boolean;
}
export interface CardActions {
  onChange?(state: CardInputState): void;
  /** `tokens` (token input only) is the answer as token IDs; `value` is their text joined by spaces. */
  onSubmit(answer: { readonly taskId: string; readonly kind: Exclude<InputDefinition['kind'], 'introduction'>; readonly value: string; readonly tokens?: readonly string[] }): void | Promise<void>;
  onContinue?(taskId: string): void | Promise<void>;
  /** When set, a submitted card shows Next where Check was; it advances past the answered task. */
  onNext?(taskId: string): void | Promise<void>;
  onReveal(taskId: string, kind: 'answer' | 'word-details'): void | Promise<void>;
  onSpeech(taskId: string): void | Promise<void>;
}
export interface CardAdapters {
  readonly labels: (language: Lang) => CardUiTranslations;
  readonly speech: CardSpeech;
}

/** Existing app localization, read without persisting a temporary UI language. */
export function cardLabels(language: Lang): CardUiTranslations {
  // The locale tables themselves remain owned by i18n; components never write settings.
  return cardUiTranslations(language);
}

let nextCard = 0;
const AUTO_SPEECH_KEY = 'dc_v2_word_auto_speak';
let autoSpeechFallback = true;
function autoSpeechEnabled(): boolean {
  try { const stored = localStorage.getItem(AUTO_SPEECH_KEY); return stored === null ? autoSpeechFallback : stored !== '0'; }
  catch { return autoSpeechFallback; }
}
export function createCardShell(host: HTMLElement, source: CardDefinition, initial: CardPresentation,
  actions: CardActions, initialState = emptyCardInput(), adapters: CardAdapters = { labels: cardLabels, speech: createCardSpeech() }) {
  // Capture content once per task; language updates cannot replace answer language/options.
  const definition: CardDefinition = { ...source, prompt: { ...source.prompt }, input: source.input.kind === 'choice'
    ? { ...source.input, options: source.input.options.map(option => ({ ...option })) }
    : source.input.kind === 'tokens' ? { ...source.input, tokens: source.input.tokens.map(token => ({ ...token })) } : { ...source.input } };
  if (definition.input.kind === 'tokens') validateTokens(definition.input.tokens);
  if (definition.input.kind === 'choice' && (definition.input.options.length === 0 ||
      new Set(definition.input.options.map(option => option.id)).size !== definition.input.options.length ||
      definition.input.options.some(option => !option.id))) throw new RangeError('Invalid choice options');
  if (definition.input.kind === 'introduction' && !actions.onContinue) throw new RangeError('Introduction requires a continuation command');
  const uid = `dc-card-${++nextCard}`;
  let presentation = initial;
  let state = validate(initialState);
  let disposed = false;
  let pending = false;
  let operationError = false;
  let speechMessage: 'ttsUnavailable' | 'ttsNoGermanVoice' | 'ttsFailed' | null = null;
  let speechGeneration = 0;
  let speaking = false;
  let activeSpeechText: string | undefined;
  let renderEvents = new AbortController();
  let focusRequest: string | undefined;

  function validate(value: CardInputState): CardInputState {
    if (typeof value.value !== 'string' || typeof value.revealed !== 'boolean' || typeof value.submitted !== 'boolean' || typeof value.detailsOpen !== 'boolean') throw new RangeError('Invalid card state');
    if (definition.input.kind === 'choice' && value.value && !definition.input.options.some(option => option.id === value.value)) throw new RangeError('Unknown choice');
    if (definition.input.kind === 'reveal' && ((value.value && !['remembered', 'forgotten'].includes(value.value)) || (value.value && !value.revealed))) throw new RangeError('Invalid reveal state');
    if (definition.input.kind === 'introduction' && value.value && value.value !== 'continue') throw new RangeError('Introduction is not rated');
    if (value.submitted && !value.value.trim()) throw new RangeError('Submitted card has no answer');
    if (definition.input.kind === 'tokens') {
      const tokens = validateTokenState(definition.input.tokens, value.tokens ?? initialTokenState(definition.input.tokens));
      // The text is derived from placement; a snapshot claiming another value is corrupt.
      if (value.value !== tokenAnswerText(definition.input.tokens, tokens)) throw new RangeError('Token answer does not match placement');
      return { ...value, tokens };
    }
    if (value.tokens) throw new RangeError('Tokens belong to token input only');
    return { ...value };
  }
  function notify() {
    // A draft observer cannot turn an already accepted command into a retry.
    try { actions.onChange?.({ ...state }); } catch { operationError = true; }
  }
  function change(value: string) {
    if (disposed || pending || presentation.busy || state.submitted) return;
    state = { ...state, value }; operationError = false; notify();
    // Keep the input DOM and caret in place while typing.
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = !value.trim();
  }
  function changeTokens(next: TokenState, focus?: string) {
    if (disposed || pending || presentation.busy || state.submitted || definition.input.kind !== 'tokens') return;
    const previous = state.tokens!;
    if (next === previous) return;
    state = { ...state, tokens: next, value: tokenAnswerText(definition.input.tokens, next) }; operationError = false; notify();
    focusRequest = focus; render();
    // Autocheck fires on the transition into "filled" only; rerenders, retries
    // and reorders of an already full answer never resubmit by themselves.
    if (definition.input.autoSubmit && becameFilled(previous, next)) void submit();
  }
  async function submit(value = state.value) {
    if (disposed || pending || presentation.busy || state.submitted || !value.trim()) return;
    if (definition.input.kind === 'reveal' && (!state.revealed || !presentation.permissions.reveal)) return;
    if (definition.input.kind === 'introduction' && !presentation.permissions.details) return;
    state = { ...state, value }; pending = true; operationError = false; render();
    try {
      if (definition.input.kind === 'introduction') await actions.onContinue!(definition.id);
      else await actions.onSubmit({ taskId: definition.id, kind: definition.input.kind, value,
        ...(definition.input.kind === 'tokens' ? { tokens: [...state.tokens!.answer] } : {}) });
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
  async function reveal() {
    if (disposed || pending || presentation.busy || state.revealed || !presentation.permissions.reveal) return;
    pending = true; operationError = false; render();
    try {
      await actions.onReveal(definition.id, 'answer');
      if (disposed || !presentation.permissions.reveal) return;
      state = { ...state, revealed: true }; notify();
    } catch { if (!disposed) operationError = true; }
    finally { if (!disposed) { pending = false; render(true); } }
  }
  async function showDetails() {
    if (disposed || pending || presentation.busy || !presentation.permissions.details) return;
    if (state.detailsOpen) { state = { ...state, detailsOpen: false }; notify(); render(); return; }
    pending = true; operationError = false; render();
    try {
      await actions.onReveal(definition.id, 'word-details');
      if (!disposed && presentation.permissions.details) { state = { ...state, detailsOpen: true }; notify(); }
    } catch { if (!disposed) operationError = true; }
    finally { if (!disposed) { pending = false; render(true); } }
  }
  /** `auto`: started by the card itself, not by a click — it never toggles an ongoing reading and stays silent if the browser refuses. */
  async function playSpeech(auto = false, text = definition.speechText) {
    if (auto && !autoSpeechEnabled()) return;
    if (disposed || pending || presentation.busy || !presentation.permissions.speech || !text) return;
    if (auto && speaking) return;
    if (speaking && activeSpeechText === text) { speechGeneration++; speaking = false; adapters.speech.cancel(); render(); return; }
    const generation = ++speechGeneration;
    if (speaking) { speaking = false; adapters.speech.cancel(); }
    pending = true; operationError = false; speechMessage = null; render();
    try {
      await actions.onSpeech(definition.id);
      if (disposed || generation !== speechGeneration || !presentation.permissions.speech) return;
      speaking = true;
      activeSpeechText = text;
      void adapters.speech.speak(text).then(result => {
        if (disposed || generation !== speechGeneration) return;
        speaking = false;
        speechMessage = auto ? null : result === 'unavailable' ? 'ttsUnavailable' : result === 'no-german-voice' ? 'ttsNoGermanVoice' : result === 'failed' ? 'ttsFailed' : null;
        render();
      }).catch(() => {
        if (!disposed && generation === speechGeneration) { speaking = false; speechMessage = auto ? null : 'ttsFailed'; render(); }
      });
    } catch { if (!disposed) operationError = true; }
    finally { if (!disposed) { pending = false; render(true); } }
  }
  function render(afterCommand = false) {
    if (disposed) return;
    const focused = document.activeElement as HTMLInputElement | null;
    const focusInside = focused !== null && host.contains(focused);
    // A token move names where focus goes next; otherwise focus stays on its control.
    const focusKey = focusInside || focusRequest ? focusRequest ?? focused?.dataset.focusKey : undefined;
    focusRequest = undefined;
    const start = focusInside && focused.type === 'text' ? focused.selectionStart : null;
    const end = focusInside && focused.type === 'text' ? focused.selectionEnd : null;
    renderEvents.abort(); renderEvents = new AbortController();
    const signal = renderEvents.signal;
    const labels = adapters.labels(presentation.language);
    const wordPlayback = !!definition.autoSpeak && !!definition.word && !!definition.speechText;
    function pronounceWord(text: string, speechText = definition.speechText, focusKey = 'speech'): HTMLButtonElement {
      const word = button(text); word.className = 'dc-word-speech'; word.lang = 'de'; word.dataset.focusKey = focusKey;
      word.setAttribute('aria-label', `${labels.listen}: ${text}`); word.title = labels.listen;
      word.setAttribute('aria-pressed', String(speaking && activeSpeechText === speechText));
      word.disabled = !speaking && (pending || !!presentation.busy || !presentation.permissions.speech);
      word.addEventListener('click', () => { void playSpeech(false, speechText); }, { signal });
      return word;
    }
    const disabled = pending || !!presentation.busy || state.submitted;
    const root = element('article', undefined, 'dc-card'); root.lang = presentation.language;
    root.setAttribute('aria-labelledby', `${uid}-title`); root.setAttribute('aria-busy', String(pending || !!presentation.busy));
    const titleKey = definition.input.kind === 'introduction' ? 'introductionTitle' : definition.input.kind === 'choice' ? 'choiceTitle' : definition.input.kind === 'text' ? 'textTitle' : definition.input.kind === 'tokens' ? 'tokensTitle' : 'revealTitle';
    const title = element('h2', definition.title?.[presentation.language] ?? labels[titleKey]); title.id = `${uid}-title`;
    const prompt = element('p', definition.prompt.text, 'dc-prompt'); prompt.lang = definition.prompt.lang;
    const focusAt = definition.prompt.focus ? definition.prompt.text.indexOf(definition.prompt.focus) : -1;
    if (focusAt >= 0) prompt.replaceChildren(definition.prompt.text.slice(0, focusAt), element('mark', definition.prompt.focus, 'dc-focus'),
      definition.prompt.text.slice(focusAt + definition.prompt.focus!.length));
    if (wordPlayback && definition.prompt.lang === 'de') prompt.replaceChildren(pronounceWord(definition.prompt.text));
    root.append(title, prompt);
    if (wordPlayback && definition.prompt.lang !== 'de' && presentation.permissions.speech && !state.detailsOpen) {
      const pronunciation = element('p', undefined, 'dc-pronunciation'); pronunciation.append(pronounceWord(definition.speechText!)); root.append(pronunciation);
    }
    const form = element('form');
    if (definition.input.kind === 'choice') form.append(ChoiceInput(definition.input, state, labels, disabled, uid, signal, change));
    else if (definition.input.kind === 'text') form.append(TextInput(definition.input, state, labels, disabled, signal, change));
    else if (definition.input.kind === 'tokens') form.append(TokenInput(definition.input, state.tokens!, labels, disabled, uid, signal, changeTokens));
    else if (definition.input.kind === 'reveal') form.append(RevealInput(definition.input, state, labels, disabled, presentation.permissions.reveal, signal, () => { void reveal(); }, value => { void submit(value); }));
    else {
      const next = button(labels.continue); next.disabled = disabled || !presentation.permissions.details;
      next.addEventListener('click', () => { void submit('continue'); }, { signal }); form.append(next);
    }
    if (['text', 'choice', 'tokens'].includes(definition.input.kind) ||
        (state.submitted && actions.onNext && definition.input.kind !== 'introduction')) {
      form.append(cardPrimaryAction(labels, { submitted: state.submitted, canSubmit: !!state.value.trim(),
        busy: pending || !!presentation.busy, ...(actions.onNext ? { onNext: () => { void next(); } } : {}) }, signal));
    }
    form.addEventListener('submit', event => { event.preventDefault(); void submit(); }, { signal });
    form.addEventListener('keydown', event => {
      if (event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || disabled || definition.input.kind !== 'choice') return;
      const index = Number(event.key) - 1;
      if (!/^[1-9]$/.test(event.key) || index >= definition.input.options.length) return;
      event.preventDefault(); const option = definition.input.options[index]!; change(option.id);
      const radio = form.querySelector<HTMLInputElement>(`input[data-choice-index="${index}"]`); if (radio) { radio.checked = true; radio.focus(); }
    }, { signal });
    root.append(form);
    const toolbar = element('div', undefined, 'dc-toolbar');
    if (definition.speechText) {
      if (definition.autoSpeak) {
        const toggle = button(''); toggle.className = 'dc-speak'; toggle.dataset.focusKey = 'auto-speech';
        toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(autoSpeechEnabled()));
        toggle.setAttribute('aria-label', labels.autoReadWords); toggle.title = labels.autoReadWords;
        const thumb = element('span', undefined, 'dc-speak-thumb'); thumb.setAttribute('aria-hidden', 'true'); thumb.append(speakerIcon()); toggle.append(thumb);
        toggle.addEventListener('click', () => {
          const enabled = !autoSpeechEnabled(); autoSpeechFallback = enabled;
          try { localStorage.setItem(AUTO_SPEECH_KEY, enabled ? '1' : '0'); } catch { /* Keep the preference for this page if storage is unavailable. */ }
          if (!enabled) { speechGeneration++; speaking = false; adapters.speech.cancel(); }
          render();
        }, { signal });
        root.append(toggle);
      }
      if (!wordPlayback) {
        // Non-word cards keep their existing playback control.
        const play = button(definition.autoSpeak ? labels.listen : ''); play.className = definition.autoSpeak ? 'dc-listen' : 'dc-speak'; play.dataset.focusKey = 'speech';
        play.setAttribute('aria-label', labels.listen); play.title = labels.listen; play.setAttribute('aria-pressed', String(speaking));
        const thumb = element('span', undefined, 'dc-speak-thumb'); thumb.setAttribute('aria-hidden', 'true');
        thumb.append(speaking ? stopIcon() : speakerIcon());
        if (definition.autoSpeak) play.prepend(speaking ? stopIcon() : speakerIcon()); else play.append(thumb);
        play.disabled = !speaking && (pending || !!presentation.busy || !presentation.permissions.speech);
        play.addEventListener('click', () => { void playSpeech(); }, { signal });
        if (definition.autoSpeak) toolbar.append(play); else root.append(play);
      }
    }
    if (definition.word && presentation.permissions.details && definition.input.kind !== 'introduction') {
      const details = button(state.detailsOpen ? labels.hideDetails : labels.showDetails);
      details.dataset.focusKey = 'details'; details.setAttribute('aria-expanded', String(state.detailsOpen)); details.setAttribute('aria-controls', `${uid}-details`);
      details.disabled = pending || !!presentation.busy;
      details.addEventListener('click', () => { void showDetails(); }, { signal });
      toolbar.append(details);
    }
    root.append(toolbar);
    if (definition.word && presentation.permissions.details && (state.detailsOpen || definition.input.kind === 'introduction')) {
      const details = WordDetails(definition.word, definition.translationLanguage, labels, definition.input.kind !== 'introduction'); details.id = `${uid}-details`; root.insertBefore(details, form);
      const headword = details.querySelector('h3');
      if (wordPlayback && headword) headword.replaceChildren(pronounceWord(headword.textContent!));
      details.querySelectorAll<HTMLElement>('blockquote > p[lang="de"]').forEach((example, index) => {
        const text = example.textContent!;
        const play = pronounceWord(text, text, `example-speech-${index}`); play.classList.add('dc-example-speech');
        example.replaceChildren(play);
      });
    }
    const status = element('p', undefined, 'dc-status'); status.setAttribute('role', operationError ? 'alert' : 'status'); status.setAttribute('aria-live', 'polite');
    if (operationError) status.textContent = labels.error;
    else if (pending || presentation.busy) status.textContent = labels.saving;
    else if (presentation.feedback) {
      status.dataset.kind = presentation.feedback.kind;
      status.textContent = presentation.feedback.message ?? labels[presentation.feedback.kind];
    } else if (state.submitted) status.textContent = definition.input.kind === 'introduction' ? labels.readyToContinue : labels.submitted;
    status.tabIndex = -1; root.append(status);
    if (speechMessage) { const warning = element('p', labels[speechMessage], 'dc-speech-warning'); warning.setAttribute('role', 'status'); root.append(warning); }
    root.querySelectorAll<HTMLElement>('input, button').forEach((control, index) => { if (!control.dataset.focusKey) control.dataset.focusKey = `input-${index}`; });
    host.replaceChildren(root);
    if (focusKey) {
      const target = Array.from(root.querySelectorAll<HTMLInputElement>('[data-focus-key]')).find(node => node.dataset.focusKey === focusKey);
      target?.focus(); if (target?.type === 'text' && start !== null && end !== null) target.setSelectionRange(start, end);
    } else if (afterCommand && document.activeElement === document.body) {
      if (state.submitted && !operationError) (root.querySelector<HTMLElement>('[data-focus-key="next"]:not(:disabled)') ?? status).focus();
      else if (operationError) status.focus();
      else (root.querySelector<HTMLElement>('form input:not(:disabled),form button:not(:disabled)')
        ?? root.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)'))?.focus();
    }
  }
  render();
  if (definition.autoSpeak === 'start' && !state.submitted && !state.revealed && !initial.feedback) void playSpeech(true);
  return {
    getState(): CardInputState { return { ...state }; },
    /** For a card mounted already answered, right after a live correct answer: read the `correct` text now. */
    readAloudAfterCorrect() { if (definition.autoSpeak === 'correct') void playSpeech(true); },
    setPresentation(next: CardPresentation) {
      if (disposed) return;
      if (!next.permissions.speech) { speechGeneration++; adapters.speech.cancel(); speechMessage = null; speaking = false; }
      const accepted = !presentation.feedback && next.feedback?.kind === 'correct';
      presentation = next; render();
      if (accepted && definition.autoSpeak === 'correct') void playSpeech(true);
    },
    restoreState(next: CardInputState) {
      if (disposed) return;
      if (pending) throw new Error('Cannot restore while a command is pending');
      state = validate(next); render();
    },
    dispose() { if (disposed) return; disposed = true; speaking = false; speechGeneration++; renderEvents.abort(); adapters.speech.dispose(); host.replaceChildren(); },
  };
}

const SVG = 'http://www.w3.org/2000/svg';
/** Shown while the text is being read: the next click stops it. */
function stopIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('aria-hidden', 'true');
  const square = document.createElementNS(SVG, 'rect');
  for (const [name, value] of Object.entries({ x: '6', y: '6', width: '12', height: '12', rx: '2', fill: 'currentColor' })) square.setAttribute(name, value);
  svg.append(square); return svg;
}

function speakerIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attributes] of [['path', { d: 'M11 5 6 9H3v6h3l5 4z', fill: 'currentColor' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }],
    ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }]] as const) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}
