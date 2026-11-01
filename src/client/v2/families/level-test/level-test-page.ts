import { createItemExerciseRegistry, LEVEL_TEST_DATASET, levelTestContent, planItemSession, planLevelTest, type ItemDataset,
  type ItemExerciseRegistry, type LevelTestExercise, type TranslationLanguage } from '../../core/index.js';
import { sessionUiTranslations, type Lang } from '../../../i18n.js';
import { assetUrl } from '../../../config.js';
import { createCardShell } from '../../card-shell.js';
import { SessionRunner, type ItemRunnerView, type RunnerEnvironment } from '../../session-runner.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { fill, levelTestUiTranslations } from './level-test-i18n.js';
import { isLevelTestPlan, latestLevelResult, levelTestRuns, progressOf, stepAfterAnswer, type LevelTestRun } from './level-test-model.js';

// M8 (#340): the level test on the shared choice card, Runner, journal and outbox. One run is one
// item session with every block planned; the policy (core families/level-test.ts) decides when it
// ends. Answers are assessment events: projectAssessments scores them, WordProgress never sees them.
// Same owner's journal as session-page (learning-context), so the home screen reads the same journal.
const TRANSLATION_KEY = 'dc_v2_level_test_translation';
const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const sections = { intro: $<HTMLElement>('intro'), test: $<HTMLElement>('test'), result: $<HTMLElement>('result') };
const host = $<HTMLDivElement>('card');
const buttons = { start: $<HTMLButtonElement>('start'), stop: $<HTMLButtonElement>('stop'),
  retry: $<HTMLButtonElement>('retrySave'), retake: $<HTMLButtonElement>('retake') };
const controls = { language: $<HTMLSelectElement>('language'), translation: $<HTMLSelectElement>('translation') };
const page = new AbortController();

let language: Lang = stored('dc_v2_lang', ['ru', 'en', 'de']) as Lang ?? 'ru';
let translation: TranslationLanguage = stored(TRANSLATION_KEY, ['ru', 'en']) as TranslationLanguage ?? 'ru';
let learning: PageLearning | undefined;
let scope: PageLearning['store'] | undefined;
let dataset: ItemDataset | undefined;
let registry: ItemExerciseRegistry | undefined;
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: ReturnType<typeof createCardShell> | undefined;
let cardKey = '';
let runs: LevelTestRun[] = [];
/** The run whose result is on screen after it ended. */
let shownResult: string | undefined;
let failure: 'loadError' | undefined;
let busy = false;

function stored(key: string, allowed: readonly string[]): string | undefined {
  try { const value = localStorage.getItem(key); return value && allowed.includes(value) ? value : undefined; } catch { return undefined; }
}
function store(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
function view(): ItemRunnerView | undefined {
  const current = runner?.view;
  return current?.family === 'items' ? current : undefined;
}
const runOf = (sessionId: string | undefined): LevelTestRun | undefined => runs.find(run => run.sessionId === sessionId);

async function refreshRuns(): Promise<void> {
  if (!scope) return;
  const data = await scope.snapshot();
  runs = levelTestRuns(data, { owner: scope.owner, ...scope.epoch, asOf: env.now() });
}

/** Next question, or the end of the run: the policy may skip the remaining blocks (early finish). */
async function advance(): Promise<void> {
  const active = runner; const current = view();
  if (!active || !current || current.phase !== 'feedback' || busy || current.busy) return;
  busy = true; render();
  try {
    await refreshRuns();
    const run = runOf(current.sessionId);
    const step = run ? stepAfterAnswer(run.score, current.taskIndex, current.total) : 'next';
    if (step === 'finish') await active.finish(); else await active.next();
  } finally {
    busy = false; await refreshRuns().catch(() => {});
    const now = view();
    if (now && (now.phase === 'completed' || now.phase === 'abandoned')) shownResult = now.sessionId;
    render();
  }
}

function attach(next: SessionRunner): void {
  unsubscribe?.(); runner?.dispose();
  runner = next; unsubscribe = next.subscribe(() => render());
}
function detach(): void { closeCard(); unsubscribe?.(); runner?.dispose(); runner = undefined; unsubscribe = undefined; }

async function start(): Promise<void> {
  if (!scope || !registry || !dataset || busy) return;
  busy = true; render();
  try {
    await stopOpen();
    const sessionId = env.id(); const seed = env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed, createdAt: env.now(),
      answerLanguage: translation, datasetId: LEVEL_TEST_DATASET, items: planLevelTest(dataset, seed) });
    shownResult = undefined;
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 },
      catalogVersion: '', words: [], datasets: [dataset] }));
  } finally { busy = false; await refreshRuns().catch(() => {}); render(); }
}

