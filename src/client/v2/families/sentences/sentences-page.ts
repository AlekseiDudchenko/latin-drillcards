import { createItemExerciseRegistry, isItemSessionPlan, planItemSession, projectExerciseProgress, sentenceContent,
  type ItemDataset, type ItemExerciseRegistry, type ItemExerciseTask, type SentenceExercise, type TranslationLanguage } from '../../core/index.js';
import { cardUiTranslations, type Lang } from '../../../i18n.js';
import { createCardShell } from '../../card-shell.js';
import { createCardSpeech } from '../../card-speech.js';
import { SessionRunner, type ItemRunnerView, type RunnerEnvironment } from '../../session-runner.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { tokenAnswerText } from '../../token-state.js';
import { fill, sentenceUiTranslations } from './sentences-i18n.js';
import { filterHash, formatTag, linkedSentences, nextSentence, parseFilter, pool, poolStats, SENTENCE_DATASET, SENTENCE_DECKS,
  SENTENCE_EXERCISE, sentenceStats, tagsOf, type SentenceFilter } from './sentences-model.js';

// M1 (#333): Sentence Builder on the shared Runner, journal and outbox. Each sentence is one
// single-task item session, so Next/Previous/variant/tense switches never lose an answer and
// never write one twice: a switch completes (answered) or abandons (unanswered) the shown session.
// Same owner's journal as session-page (learning-context), so both pages share one journal.
const DATASET = new URL('../../../data/items/sentences.json', import.meta.url);
const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const controls = { deck: $<HTMLSelectElement>('deck'), tag: $<HTMLSelectElement>('tag'), language: $<HTMLSelectElement>('language'),
  translation: $<HTMLSelectElement>('translation'), autoSpeak: $<HTMLInputElement>('autoSpeak') };
const buttons = { previous: $<HTMLButtonElement>('previous'), variant: $<HTMLButtonElement>('variant'),
  tryAgain: $<HTMLButtonElement>('tryAgain'), retry: $<HTMLButtonElement>('retrySave') };
const page = new AbortController();
const speech = createCardSpeech();

let language: Lang = stored('dc_v2_lang', ['ru', 'en', 'de']) as Lang ?? 'ru';
let translation: TranslationLanguage = stored('dc_v2_sentence_translation', ['ru', 'en']) as TranslationLanguage ?? 'ru';
let filter: SentenceFilter = parseFilter(location.hash);
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
/** Shown sentences of this visit, for Previous: the item and the seed of its token order. */
const visited: { readonly itemId: string; readonly seed: string }[] = [];
let progress: ReturnType<typeof projectExerciseProgress> | undefined;

function stored(key: string, allowed: readonly string[]): string | undefined {
  try { const value = localStorage.getItem(key); return value && allowed.includes(value) ? value : undefined; } catch { return undefined; }
}
function store(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
/** Retries are marked per session, so an answer after seeing the solution is never independent. */
const ASSISTED_KEY = 'dc_v2_sentence_assisted';
function assistedSessions(): string[] {
  try { return JSON.parse(sessionStorage.getItem(ASSISTED_KEY) ?? '[]') as string[]; } catch { return []; }
}
function markAssisted(sessionId: string): void {
  try { sessionStorage.setItem(ASSISTED_KEY, JSON.stringify([...assistedSessions().slice(-50), sessionId])); } catch { /* best effort */ }
}
const autoSpeakOn = (): boolean => stored('auto_speak', ['0', '1']) === '1';

function view(): ItemRunnerView | undefined {
  const current = runner?.view;
  return current?.family === 'items' ? current : undefined;
}
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

async function show(itemId: string, options: { seed?: string; assisted?: boolean; remember?: boolean } = {}): Promise<void> {
  if (!scope || !registry || !dataset || busy) return;
  busy = true; render();
  try {
    await leave();
    const shown = view();
    if (shown && options.remember !== false) visited.push({ itemId: shown.plan.tasks[0]!.target.itemId, seed: shown.plan.seed });
    const sessionId = env.id(); const seed = options.seed ?? env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed, createdAt: env.now(),
      answerLanguage: translation, datasetId: SENTENCE_DATASET, items: [{ itemId, exerciseId: SENTENCE_EXERCISE }] });
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
  const id = nextSentence(registry, progress, filter, currentItemId());
  if (id) await show(id); else { failure = 'noData'; render(); }
}
async function goPrevious(): Promise<void> {
  const previous = visited.pop();
  // A returned-to sentence was already seen with its solution: the new attempt is assisted.
  if (previous) await show(previous.itemId, { seed: previous.seed, assisted: true, remember: false });
}
async function tryAgain(): Promise<void> {
  const current = view();
  if (current) await show(current.plan.tasks[0]!.target.itemId, { seed: current.plan.seed, assisted: true, remember: false });
}

