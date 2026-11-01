import { createItemExerciseRegistry, isItemSessionPlan, planItemSession, projectExerciseProgress, sentenceContent,
  type ItemDataset, type ItemExerciseRegistry, type ItemExerciseTask, type ListeningExercise, type ListeningMode,
  type TranslationLanguage } from '../../core/index.js';
import type { Lang } from '../../../i18n.js';
import { createCardShell } from '../../card-shell.js';
import { createCardSpeech, type SpeechResult } from '../../card-speech.js';
import { SessionRunner, type ItemRunnerView, type RunnerEnvironment } from '../../session-runner.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { tokenAnswerText } from '../../token-state.js';
import { fill } from '../sentences/sentences-i18n.js';
import { CEFR_DECKS, formatTag, nextSentence, pool, poolStats, SENTENCE_DATASET, sentenceStats, type SentenceFilter } from '../sentences/sentences-model.js';
import { listeningUiTranslations } from './listening-i18n.js';

// M2 (#334): listening on the shared Runner and journal, over the M1 sentence corpus. The audio
// is the prompt: the card shows only an instruction, and the German text appears after the answer.
// Playing (and replaying) is page-local and writes nothing; only the answer goes to the journal.
// Each sentence is one single-task item session, as in the sentence builder (see sentences-page).
const DATASET = new URL('../../../data/items/sentences.json', import.meta.url);
const EXERCISE: Record<ListeningMode, string> = { tokens: 'listening-tokens', text: 'listening-text' };
const MODE_KEY = 'hoeren_mode';
const AUTOPLAY_KEY = 'dc_v2_listening_autoplay';
const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const controls = { deck: $<HTMLSelectElement>('deck'), language: $<HTMLSelectElement>('language'),
  translation: $<HTMLSelectElement>('translation'), autoPlay: $<HTMLInputElement>('autoPlay') };
const modeButtons = { tokens: $<HTMLButtonElement>('modeTokens'), text: $<HTMLButtonElement>('modeText') };
const buttons = { play: $<HTMLButtonElement>('play'), previous: $<HTMLButtonElement>('previous'),
  tryAgain: $<HTMLButtonElement>('tryAgain'), retry: $<HTMLButtonElement>('retrySave') };
const page = new AbortController();
const speech = createCardSpeech();

let language: Lang = stored('dc_v2_lang', ['ru', 'en', 'de']) as Lang ?? 'ru';
let translation: TranslationLanguage = stored('dc_v2_sentence_translation', ['ru', 'en']) as TranslationLanguage ?? 'ru';
// v1 used "drag" and "type" under the same key.
let mode: ListeningMode = stored(MODE_KEY, ['type', 'text']) ? 'text' : 'tokens';
let filter: SentenceFilter = parseLevel(location.hash);
let learning: PageLearning | undefined;
let scope: PageLearning['store'] | undefined;
let dataset: ItemDataset | undefined;
let registry: ItemExerciseRegistry | undefined;
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: ReturnType<typeof createCardShell> | undefined;
let cardKey = '';
let failure: 'loadError' | 'noData' | undefined;
let busy = false;
let playing = false;
let speechProblem: Exclude<SpeechResult, 'completed' | 'cancelled'> | undefined;
/** Session whose audio has been played automatically, so a re-render never replays it. */
let autoPlayed = '';
const visited: { readonly itemId: string; readonly seed: string }[] = [];
let progress: ReturnType<typeof projectExerciseProgress> | undefined;

