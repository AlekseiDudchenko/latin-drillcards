import { describeWordStatus, isItemSessionPlan, planVocabularySession, sessionTasks, WORD_EXERCISE_IDS, type Component, type SessionRequest, type TranslationLanguage,
  type VocabularySessionPlan, type VocabularySessionSummary, type Word, type WordExerciseId, type WordProgress } from './core/index.js';
import { cardUiTranslations, homeUiTranslations, sessionUiTranslations, type Lang } from '../i18n.js';
import { createCardShell } from './card-shell.js';
import { playResultSound } from './card-sound.js';
import { deckOverview, decksOfWord, emptyQueueReason, parseRoute, routeHash, searchDecks, searchWords, startedCount,
  wordSummary, type CatalogIndex, type DeckFile, type DeckOverview, type Route } from './home-model.js';
import { SessionRunner, type CommandResult, type RunnerEnvironment, type RunnerStore, type RunnerView } from './session-runner.js';
import { openLearningPage } from './account-bar.js';
import type { CatalogSource, PageLearning } from './learning-context.js';
import { WordDetails } from './word-details.js';
import { wordTaskCard, wordTaskFeedback, wordTaskPresentation } from './word-task-card.js';

const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const sections = { continue: $<HTMLElement>('continue'), home: $<HTMLElement>('home'), deck: $<HTMLElement>('deck'),
  word: $<HTMLElement>('word'), session: $<HTMLElement>('session') };
const host = $<HTMLDivElement>('card');
const setup = $<HTMLFormElement>('setup');
const notice = $<HTMLParagraphElement>('notice');
const progress = $<HTMLParagraphElement>('progress');
const summary = $<HTMLElement>('summary');
const buttons = { retry: $<HTMLButtonElement>('retry'), pause: $<HTMLButtonElement>('pause'),
  resume: $<HTMLButtonElement>('resume'), finish: $<HTMLButtonElement>('finish'), new: $<HTMLButtonElement>('new') };
const intents = { 'learn-new': $<HTMLButtonElement>('learnNew'), 'review-due': $<HTMLButtonElement>('reviewDue') };
const page = new AbortController();
let language: Lang = 'ru';
// The environment's catalog and the owner's store (learning-context): the seed and a local guest only in an unconfigured build.
let learning: PageLearning | undefined;
let source: CatalogSource | undefined;
let scope: RunnerStore | undefined;
let runner: SessionRunner | undefined;
let unsubscribe: (() => void) | undefined;
let card: ReturnType<typeof createCardShell> | undefined;
let cardKey = '';
/** `task|phase` of the last rendered card; a cue plays only on a live question → feedback step, never when a saved answer is reopened. */
let lastPhase = '';
let message: keyof ReturnType<typeof sessionUiTranslations> | 'catalogError' | 'deckNotFound' | 'wordNotFound' | undefined;
let catalog: Promise<CatalogIndex> | undefined;
const deckFiles = new Map<string, Promise<DeckFile>>();
/** Owner-scoped projections of the active epoch, refreshed on every navigation outside a session. */
let projections: readonly WordProgress[] = [];
let openSession: { readonly id: string; readonly deckId: string; readonly taskIndex: number; readonly total: number } | undefined;
let current: Route = { view: 'home' };
let shownDeck: DeckFile | undefined;
let shownWord: { readonly word: Word; readonly deckId: string } | undefined;

function loadCatalog(): Promise<CatalogIndex> {
  if (!source) return Promise.reject(new Error('Catalog not ready'));
  catalog ??= source.index().catch(error => { catalog = undefined; throw error; });
  return catalog;
}
function loadDeck(id: string): Promise<DeckFile> {
  let file = deckFiles.get(id);
  if (!file) {
    if (!source) return Promise.reject(new Error('Catalog not ready'));
    file = source.deck(id).catch(error => { deckFiles.delete(id); throw error; });
    deckFiles.set(id, file);
  }
  return file;
}

