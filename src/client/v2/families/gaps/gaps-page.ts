import { createItemExerciseRegistry, isItemSessionPlan, planItemSession, sessionTasks, type ItemDataset,
  type ItemExerciseRegistry, type ItemExerciseTask, type ItemSessionSummary, type PassivTense, type TranslationLanguage } from '../../core/index.js';
import { cardUiTranslations, sessionUiTranslations, type Lang } from '../../../i18n.js';
import { assetUrl } from '../../../config.js';
import { createClozeCard } from '../../cloze-input.js';
import { createCardSpeech, type SpeechResult } from '../../card-speech.js';
import { SessionRunner, type CommandResult, type ItemRunnerView, type RunnerEnvironment, type RunnerView } from '../../session-runner.js';
import type { StoredFact } from '../../storage/learning-db.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { answerText, clozeDefinition, familyOf, familyStats, GAP_EXERCISE, GAP_FAMILIES, itemContent, planGapItems, slotResults,
  solvedSentence, tenseVariants, values, type GapFamily, type GapMode } from './gaps-model.js';
import { fill, gapsUiTranslations } from './gaps-i18n.js';

// M3 (#335): FC05/FC06 on the shared Runner, store and ClozeInput. Same owner's journal as
// the vocabulary session page (learning-context).
const PREFS = { family: 'dc_v2_gap_family', mode: 'dc_v2_gap_mode', autoSpeak: 'dc_v2_auto_speak', translation: 'dc_v2_gap_translation_' };

const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const notice = $<HTMLParagraphElement>('notice');
const buttons = { previous: $<HTMLButtonElement>('previous'), forward: $<HTMLButtonElement>('forward'),
  retry: $<HTMLButtonElement>('retry'), pause: $<HTMLButtonElement>('pause'), resume: $<HTMLButtonElement>('resume'),
  finish: $<HTMLButtonElement>('finish'), new: $<HTMLButtonElement>('new') };
const speech = createCardSpeech();
let language: Lang = 'ru';
let learning: PageLearning | undefined;
let scope: PageLearning['store'] | undefined;
let registry: ItemExerciseRegistry | undefined;
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: ReturnType<typeof createClozeCard> | undefined;
let cardKey = '';
let message: 'saveError' | 'conflict' | 'loadError' | undefined;
let openSession: { readonly id: string; readonly family: GapFamily; readonly taskIndex: number; readonly total: number } | undefined;
/** Hints opened in this page (showing the answer is not an event: these tasks have no reveal input). */
const hints = new Set<string>();
/** Previous: a read-only view of an earlier task of the running session with its saved answer. */
let review: { readonly index: number; readonly facts: readonly StoredFact[] } | undefined;
let spokenKey = '';

function pref(key: string, fallback: string): string { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function setPref(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preferences are optional */ } }
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const selectedFamily = (): GapFamily => $<HTMLSelectElement>('family').value as GapFamily;
const selectedMode = (): GapMode => (document.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'select') as GapMode;
const context = () => ({ owner: scope!.owner, dataEpoch: scope!.epoch.dataEpoch, epochStartedAt: scope!.epoch.epochStartedAt, asOf: env.now() });
const own = (datasetId: string | undefined) => !!datasetId && !!familyOf(datasetId);

async function loadDataset(family: GapFamily): Promise<ItemDataset> {
  const response = await fetch(assetUrl(`data/items/${GAP_FAMILIES[family].file}`));
  if (!response.ok) throw new Error(`Dataset ${family}: ${response.status}`);
  return response.json() as Promise<ItemDataset>;
}