/** Stop the open run: its answers stay in the journal, the run has no estimate. */
async function stopOpen(): Promise<void> {
  const active = runner; const current = view();
  if (active && current && current.phase !== 'completed' && current.phase !== 'abandoned') await active.finish();
  detach();
}
async function stop(): Promise<void> {
  if (busy) return;
  busy = true; render();
  const sessionId = view()?.sessionId;
  try { await stopOpen(); shownResult = sessionId; } finally { busy = false; await refreshRuns().catch(() => {}); render(); }
}

function localize(): void {
  const text = levelTestUiTranslations(language); const session = sessionUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${text.title}`;
  $('title').textContent = text.title; $('languageLabel').textContent = session.interfaceLanguage;
  $('translationLabel').textContent = text.translation; $('intro-text').textContent = text.intro;
  $('notProgress').textContent = text.notProgress; $('keyboard').textContent = text.keyboard;
  $('resultTitle').textContent = text.resultTitle;
  buttons.start.textContent = text.start; buttons.stop.textContent = text.stop;
  buttons.retry.textContent = session.retry; buttons.retake.textContent = text.retake;
}

function show(name: keyof typeof sections): void {
  for (const [key, section] of Object.entries(sections)) section.hidden = key !== name;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}

function render(): void {
  const text = levelTestUiTranslations(language); const session = sessionUiTranslations(language);
  const current = view();
  const notice = $('notice');
  notice.textContent = failure ? text.loadError : current?.error === 'save' ? session.saveError : current?.error === 'conflict' ? session.conflict : '';
  notice.setAttribute('role', failure || current?.error ? 'alert' : 'status');
  const disabled = busy || !!current?.busy;
  Object.values(buttons).forEach(button => { button.disabled = disabled || !!failure; });
  buttons.retry.hidden = current?.error !== 'save';
  if (current && (current.phase === 'presenting' || current.phase === 'feedback' || current.phase === 'paused' || current.phase === 'ready')) {
    renderTest(current, disabled); return;
  }
  closeCard();
  const ended = runOf(shownResult);
  if (ended) { renderResult(ended); return; }
  renderIntro();
}

function renderIntro(): void {
  const text = levelTestUiTranslations(language);
  show('intro');
  const last = runs[runs.length - 1]; const result = latestLevelResult(runs);
  const lines: string[] = [];
  if (result?.score.estimate) lines.push(fill(text.lastResult, { level: result.score.estimate.level.toUpperCase(),
    date: formatDate(result.lastAnsweredAt ?? result.createdAt) }));
  if (last && last.score.status !== 'concluded' && last.lastAnsweredAt) lines.push(text.incomplete);
  $('lastResult').textContent = lines.join(' ');
}

function renderTest(current: ItemRunnerView, disabled: boolean): void {
  const text = levelTestUiTranslations(language);
  show('test');
  const task = current.task;
  const run = runOf(current.sessionId);
  const { n, max } = run ? progressOf(run.score, current.taskIndex, current.total) : { n: current.taskIndex + 1, max: current.total };
  const exercise = task?.specification.exercise as unknown as LevelTestExercise | undefined;
  $('progress').textContent = `${fill(text.progress, { n: String(n), max: String(max) })} · ${fill(text.level, { level: exercise?.level.toUpperCase() ?? '' })}`;
  const answered = current.phase === 'feedback' && current.answer;
  if (!task || !exercise || !registry || (current.phase !== 'presenting' && current.phase !== 'feedback')) { closeCard(); return; }
  const content = levelTestContent(registry.getItem(LEVEL_TEST_DATASET, task.target.itemId).content)!;
  const label = (id: string): string => content.options.find(option => option.id === id)![translation];
  const feedback = answered ? current.answer!.evaluation.outcome === 'correct' ? { kind: 'correct' as const, message: text.correct }
    : { kind: 'incorrect' as const, message: fill(text.wrong, { answer: label(content.correctOptionId) }) } : undefined;
  const presentation = { language, busy: disabled, permissions: { reveal: false, details: false, speech: false }, ...(feedback ? { feedback } : {}) };
  // Option labels follow the chosen translation language as in v1; option IDs, and so the answer, do not change.
  const key = `${current.sessionId}|${current.taskIndex}|${current.phase}|${translation}`;
  if (card && key === cardKey) { card.setPresentation(presentation); if (!answered) focusQuestion(disabled); return; }
  const draft = card && cardKey.startsWith(`${current.sessionId}|${current.taskIndex}|presenting|`) ? card.getState().value : '';
  closeCard(); cardKey = key;
  const active = runner!;
  const raw = answered && typeof current.answer!.rawAnswer === 'string' ? current.answer!.rawAnswer : undefined;
  card = createCardShell(host, { id: task.id, title: { en: levelTestUiTranslations('en').pick, ru: levelTestUiTranslations('ru').pick, de: levelTestUiTranslations('de').pick },
    prompt: exercise.prompt, input: { kind: 'choice', answerLang: translation, options: exercise.options.map(option => ({ id: option.id, label: label(option.id) })) },
    translationLanguage: translation }, presentation, {
    async onSubmit(answer) {
      const result = await active.submit(answer.value);
      if (result === 'conflict') throw new Error('Session changed elsewhere');
      await refreshRuns().catch(() => {}); render();
    },
    onNext: advance,
    onReveal() {}, onSpeech() {},
  }, raw ? { value: raw, revealed: false, submitted: true, detailsOpen: false } : draft ? { value: draft, revealed: false, submitted: false, detailsOpen: false } : undefined);
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus(); else focusQuestion(disabled);
}
/** A new question takes the focus when it was lost (Start, Next or Retake just hid, or the page itself),
 * so 1–4 and Enter work at once; a control the user is on keeps it. */
function focusQuestion(disabled: boolean): void {
  const active = document.activeElement as HTMLElement | null;
  if (disabled || (active && active !== document.body && !active.closest('[hidden]'))) return;
  host.querySelector<HTMLInputElement>('input[type=radio]')?.focus();
}

function renderResult(run: LevelTestRun): void {
  const text = levelTestUiTranslations(language);
  show('result');
  const estimate = run.score.estimate;
  $('resultLevel').textContent = estimate ? fill(text.resultLevel, { level: estimate.level.toUpperCase() }) : text.incomplete;
  $('resultNote').textContent = run.score.status === 'concluded' && run.score.skipped ? text.stoppedEarly : '';
  const rows = $('resultBlocks'); rows.replaceChildren();
  for (const block of run.score.blocks) {
    const row = document.createElement('li'); row.className = 'dc-level-block'; row.dataset.level = block.level;
    row.dataset.passed = String(block.passed);
    const badge = document.createElement('span'); badge.className = 'dc-level-badge'; badge.textContent = block.level.toUpperCase();
    const bar = document.createElement('progress'); bar.max = block.total; bar.value = block.correct;
    bar.setAttribute('aria-label', block.level.toUpperCase());
    const score = document.createElement('span');
    score.textContent = `${fill(text.blockLine, { correct: String(block.correct), total: String(block.total) })}` +
      (block.passed === null ? '' : ` · ${block.passed ? text.passed : text.failed}`);
    row.append(badge, bar, score); rows.append(row);
  }
  const link = $<HTMLAnchorElement>('startWith');
  link.hidden = !estimate;
  if (estimate) { link.textContent = fill(text.startWith, { level: estimate.start.toUpperCase() }); link.href = `./session.html#deck=${estimate.start}`; }
}
function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