/** Placeholder substitution without String.replace patterns ($&, $', …) in values. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const link = (route: Route, text: string): HTMLAnchorElement => { const a = node('a', text); a.href = routeHash(route); return a; };
const formatDate = (iso: string): string => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const headword = (word: Word): string => [word.article, word.lemma].filter(Boolean).join(' ');
const translation = (): TranslationLanguage => $<HTMLSelectElement>('translation').value as TranslationLanguage;
const exerciseNames = (): Record<Exclude<WordExerciseId, 'introduction'>, string> => {
  const cards = cardUiTranslations(language); const lang = translation().toUpperCase();
  return { 'meaning-choice': `LA → ${lang}`, 'target-choice': `${lang} → LA`, 'meaning-recall': cards.revealTitle,
    'target-type': cards.wordTypeTitle, 'article-choice': cards.articleTitle, 'target-with-article-type': cards.wordArticleTypeTitle };
};
function componentNames(): Record<Component, string> {
  const labels = sessionUiTranslations(language); const cards = cardUiTranslations(language);
  return { recognition: labels.recognitionComponent, recall: cards.recallComponent, spelling: cards.spellingComponent, article: cards.articleComponent };
}

function localize(): void {
  const labels = sessionUiTranslations(language); const home = homeUiTranslations(language);
  document.documentElement.lang = language;
  $('title').textContent = home.homeTitle; $('languageLabel').textContent = labels.interfaceLanguage;
  $('continueTitle').textContent = home.continueTitle; $('continueAction').textContent = home.continueAction;
  $('continueFinish').textContent = labels.finish;
  $('deckSearchLabel').textContent = home.searchDecks; $('wordSearchLabel').textContent = home.searchWords;
  $('wordsHeading').textContent = home.wordsHeading;
  $('wordSortLabel').textContent = home.wordSortLabel; $('wordPartLabel').textContent = home.wordPartLabel;
  for (const [id, values, labels] of [['wordSort', ['deck', 'az', 'weak', 'strong'], home.wordSorts], ['wordPart', ['all', 'noun', 'verb', 'adjective', 'adverb', 'other'], home.wordParts]] as const) {
    const select = $<HTMLSelectElement>(id); const value = select.value;
    select.replaceChildren(...values.map((value, i) => { const option = node('option', labels[i]); option.value = value; return option; }));
    if (value) select.value = value;
  }

  $('exerciseLabel').textContent = labels.exercise; $('translationLabel').textContent = labels.translation;
  $('formatLabel').textContent = labels.format; $('scopeLabel').textContent = labels.scope;
  const format = $<HTMLSelectElement>('format').options; format[0]!.textContent = labels.single; format[1]!.textContent = labels.circuit;
  const scope = $<HTMLSelectElement>('scope').options; scope[0]!.textContent = labels.dueComponents; scope[1]!.textContent = labels.allExercises;
  const names = exerciseNames();
  Array.from($<HTMLSelectElement>('exercise').options).forEach(option => { option.textContent = names[option.value as keyof typeof names]; });
  for (const name of Object.keys(buttons) as (keyof typeof buttons)[])
    buttons[name].textContent = name === 'new' ? home.toDeck : labels[name];
}

/** The exercise menu comes from the shared registry; the introduction is part of learning, not a choice. */
function buildExerciseOptions(): void {
  const select = $<HTMLSelectElement>('exercise');
  select.replaceChildren(...WORD_EXERCISE_IDS.filter(id => id !== 'introduction').map(id => {
    const option = node('option'); option.value = id; return option;
  }));
}

/** A circuit has no exercise choice; only review chooses between due components and all exercises. */
function syncSetup(): void {
  const circuit = $<HTMLSelectElement>('format').value === 'circuit';
  $('exerciseField').hidden = circuit;
  $('scopeField').hidden = !circuit;
}

/** New words are always a five-word circuit through every exercise; the format choice applies to review only. */
function request(intent: 'learn-new' | 'review-due', deckId: string): SessionRequest {
  const format = intent === 'learn-new' || $<HTMLSelectElement>('format').value === 'circuit'
    ? { format: 'circuit', circuitScope: intent === 'review-due' ? $<HTMLSelectElement>('scope').value : 'all-exercises' }
    : { format: 'single', exerciseId: $<HTMLSelectElement>('exercise').value as WordExerciseId };
  return { deckId, answerLanguage: translation(), intent, ...format } as SessionRequest;
}