function localize(): void {
  const text = gapsUiTranslations(language); const session = sessionUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${text.title}`;
  $('title').textContent = text.title; $('languageLabel').textContent = session.interfaceLanguage;
  $('familyLabel').textContent = text.family; $('modeLabel').textContent = text.mode;
  $('modeSelect').textContent = text.modes.select; $('modeType').textContent = text.modes.type;
  $('tenseLabel').textContent = text.tense; $('translationLabel').textContent = session.translation;
  $<HTMLSelectElement>('tense').options[0]!.textContent = text.allTenses;
  for (const option of Array.from($<HTMLSelectElement>('family').options)) option.textContent = text.families[option.value as GapFamily];
  $('start').textContent = text.start; $('empty').textContent = text.empty; $('statsTitle').textContent = text.statsTitle;
  $('continueTitle').textContent = text.continueTitle; $('continueAction').textContent = text.continue; $('continueFinish').textContent = session.finish;
  $('hint').textContent = text.hint; $('listen').textContent = text.listen; $('autoSpeakLabel').textContent = text.autoSpeak;
  $('explanationTitle').textContent = text.explanationTitle; $('variantsTitle').textContent = text.variantsTitle;
  buttons.previous.textContent = text.previous; buttons.forward.textContent = text.backToCurrent;
  for (const name of ['retry', 'pause', 'resume', 'finish'] as const) buttons[name].textContent = session[name];
  buttons.new.textContent = text.start;
}

function noticeText(view?: RunnerView): string {
  const session = sessionUiTranslations(language);
  if (view?.error === 'save') return session.saveError;
  if (view?.error === 'conflict') return session.conflict;
  if (view?.phase === 'paused') return session.paused;
  if (view?.phase === 'completed') return session.completed;
  if (view?.phase === 'abandoned') return session.abandoned;
  return message ? session[message] : '';
}

/** Setup screen: per-family statistics from the same journal (one row per mode). */
async function renderSetup(): Promise<void> {
  const family = selectedFamily();
  $('tenseField').hidden = family !== 'passiv'; $('translationField').hidden = family !== 'passiv';
  $('empty').hidden = true;
  const list = $<HTMLUListElement>('statsList');
  if (!scope || !registry) return;
  const data = await scope.snapshot();
  const text = gapsUiTranslations(language);
  const stats = familyStats(registry, family, data.facts, context());
  list.replaceChildren(...(['select', 'type'] as const).map(mode => {
    const row = stats[mode];
    const line = node('li', fill(row.accuracy === null ? text.statsLineNone : text.statsLine, { mode: text.modes[mode], attempted: String(row.attempted),
      applicable: String(row.applicable), accuracy: `${Math.round((row.accuracy ?? 0) * 100)}%` }));
    line.dataset.mode = mode; line.dataset.attempted = String(row.attempted); return line;
  }));
}

function renderContinue(): void {
  const panel = $('continue');
  panel.hidden = !openSession || !!runner;
  if (panel.hidden) return;
  const text = gapsUiTranslations(language);
  $('continueLine').textContent = fill(text.continueLine, { family: text.families[openSession!.family],
    n: String(Math.min(openSession!.taskIndex + 1, openSession!.total)), total: String(openSession!.total) });
}

async function refresh(): Promise<void> {
  if (!scope) return;
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && own(s.state.plan.datasets[0]?.datasetId) &&
    s.state.status !== 'completed' && s.state.status !== 'abandoned').sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  openSession = open && isItemSessionPlan(open.state.plan) ? { id: open.state.plan.sessionId, family: familyOf(open.state.plan.datasets[0]!.datasetId)!,
    taskIndex: open.state.taskIndex, total: sessionTasks(open.state).length } : undefined;
  renderContinue();
  $('setup').hidden = !!runner;
  $<HTMLButtonElement>('start').disabled = !!openSession;
  await renderSetup();
}

function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

function renderTranslations(task: ItemExerciseTask | undefined, family: GapFamily | undefined): void {
  const box = $('translations');
  const content = task && registry ? itemContent(registry, task) : undefined;
  if (!content?.translations || family !== 'passiv') { box.replaceChildren(); return; }
  const primary = task!.specification.answerLanguage;
  const extra = (['ru', 'en'] as TranslationLanguage[]).filter(lang => lang !== primary);
  const text = gapsUiTranslations(language);
  box.replaceChildren(...extra.flatMap(lang => {
    const shown = pref(PREFS.translation + lang, '0') === '1';
    const toggle = node('button', fill(text.translation, { lang: lang.toUpperCase() }), 'dc-gaps-toggle'); toggle.type = 'button';
    toggle.dataset.translation = lang; toggle.setAttribute('aria-pressed', String(shown));
    toggle.addEventListener('click', () => { setPref(PREFS.translation + lang, shown ? '0' : '1'); renderTranslations(task, family); });
    const line = node('p', content.translations![lang], 'dc-gaps-translation'); line.lang = lang; line.hidden = !shown; line.dataset.translation = lang;
    return [toggle, line];
  }));
}

function speechMessage(result: SpeechResult): string {
  const labels = cardUiTranslations(language);
  return result === 'unavailable' ? labels.ttsUnavailable : result === 'no-german-voice' ? labels.ttsNoGermanVoice : result === 'failed' ? labels.ttsFailed : '';
}
function speak(sentence: string): void {
  const status = $('speechStatus'); status.textContent = '';
  void speech.speak(sentence).then(result => { if (cardKey) status.textContent = speechMessage(result); });
}

function renderAfter(task: ItemExerciseTask, family: GapFamily, correct: boolean | undefined, past: boolean): void {
  const after = $('after');
  after.hidden = correct === undefined;
  if (correct === undefined || !registry) return;
  const text = gapsUiTranslations(language);
  const content = itemContent(registry, task);
  const hint = hints.has(task.id) || past;
  $('hint').hidden = correct || hint;
  $('hintAnswer').hidden = correct || !hint;
  $('hintAnswer').textContent = fill(text.hintAnswer, { answer: answerText(content) });
  $('explanationText').textContent = family === 'passiv' && content.tense ? text.passivRules[content.tense] : text.relativeRule;
  $<HTMLInputElement>('autoSpeak').checked = pref(PREFS.autoSpeak, '0') === '1';
}

function renderVariants(task: ItemExerciseTask | undefined, answered: boolean): void {
  const section = $('variants');
  const dataset = task && registry ? registry.dataset(task.target.datasetId, task.specification.datasetVersion) : undefined;
  const variants = dataset ? tenseVariants(dataset, task!.target.itemId) : [];
  section.hidden = variants.length < 2;
  if (section.hidden) return;
  const text = gapsUiTranslations(language);
  const lang = task!.specification.answerLanguage;
  $('variantList').replaceChildren(...variants.map(variant => {
    const current = variant.itemId === task!.target.itemId;
    const item = node('li'); item.dataset.itemId = variant.itemId;
    const tense = node('strong', variant.tense); tense.lang = 'de'; item.append(tense);
    if (current) { item.setAttribute('aria-current', 'true'); item.append(` · ${text.variantCurrent}`); }
    // The solved sentences would give the answer away, so they appear once this task is answered.
    if (answered) {
      const sentence = node('span', ` — ${solvedSentence(variant.content)}`); sentence.lang = 'de'; item.append(sentence);
      if (variant.content.translations) { const tr = node('small', ` (${variant.content.translations[lang]})`); tr.lang = lang; item.append(tr); }
    }
    return item;
  }));
}

function renderSummary(summary: ItemSessionSummary | undefined, view: ItemRunnerView | undefined): void {
  const section = $('summary');
  section.hidden = !summary || !view || !registry;
  if (section.hidden) { section.replaceChildren(); return; }
  const text = gapsUiTranslations(language); const session = sessionUiTranslations(language);
  const list = node('ol');
  for (const entry of summary!.tasks) {
    const task = view!.plan.tasks.find(candidate => candidate.id === entry.taskId)!;
    const line = node('li'); line.dataset.result = entry.outcome ?? 'unanswered';
    const sentence = node('span', solvedSentence(itemContent(registry!, task))); sentence.lang = 'de';
    line.append(sentence, ` — ${entry.outcome === 'correct' ? session.resultCorrect : entry.outcome === 'incorrect' ? session.resultIncorrect : text.unanswered}`);
    list.append(line);
  }
  section.replaceChildren(node('h2', text.summaryTitle), node('p', fill(text.summaryLine, { correct: String(summary!.correct), total: String(summary!.tasks.length) })), list);
  section.querySelector('h2')!.id = 'summaryTitle';
}

function render(input?: RunnerView): void {
  const view = input?.family === 'items' ? input : undefined;
  const session = sessionUiTranslations(language); const text = gapsUiTranslations(language);
  const terminal = view?.phase === 'completed' || view?.phase === 'abandoned';
  $('session').hidden = !view;
  notice.textContent = noticeText(view);
  notice.setAttribute('role', view?.error || message === 'loadError' ? 'alert' : 'status');
  if (!view) { closeCard(); return; }
  if (review && (terminal || review.index >= view.taskIndex)) review = undefined;
  const reviewing = review !== undefined;
  const index = review?.index ?? view.taskIndex;
  $('progress').textContent = terminal ? '' : fill(session.progress, { n: String(index + 1), total: String(view.total) });
  $('reviewing').hidden = !reviewing; $('reviewing').textContent = reviewing ? fill(text.reviewing, { n: String(index + 1) }) : '';
  renderSummary(view.summary as ItemSessionSummary | undefined, view);
  const busy = view.busy;
  buttons.previous.hidden = terminal || view.phase === 'paused' || index === 0;
  buttons.forward.hidden = !reviewing;
  buttons.retry.hidden = view.error !== 'save';
  buttons.pause.hidden = reviewing || (view.phase !== 'presenting' && view.phase !== 'feedback');
  buttons.resume.hidden = view.phase !== 'paused';
  buttons.finish.hidden = terminal;
  buttons.new.hidden = !terminal;
  Object.values(buttons).forEach(button => { button.disabled = busy; });
  const task = reviewing ? view.plan.tasks[index] : view.task;
  const family = task ? familyOf(task.target.datasetId) : undefined;
  if (!task || !family || terminal || view.phase === 'paused' || view.phase === 'ready' || !registry) {
    closeCard(); $('after').hidden = true; $('variants').hidden = true; $('tenseBadge').hidden = true; renderTranslations(undefined, undefined); return;
  }
  const content = itemContent(registry, task);
  $('tenseBadge').hidden = !content.tense; $('tenseBadge').textContent = content.tense ?? '';
  renderTranslations(task, family);
  // The answer shown is always the stored one: the live task's from the Runner, an earlier task's from the journal.
  const stored = reviewing ? review!.facts.find(f => f.event.taskId === task.id && f.event.kind === 'answer') : undefined;
  const raw = reviewing ? (stored?.event.kind === 'answer' ? stored.event.rawAnswer : undefined) : view.phase === 'feedback' ? view.answer?.rawAnswer : undefined;
  const outcome = reviewing ? stored?.evaluation?.outcome : view.answer?.evaluation.outcome;
  const answered = raw !== undefined;
  const correct = answered ? outcome === 'correct' : undefined;
  renderAfter(task, family, correct, reviewing);
  renderVariants(task, answered);
  const results = answered ? slotResults(registry, task, raw!, reviewing || hints.has(task.id)) : undefined;
  const definition = { ...clozeDefinition(task), title: { ru: gapsUiTranslations('ru').taskTitles[family], en: gapsUiTranslations('en').taskTitles[family],
    de: gapsUiTranslations('de').taskTitles[family] },
    ...(content.translations ? { prompt: { text: content.translations[task.specification.answerLanguage], lang: task.specification.answerLanguage } } : {}) };
  const presentation = { language, busy, ...(results ? { slotResults: results, feedback: { kind: correct ? 'correct' as const : 'incorrect' as const } } : {}) };
  const key = `${view.sessionId}|${index}|${reviewing ? 'review' : view.phase}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  closeCard(); cardKey = key; $('speechStatus').textContent = '';
  const active = runner!;
  card = createClozeCard(host, definition, presentation, {
    onSubmit: ({ values: answer }) => saved(active.submit(answer)),
    ...(!reviewing ? { onNext: () => saved(active.next()) } : {}),
  }, answered ? { values: values(raw), submitted: true } : undefined);
  if (!answered) host.querySelector<HTMLInputElement>('.dc-cloze input')?.focus();
  else if (!reviewing) {
    host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
    // v1: a correct answer reads the full sentence aloud when auto-speak is on (once per task).
    if (correct && pref(PREFS.autoSpeak, '0') === '1' && spokenKey !== task.id) { spokenKey = task.id; speak(solvedSentence(content)); }
  } else (buttons.previous.hidden ? buttons.forward : buttons.previous).focus();
}

