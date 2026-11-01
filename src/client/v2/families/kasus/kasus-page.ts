import { createItemExerciseRegistry, isItemSessionPlan, planItemSession, sessionTasks, KASUS_VARIANTS, type ItemDataset,
  type ItemExerciseRegistry, type ItemExerciseTask, type ItemSessionSummary, type JsonValue, type RecordedLearningFact,
  type TranslationLanguage } from '../../core/index.js';
import { cardUiTranslations, sessionUiTranslations, type Lang } from '../../../i18n.js';
import { assetUrl } from '../../../config.js';
import { createCardShell } from '../../card-shell.js';
import { createClozeCard } from '../../cloze-input.js';
import { createCardSpeech, type SpeechResult } from '../../card-speech.js';
import { SessionRunner, type CommandResult, type ItemRunnerView, type RunnerEnvironment, type RunnerView } from '../../session-runner.js';
import type { StoredFact } from '../../storage/learning-db.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { choiceDefinition, clozeDefinition, grade, isKasusTask, itemContent, itemStats, kasusStats, planKasusItems, rawAnswer, ruleOf,
  ruleRow, solvedSentence, variantOf, KASUS_DATASET, KASUS_FILTERS, type KasusFilter, type KasusRules } from './kasus-model.js';
import { fill, kasusUiTranslations } from './kasus-i18n.js';
import { createRuleWindow } from './kasus-rule.js';

// M4 (#336): FC07 on the shared Runner, store, ClozeInput (article) and ChoiceInput (case, question).
// Same owner's journal as the vocabulary session page (learning-context).
const PREFS = { filter: 'dc_v2_kasus_filter' };

const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const notice = $<HTMLParagraphElement>('notice');
const buttons = { previous: $<HTMLButtonElement>('previous'), forward: $<HTMLButtonElement>('forward'),
  retry: $<HTMLButtonElement>('retry'), pause: $<HTMLButtonElement>('pause'), resume: $<HTMLButtonElement>('resume'),
  finish: $<HTMLButtonElement>('finish'), new: $<HTMLButtonElement>('new') };
const speech = createCardSpeech();
const ruleWindow = createRuleWindow($<HTMLDialogElement>('rule'));
let language: Lang = 'ru';
let learning: PageLearning | undefined;
let scope: PageLearning['store'] | undefined;
let registry: ItemExerciseRegistry | undefined;
let rules: KasusRules = {};
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: { readonly kind: 'cloze'; readonly card: ReturnType<typeof createClozeCard> } | { readonly kind: 'choice'; readonly card: ReturnType<typeof createCardShell> } | undefined;
let cardKey = '';
let message: 'saveError' | 'conflict' | 'loadError' | undefined;
let openSession: { readonly id: string; readonly filter: KasusFilter; readonly taskIndex: number; readonly total: number } | undefined;
/** Previous: a read-only view of an earlier task of the running session with its saved answer. */
let review: { readonly index: number; readonly facts: readonly StoredFact[] } | undefined;
/** The journal as of the last answer, for the per-sentence statistics line. */
let facts: readonly RecordedLearningFact[] = [];

