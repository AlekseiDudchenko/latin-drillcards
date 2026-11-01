import { createItemExerciseRegistry, isItemSessionPlan, KONJUNKTIV2_TRAINERS, konjunktiv2ExerciseId, planItemSession, projectExerciseProgress,
  type ItemDataset, type ItemExerciseRegistry, type ItemExerciseTask, type Konjunktiv2Mode, type Konjunktiv2Trainer } from '../../core/index.js';
import { assetUrl } from '../../../config.js';
import type { Lang } from '../../../i18n.js';
import type { CardInputState } from '../../card-inputs.js';
import { createCardShell } from '../../card-shell.js';
import { createCardSpeech } from '../../card-speech.js';
import { SessionRunner, type ItemRunnerView, type RunnerEnvironment } from '../../session-runner.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { tokenAnswerText } from '../../token-state.js';
import { fill, konjunktiv2UiTranslations } from './konjunktiv2-i18n.js';
import { exerciseOf, itemContent, itemStats, KONJUNKTIV2_DATASET, modeOf, nextItem, parseTrainer, textFromTokens, tokensFromText,
  trainerHash, trainerOfDataset, trainerStats } from './konjunktiv2-model.js';

// M5 (#337): the four Konjunktiv II trainers on one page, the shared Runner, journal and outbox.
// Each shown sentence is one single-task item session (as M1): Next/Previous/trainer switches complete
// an answered session or abandon an unanswered one, so nothing is lost or written twice. A mode switch
// before the answer restarts the same sentence with the same chip order in the other input and carries
// the draft across; after the answer it applies from the next sentence.
// Same owner's journal as session-page (learning-context), so all pages share one journal.
const PREFS = { mode: 'dc_v2_k2_mode', autoSpeak: 'auto_speak', language: 'dc_v2_lang' };
const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const controls = { trainer: $<HTMLSelectElement>('trainer'), language: $<HTMLSelectElement>('language'), autoSpeak: $<HTMLInputElement>('autoSpeak') };
const buttons = { previous: $<HTMLButtonElement>('previous'), tryAgain: $<HTMLButtonElement>('tryAgain'),
  retry: $<HTMLButtonElement>('retrySave') };
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'));
const page = new AbortController();
const speech = createCardSpeech();

let language: Lang = stored(PREFS.language, ['ru', 'en', 'de']) as Lang ?? 'ru';
let mode: Konjunktiv2Mode = stored(PREFS.mode, ['text', 'tokens']) as Konjunktiv2Mode ?? 'text';
let trainer: Konjunktiv2Trainer = parseTrainer(location.hash);
let learning: PageLearning | undefined;
let scope: PageLearning['store'] | undefined;
const datasets = new Map<Konjunktiv2Trainer, ItemDataset>();
let registry: ItemExerciseRegistry | undefined;
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: ReturnType<typeof createCardShell> | undefined;
let cardKey = '';
let failure: 'loadError' | 'noData' | undefined;
let modeNotice = false;
let busy = false;
/** Shown sentences of this visit (current trainer), for Previous: the item, its mode and the seed of its chip order. */
const visited: { readonly itemId: string; readonly mode: Konjunktiv2Mode; readonly seed: string }[] = [];
/** A draft carried into the next card by a mode switch. */
let carried: { readonly sessionId: string; readonly state: CardInputState } | undefined;
let progress: ReturnType<typeof projectExerciseProgress> | undefined;