/** A conflict means nothing was saved for this card: it must stay answerable, not "accepted". */
async function saved(result: Promise<CommandResult>): Promise<void> {
  if (await result === 'conflict') throw new Error('Session changed elsewhere');
}
function attach(next: SessionRunner): void {
  detach(); message = undefined; review = undefined;
  runner = next; unsubscribe = next.subscribe(render);
  $('setup').hidden = true; $('continue').hidden = true;
  render(next.view);
}
function detach(): void { unsubscribe?.(); unsubscribe = undefined; runner?.dispose(); runner = undefined; closeCard(); speech.cancel(); }
/** Commands report failures through the view; the retained command is repeated with Retry. */
function command(action: (r: SessionRunner) => Promise<unknown>): void {
  if (runner) action(runner).catch(() => { if (runner) render(runner.view); });
}

let starting = false;
async function start(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!scope || !registry || starting || openSession) return;
  starting = true; $<HTMLButtonElement>('start').disabled = true;
  try {
    const family = selectedFamily(); const mode = selectedMode();
    const datasetId = GAP_FAMILIES[family].datasetId;
    const tense = family === 'passiv' ? $<HTMLSelectElement>('tense').value as PassivTense | '' : '';
    const answerLanguage = (family === 'passiv' ? $<HTMLSelectElement>('translation').value : language === 'en' ? 'en' : 'ru') as TranslationLanguage;
    const data = await scope.snapshot();
    const itemIds = planGapItems(registry, GAP_EXERCISE[mode], datasetId, data.facts, context(), tense ? { tense } : {});
    if (!itemIds.length) { $('empty').hidden = false; return; }
    const sessionId = env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed: env.id(), createdAt: env.now(), answerLanguage,
      datasetId, items: itemIds.map(itemId => ({ itemId, exerciseId: GAP_EXERCISE[mode] })) });
    // The archive pins the dataset version: a reload never grades against newer content.
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 }, catalogVersion: '', words: [],
      datasets: [registry.dataset(datasetId)] }));
  } catch { message = 'saveError'; notice.textContent = noticeText(); }
  finally { starting = false; if (!runner) await refresh(); }
}

