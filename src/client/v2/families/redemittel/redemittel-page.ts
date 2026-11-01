import { createItemExerciseRegistry, isItemSessionPlan, planItemSession, sessionTasks, type ItemDataset, type ItemExerciseRegistry,
  type ItemSessionSummary, type PhraseDeck, type TranslationLanguage } from '../../core/index.js';
import { cardUiTranslations, sessionUiTranslations, type Lang } from '../../../i18n.js';
import { assetUrl } from '../../../config.js';
import { createCardShell } from '../../card-shell.js';
import { createCardSpeech, type SpeechResult } from '../../card-speech.js';
import { SessionRunner, type CommandResult, type ItemRunnerView, type RunnerEnvironment, type RunnerView } from '../../session-runner.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { deckOf, deckStats, itemContent, otherLanguage, PHRASE_DATASET, PHRASE_DATASET_FILE, PHRASE_EXERCISE, phraseCard,
  phrasePresentation, planPhraseItems, ratingOf, summaryRows } from './redemittel-model.js';
import { fill, redemittelUiTranslations } from './redemittel-i18n.js';

// M7 (#339): FC11 on the shared Runner, store and RevealInput. Same owner's journal as
// the vocabulary session page (learning-context).
const PREFS = { deck: 'dc_v2_phrase_deck', autoSpeak: 'dc_v2_auto_speak' };

const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const notice = $<HTMLParagraphElement>('notice');
const buttons = { retry: $<HTMLButtonElement>('retry'), pause: $<HTMLButtonElement>('pause'),
  resume: $<HTMLButtonElement>('resume'), finish: $<HTMLButtonElement>('finish'), new: $<HTMLButtonElement>('new') };
const speech = createCardSpeech();
let language: Lang = 'ru';
let learning: PageLearning | undefined;
let scope: PageLearning['store'] | undefined;
let registry: ItemExerciseRegistry | undefined;
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: ReturnType<typeof createCardShell> | undefined;
let cardKey = '';
let message: 'saveError' | 'conflict' | 'loadError' | undefined;
let openSession: { readonly id: string; readonly deck: PhraseDeck; readonly taskIndex: number; readonly total: number } | undefined;

function pref(key: string, fallback: string): string { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function setPref(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preferences are optional */ } }
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const selectedDeck = (): PhraseDeck => $<HTMLSelectElement>('deck').value as PhraseDeck;
const context = () => ({ owner: scope!.owner, dataEpoch: scope!.epoch.dataEpoch, epochStartedAt: scope!.epoch.epochStartedAt, asOf: env.now() });
const titles = () => Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, redemittelUiTranslations(lang).cardTitle])) as Record<Lang, string>;

async function loadDataset(): Promise<ItemDataset> {
  const response = await fetch(assetUrl(`data/items/${PHRASE_DATASET_FILE}`));
  if (!response.ok) throw new Error(`Dataset ${PHRASE_DATASET}: ${response.status}`);
  return response.json() as Promise<ItemDataset>;
}