function localize(): void {
  const labels = sentenceUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${labels.title}`;
  $('title').textContent = labels.title;
  $('languageLabel').textContent = labels.interfaceLanguage;
  $('translationLabel').textContent = labels.translation;
  $('deckLabel').textContent = labels.deck;
  $('tagLabel').textContent = labels.topic;
  $('autoSpeakLabel').textContent = labels.autoSpeak;
  $('keyboard').textContent = labels.keyboard;
  buttons.previous.textContent = labels.previous;
  buttons.variant.textContent = labels.variant; buttons.tryAgain.textContent = labels.tryAgain; buttons.retry.textContent = labels.retrySave;
  controls.deck.replaceChildren(...['all', ...SENTENCE_DECKS].map(deck => option(deck, deck === 'all' ? labels.allLevels : deck.toUpperCase())));
  controls.deck.value = filter.deck;
  renderTags();
}
function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
}
function renderTags(): void {
  if (!dataset) return;
  const tags = tagsOf(dataset, filter.deck);
  controls.tag.replaceChildren(option('', sentenceUiTranslations(language).allTopics), ...tags.map(tag => option(tag, formatTag(tag))));
  controls.tag.value = filter.tag && tags.includes(filter.tag) ? filter.tag : '';
}

function exerciseOf(task: ItemExerciseTask): SentenceExercise { return task.specification.exercise as unknown as SentenceExercise; }

function render(): void {
  const labels = sentenceUiTranslations(language);
  const current = view();
  const notice = $('notice');
  notice.textContent = failure ? labels[failure] : current?.error === 'save' ? labels.saveError : '';
  notice.setAttribute('role', failure === 'loadError' || current?.error ? 'alert' : 'status');
  const disabled = busy || !!current?.busy;
  Object.values(buttons).forEach(button => { button.disabled = disabled; });
  buttons.retry.hidden = current?.error !== 'save';
  buttons.previous.disabled ||= visited.length === 0;
  const task = current?.task;
  const answered = current?.phase === 'feedback' && current.answer;
  buttons.tryAgain.hidden = !answered || current?.answer?.evaluation.outcome === 'correct';
  renderMeta(task);
  if (!current || !task || (current.phase !== 'presenting' && current.phase !== 'feedback')) { closeCard(); return; }
  const exercise = exerciseOf(task);
  const feedback = answered ? current.answer!.evaluation.outcome === 'correct'
    ? { kind: 'correct' as const, message: labels.correct } : { kind: 'incorrect' as const, message: fill(labels.wrong, { target: exercise.target }) } : undefined;
  // Speech would read the solution: it is offered only once the answer is saved.
  const presentation = { language, busy: disabled, permissions: { reveal: false, details: false, speech: !!answered }, ...(feedback ? { feedback } : {}) };
  const key = `${current.sessionId}|${current.phase}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  closeCard(); cardKey = key;
  const tokens = exercise.tokens.map(token => ({ id: token.id, text: token.text }));
  const raw = answered && Array.isArray(current.answer!.rawAnswer) ? current.answer!.rawAnswer as string[] : undefined;
  const placement = raw ? { answer: raw, pool: tokens.map(t => t.id).filter(id => !raw.includes(id)) } : undefined;
  const active = runner!;
  const assisted = assistedSessions().includes(current.sessionId);
  card = createCardShell(host, { id: task.id, title: Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, cardUiTranslations(lang).sentenceAssemblyTitle])) as Record<Lang, string>,
    prompt: exercise.prompt, input: { kind: 'tokens', answerLang: 'la', tokens, autoSubmit: false }, translationLanguage: task.specification.answerLanguage,
    speechText: exercise.target }, presentation, {
    async onSubmit(answer) {
      const result = await active.submit([...(answer.tokens ?? [])], { assisted });
      if (result === 'conflict') throw new Error('Session changed elsewhere');
      await refreshProgress().catch(() => {}); render();
      if (active.view.answer?.evaluation.outcome === 'correct' && autoSpeakOn()) void speech.speak(exercise.target);
    },
    onNext: goNext,
    onReveal() {}, onSpeech() {},
  }, placement ? { value: tokenAnswerText(tokens, placement), revealed: false, submitted: true, detailsOpen: false, tokens: placement } : undefined);
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
}