async function init(): Promise<void> {
  controls.language.value = language; controls.translation.value = translation;
  localize(); render();
  try {
    const response = await fetch(assetUrl('data/items/level-test.json'));
    if (!response.ok) throw new Error(`Dataset: ${response.status}`);
    dataset = await response.json() as ItemDataset;
    registry = createItemExerciseRegistry([dataset]);
    learning = await openLearningPage();
    scope = learning.store;
    await refreshRuns();
  } catch { failure = 'loadError'; render(); return; }
  // A reload continues the open run on the question it was on; a stored answer is never asked again.
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isLevelTestPlan(s.state.plan) && !['completed', 'abandoned'].includes(s.state.status))
    .sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  if (open && open.datasets?.[0]?.version === dataset.version) {
    const resumed = await SessionRunner.open(scope, env, open.state.plan.sessionId);
    if (resumed.view.phase === 'paused') await resumed.resume().catch(() => {});
    attach(resumed);
  } else if (open) {
    // The dataset was republished: the old run cannot be rebuilt against it, so it ends without a result.
    await SessionRunner.open(scope, env, open.state.plan.sessionId).then(old => old.finish().finally(() => old.dispose())).catch(() => {});
    await refreshRuns().catch(() => {});
  }
  render();
}

const signal = page.signal;
const guard = (action: () => Promise<void>) => () => { void action().catch(() => { busy = false; render(); }); };
buttons.start.addEventListener('click', guard(start), { signal });
buttons.retake.addEventListener('click', guard(start), { signal });
buttons.stop.addEventListener('click', guard(stop), { signal });
buttons.retry.addEventListener('click', guard(async () => { await runner?.retry(); await refreshRuns(); render(); }), { signal });
controls.language.addEventListener('change', () => {
  language = controls.language.value as Lang; store('dc_v2_lang', language); localize(); render();
}, { signal });
controls.translation.addEventListener('change', () => {
  translation = controls.translation.value as TranslationLanguage; store(TRANSLATION_KEY, translation); render();
}, { signal });
// Release the active card and runner; the stored answer stays.
window.addEventListener('pagehide', () => { detach(); page.abort(); learning?.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void init();