function stored(key: string, allowed: readonly string[]): string | undefined {
  try { const value = localStorage.getItem(key); return value && allowed.includes(value) ? value : undefined; } catch { return undefined; }
}
function store(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
/** Retries are marked per session, so an answer after seeing the solution is never independent. */
const ASSISTED_KEY = 'dc_v2_k2_assisted';
function assistedSessions(): string[] {
  try { return JSON.parse(sessionStorage.getItem(ASSISTED_KEY) ?? '[]') as string[]; } catch { return []; }
}
function markAssisted(sessionId: string): void {
  try { sessionStorage.setItem(ASSISTED_KEY, JSON.stringify([...assistedSessions().slice(-50), sessionId])); } catch { /* best effort */ }
}
const autoSpeakOn = (): boolean => stored(PREFS.autoSpeak, ['0', '1']) === '1';

function view(): ItemRunnerView | undefined {
  const current = runner?.view;
  return current?.family === 'items' ? current : undefined;
}
const currentTask = (): ItemExerciseTask | undefined => view()?.task;
function currentItemId(): string | undefined { return view()?.plan.tasks[0]?.target.itemId; }

async function refreshProgress(): Promise<void> {
  if (!scope) return;
  const data = await scope.snapshot();
  progress = projectExerciseProgress(data.facts, { owner: scope.owner, ...scope.epoch, asOf: env.now() });
}

/** Leave the shown sentence: an answered one is completed, an unanswered one abandoned (no event). */
async function leave(): Promise<void> {
  const active = runner; const current = view();
  if (!active || !current) return;
  if (current.phase === 'feedback') await active.next();
  else if (current.phase === 'presenting' || current.phase === 'paused' || current.phase === 'ready') await active.finish();
}

async function show(itemId: string, options: { seed?: string; assisted?: boolean; remember?: boolean; mode?: Konjunktiv2Mode; draft?: CardInputState } = {}): Promise<void> {
  const dataset = datasets.get(trainer);
  if (!scope || !registry || !dataset || busy) return;
  busy = true; modeNotice = false; render();
  try {
    await leave();
    const shown = view();
    if (shown && options.remember !== false) visited.push({ itemId: shown.plan.tasks[0]!.target.itemId, mode: modeOf(shown.task ?? shown.plan.tasks[0]!), seed: shown.plan.seed });
    const sessionId = env.id(); const seed = options.seed ?? env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed, createdAt: env.now(),
      answerLanguage: 'ru', datasetId: dataset.id, items: [{ itemId, exerciseId: konjunktiv2ExerciseId(trainer, options.mode ?? mode) }] });
    if (options.assisted) markAssisted(sessionId);
    carried = options.draft ? { sessionId, state: options.draft } : undefined;
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 },
      catalogVersion: '', words: [], datasets: [dataset] }));
  } finally { busy = false; await refreshProgress().catch(() => {}); render(); }
}

function attach(next: SessionRunner): void {
  unsubscribe?.(); runner?.dispose();
  runner = next; unsubscribe = next.subscribe(() => render());
}

async function goNext(): Promise<void> {
  if (!registry || !progress || !datasets.has(trainer)) return;
  const id = nextItem(registry, progress, trainer, mode, currentItemId());
  if (id) await show(id); else { failure = 'noData'; render(); }
}
async function goPrevious(): Promise<void> {
  const previous = visited.pop();
  // A returned-to sentence was already seen with its solution: the new attempt is assisted.
  if (previous) await show(previous.itemId, { seed: previous.seed, mode: previous.mode, assisted: true, remember: false });
}
async function tryAgain(): Promise<void> {
  const current = view(); const task = currentTask();
  if (current && task) await show(task.target.itemId, { seed: current.plan.seed, mode: modeOf(task), assisted: true, remember: false });
}