function stored(key: string, allowed: readonly string[]): string | undefined {
  try { const value = localStorage.getItem(key); return value && allowed.includes(value) ? value : undefined; } catch { return undefined; }
}
function store(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
/** Levels as in v1 Hören: all CEFR levels or one of them. */
function parseLevel(hash: string): SentenceFilter {
  const deck = new URLSearchParams(hash.replace(/^#/, '')).get('deck') ?? 'all';
  return { deck: CEFR_DECKS.includes(deck) ? deck : 'all' };
}
const ASSISTED_KEY = 'dc_v2_listening_assisted';
function assistedSessions(): string[] {
  try { return JSON.parse(sessionStorage.getItem(ASSISTED_KEY) ?? '[]') as string[]; } catch { return []; }
}
function markAssisted(sessionId: string): void {
  try { sessionStorage.setItem(ASSISTED_KEY, JSON.stringify([...assistedSessions().slice(-50), sessionId])); } catch { /* best effort */ }
}
const autoPlayOn = (): boolean => stored(AUTOPLAY_KEY, ['0', '1']) !== '0';

function view(): ItemRunnerView | undefined {
  const current = runner?.view;
  return current?.family === 'items' ? current : undefined;
}
function currentItemId(): string | undefined { return view()?.plan.tasks[0]?.target.itemId; }
function exerciseOf(task: ItemExerciseTask): ListeningExercise { return task.specification.exercise as unknown as ListeningExercise; }
const isListening = (exerciseId: string | undefined): boolean => exerciseId === EXERCISE.tokens || exerciseId === EXERCISE.text;

async function refreshProgress(): Promise<void> {
  if (!scope) return;
  const data = await scope.snapshot();
  progress = projectExerciseProgress(data.facts, { owner: scope.owner, ...scope.epoch, asOf: env.now() });
}

async function leave(): Promise<void> {
  const active = runner; const current = view();
  if (!active || !current) return;
  if (current.phase === 'feedback') await active.next();
  else if (current.phase === 'presenting' || current.phase === 'paused' || current.phase === 'ready') await active.finish();
}

async function show(itemId: string, options: { seed?: string; assisted?: boolean; remember?: boolean } = {}): Promise<void> {
  if (!scope || !registry || !dataset || busy) return;
  busy = true; stopAudio(); render();
  try {
    await leave();
    const shown = view();
    if (shown && options.remember !== false) visited.push({ itemId: shown.plan.tasks[0]!.target.itemId, seed: shown.plan.seed });
    const sessionId = env.id(); const seed = options.seed ?? env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed, createdAt: env.now(),
      answerLanguage: translation, datasetId: SENTENCE_DATASET, items: [{ itemId, exerciseId: EXERCISE[mode] }] });
    if (options.assisted) markAssisted(sessionId);
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 },
      catalogVersion: '', words: [], datasets: [dataset] }));
  } finally { busy = false; await refreshProgress().catch(() => {}); render(); }
}

function attach(next: SessionRunner): void {
  unsubscribe?.(); runner?.dispose();
  runner = next; unsubscribe = next.subscribe(() => render());
}

async function goNext(): Promise<void> {
  if (!registry || !progress) return;
  const id = nextSentence(registry, progress, filter, currentItemId(), EXERCISE[mode]);
  if (id) await show(id); else { failure = 'noData'; render(); }
}
async function goPrevious(): Promise<void> {
  const previous = visited.pop();
  // A returned-to sentence was already heard with its text: the new attempt is assisted.
  if (previous) await show(previous.itemId, { seed: previous.seed, assisted: true, remember: false });
}
async function tryAgain(): Promise<void> {
  const current = view();
  if (current) await show(current.plan.tasks[0]!.target.itemId, { seed: current.plan.seed, assisted: true, remember: false });
}
/** Another mode for the same sentence and token order. After an answer the text is known, so it is assisted. */
async function switchMode(next: ListeningMode): Promise<void> {
  if (next === mode) return;
  mode = next; store(MODE_KEY, next === 'text' ? 'type' : 'drag');
  const current = view();
  if (!current) { render(); return; }
  const answered = current.phase === 'feedback' || assistedSessions().includes(current.sessionId);
  await show(current.plan.tasks[0]!.target.itemId, { seed: current.plan.seed, assisted: answered, remember: false });
}