function renderSummary(result: VocabularySessionSummary | undefined, deckId: string | undefined): void {
  summary.hidden = !result;
  if (!result) { summary.replaceChildren(); return; }
  const labels = sessionUiTranslations(language); const cards = cardUiTranslations(language);
  const names = componentNames();
  const results = { correct: labels.resultCorrect, incorrect: labels.resultIncorrect, corrected: labels.resultCorrected, unobserved: labels.resultUnobserved };
  const title = node('h2', labels.summaryTitle); title.id = 'summaryTitle';
  const totals = node('p', fill(labels.summaryTotals, { tasks: String(result.tasks), answered: String(result.answered), mistakes: String(result.mistakes) }));
  const words = result.words.map(word => {
    const article = node('article'); article.lang = 'la';
    const components = node('ul');
    for (const item of word.components) {
      const line = node('li', `${names[item.component]}: ${results[item.result]}`); line.dataset.result = item.result; line.lang = language;
      components.append(line);
    }
    const mistakes = node('ul');
    for (const mistake of word.mistakes) {
      const rating = mistake.exerciseId === 'meaning-recall';
      const given = node('span', rating ? (mistake.given === 'forgotten' ? cards.forgotten : cards.remembered) : mistake.given);
      given.lang = rating ? language : mistake.lang;
      const expected = node('span', mistake.expected); expected.lang = mistake.lang;
      const line = node('li'); line.lang = language; line.dataset.result = mistake.corrected ? 'corrected' : 'incorrect';
      // Answers are user text: placed as nodes, never interpreted as replacement patterns or HTML.
      const parts = labels.mistakeLine.split(/(\{given\}|\{expected\})/);
      line.append(...parts.map(part => part === '{given}' ? given : part === '{expected}' ? expected : document.createTextNode(part)),
        ` — ${mistake.corrected ? labels.corrected : labels.notCorrected}`);
      mistakes.append(line);
    }
    const heading = node('p', word.mistakes.length ? labels.mistakes : labels.noMistakes); heading.lang = language;
    // The word card shows the progress this session just changed.
    const name = node('h3'); name.append(link({ view: 'word', wordId: word.wordId, ...(deckId ? { deckId } : {}) }, word.label));
    article.append(name, components, heading, ...(word.mistakes.length ? [mistakes] : []));
    return article;
  });
  summary.replaceChildren(title, totals, ...words);
}

function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

/** Swapping cards briefly empties the page and the browser jumps to the top; a new task starts at the session instead. */
let revealedTask = '';
function revealTask(key: string): void {
  if (key === revealedTask) return;
  revealedTask = key;
  const box = sections.session.getBoundingClientRect();
  if (box.top < 0 || box.bottom > innerHeight) window.scrollTo({ top: scrollY + box.top, behavior: 'instant' });
}

function noticeText(view?: RunnerView): string {
  const labels = sessionUiTranslations(language); const home = homeUiTranslations(language);
  if (view?.error === 'save') return labels.saveError;
  if (view?.error === 'conflict') return labels.conflict;
  if (view?.phase === 'paused') return labels.paused;
  if (view?.phase === 'completed') return labels.completed;
  if (view?.phase === 'abandoned') return labels.abandoned;
  if (!message) return '';
  return message === 'catalogError' || message === 'deckNotFound' || message === 'wordNotFound' ? home[message] : labels[message];
}