/** Before the answer: the same sentence (same seed, so the same chips) in the other input, with the draft carried over. */
async function switchMode(next: Konjunktiv2Mode): Promise<void> {
  if (next === mode) return;
  mode = next; store(PREFS.mode, mode);
  const current = view(); const task = currentTask();
  if (!current || !task || !registry) { render(); return; }
  if (current.phase !== 'presenting') { modeNotice = current.phase === 'feedback'; render(); return; }
  if (modeOf(task) === mode) { render(); return; }
  const draft = card?.getState();
  const assisted = assistedSessions().includes(current.sessionId);
  // The target mode's chips: the same seed and item give the same order the other definition will build.
  const other = registry.buildTask(konjunktiv2ExerciseId(trainer, mode), task.target.datasetId, task.target.itemId,
    { taskId: 'preview', seed: current.plan.seed, answerLanguage: 'ru' });
  const tokens = exerciseOf(other).tokens ?? [];
  const source = exerciseOf(task).tokens ?? [];
  const value = !draft ? '' : draft.tokens ? textFromTokens(draft.tokens, source) : draft.value;
  const state: CardInputState | undefined = !value.trim() ? undefined : mode === 'tokens'
    ? (() => { const placed = tokensFromText(value, tokens); return { value: tokenAnswerText(tokens, placed), revealed: false, submitted: false, detailsOpen: false, tokens: placed }; })()
    : { value, revealed: false, submitted: false, detailsOpen: false };
  await show(task.target.itemId, { seed: current.plan.seed, mode, assisted, remember: false, ...(state ? { draft: state } : {}) });
}

function localize(): void {
  const labels = konjunktiv2UiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${labels.title}`;
  $('title').textContent = labels.title;
  $('languageLabel').textContent = labels.interfaceLanguage;
  $('trainerLabel').textContent = labels.trainer;
  $('modeLabel').textContent = labels.mode;
  $('modeText').textContent = labels.modes.text; $('modeTokens').textContent = labels.modes.tokens;
  $('autoSpeakLabel').textContent = labels.autoSpeak;
  $('keyboard').textContent = labels.keyboard;
  buttons.previous.textContent = labels.previous;
  buttons.tryAgain.textContent = labels.tryAgain; buttons.retry.textContent = labels.retrySave;
  controls.trainer.replaceChildren(...KONJUNKTIV2_TRAINERS.map(value => {
    const node = document.createElement('option'); node.value = value; node.textContent = labels.trainers[value]; return node;
  }));
  controls.trainer.value = trainer;
}

function titles(task: ItemExerciseTask): Record<Lang, string> {
  return Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, konjunktiv2UiTranslations(lang).tasks[trainerOfDataset(task.target.datasetId)!][modeOf(task)]])) as Record<Lang, string>;
}

function render(): void {
  const labels = konjunktiv2UiTranslations(language);
  const current = view();
  const notice = $('notice');
  notice.textContent = failure ? labels[failure] : current?.error === 'save' ? labels.saveError : modeNotice ? labels.modeLater : '';
  notice.setAttribute('role', failure === 'loadError' || current?.error ? 'alert' : 'status');
  const disabled = busy || !!current?.busy;
  Object.values(buttons).forEach(button => { button.disabled = disabled; });
  modeInputs.forEach(input => { input.checked = input.value === mode; input.disabled = disabled; });
  controls.trainer.disabled = disabled;
  buttons.retry.hidden = current?.error !== 'save';
  buttons.previous.disabled ||= visited.length === 0;
  const task = current?.task;
  const answered = current?.phase === 'feedback' && current.answer;
  buttons.tryAgain.hidden = !answered || current?.answer?.evaluation.outcome === 'correct';
  renderMeta(task, !!answered);
  if (!current || !task || !registry || (current.phase !== 'presenting' && current.phase !== 'feedback')) { closeCard(); return; }
  const exercise = exerciseOf(task); const content = itemContent(registry, task);
  const feedback = answered ? current.answer!.evaluation.outcome === 'correct'
    ? { kind: 'correct' as const, message: labels.correct } : { kind: 'incorrect' as const, message: fill(labels.wrong, { answer: exercise.answers[0]! }) } : undefined;
  // Speech would read the solution: it is offered only once the answer is saved.
  const presentation = { language, busy: disabled, permissions: { reveal: false, details: false, speech: !!answered }, ...(feedback ? { feedback } : {}) };
  const key = `${current.sessionId}|${current.phase}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  closeCard(); cardKey = key;
  const taskMode = modeOf(task);
  const tokens = (exercise.tokens ?? []).map(token => ({ id: token.id, text: token.text }));
  const raw = answered ? current.answer!.rawAnswer : undefined;
  let initial: CardInputState | undefined;
  if (answered && taskMode === 'tokens' && Array.isArray(raw)) {
    const placement = { answer: raw as string[], pool: tokens.map(t => t.id).filter(id => !(raw as string[]).includes(id)) };
    initial = { value: tokenAnswerText(tokens, placement), revealed: false, submitted: true, detailsOpen: false, tokens: placement };
  } else if (answered && typeof raw === 'string') initial = { value: raw, revealed: false, submitted: true, detailsOpen: false };
  else if (carried?.sessionId === current.sessionId) initial = carried.state;
  const active = runner!;
  const assisted = assistedSessions().includes(current.sessionId);
  card = createCardShell(host, { id: task.id, title: titles(task), prompt: { text: exercise.template, lang: 'de' },
    input: taskMode === 'tokens' ? { kind: 'tokens', answerLang: 'de', tokens, autoSubmit: false } : { kind: 'text', answerLang: 'de' },
    translationLanguage: task.specification.answerLanguage, speechText: content.solution }, presentation, {
    async onSubmit(answer) {
      const result = await active.submit(taskMode === 'tokens' ? [...(answer.tokens ?? [])] : answer.value, { assisted });
      if (result === 'conflict') throw new Error('Session changed elsewhere');
      carried = undefined;
      await refreshProgress().catch(() => {}); render();
      if (active.view.answer?.evaluation.outcome === 'correct' && autoSpeakOn()) void speech.speak(content.solution);
    },
    onNext: goNext,
    onReveal() {}, onSpeech() {},
  }, initial);
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
  else if (taskMode === 'text' && (document.activeElement === document.body || !document.activeElement)) host.querySelector<HTMLInputElement>('input[type=text]')?.focus();
}