// --- Audio: the prompt. Replaying is never an answer and never an event. ---
function stopAudio(): void { speech.cancel(); playing = false; }
async function play(): Promise<void> {
  const task = view()?.task;
  if (!task) return;
  const { audio } = exerciseOf(task);
  playing = true; speechProblem = undefined; renderAudio();
  const result = await speech.speak(audio.text);
  if (view()?.task?.id !== task.id) return;
  playing = false;
  speechProblem = result === 'completed' || result === 'cancelled' ? undefined : result;
  renderAudio();
}
function renderAudio(): void {
  const labels = listeningUiTranslations(language);
  buttons.play.textContent = playing ? labels.playing : labels.play;
  buttons.play.disabled = busy || !view()?.task;
  buttons.play.setAttribute('aria-busy', String(playing));
  const notice = $('speechNotice');
  notice.hidden = !speechProblem;
  if (!speechProblem) { notice.replaceChildren(); return; }
  const message = document.createElement('span');
  message.textContent = speechProblem === 'unavailable' ? labels.ttsUnavailable : speechProblem === 'no-german-voice' ? labels.ttsNoGermanVoice : labels.ttsFailed;
  const help = document.createElement('a'); help.href = '../hilfe/vorlesen'; help.textContent = labels.ttsHelp;
  notice.replaceChildren(message, ' ', help);
}

function localize(): void {
  const labels = listeningUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${labels.title}`;
  $('title').textContent = labels.title;
  $('languageLabel').textContent = labels.interfaceLanguage;
  $('translationLabel').textContent = labels.translation;
  $('deckLabel').textContent = labels.deck;
  $('modeLabel').textContent = labels.mode;
  $('autoPlayLabel').textContent = labels.autoSpeak;
  $('keyboard').textContent = labels.keyboard;
  modeButtons.tokens.textContent = labels.modeTokens; modeButtons.text.textContent = labels.modeText;
  buttons.previous.textContent = labels.previous;
  buttons.tryAgain.textContent = labels.tryAgain; buttons.retry.textContent = labels.retrySave;
  controls.deck.replaceChildren(...['all', ...CEFR_DECKS].map(deck => option(deck, deck === 'all' ? labels.allLevels : deck.toUpperCase())));
  controls.deck.value = filter.deck;
}
function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
}

function render(): void {
  const labels = listeningUiTranslations(language);
  const current = view();
  const notice = $('notice');
  notice.textContent = failure ? labels[failure] : current?.error === 'save' ? labels.saveError : '';
  notice.setAttribute('role', failure === 'loadError' || current?.error ? 'alert' : 'status');
  const disabled = busy || !!current?.busy;
  Object.values(buttons).forEach(button => { button.disabled = disabled; });
  for (const [key, node] of Object.entries(modeButtons)) { node.setAttribute('aria-pressed', String(key === mode)); node.disabled = disabled; }
  buttons.retry.hidden = current?.error !== 'save';
  buttons.previous.disabled ||= visited.length === 0;
  const task = current?.task;
  const answered = current?.phase === 'feedback' && current.answer ? current.answer : undefined;
  buttons.tryAgain.hidden = !answered || answered.evaluation.outcome === 'correct';
  renderMeta(task, !!answered);
  renderAudio();
  if (!current || !task || (current.phase !== 'presenting' && current.phase !== 'feedback')) { closeCard(); return; }
  const exercise = exerciseOf(task);
  const feedback = answered ? answered.evaluation.outcome === 'correct'
    ? { kind: 'correct' as const, message: labels.correct } : { kind: 'incorrect' as const, message: fill(labels.wrong, { target: exercise.target }) } : undefined;
  // No speechText: the card never offers the German text; the page plays it.
  const presentation = { language, busy: disabled, permissions: { reveal: false, details: false, speech: false }, ...(feedback ? { feedback } : {}) };
  const key = `${current.sessionId}|${current.phase}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  closeCard(); cardKey = key;
  const active = runner!;
  const assisted = assistedSessions().includes(current.sessionId);
  const instruction = { text: exercise.mode === 'tokens' ? labels.promptTokens : labels.promptText, lang: language };
  const title = Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, listeningUiTranslations(lang).title])) as Record<Lang, string>;
  const actions = {
    async onSubmit(answer: { value: string; tokens?: readonly string[] }) {
      const raw = exercise.mode === 'tokens' ? [...(answer.tokens ?? [])] : answer.value;
      const result = await active.submit(raw, { assisted });
      if (result === 'conflict') throw new Error('Session changed elsewhere');
      await refreshProgress().catch(() => {}); render();
    },
    onNext: goNext,
    onReveal() {}, onSpeech() {},
  };
  if (exercise.mode === 'tokens') {
    const tokens = exercise.tokens!.map(token => ({ id: token.id, text: token.text }));
    const raw = answered && Array.isArray(answered.rawAnswer) ? answered.rawAnswer as string[] : undefined;
    const placement = raw ? { answer: raw, pool: tokens.map(t => t.id).filter(id => !raw.includes(id)) } : undefined;
    card = createCardShell(host, { id: task.id, title, prompt: instruction, input: { kind: 'tokens', answerLang: 'de', tokens, autoSubmit: false },
      translationLanguage: task.specification.answerLanguage }, presentation, actions,
      placement ? { value: tokenAnswerText(tokens, placement), revealed: false, submitted: true, detailsOpen: false, tokens: placement } : undefined);
  } else {
    const raw = answered && typeof answered.rawAnswer === 'string' ? answered.rawAnswer : undefined;
    card = createCardShell(host, { id: task.id, title, prompt: instruction, input: { kind: 'text', answerLang: 'de' },
      translationLanguage: task.specification.answerLanguage }, presentation, actions,
      raw !== undefined ? { value: raw, revealed: false, submitted: true, detailsOpen: false } : undefined);
  }
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
  else if (current.phase === 'presenting' && autoPlayed !== current.sessionId && autoPlayOn()) { autoPlayed = current.sessionId; void play(); }
}