function localize(): void {
  const text = redemittelUiTranslations(language); const session = sessionUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${text.title}`;
  $('title').textContent = text.title; $('languageLabel').textContent = session.interfaceLanguage;
  $('deckLabel').textContent = text.deck; $('translationLabel').textContent = session.translation;
  for (const option of Array.from($<HTMLSelectElement>('deck').options)) option.textContent = text.decks[option.value as PhraseDeck];
  $('start').textContent = text.start; $('empty').textContent = text.empty; $('statsTitle').textContent = text.statsTitle;
  $('statsNote').textContent = text.subjective; $('subjective').textContent = text.subjective; $('keyboard').textContent = text.keyboard;
  $('continueTitle').textContent = text.continueTitle; $('continueAction').textContent = text.continue; $('continueFinish').textContent = session.finish;
  $('autoSpeakLabel').textContent = text.autoSpeak; $('detailsTitle').textContent = text.detailsTitle;
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

/** Setup screen: the deck's own statistics from the same journal. */
async function renderSetup(): Promise<void> {
  $('empty').hidden = true;
  if (!scope || !registry) return;
  const deck = selectedDeck();
  const data = await scope.snapshot();
  const text = redemittelUiTranslations(language);
  const stats = deckStats(registry, deck, data.facts, context());
  const line = $('statsLine');
  line.textContent = fill(stats.rated ? text.statsLine : text.statsLineNone, { rated: String(stats.rated), applicable: String(stats.applicable),
    remembered: String(stats.remembered), forgotten: String(stats.forgotten) });
  line.dataset.deck = deck; line.dataset.rated = String(stats.rated);
}

function renderContinue(): void {
  const panel = $('continue');
  panel.hidden = !openSession || !!runner;
  if (panel.hidden) return;
  const text = redemittelUiTranslations(language);
  $('continueLine').textContent = fill(text.continueLine, { deck: text.decks[openSession!.deck],
    n: String(Math.min(openSession!.taskIndex + 1, openSession!.total)), total: String(openSession!.total) });
}

async function refresh(): Promise<void> {
  if (!scope || !registry) return;
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && s.state.plan.datasets[0]?.datasetId === PHRASE_DATASET &&
    s.state.status !== 'completed' && s.state.status !== 'abandoned').sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  openSession = open && isItemSessionPlan(open.state.plan) ? { id: open.state.plan.sessionId,
    deck: deckOf(createItemExerciseRegistry(open.datasets ?? []), open.state.plan.tasks[0]!),
    taskIndex: open.state.taskIndex, total: sessionTasks(open.state).length } : undefined;
  renderContinue();
  $('setup').hidden = !!runner;
  $<HTMLButtonElement>('start').disabled = !!openSession;
  await renderSetup();
}

function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

function speechMessage(result: SpeechResult): string {
  const labels = cardUiTranslations(language);
  return result === 'unavailable' ? labels.ttsUnavailable : result === 'no-german-voice' ? labels.ttsNoGermanVoice : result === 'failed' ? labels.ttsFailed : '';
}
function speak(phrase: string): void {
  const status = $('speechStatus'); status.textContent = '';
  void speech.speak(phrase).then(result => { if (cardKey) status.textContent = speechMessage(result); });
}

/** Phrase details once the phrase is shown: the other translation and the deck. */
function renderDetails(view: ItemRunnerView | undefined, shown: boolean): void {
  const section = $('details');
  const task = view?.task;
  section.hidden = !shown || !task || !registry;
  if (section.hidden) { $('detailsList').replaceChildren(); return; }
  const text = redemittelUiTranslations(language);
  const content = itemContent(registry!, task!);
  const other = otherLanguage(task!.specification.answerLanguage);
  const translation = node('dd', content.translations[other]); translation.lang = other; translation.dataset.translation = other;
  $('detailsList').replaceChildren(node('dt', fill(text.translationIn, { lang: other.toUpperCase() })), translation,
    node('dt', text.deckLabel), node('dd', text.decks[content.deck]));
}

function renderSummary(view: ItemRunnerView | undefined): void {
  const section = $('summary');
  const summary = view?.summary as ItemSessionSummary | undefined;
  section.hidden = !summary || !registry;
  if (section.hidden) { section.replaceChildren(); return; }
  const text = redemittelUiTranslations(language); const labels = cardUiTranslations(language);
  const rows = summaryRows(registry!, view!.plan.tasks, summary!);
  const list = node('ol');
  for (const row of rows) {
    const line = node('li'); line.dataset.result = row.rating ?? 'unrated';
    const phrase = node('span', row.de); phrase.lang = 'de';
    line.append(phrase, ` — ${row.rating ? labels[row.rating] : text.unrated}`); list.append(line);
  }
  const title = node('h2', text.summaryTitle); title.id = 'summaryTitle';
  section.replaceChildren(title, node('p', fill(text.summaryLine, { remembered: String(rows.filter(r => r.rating === 'remembered').length), total: String(rows.length) })),
    node('p', text.subjective, 'dc-phrases-note'), list);
}

function render(input?: RunnerView): void {
  const view = input?.family === 'items' ? input : undefined;
  const session = sessionUiTranslations(language); const text = redemittelUiTranslations(language);
  const terminal = view?.phase === 'completed' || view?.phase === 'abandoned';
  $('session').hidden = !view;
  notice.textContent = noticeText(view);
  notice.setAttribute('role', view?.error || message === 'loadError' ? 'alert' : 'status');
  if (!view) { closeCard(); return; }
  $('progress').textContent = terminal ? '' : fill(session.progress, { n: String(view.taskIndex + 1), total: String(view.total) });
  renderSummary(view);
  buttons.retry.hidden = view.error !== 'save';
  buttons.pause.hidden = view.phase !== 'presenting' && view.phase !== 'feedback';
  buttons.resume.hidden = view.phase !== 'paused';
  buttons.finish.hidden = terminal;
  buttons.new.hidden = !terminal;
  Object.values(buttons).forEach(button => { button.disabled = view.busy; });
  const task = view.task;
  const active = !!task && !!registry && (view.phase === 'presenting' || view.phase === 'feedback');
  $('subjective').hidden = !active; $('keyboard').hidden = !active; $('speechBox').hidden = !active;
  if (!active) { closeCard(); renderDetails(undefined, false); return; }
  const answered = view.phase === 'feedback' ? view.answer : undefined;
  const rating = ratingOf(answered?.rawAnswer);
  const revealed = view.revealed || !!answered;
  renderDetails(view, revealed);
  $<HTMLInputElement>('autoSpeak').checked = pref(PREFS.autoSpeak, '0') === '1';
  // The rating is subjective: the card says what was chosen, never "correct".
  const presentation = phrasePresentation(language, { revealed, busy: view.busy, ...(rating ? { rating } : {}) },
    rating ? { kind: 'info', message: text.rated[rating] } : undefined);
  // A saved reveal (also one repeated by Retry) remounts the card in its revealed state.
  const key = `${view.sessionId}|${view.taskIndex}|${view.phase}|${revealed}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  const revealedNow = !!card && cardKey === `${view.sessionId}|${view.taskIndex}|presenting|false` && revealed && !answered;
  closeCard(); cardKey = key; $('speechStatus').textContent = '';
  const runnerNow = runner!;
  card = createCardShell(host, phraseCard(task!, titles()), presentation, {
    onSubmit: ({ value }) => saved(runnerNow.submit(value)),
    onNext: () => saved(runnerNow.next()),
    async onReveal(_, kind) {
      if (kind !== 'answer') return;
      await saved(runnerNow.reveal());
      // v1: the phrase is read aloud when it is shown and auto-speak is on.
      if (pref(PREFS.autoSpeak, '0') === '1') speak(itemContent(registry!, task!).de);
    },
    onSpeech() {},
  }, { value: rating ?? '', revealed, submitted: !!rating, detailsOpen: false });
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
  else if (revealedNow) host.querySelector<HTMLButtonElement>('.dc-ratings button')?.focus();
  else if (!revealed) host.querySelector<HTMLButtonElement>('.dc-reveal button')?.focus();
}