function renderMeta(task: ItemExerciseTask | undefined, answered: boolean): void {
  const labels = konjunktiv2UiTranslations(language);
  const meta = $('meta'); const extra = $('extra'); const stats = $('stats');
  meta.textContent = ''; extra.replaceChildren(); stats.replaceChildren();
  if (!registry || !progress) return;
  if (task) {
    const content = itemContent(registry, task);
    meta.textContent = `${labels.trainers[trainer]} · #${task.target.itemId}`;
    // v1 showed the hint with the feedback; the other accepted answers are shown with it.
    if (answered) {
      const hint = document.createElement('p'); hint.className = 'dc-k2-hint'; hint.lang = 'de'; hint.textContent = fill(labels.hint, { hint: content.hint });
      extra.append(hint);
      if (content.answers.length > 1) {
        const others = document.createElement('p'); others.className = 'dc-k2-alternatives';
        others.textContent = fill(labels.alternatives, { forms: content.answers.slice(1).join(' · ') }); extra.append(others);
      }
    }
    const own = itemStats(progress, trainer, task.target.itemId);
    const line = document.createElement('p'); line.id = 'itemStats';
    line.textContent = own ? fill(labels.itemStats, { answers: String(own.answers), independent: String(own.independent) }) : labels.itemNew;
    stats.append(line);
  }
  if (!datasets.has(trainer)) return;
  const summary = trainerStats(registry, progress, trainer);
  const list = document.createElement('ul'); list.id = 'trainerStats';
  for (const key of ['text', 'tokens'] as const) {
    const row = summary[key]; const item = document.createElement('li'); item.dataset.mode = key; item.dataset.attempted = String(row.attempted);
    item.textContent = fill(row.accuracy === null ? labels.trainerStatsNone : labels.trainerStats, { mode: labels.modes[key],
      attempted: String(row.attempted), total: String(row.applicable), accuracy: row.accuracy === null ? '—' : `${Math.round(row.accuracy * 100)}%` });
    list.append(item);
  }
  stats.append(list);
}
function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