/** Level and statistics always; the German text, translation and explanation only after the answer. */
function renderMeta(task: ItemExerciseTask | undefined, answered: boolean): void {
  const labels = listeningUiTranslations(language);
  const meta = $('meta'); const extra = $('extra'); const stats = $('stats');
  meta.textContent = ''; extra.replaceChildren(); stats.textContent = '';
  if (!task || !registry) return;
  const item = registry.getItem(SENTENCE_DATASET, task.target.itemId);
  const content = sentenceContent(item.content)!;
  meta.textContent = [fill(labels.level, { level: content.level }), item.id].join(' · ');
  if (answered) {
    const exercise = exerciseOf(task);
    const target = document.createElement('p'); target.className = 'dc-listening-target'; target.lang = 'de'; target.textContent = exercise.target;
    extra.append(target);
    if (exercise.translation) {
      const line = document.createElement('p'); line.className = 'dc-listening-translation'; line.lang = exercise.translation.lang;
      line.textContent = `${labels.translationHint}: ${exercise.translation.text}`; extra.append(line);
    }
    const others = (['ru', 'en', 'es'] as const).filter(lang => lang !== task.specification.answerLanguage && content.translations[lang]);
    if (others.length) {
      const details = document.createElement('details'); details.className = 'dc-translations';
      const summary = document.createElement('summary'); summary.textContent = labels.otherTranslations; details.append(summary);
      for (const lang of others) { const line = document.createElement('p'); line.lang = lang; line.textContent = `${lang.toUpperCase()}: ${content.translations[lang]}`; details.append(line); }
      extra.append(details);
    }
    if (content.explanation) {
      const node = document.createElement('p'); node.className = 'dc-explanation'; node.textContent = `${labels.explanation}: ${content.explanation}`; extra.append(node);
    }
    if (content.tags.length) { const tags = document.createElement('p'); tags.className = 'dc-sentence-meta'; tags.textContent = content.tags.map(formatTag).join(' · '); extra.append(tags); }
  }
  if (progress) {
    const exerciseId = task.exerciseId;
    const own = sentenceStats(progress, item.id, exerciseId);
    const all = poolStats(registry, progress, filter, exerciseId);
    stats.textContent = `${own ? fill(labels.stats, { answers: String(own.answers), independent: String(own.independent) }) : labels.statsNew} · ` +
      fill(labels.poolStats, { mode: exerciseId === EXERCISE.text ? labels.modeText : labels.modeTokens, attempted: String(all.attempted), total: String(all.total),
        accuracy: all.accuracy === null ? '—' : `${Math.round(all.accuracy * 100)}%` });
  }
}
function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