/** A conflict means nothing was saved for this card: it must stay answerable, not "accepted". */
async function saved(result: Promise<CommandResult>): Promise<void> {
  if (await result === 'conflict') throw new Error('Session changed elsewhere');
}
function attach(next: SessionRunner): void {
  detach(); message = undefined;
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
    const deck = selectedDeck();
    const answerLanguage = $<HTMLSelectElement>('translation').value as TranslationLanguage;
    const data = await scope.snapshot();
    const itemIds = planPhraseItems(registry, deck, data.facts, context());
    if (!itemIds.length) { $('empty').hidden = false; return; }
    const sessionId = env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed: env.id(), createdAt: env.now(), answerLanguage,
      datasetId: PHRASE_DATASET, items: itemIds.map(itemId => ({ itemId, exerciseId: PHRASE_EXERCISE })) });
    // The archive pins the dataset version: a reload never shows newer content for the same task.
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 }, catalogVersion: '', words: [],
      datasets: [registry.dataset(PHRASE_DATASET)] }));
  } catch { message = 'saveError'; notice.textContent = noticeText(); }
  finally { starting = false; if (!runner) await refresh(); }
}

async function init(): Promise<void> {
  language = (pref('dc_v2_language', 'ru') as Lang); if (!['ru', 'en', 'de'].includes(language)) language = 'ru';
  $<HTMLSelectElement>('language').value = language;
  $<HTMLSelectElement>('deck').value = pref(PREFS.deck, 'beruf') === 'daily' ? 'daily' : 'beruf';
  $<HTMLSelectElement>('translation').value = language === 'en' ? 'en' : 'ru';
  localize();
  try {
    registry = createItemExerciseRegistry([await loadDataset()]);
    learning = await openLearningPage();
    scope = learning.store;
  } catch { message = 'loadError'; notice.textContent = noticeText(); notice.setAttribute('role', 'alert'); return; }
  await refresh();
}