async function showReview(index: number): Promise<void> {
  if (!runner || !scope) return;
  if (index >= runner.view.taskIndex) { review = undefined; render(runner.view); return; }
  const data = await scope.snapshot();
  review = { index: Math.max(0, index), facts: data.facts.filter(f => f.event.sessionId === runner!.view.sessionId) };
  render(runner.view);
}

async function init(): Promise<void> {
  language = (pref('dc_v2_language', 'ru') as Lang); if (!['ru', 'en', 'de'].includes(language)) language = 'ru';
  $<HTMLSelectElement>('language').value = language;
  $<HTMLSelectElement>('family').value = pref(PREFS.family, 'relative') === 'passiv' ? 'passiv' : 'relative';
  const mode = pref(PREFS.mode, 'select') === 'type' ? 'type' : 'select';
  document.querySelector<HTMLInputElement>(`input[name=mode][value=${mode}]`)!.checked = true;
  $<HTMLSelectElement>('translation').value = language === 'en' ? 'en' : 'ru';
  localize();
  try {
    const [relative, passiv] = await Promise.all([loadDataset('relative'), loadDataset('passiv')]);
    registry = createItemExerciseRegistry([relative, passiv]);
    learning = await openLearningPage();
    scope = learning.store;
  } catch { message = 'loadError'; notice.textContent = noticeText(); notice.setAttribute('role', 'alert'); return; }
  await refresh();
}