async function applyFilter(next: SentenceFilter): Promise<void> {
  filter = next; visited.length = 0;
  const hash = `#deck=${next.deck}`;
  if (location.hash !== hash) window.history.replaceState(null, '', hash);
  if (!dataset || !pool(dataset, filter).length) { failure = 'noData'; await leave().catch(() => {}); runner?.dispose(); runner = undefined; render(); return; }
  failure = undefined;
  if (currentItemId() && pool(dataset, filter).some(item => item.id === currentItemId())) { render(); return; }
  await goNext();
}

async function init(): Promise<void> {
  controls.language.value = language; controls.translation.value = translation; controls.autoPlay.checked = autoPlayOn();
  localize(); render();
  try {
    const response = await fetch(DATASET);
    if (!response.ok) throw new Error(`Dataset: ${response.status}`);
    dataset = await response.json() as ItemDataset;
    registry = createItemExerciseRegistry([dataset]);
    learning = await openLearningPage();
    scope = learning.store;
    await refreshProgress();
  } catch { failure = 'loadError'; render(); return; }
  // A reload continues the open listening session (the sentence builder and video keep their own).
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && isListening(s.state.plan.tasks[0]?.exerciseId) &&
    s.state.plan.datasets.some(d => d.datasetId === SENTENCE_DATASET) &&
    !['completed', 'abandoned'].includes(s.state.status)).sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  const openId = open?.state.plan.sessionId;
  const openTask = open && isItemSessionPlan(open.state.plan) ? open.state.plan.tasks[0] : undefined;
  const resumable = openTask && open.datasets?.[0]?.version === dataset.version && openTask.exerciseId === EXERCISE[mode] &&
    pool(dataset, filter).some(item => item.id === openTask.target.itemId);
  if (openId && resumable) {
    const resumed = await SessionRunner.open(scope, env, openId);
    if (resumed.view.phase === 'paused') await resumed.resume().catch(() => {});
    // A reload is not a new sentence: play only on request.
    autoPlayed = openId;
    attach(resumed); render();
  } else {
    if (openId) await SessionRunner.open(scope, env, openId).then(old => old.finish().finally(() => old.dispose())).catch(() => {});
    await applyFilter(filter);
  }
}

const signal = page.signal;
const guard = (action: () => Promise<void>) => () => { void action().catch(() => { render(); }); };
buttons.play.addEventListener('click', guard(play), { signal });
buttons.previous.addEventListener('click', guard(goPrevious), { signal });
buttons.tryAgain.addEventListener('click', guard(tryAgain), { signal });
buttons.retry.addEventListener('click', guard(async () => { await runner?.retry(); }), { signal });
modeButtons.tokens.addEventListener('click', guard(() => switchMode('tokens')), { signal });
modeButtons.text.addEventListener('click', guard(() => switchMode('text')), { signal });
controls.deck.addEventListener('change', guard(() => applyFilter({ deck: controls.deck.value })), { signal });
controls.language.addEventListener('change', () => {
  language = controls.language.value as Lang; store('dc_v2_lang', language); localize(); closeCard(); render();
}, { signal });
controls.translation.addEventListener('change', () => { translation = controls.translation.value as TranslationLanguage; store('dc_v2_sentence_translation', translation); }, { signal });
controls.autoPlay.addEventListener('change', () => store(AUTOPLAY_KEY, controls.autoPlay.checked ? '1' : '0'), { signal });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('.dc-tokens, select, input, textarea, summary, a')) return;
  const current = view();
  if (event.key === 'ArrowRight') { event.preventDefault(); guard(goNext)(); }
  else if (event.key === 'ArrowLeft' && visited.length) { event.preventDefault(); guard(goPrevious)(); }
  else if (event.key === 'Enter' && current?.phase === 'feedback' && target?.tagName !== 'BUTTON') {
    event.preventDefault();
    guard(goNext)();
  }
}, { signal });
// Leaving the page (or the tab) stops the sound at once.
window.addEventListener('pagehide', () => { unsubscribe?.(); runner?.dispose(); closeCard(); speech.dispose(); page.abort(); learning?.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void init();