function renderMeta(task?: ItemExerciseTask): void {
  const labels = sentenceUiTranslations(language);
  const meta = $('meta'); const extra = $('extra'); const tenses = $('tenses'); const stats = $('stats');
  meta.textContent = ''; extra.replaceChildren(); tenses.replaceChildren(); stats.textContent = '';
  buttons.variant.hidden = true;
  if (!task || !dataset || !registry) return;
  const item = registry.getItem(SENTENCE_DATASET, task.target.itemId);
  const content = sentenceContent(item.content)!;
  meta.textContent = [fill(labels.level, { level: content.level }), ...content.tags.map(formatTag), item.id].join(' · ');
  const linked = linkedSentences(dataset, item.id);
  buttons.variant.hidden = !linked.variant;
  if (linked.tenses.length) {
    const group = document.createElement('div'); group.className = 'dc-tense-buttons'; group.setAttribute('role', 'group');
    group.setAttribute('aria-label', labels.tenses);
    for (const tense of linked.tenses) {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = tense.label; node.dataset.tenseId = tense.id;
      node.setAttribute('aria-pressed', String(tense.id === item.id)); node.disabled = busy || tense.id === item.id;
      node.addEventListener('click', () => { void show(tense.id).catch(() => { failure = 'loadError'; render(); }); });
      group.append(node);
    }
    tenses.append(group);
  }
  // Translations other than the prompt's, as the v1 hint toggles (RU/EN/ES where present).
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
  if (progress) {
    const own = sentenceStats(progress, item.id);
    const all = poolStats(registry, progress, filter);
    stats.textContent = `${own ? fill(labels.sentenceStats, { answers: String(own.answers), independent: String(own.independent) }) : labels.sentenceNew} · ` +
      fill(labels.poolStats, { attempted: String(all.attempted), total: String(all.total),
        accuracy: all.accuracy === null ? '—' : `${Math.round(all.accuracy * 100)}%` });
  }
}
function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

async function applyFilter(next: SentenceFilter): Promise<void> {
  filter = next; visited.length = 0;
  if (location.hash !== filterHash(next)) window.history.replaceState(null, '', filterHash(next));
  renderTags();
  if (!dataset || !pool(dataset, filter).length) { failure = 'noData'; await leave().catch(() => {}); runner?.dispose(); runner = undefined; render(); return; }
  failure = undefined;
  if (currentItemId() && pool(dataset, filter).some(item => item.id === currentItemId())) { render(); return; }
  await goNext();
}

async function init(): Promise<void> {
  controls.language.value = language; controls.translation.value = translation; controls.autoSpeak.checked = autoSpeakOn();
  localize();
  try {
    const response = await fetch(DATASET);
    if (!response.ok) throw new Error(`Dataset: ${response.status}`);
    dataset = await response.json() as ItemDataset;
    registry = createItemExerciseRegistry([dataset]);
    learning = await openLearningPage();
    scope = learning.store;
    await refreshProgress();
  } catch { failure = 'loadError'; render(); return; }
  localize();
  // A reload continues the sentence that was shown: its session is still open in storage
  // (only an assembly one: listening sessions use the same dataset, see listening-page).
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && s.state.plan.tasks[0]?.exerciseId === SENTENCE_EXERCISE &&
    s.state.plan.datasets.some(d => d.datasetId === SENTENCE_DATASET) &&
    !['completed', 'abandoned'].includes(s.state.status)).sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  const openId = open?.state.plan.sessionId;
  const resumable = open && open.datasets?.[0]?.version === dataset.version && pool(dataset, filter)
    .some(item => isItemSessionPlan(open.state.plan) && item.id === open.state.plan.tasks[0]?.target.itemId);
  if (openId && resumable) {
    const resumed = await SessionRunner.open(scope, env, openId);
    if (resumed.view.phase === 'paused') await resumed.resume().catch(() => {});
    attach(resumed); render();
  } else {
    if (openId) await SessionRunner.open(scope, env, openId).then(old => old.finish().finally(() => old.dispose())).catch(() => {});
    await applyFilter(filter);
  }
}

const signal = page.signal;
const guard = (action: () => Promise<void>) => () => { void action().catch(() => { render(); }); };
buttons.previous.addEventListener('click', guard(goPrevious), { signal });
buttons.tryAgain.addEventListener('click', guard(tryAgain), { signal });
buttons.variant.addEventListener('click', guard(async () => {
  const id = currentItemId(); const variant = id && dataset ? linkedSentences(dataset, id).variant : undefined;
  if (variant) await show(variant);
}), { signal });
buttons.retry.addEventListener('click', guard(async () => { await runner?.retry(); }), { signal });
controls.deck.addEventListener('change', guard(() => applyFilter({ deck: controls.deck.value })), { signal });
controls.tag.addEventListener('change', guard(() => applyFilter({ deck: filter.deck, ...(controls.tag.value ? { tag: controls.tag.value } : {}) })), { signal });
controls.language.addEventListener('change', () => {
  language = controls.language.value as Lang; store('dc_v2_lang', language); localize(); render();
}, { signal });
// The shown task keeps its pinned prompt language; the next sentence uses the new one.
controls.translation.addEventListener('change', () => { translation = controls.translation.value as TranslationLanguage; store('dc_v2_sentence_translation', translation); }, { signal });
controls.autoSpeak.addEventListener('change', () => store('auto_speak', controls.autoSpeak.checked ? '1' : '0'), { signal });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  // Token buttons use the arrows and Enter themselves; form fields keep their own keys.
  if (target?.closest('.dc-tokens, select, input, textarea, summary, .dc-tense-buttons')) return;
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