$<HTMLFormElement>('setupForm').addEventListener('submit', event => { void start(event); });
$('deck').addEventListener('change', () => { setPref(PREFS.deck, selectedDeck()); void renderSetup(); });
$('continueAction').addEventListener('click', () => {
  if (!scope || !openSession) return;
  void SessionRunner.open(scope, env, openSession.id).then(attach, () => { message = 'loadError'; notice.textContent = noticeText(); });
});
$('continueFinish').addEventListener('click', () => {
  if (!scope || !openSession) return;
  void SessionRunner.open(scope, env, openSession.id).then(async opened => { try { await opened.finish(); } finally { opened.dispose(); await refresh(); } })
    .catch(() => { message = 'saveError'; notice.textContent = noticeText(); });
});
$<HTMLInputElement>('autoSpeak').addEventListener('change', event => setPref(PREFS.autoSpeak, (event.target as HTMLInputElement).checked ? '1' : '0'));
buttons.retry.addEventListener('click', () => command(r => r.retry()));
buttons.pause.addEventListener('click', () => command(r => r.pause()));
buttons.resume.addEventListener('click', () => command(r => r.resume()));
buttons.finish.addEventListener('click', () => command(r => r.finish()));
buttons.new.addEventListener('click', () => { detach(); render(); void refresh(); });
// The ratings replace the reveal button in place: the second click of a double click on "Show answer"
// must not rate the phrase. Clicks by keyboard have detail 0 and are unaffected.
host.addEventListener('click', event => {
  if (event.detail > 1 && (event.target as HTMLElement).closest('.dc-ratings')) { event.preventDefault(); event.stopPropagation(); }
}, true);
// v1 keyboard: Space/Enter shows the phrase, 1 = didn't remember, 2 = remembered, then Enter/→ goes on.
// A focused control keeps its own Space/Enter, so a key never acts twice.
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  const view = runner?.view;
  if (!view || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target.matches('input, select, textarea')) return;
  const onControl = target.matches('button, a');
  if (view.phase === 'presenting' && !view.revealed && (event.key === ' ' || event.key === 'Enter') && !onControl) {
    const show = host.querySelector<HTMLButtonElement>('.dc-reveal button');
    if (show && !show.disabled) { event.preventDefault(); show.click(); }
  } else if (view.phase === 'presenting' && view.revealed && (event.key === '1' || event.key === '2')) {
    const rate = host.querySelectorAll<HTMLButtonElement>('.dc-ratings button')[Number(event.key) - 1];
    if (rate && !rate.disabled) { event.preventDefault(); rate.click(); }
  } else if (view.phase === 'feedback' && (event.key === 'ArrowRight' || (event.key === 'Enter' && !onControl))) {
    const next = host.querySelector<HTMLButtonElement>('[data-focus-key="next"]:not(:disabled)');
    if (next) { event.preventDefault(); next.click(); }
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