async function applyTrainer(next: Konjunktiv2Trainer): Promise<void> {
  trainer = next; visited.length = 0; controls.trainer.value = trainer;
  if (location.hash !== trainerHash(trainer)) window.history.replaceState(null, '', trainerHash(trainer));
  if (!datasets.get(trainer)?.items.length) { failure = 'noData'; await leave().catch(() => {}); runner?.dispose(); runner = undefined; render(); return; }
  failure = undefined;
  if (currentTask()?.target.datasetId === KONJUNKTIV2_DATASET[trainer]) { render(); return; }
  await goNext();
}

async function init(): Promise<void> {
  controls.language.value = language; controls.autoSpeak.checked = autoSpeakOn();
  localize();
  try {
    await Promise.all(KONJUNKTIV2_TRAINERS.map(async key => {
      const response = await fetch(assetUrl(`data/items/${KONJUNKTIV2_DATASET[key]}.json`));
      if (!response.ok) throw new Error(`Dataset: ${response.status}`);
      datasets.set(key, await response.json() as ItemDataset);
    }));
    registry = createItemExerciseRegistry([...datasets.values()]);
    learning = await openLearningPage();
    scope = learning.store;
    await refreshProgress();
  } catch { failure = 'loadError'; render(); return; }
  // A reload continues the sentence that was shown in this trainer: its session is still open in storage.
  const data = await scope.snapshot();
  const ids = new Set(Object.values(KONJUNKTIV2_DATASET));
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && s.state.plan.datasets.some(d => ids.has(d.datasetId)) &&
    !['completed', 'abandoned'].includes(s.state.status)).sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  const openId = open?.state.plan.sessionId;
  const openDataset = open?.datasets?.[0];
  const resumable = openDataset && openDataset.id === KONJUNKTIV2_DATASET[trainer] && openDataset.version === datasets.get(trainer)?.version;
  if (openId && resumable) {
    const resumed = await SessionRunner.open(scope, env, openId);
    if (resumed.view.phase === 'paused') await resumed.resume().catch(() => {});
    attach(resumed);
    const task = currentTask(); if (task) mode = modeOf(task);
    if (location.hash !== trainerHash(trainer)) window.history.replaceState(null, '', trainerHash(trainer));
    render();
  } else {
    if (openId) await SessionRunner.open(scope, env, openId).then(old => old.finish().finally(() => old.dispose())).catch(() => {});
    await applyTrainer(trainer);
  }
}

const signal = page.signal;
const guard = (action: () => Promise<void>) => () => { void action().catch(() => { render(); }); };
buttons.previous.addEventListener('click', guard(goPrevious), { signal });
buttons.tryAgain.addEventListener('click', guard(tryAgain), { signal });
buttons.retry.addEventListener('click', guard(async () => { await runner?.retry(); }), { signal });
controls.trainer.addEventListener('change', guard(() => applyTrainer(controls.trainer.value as Konjunktiv2Trainer)), { signal });
modeInputs.forEach(input => input.addEventListener('change', guard(() => switchMode(input.value as Konjunktiv2Mode)), { signal }));
controls.language.addEventListener('change', () => {
  language = controls.language.value as Lang; store(PREFS.language, language); localize(); render();
}, { signal });
controls.autoSpeak.addEventListener('change', () => store(PREFS.autoSpeak, controls.autoSpeak.checked ? '1' : '0'), { signal });
window.addEventListener('hashchange', () => { const next = parseTrainer(location.hash); if (next !== trainer) guard(() => applyTrainer(next))(); }, { signal });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  // Token buttons use the arrows and Enter themselves; form fields keep their own keys.
  if (target?.closest('.dc-tokens, select, input, textarea, summary')) return;
  const current = view();
  if (event.key === 'ArrowRight') { event.preventDefault(); guard(goNext)(); }
  else if (event.key === 'ArrowLeft' && visited.length) { event.preventDefault(); guard(goPrevious)(); }
  else if (event.key === 'Enter' && current?.phase === 'feedback' && target?.tagName !== 'BUTTON') {
    event.preventDefault();
    guard(goNext)();
  }
}, { signal });
window.addEventListener('pagehide', () => { unsubscribe?.(); runner?.dispose(); closeCard(); speech.dispose(); page.abort(); learning?.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void init();