function render(input?: RunnerView): void {
  // This page runs vocabulary sessions only; item sessions have their family's own pages (M1–M8).
  const view = input?.family === 'vocabulary' ? input : undefined;
  const labels = sessionUiTranslations(language);
  const terminal = view?.phase === 'completed' || view?.phase === 'abandoned';
  progress.textContent = view && !terminal ? (view.correction ? `${labels.correctionRound} · ` : '') +
    fill(labels.progress, { n: String(view.taskIndex + 1), total: String(view.total) }) : '';
  renderSummary(view?.summary, view?.request.deckId);
  notice.textContent = noticeText(view);
  notice.setAttribute('role', view?.error || message === 'catalogError' || message === 'loadError' ? 'alert' : 'status');
  const busy = !!view?.busy;
  const introduction = view?.task?.exerciseId === 'introduction';
  buttons.retry.hidden = view?.error !== 'save';
  buttons.pause.hidden = view?.phase !== 'presenting' && view?.phase !== 'feedback';
  buttons.resume.hidden = view?.phase !== 'paused';
  buttons.finish.hidden = !view || terminal;
  buttons.new.hidden = !terminal;
  Object.values(buttons).forEach(button => { button.disabled = busy; });
  // An introduction is shown only after its event is saved, i.e. in feedback.
  if (!view || !view.task || terminal || view.phase === 'paused' || view.phase === 'ready' ||
      (introduction && view.phase !== 'feedback')) { closeCard(); return; }
  const task = view.task;
  const answered = view.phase === 'feedback' && !introduction && view.answer;
  // The card is disabled while any Runner command, including a page-level one, is being saved.
  const presentation = { ...wordTaskPresentation(task, language, answered ? 'feedback' : 'question'), busy,
    ...(answered ? { feedback: wordTaskFeedback(task, view.answer!.evaluation, language) } : {}) };
  const taskKey = `${view.sessionId}|${!!view.correction}|${view.taskIndex}`;
  let liveCorrect = false;
  if (answered && lastPhase === `${taskKey}|presenting`) {
    const outcome = wordTaskFeedback(task, view.answer!.evaluation, language).kind;
    if (outcome === 'correct' || outcome === 'incorrect') playResultSound(outcome);
    liveCorrect = outcome === 'correct';
  }
  lastPhase = `${taskKey}|${view.phase}`;
  // A saved reveal (also one repeated by Retry) remounts the card in its revealed state.
  const key = `${view.sessionId}|${view.taskIndex}|${view.phase}|${view.revealed}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  const revealedNow = !!card && cardKey === `${view.sessionId}|${view.taskIndex}|${view.phase}|false` && view.revealed;
  closeCard(); cardKey = key;
  const active = runner!;
  const raw = view.answer?.rawAnswer;
  card = createCardShell(host, wordTaskCard(view.registry, task), presentation, {
    onSubmit: ({ value }) => saved(active.submit(value)),
    onContinue: () => saved(active.next()),
    onNext: () => saved(active.next()),
    onReveal: (_, kind) => kind === 'answer' ? saved(active.reveal()) : undefined,
    onSpeech() {},
  }, { value: answered && typeof raw === 'string' ? raw : '', revealed: view.revealed, submitted: !!answered, detailsOpen: false });
  revealTask(`${view.sessionId}|${!!view.correction}|${view.taskIndex}`);
  if (liveCorrect) card.readAloudAfterCorrect();
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
  else if (revealedNow) host.querySelector<HTMLButtonElement>('.dc-ratings button')?.focus();
}

/** A conflict means nothing was saved for this card: the card must stay answerable, not "accepted". */
async function saved(result: Promise<CommandResult>): Promise<void> {
  if (await result === 'conflict') throw new Error('Session changed elsewhere');
}

function attach(next: SessionRunner): void {
  detach(); message = undefined;
  runner = next; unsubscribe = next.subscribe(render); render(next.view);
}
/** Leaving the session screen releases the Runner; storage keeps the session for Continue. */
function detach(): void { unsubscribe?.(); unsubscribe = undefined; runner?.dispose(); runner = undefined; closeCard(); }

/** Commands report failures through the view; the retained command is repeated with Retry. */
function command(action: (r: SessionRunner) => Promise<unknown>): void {
  if (runner) action(runner).catch(() => { if (runner) render(runner.view); });
}

function go(route: Route): void {
  const hash = routeHash(route);
  if (location.hash === hash || (hash === '#' && !location.hash)) void navigate(); else location.hash = hash;
}

let starting = false;
async function start(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const intent = (event.submitter as HTMLButtonElement | null)?.value as 'learn-new' | 'review-due' | undefined;
  if (!scope || !shownDeck || !intent || starting || openSession) return;
  starting = true; Object.values(intents).forEach(button => { button.disabled = true; });
  try { await plan(scope, shownDeck, intent); } finally { starting = false; if (current.view === 'deck') renderDeck(); }
}

/** Distractors come from the whole published catalog, exactly as the server rebuilds them: a deck-only pool would pick different options and the server would reject the task. */
async function catalogWords(file: DeckFile): Promise<readonly Word[]> {
  const index = await loadCatalog();
  const files = await Promise.all(index.decks.map(deck => deck.id === file.deck.id ? file : loadDeck(deck.id)));
  const byId = new Map<string, Word>();
  for (const { words } of files) for (const word of words) byId.set(word.id, word);
  return [...byId.values()];
}

async function plan(scope: RunnerStore, file: DeckFile, intent: 'learn-new' | 'review-due'): Promise<void> {
  const seq = navigation;
  const at = env.now();
  const data = await scope.restore(at);
  const pool = await catalogWords(file);
  const planned = planVocabularySession({ request: request(intent, file.deck.id), deck: file.deck, words: pool,
    progress: data.projections.map(item => item.progress), owner: scope.owner, dataEpoch: scope.epoch.dataEpoch,
    sessionId: env.id(), seed: env.id(), catalogVersion: file.catalogVersion, at,
    studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  if (planned.kind === 'empty') {
    message = planned.reason === 'no-new-words' ? 'noNewWords' : planned.reason === 'no-due-words' ? 'noDueWords' : 'noApplicableTasks';
    notice.textContent = noticeText(); return;
  }
  // The session pins the catalog's words as its snapshot: reload never reads a newer catalog.
  const started = await SessionRunner.start(scope, env, { state: { plan: planned.plan, status: 'ready', taskIndex: 0, revision: 0 },
    words: pool, catalogVersion: file.catalogVersion });
  // The user moved on while it was being saved: keep the session for Continue, honour the navigation.
  if (seq !== navigation) { started.dispose(); void navigate(); return; }
  attach(started);
  go({ view: 'session' });
}

async function refreshProgress(scope: RunnerStore): Promise<void> {
  const data = await scope.restore(env.now());
  projections = data.projections.map(item => item.progress);
  // Item sessions (M1–M8) continue on their family's page.
  const open = data.sessions.filter(s => !isItemSessionPlan(s.state.plan) && s.state.status !== 'completed' && s.state.status !== 'abandoned')
    .sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  openSession = open ? { id: open.state.plan.sessionId, deckId: (open.state.plan as VocabularySessionPlan).request.deckId,
    taskIndex: open.state.taskIndex, total: sessionTasks(open.state).length } : undefined;
}

/** The Continue panel is renderContinue's, except that a session screen never shows it. */
function show(view: Route['view']): void {
  for (const [name, section] of Object.entries(sections)) if (name !== 'continue') section.hidden = name !== view;
  if (view === 'session') sections.continue.hidden = true;
}

async function renderContinue(): Promise<void> {
  const home = homeUiTranslations(language);
  sections.continue.hidden = !openSession || current.view === 'session';
  if (!openSession || current.view === 'session') return;
  const index = await loadCatalog().catch(() => undefined);
  const title = index?.decks.find(deck => deck.id === openSession!.deckId)?.title ?? openSession.deckId;
  $('continueLine').textContent = fill(home.continueLine, { deck: title, n: String(openSession.taskIndex + 1), total: String(openSession.total) });
}

async function renderHome(): Promise<void> {
  const home = homeUiTranslations(language);
  document.title = `Latin DrillCards · ${home.homeTitle}`;
  const list = $<HTMLUListElement>('decks');
  const index = await loadCatalog();
  const decks = searchDecks(index.decks, $<HTMLInputElement>('deckSearch').value);
  list.replaceChildren(...decks.map(deck => {
    const item = node('li'); const a = link({ view: 'deck', deckId: deck.id }, '');
    const total = deck.wordIds.length; const started = startedCount(deck, projections);
    // CEFR decks are tinted by level, themed decks share one tint; the meter repeats the counts visually.
    a.dataset.level = /^[abc][12]$/.test(deck.id) ? deck.id : 'themed';
    const meter = node('span', undefined, 'dc-deck-meter'); meter.setAttribute('aria-hidden', 'true');
    const done = node('span'); done.style.setProperty('--dc-done', `${started ? Math.max(2, Math.round(started / total * 100)) : 0}%`); meter.append(done);
    a.append(node('strong', deck.title), node('span', fill(home.deckCounts,
      { total: String(total), started: String(started) })), meter);
    item.append(a); return item;
  }));
  if (!decks.length) list.append(node('li', home.noDecks, 'dc-empty'));
}

function overview(): DeckOverview {
  return deckOverview({ request: request('learn-new', shownDeck!.deck.id), deck: shownDeck!.deck, words: shownDeck!.words,
    progress: projections, owner: scope!.owner, at: env.now() });
}

/** Counts are the planner's own queues for the chosen format, exercise and translation language. */
function renderDeck(): void {
  if (!shownDeck || !scope) return;
  const home = homeUiTranslations(language);
  const stats = overview();
  document.title = `Latin DrillCards · ${shownDeck.deck.title}`;
  $('deckBack').textContent = home.allDecks;
  $('deckTitle').textContent = shownDeck.deck.title;
  $('deckStats').textContent = fill(home.deckStats, { total: String(stats.total), started: String(stats.started),
    fresh: String(stats.fresh), due: String(stats.due) });
  intents['learn-new'].textContent = fill(home.learnNewCount, { n: String(stats.fresh) });
  intents['review-due'].textContent = fill(home.reviewDueCount, { n: String(stats.due) });
  const texts: Record<string, string> = { 'all-started': home.emptyAllStarted, 'no-translation': home.emptyNoTranslation,
    'nothing-started': home.emptyNothingStarted, 'not-due-yet': home.emptyNotDueYet };
  for (const intent of ['learn-new', 'review-due'] as const) {
    const reason = emptyQueueReason(intent, stats);
    const empty = $<HTMLParagraphElement>(intent === 'learn-new' ? 'learnNewEmpty' : 'reviewDueEmpty');
    empty.hidden = !reason;
    empty.textContent = !reason ? '' : reason === 'not-for-exercise'
      ? (intent === 'learn-new' ? home.emptyNewNotForExercise : home.emptyDueNotForExercise)
      : reason === 'not-due-yet' && stats.nextDueAt ? `${texts[reason]} ${fill(home.nextDue, { date: formatDate(stats.nextDueAt) })}` : texts[reason]!;
    intents[intent].disabled = !!reason || !!openSession || starting;
  }
  const blocked = $<HTMLParagraphElement>('blocked');
  blocked.hidden = !openSession; blocked.textContent = openSession ? home.openSessionBlocks : '';
}

const STATE_LABELS = { new: 'stateNew', learning: 'stateLearning', scheduled: 'stateScheduled', due: 'stateDue' } as const;
let wordFilter = 'all';
const FILTERS = ['all', 'due', 'new', 'learning', 'unsettled', 'learned'] as const;
const STATUS_LABELS = { new: 'stateNew', learning: 'stateLearning', unsettled: 'stateUnsettled', learned: 'stateLearned' } as const;

/** Per-exercise progress of one word, collapsed by default. Counts come from the shared component progress. */
function wordStatusDetails(word: Word): HTMLDetailsElement {
  const home = homeUiTranslations(language);
  const status = describeWordStatus(word, projections.find(item => item.wordId === word.id), translation());
  const exercises = exerciseNames(); const components = componentNames();
  const details = node('details', undefined, 'dc-wstatus'); const summary = node('summary');
  const name = node('span', headword(word), 'dc-word-name'); name.lang = 'la';
  const meaning = node('span', word.meanings[translation()]?.preferred ?? '', 'dc-word-meaning'); meaning.lang = translation();
  const heading = node('span', undefined, 'dc-word-heading'); heading.append(name, meaning);
  summary.append(heading);

  const overall = node('span', home[STATUS_LABELS[status.state]], 'dc-state'); overall.dataset.state = status.state;
  const right = node('span', undefined, 'dc-word-right');
  const due = wordSummary(word, projections, env.now()).state === 'due';
  right.append(overall, node('small', due ? home.dueNow : home.statusDetails)); summary.append(right);
  const mini = node('span', undefined, 'dc-word-mini');
  for (const component of status.components) mini.append(node('span', `${components[component.component]} ${Math.min(component.reviews, component.requiredReviews)} / ${component.requiredReviews}`));
  summary.append(mini);
  const rows = node('div', undefined, 'dc-wstatus-rows'); rows.setAttribute('role', 'list');
  for (const item of status.exercises) {
    const row = node('div', undefined, 'dc-wstatus-row'); row.setAttribute('role', 'listitem'); row.dataset.exercise = item.exerciseId; row.dataset.done = String(item.done);
    const trains = fill(home.statusAssesses, { components: item.components.map(name => components[name]).join(', ') });
    const label = node('span', undefined, 'dc-wstatus-name'); label.append(node('span', exercises[item.exerciseId]), node('small', trains));
    row.append(label);
    if (item.available) {
      const pips = node('span', undefined, 'dc-pips'); pips.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < item.required; i++) pips.append(node('span', undefined, i < item.reviews ? 'on' : ''));
      row.append(pips, node('span', `${Math.min(item.reviews, item.required)} / ${item.required}${item.done ? ` · ${home.statusDone}` : ''}`, 'dc-wstatus-count'));
    } else row.append(node('span', item.unavailableReason === 'no-article' ? home.statusNoArticle : home.statusNoTranslation, 'dc-wstatus-count'));
    rows.append(row);
  }
  const stability = node('div', undefined, 'dc-wstatus-stability'); stability.setAttribute('role', 'list');
  for (const item of status.components) if (item.stage !== 'unintroduced')
    stability.append(node('div', `${components[item.component]}: ${fill(home.statusStability, { days: String(Math.round(item.stability)), need: String(item.requiredStability) })}`));
  const first = status.components[0];
  const body = node('div', undefined, 'dc-word-progress');
  body.append(rows, stability, node('p', first ? fill(home.statusRule, { reviews: String(first.requiredReviews), days: String(first.requiredStability) }) : '', 'dc-note'), link({ view: 'word', wordId: word.id, deckId: shownDeck!.deck.id }, home.openWord));
  details.append(summary, body);
  return details;
}
function renderWords(): void {
  if (!shownDeck) return;
  const home = homeUiTranslations(language); const at = env.now(); const lang = translation();
  const list = $<HTMLUListElement>('words');
  const entries = shownDeck.words.map(word => ({ word, status: describeWordStatus(word, projections.find(item => item.wordId === word.id), lang), due: wordSummary(word, projections, at).state === 'due' }));
  const matches = (entry: typeof entries[number], filter: string) => filter === 'all' || (filter === 'due' ? entry.due : entry.status.state === filter);
  $('wordFilters').replaceChildren(...FILTERS.map((filter, i) => {
    const button = node('button', `${home.wordFilters[i]} · ${entries.filter(entry => matches(entry, filter)).length}`); button.type = 'button';
    button.setAttribute('aria-pressed', String(wordFilter === filter)); button.addEventListener('click', () => { wordFilter = filter; renderWords(); }); return button;
  }));
  const searched = new Set(searchWords(shownDeck.words, $<HTMLInputElement>('wordSearch').value));
  const part = $<HTMLSelectElement>('wordPart').value;
  const filtered = entries.filter(entry => searched.has(entry.word) && matches(entry, wordFilter) && (part === 'all' || entry.word.partOfSpeech === part));
  const sort = $<HTMLSelectElement>('wordSort').value;
  const strength = (entry: typeof entries[number]) => Math.min(...entry.status.components.map(component => component.stability));
  if (sort === 'az') filtered.sort((a, b) => a.word.lemma.localeCompare(b.word.lemma, 'de'));
  if (sort === 'weak') filtered.sort((a, b) => strength(a) - strength(b));
  if (sort === 'strong') filtered.sort((a, b) => Number(b.status.state === 'learned') - Number(a.status.state === 'learned') || strength(b) - strength(a));
  const words = filtered.map(entry => entry.word);
  $('wordResults').textContent = fill(home.wordResults, { shown: String(words.length), total: String(shownDeck.words.length) });
  const opened = new Set(Array.from(list.querySelectorAll<HTMLDetailsElement>('details[open]')).map(item => item.dataset.word));
  list.replaceChildren(...words.map(word => {
    const item = node('li'); const details = wordStatusDetails(word); details.dataset.word = word.id;
    details.open = opened.has(word.id); item.append(details); return item;
  }));
  if (!words.length) list.append(node('li', home.noWords, 'dc-empty'));
}

/** One wordId, one progress: the card reads the owner's projection, never a deck-local copy. */
function renderWord(index: CatalogIndex): void {
  if (!shownWord) return;
  const home = homeUiTranslations(language); const cards = cardUiTranslations(language);
  const { word, deckId } = shownWord;
  const result = wordSummary(word, projections, env.now());
  const stages = { unintroduced: home.stageUnintroduced, learning: home.stageLearning, review: home.stageReview, relearning: home.stageRelearning };
  const names = componentNames();
  document.title = `Latin DrillCards · ${headword(word)}`;
  $('wordBack').textContent = home.backToDeck;
  ($<HTMLAnchorElement>('wordBack')).href = routeHash({ view: 'deck', deckId });
  const title = node('h2', headword(word)); title.lang = 'la';
  const state = node('span', home[STATE_LABELS[result.state]], 'dc-state'); state.dataset.state = result.state;
  title.append(' ', state);
  const status = node('p', result.state === 'new' ? home.notStarted : result.state === 'due' ? home.dueNow
    : result.dueAt ? fill(home.nextDue, { date: formatDate(result.dueAt) }) : '');
  const components = node('ul', undefined, 'dc-components');
  for (const item of result.components) {
    const when = item.stage === 'unintroduced' ? '' : item.due ? ` · ${home.dueNow}`
      : item.dueAt ? ` · ${fill(home.dueOn, { date: formatDate(item.dueAt) })}` : '';
    const line = node('li', `${names[item.component]}: ${stages[item.stage]}${when}`); line.dataset.stage = item.stage;
    components.append(line);
  }
  const decks = node('p', `${home.inDecks} `);
  decksOfWord(index.decks, word.id).forEach((deck, i) => { if (i) decks.append(', '); decks.append(link({ view: 'deck', deckId: deck.id }, deck.title)); });
  $('wordCard').replaceChildren(title, status, node('h3', home.progressHeading), components, node('p', home.sharedProgress, 'dc-note'),
    decks, WordDetails(word, translation(), cards, false));
}

async function openRoute(route: Route, scope: RunnerStore, seq: number): Promise<void> {
  if (route.view === 'session') {
    if (!runner) {
      const open = await SessionRunner.latestOpenSession(scope);
      if (seq !== navigation) return;
      if (!open) { location.replace('#'); return; }
      const resumed = await SessionRunner.open(scope, env, open);
      if (seq !== navigation) { resumed.dispose(); return; }
      if (resumed.view.phase === 'paused') await resumed.resume().catch(() => {});
      if (seq !== navigation) { resumed.dispose(); return; }
      attach(resumed);
    }
    document.title = `Latin DrillCards · ${sessionUiTranslations(language).title}`;
    show('session'); render(runner!.view); return;
  }
  await refreshProgress(scope);
  const index = await loadCatalog();
  if (seq !== navigation) return;
  if (route.view === 'home') { show('home'); await renderHome(); }
  else if (route.view === 'deck') {
    if (!index.decks.some(deck => deck.id === route.deckId)) { message = 'deckNotFound'; show('home'); await renderHome(); }
    else {
      const file = await loadDeck(route.deckId);
      if (seq !== navigation) return;
      if (shownDeck?.deck.id !== file.deck.id) { $<HTMLInputElement>('wordSearch').value = ''; wordFilter = 'all'; $<HTMLSelectElement>('wordPart').value = 'all'; }
      shownDeck = file; show('deck'); renderDeck(); renderWords();
    }
  } else {
    const deckId = route.deckId && index.decks.find(deck => deck.id === route.deckId)?.wordIds.includes(route.wordId)
      ? route.deckId : decksOfWord(index.decks, route.wordId)[0]?.id;
    if (!deckId) { message = 'wordNotFound'; show('home'); await renderHome(); }
    else {
      const file = await loadDeck(deckId);
      if (seq !== navigation) return;
      shownWord = { word: file.words.find(word => word.id === route.wordId)!, deckId }; show('word'); renderWord(index);
    }
  }
  await renderContinue();
}

let navigation = 0;
async function navigate(): Promise<void> {
  const seq = ++navigation;
  current = parseRoute(location.hash);
  if (current.view !== 'session') detach();
  message = undefined;
  if (!scope) return;
  try { await openRoute(current, scope, seq); }
  catch { if (seq === navigation) message = 'catalogError'; }
  if (seq === navigation && current.view !== 'session') render();
}

let finishing = false;
async function finishOpen(): Promise<void> {
  if (!scope || !openSession || finishing) return;
  finishing = true;
  try {
    const open = await SessionRunner.open(scope, env, openSession.id);
    attach(open);
    await open.finish();
    go({ view: 'session' });
  } finally { finishing = false; }
}

async function init(): Promise<void> {
  buildExerciseOptions(); localize(); syncSetup();
  try {
    learning = await openLearningPage();
    source = learning.catalog; scope = learning.store;
  } catch {
    message = 'loadError'; render(); return;
  }
  await navigate();
}

const signal = page.signal;
setup.addEventListener('submit', event => { void start(event).catch(() => { message = 'loadError'; render(runner?.view); }); }, { signal });
buttons.retry.addEventListener('click', () => command(r => r.retry()), { signal });
buttons.pause.addEventListener('click', () => command(r => r.pause()), { signal });
buttons.resume.addEventListener('click', () => command(r => r.resume()), { signal });
buttons.finish.addEventListener('click', () => command(r => r.finish()), { signal });
buttons.new.addEventListener('click', () => {
  const deckId = (runner?.view.family === 'vocabulary' ? runner.view.request.deckId : undefined);
  go(deckId ? { view: 'deck', deckId } : { view: 'home' });
}, { signal });
$('continueAction').addEventListener('click', () => go({ view: 'session' }), { signal });
$('continueFinish').addEventListener('click', () => { void finishOpen().catch(() => { message = 'loadError'; render(runner?.view); }); }, { signal });
$('deckSearch').addEventListener('input', () => { void renderHome().catch(() => {}); }, { signal });
$('wordSearch').addEventListener('input', renderWords, { signal });
for (const id of ['wordPart', 'wordSort']) $(id).addEventListener('change', renderWords, { signal });
$('language').addEventListener('change', event => {
  language = (event.target as HTMLSelectElement).value as Lang; localize();
  if (current.view === 'session') { document.title = `Latin DrillCards · ${sessionUiTranslations(language).title}`; render(runner?.view); }
  else void navigate();
}, { signal });
$('translation').addEventListener('change', () => { localize(); renderDeck(); renderWords(); }, { signal });
for (const id of ['format', 'scope', 'exercise']) $(id).addEventListener('change', () => { syncSetup(); renderDeck(); }, { signal });
window.addEventListener('hashchange', () => { void navigate(); }, { signal });
// Leaving the page releases the card, runner subscription, DOM listeners and the connection.
window.addEventListener('pagehide', () => { detach(); page.abort(); learning?.dispose(); }, { once: true });
// A page restored from the back/forward cache has no live runner: start over from storage.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void init();