$<HTMLFormElement>('setupForm').addEventListener('submit', event => { void start(event); });
$('family').addEventListener('change', () => { setPref(PREFS.family, selectedFamily()); void renderSetup(); });
document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach(input => input.addEventListener('change', () => { setPref(PREFS.mode, selectedMode()); }));
$('continueAction').addEventListener('click', () => {
  if (!scope || !openSession) return;
  void SessionRunner.open(scope, env, openSession.id).then(attach, () => { message = 'loadError'; notice.textContent = noticeText(); });
});
$('continueFinish').addEventListener('click', () => {
  if (!scope || !openSession) return;
  void SessionRunner.open(scope, env, openSession.id).then(async opened => { try { await opened.finish(); } finally { opened.dispose(); await refresh(); } })
    .catch(() => { message = 'saveError'; notice.textContent = noticeText(); });
});
$('hint').addEventListener('click', () => {
  const task = runner?.view.task;
  if (!task) return;
  hints.add(task.id); render(runner!.view); $('hintAnswer').focus();
});
$('listen').addEventListener('click', () => {
  const view = runner?.view; if (!view || view.family !== 'items' || !registry) return;
  const task = review ? view.plan.tasks[review.index] : view.task;
  if (task) speak(solvedSentence(itemContent(registry, task)));
});
$<HTMLInputElement>('autoSpeak').addEventListener('change', event => setPref(PREFS.autoSpeak, (event.target as HTMLInputElement).checked ? '1' : '0'));
buttons.retry.addEventListener('click', () => command(r => r.retry()));
buttons.pause.addEventListener('click', () => command(r => r.pause()));
buttons.resume.addEventListener('click', () => command(r => r.resume()));
buttons.finish.addEventListener('click', () => command(r => r.finish()));
buttons.previous.addEventListener('click', () => { if (runner) void showReview((review?.index ?? runner.view.taskIndex) - 1); });
buttons.forward.addEventListener('click', () => { if (runner) void showReview(runner.view.taskIndex); });
buttons.new.addEventListener('click', () => { detach(); review = undefined; render(); void refresh(); });
// v1 keyboard: ←/→ move between tasks when focus is not in a text field (Enter checks, then Next is focused).
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (!runner || event.altKey || event.ctrlKey || event.metaKey || target.matches('input[type=text], select, textarea')) return;
  if (event.key === 'ArrowLeft' && !buttons.previous.hidden && !buttons.previous.disabled) { event.preventDefault(); buttons.previous.click(); }
  if (event.key === 'ArrowRight') {
    if (review) { event.preventDefault(); void showReview(review.index + 1); }
    else {
      const next = host.querySelector<HTMLButtonElement>('[data-focus-key="next"]:not(:disabled)');
      if (next) { event.preventDefault(); next.click(); }
    }
  }
});
$('language').addEventListener('change', event => {
  language = (event.target as HTMLSelectElement).value as Lang; setPref('dc_v2_language', language); localize();
  renderContinue(); void renderSetup(); if (runner) render(runner.view);
});
window.addEventListener('pagehide', () => { detach(); speech.dispose(); learning?.dispose(); }, { once: true });
// A page restored from the back/forward cache has no live store or runner: start over from storage.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void init();