function pref(key: string, fallback: string): string { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function setPref(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preferences are optional */ } }
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const selectedFilter = (): KasusFilter => (document.querySelector<HTMLInputElement>('input[name=filter]:checked')?.value ?? 'all') as KasusFilter;
const context = () => ({ owner: scope!.owner, dataEpoch: scope!.epoch.dataEpoch, epochStartedAt: scope!.epoch.epochStartedAt, asOf: env.now() });
/** The filter a session was started with, read back from its tasks. */
function filterOf(tasks: readonly ItemExerciseTask[]): KasusFilter {
  const variants = new Set(tasks.map(variantOf));
  return variants.size === 1 ? [...variants][0]! : 'all';
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

function localize(): void {
  const text = kasusUiTranslations(language); const session = sessionUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${text.title}`;
  $('title').textContent = text.title; $('languageLabel').textContent = session.interfaceLanguage;
  $('filterLabel').textContent = text.filter;
  for (const filter of KASUS_FILTERS) $(`filter-${filter}`).textContent = text.filters[filter];
  $('start').textContent = text.start; $('empty').textContent = text.empty; $('statsTitle').textContent = text.statsTitle;
  $('continueTitle').textContent = text.continueTitle; $('continueAction').textContent = text.continue; $('continueFinish').textContent = session.finish;
  $('explanationTitle').textContent = text.explanationTitle; $('ruleOpen').textContent = text.ruleOpen; $('listen').textContent = text.listen;
  $('translationLabel').textContent = text.translation; $('keyboard').textContent = text.keyboard;
  buttons.previous.textContent = text.previous; buttons.forward.textContent = text.backToCurrent;
  for (const name of ['retry', 'pause', 'resume', 'finish'] as const) buttons[name].textContent = session[name];
  buttons.new.textContent = text.start;
  ruleWindow.localize(language, text);
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

/** Setup screen: statistics per variant from the same journal. */
async function renderSetup(): Promise<void> {
  $('empty').hidden = true;
  if (!scope || !registry) return;
  const data = await scope.snapshot();
  const text = kasusUiTranslations(language);
  const stats = kasusStats(registry, data.facts, context());
  $<HTMLUListElement>('statsList').replaceChildren(...KASUS_VARIANTS.map(variant => {
    const row = stats[variant];
    const line = node('li', fill(row.accuracy === null ? text.statsLineNone : text.statsLine, { variant: text.filters[variant],
      attempted: String(row.attempted), applicable: String(row.applicable), accuracy: `${Math.round((row.accuracy ?? 0) * 100)}%` }));
    line.dataset.variant = variant; line.dataset.attempted = String(row.attempted); return line;
  }));
}

function renderContinue(): void {
  const panel = $('continue');
  panel.hidden = !openSession || !!runner;
  if (panel.hidden) return;
  const text = kasusUiTranslations(language);
  $('continueLine').textContent = fill(text.continueLine, { filter: text.filters[openSession!.filter],
    n: String(Math.min(openSession!.taskIndex + 1, openSession!.total)), total: String(openSession!.total) });
}

async function refresh(): Promise<void> {
  if (!scope) return;
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && s.state.plan.datasets[0]?.datasetId === KASUS_DATASET.datasetId &&
    s.state.status !== 'completed' && s.state.status !== 'abandoned').sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  openSession = open && isItemSessionPlan(open.state.plan) ? { id: open.state.plan.sessionId, filter: filterOf(open.state.plan.tasks),
    taskIndex: open.state.taskIndex, total: sessionTasks(open.state).length } : undefined;
  renderContinue();
  $('setup').hidden = !!runner;
  $<HTMLButtonElement>('start').disabled = !!openSession;
  await renderSetup();
}

function closeCard(): void { card?.card.dispose(); card = undefined; cardKey = ''; }

function speechMessage(result: SpeechResult): string {
  const labels = cardUiTranslations(language);
  return result === 'unavailable' ? labels.ttsUnavailable : result === 'no-german-voice' ? labels.ttsNoGermanVoice : result === 'failed' ? labels.ttsFailed : '';
}
function speak(sentence: string): void {
  const status = $('speechStatus'); status.textContent = '';
  void speech.speak(sentence).then(result => { if (cardKey) status.textContent = speechMessage(result); });
}

/** After the answer: why (this task's explanation), the translation, the rule summary and the rule window. */
function renderAfter(task: ItemExerciseTask, answered: boolean): void {
  const after = $('after');
  after.hidden = !answered;
  if (!answered || !registry) { if (ruleWindow.open) ruleWindow.close(); return; }
  const content = itemContent(registry, task);
  $('explanationText').textContent = content.explanation[language];
  const lang = task.specification.answerLanguage;
  $('translationText').textContent = content.translations[lang]; $('translationText').lang = lang;
  const rule = ruleOf(rules, content);
  $('ruleSummary').textContent = rule ? rule.summary[language] : '';
  $('ruleOpen').hidden = !rule;
  const stats = itemStats(facts, context(), task);
  const text = kasusUiTranslations(language);
  $('itemStats').textContent = stats.tasks ? fill(text.itemStats, { answers: String(stats.tasks), independent: String(stats.independentCorrect) }) : text.itemNew;
}

function renderSummary(summary: ItemSessionSummary | undefined, view: ItemRunnerView | undefined): void {
  const section = $('summary');
  section.hidden = !summary || !view || !registry;
  if (section.hidden) { section.replaceChildren(); return; }
  const text = kasusUiTranslations(language); const session = sessionUiTranslations(language);
  const list = node('ol');
  for (const entry of summary!.tasks) {
    const task = view!.plan.tasks.find(candidate => candidate.id === entry.taskId)!;
    const line = node('li'); line.dataset.result = entry.outcome ?? 'unanswered';
    const sentence = node('span', solvedSentence(itemContent(registry!, task))); sentence.lang = 'de';
    line.append(sentence, ` — ${entry.outcome === 'correct' ? session.resultCorrect : entry.outcome === 'incorrect' ? session.resultIncorrect : text.unanswered}`);
    list.append(line);
  }
  const title = node('h2', text.summaryTitle); title.id = 'summaryTitle';
  section.replaceChildren(title, node('p', fill(text.summaryLine, { correct: String(summary!.correct), total: String(summary!.tasks.length) })), list);
}

const titles = (variant: ReturnType<typeof variantOf>) =>
  ({ ru: kasusUiTranslations('ru').taskTitles[variant], en: kasusUiTranslations('en').taskTitles[variant], de: kasusUiTranslations('de').taskTitles[variant] });

function render(input?: RunnerView): void {
  const view = input?.family === 'items' ? input : undefined;
  const session = sessionUiTranslations(language); const text = kasusUiTranslations(language);
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
  if (!task || !isKasusTask(task) || terminal || view.phase === 'paused' || view.phase === 'ready' || !registry) {
    closeCard(); $('after').hidden = true; if (ruleWindow.open) ruleWindow.close(); $('keyboard').hidden = true; return;
  }
  $('keyboard').hidden = false;
  const content = itemContent(registry, task);
  const variant = variantOf(task);
  // The answer shown is always the stored one: the live task's from the Runner, an earlier task's from the journal.
  const stored = reviewing ? review!.facts.find(f => f.event.taskId === task.id && f.event.kind === 'answer') : undefined;
  const raw: JsonValue | undefined = reviewing ? (stored?.event.kind === 'answer' ? stored.event.rawAnswer : undefined)
    : view.phase === 'feedback' ? view.answer?.rawAnswer : undefined;
  const answered = raw !== undefined;
  const result = answered ? grade(registry, task, raw!) : undefined;
  renderAfter(task, answered);
  const feedback = result ? { kind: result.correct ? 'correct' as const : 'incorrect' as const,
    message: result.correct ? text.correct : fill(text.wrong, { answer: content.answer }) } : undefined;
  const key = `${view.sessionId}|${index}|${reviewing ? 'review' : view.phase}`;
  const cloze = { language, busy, ...(feedback ? { feedback, slotResults: { 'slot-1': result!.correct ? { outcome: 'correct' as const }
    : { outcome: 'incorrect' as const, expected: content.answer } } } : {}) };
  const choice = { language, busy, permissions: { reveal: false, details: false, speech: false }, ...(feedback ? { feedback } : {}) };
  if (card && key === cardKey) { if (card.kind === 'cloze') card.card.setPresentation(cloze); else card.card.setPresentation(choice); return; }
  closeCard(); cardKey = key; $('speechStatus').textContent = '';
  const active = runner!;
  // A conflict means nothing was saved for this card: it must stay answerable, not "accepted".
  const submit = async (option: string) => {
    if (await active.submit(rawAnswer(task, option)) === 'conflict') throw new Error('Session changed elsewhere');
    // The per-sentence statistics follow the journal, now including this answer.
    if (scope) { facts = (await scope.snapshot()).facts; if (runner === active) render(active.view); }
  };
  if (variant === 'article') {
    card = { kind: 'cloze', card: createClozeCard(host, { ...clozeDefinition(task), title: titles(variant) }, cloze,
      { onSubmit: ({ values }) => submit(values['slot-1']!), ...(!reviewing ? { onNext: () => savedNext(active) } : {}) }, result ? { values: { 'slot-1': result.chosen }, submitted: true } : undefined) };
  } else {
    const definition = choiceDefinition(task);
    card = { kind: 'choice', card: createCardShell(host, { id: task.id, title: titles(variant), prompt: definition.prompt, input: definition.input,
      translationLanguage: task.specification.answerLanguage }, choice, { onSubmit: ({ value }) => submit(value), ...(!reviewing ? { onNext: () => savedNext(active) } : {}), onReveal() {}, onSpeech() {} },
      result ? { value: result.chosen, revealed: false, submitted: true, detailsOpen: false } : undefined) };
  }
  if (!answered) host.querySelector<HTMLInputElement>('input[type=radio]')?.focus();
  else if (!reviewing) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
  else (buttons.previous.hidden ? buttons.forward : buttons.previous).focus();
}

async function savedNext(active: SessionRunner): Promise<void> {
  if (await active.next() === 'conflict') throw new Error('Session changed elsewhere');
}
function attach(next: SessionRunner): void {
  detach(); message = undefined; review = undefined; wanted = undefined;
  runner = next; unsubscribe = next.subscribe(render);
  $('setup').hidden = true; $('continue').hidden = true;
  void scope?.snapshot().then(data => { facts = data.facts; if (runner === next) render(next.view); });
  render(next.view);
}
function detach(): void { unsubscribe?.(); unsubscribe = undefined; runner?.dispose(); runner = undefined; closeCard(); speech.cancel(); if (ruleWindow.open) ruleWindow.close(); }
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
    const filter = selectedFilter();
    const answerLanguage: TranslationLanguage = language === 'en' ? 'en' : 'ru';
    const data = await scope.snapshot();
    const items = planKasusItems(registry, filter, data.facts, context());
    if (!items.length) { $('empty').hidden = false; return; }
    const sessionId = env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed: env.id(), createdAt: env.now(), answerLanguage,
      datasetId: KASUS_DATASET.datasetId, items });
    // The archive pins the dataset version: a reload never grades against newer content.
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 }, catalogVersion: '', words: [],
      datasets: [registry.dataset(KASUS_DATASET.datasetId)] }));
  } catch { message = 'saveError'; notice.textContent = noticeText(); }
  finally { starting = false; if (!runner) await refresh(); }
}

/** The task index last asked for (keys can arrive faster than the journal is read). */
let wanted: number | undefined;
const shownIndex = (): number => wanted ?? review?.index ?? runner!.view.taskIndex;
async function showReview(index: number): Promise<void> {
  if (!runner || !scope) return;
  wanted = Math.max(0, index);
  if (wanted >= runner.view.taskIndex) { wanted = undefined; review = undefined; render(runner.view); return; }
  const target = wanted;
  const data = await scope.snapshot();
  if (wanted !== target || !runner) return;
  wanted = undefined;
  review = { index: target, facts: data.facts.filter(f => f.event.sessionId === runner!.view.sessionId) };
  render(runner.view);
}

/** The task on screen: the reviewed one or the live one. */
function shownTask(): ItemExerciseTask | undefined {
  const view = runner?.view;
  if (!view || view.family !== 'items') return undefined;
  return review ? view.plan.tasks[review.index] : view.task;
}

async function init(): Promise<void> {
  language = (pref('dc_v2_language', 'ru') as Lang); if (!['ru', 'en', 'de'].includes(language)) language = 'ru';
  $<HTMLSelectElement>('language').value = language;
  const filter = pref(PREFS.filter, 'all');
  document.querySelector<HTMLInputElement>(`input[name=filter][value=${(KASUS_FILTERS as readonly string[]).includes(filter) ? filter : 'all'}]`)!.checked = true;
  localize();
  try {
    const [dataset, ruleFile] = await Promise.all([loadJson<ItemDataset>(KASUS_DATASET.file), loadJson<KasusRules>(KASUS_DATASET.rules)]);
    registry = createItemExerciseRegistry([dataset]); rules = ruleFile;
    learning = await openLearningPage();
    scope = learning.store;
  } catch { message = 'loadError'; notice.textContent = noticeText(); notice.setAttribute('role', 'alert'); return; }
  await refresh();
}

$<HTMLFormElement>('setupForm').addEventListener('submit', event => { void start(event); });
document.querySelectorAll<HTMLInputElement>('input[name=filter]').forEach(input => input.addEventListener('change', () => setPref(PREFS.filter, selectedFilter())));
$('continueAction').addEventListener('click', () => {
  if (!scope || !openSession) return;
  void SessionRunner.open(scope, env, openSession.id).then(attach, () => { message = 'loadError'; notice.textContent = noticeText(); });
});
$('continueFinish').addEventListener('click', () => {
  if (!scope || !openSession) return;
  void SessionRunner.open(scope, env, openSession.id).then(async opened => { try { await opened.finish(); } finally { opened.dispose(); await refresh(); } })
    .catch(() => { message = 'saveError'; notice.textContent = noticeText(); });
});
$('ruleOpen').addEventListener('click', () => {
  const task = shownTask(); if (!task || !registry) return;
  const content = itemContent(registry, task); const rule = ruleOf(rules, content);
  if (rule) ruleWindow.show(rule, ruleRow(content), language, kasusUiTranslations(language), $('ruleOpen'));
});
$('listen').addEventListener('click', () => {
  const task = shownTask();
  if (task && registry) speak(solvedSentence(itemContent(registry, task)));
});
buttons.retry.addEventListener('click', () => command(r => r.retry()));
buttons.pause.addEventListener('click', () => command(r => r.pause()));
buttons.resume.addEventListener('click', () => command(r => r.resume()));
buttons.finish.addEventListener('click', () => command(r => r.finish()));
buttons.previous.addEventListener('click', () => { if (runner) void showReview(shownIndex() - 1); });
buttons.forward.addEventListener('click', () => { if (runner) void showReview(runner.view.taskIndex); });
buttons.new.addEventListener('click', () => { detach(); review = undefined; render(); void refresh(); });
// v1 keyboard: ←/→ move between tasks (digits, Enter and the arrows of a radio group belong to the card's inputs). The open rule window owns the keyboard.
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (!runner || ruleWindow.open || event.altKey || event.ctrlKey || event.metaKey || target.matches('input[type=text], input[type=radio], select, textarea')) return;
  if (event.key === 'ArrowLeft' && !buttons.previous.hidden && !buttons.previous.disabled) { event.preventDefault(); buttons.previous.click(); }
  if (event.key === 'ArrowRight') {
    if (review || wanted !== undefined) { event.preventDefault(); void showReview(shownIndex() + 1); }
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
