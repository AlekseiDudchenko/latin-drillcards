import { isItemSessionPlan, sessionTasks, vocabularyQueues, type SessionRequest, type VocabularySessionPlan } from './core/index.js';
import { homeUiTranslations, sessionUiTranslations, type Lang } from '../i18n.js';
import { openLearningPage } from './account-bar.js';
import { startedCount, type CatalogIndex } from './home-model.js';
import { storedLanguage, storeLanguage } from './interface-language.js';
import type { PageLearning } from './learning-context.js';
import { SessionRunner, type RunnerEnvironment, type RunnerStore } from './session-runner.js';
import { HUBS, SECTIONS } from './site-nav-model.js';
import { dailyProgress, dueDeck, focusDeck, type DailyProgress } from './today-model.js';
import { count, fill, TODAY_TEXT } from './today-i18n.js';

// "Today": where to go next. It reads the owner's projections and the catalog; every action is a link into
// the deck screen or a family page, so the planner and the Runner stay the only places a session starts.
const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};

interface DeckRow { readonly id: string; readonly title: string; readonly total: number; readonly started: number; readonly due: number }
interface Today {
  readonly daily: DailyProgress;
  readonly open?: { readonly id: string; readonly deckId: string; readonly taskIndex: number; readonly total: number };
  readonly decks: readonly DeckRow[];
  readonly dueTotal: number; readonly dueDeck?: string;
  readonly focus?: DeckRow & { readonly fresh: number };
  readonly titles: ReadonlyMap<string, string>;
}

const page = new AbortController();
let language: Lang = storedLanguage();
let learning: PageLearning | undefined;
let scope: RunnerStore | undefined;
let today: Today | undefined;
let finishing = false;

async function load(learned: PageLearning): Promise<Today> {
  const store = learned.store; const at = env.now();
  const [index, data]: [CatalogIndex, Awaited<ReturnType<RunnerStore['restore']>>] = await Promise.all([learned.catalog.index(), store.restore(at)]);
  const progress = data.projections.map(item => item.progress);
  const context = { owner: store.owner, ...store.epoch, asOf: at };
  const answerLanguage = language === 'en' ? 'en' : 'ru';
  // One failed deck must not hide the others; its row simply has no due words.
  const files = await Promise.all(index.decks.map(deck => learned.catalog.deck(deck.id).catch(() => undefined)));
  const dueIds = new Set<string>(); const fresh = new Map<string, number>();
  const decks: DeckRow[] = index.decks.map((deck, i) => {
    const file = files[i]; let due = 0;
    if (file) {
      const queues = vocabularyQueues({ request: { deckId: deck.id, answerLanguage, intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises' } as SessionRequest,
        deck: file.deck, words: file.words, progress, owner: store.owner, at });
      due = queues.due.length; fresh.set(deck.id, queues.fresh.length);
      for (const item of queues.due) dueIds.add(item.word.id);
    }
    return { id: deck.id, title: deck.title, total: new Set(deck.wordIds).size, started: startedCount(deck, progress), due };
  });
  const vocabulary = data.sessions.filter(s => !isItemSessionPlan(s.state.plan));
  const last = [...vocabulary].sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  const unfinished = vocabulary.filter(s => s.state.status !== 'completed' && s.state.status !== 'abandoned')
    .sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  const focusId = focusDeck(decks, last ? (last.state.plan as VocabularySessionPlan).request.deckId : undefined);
  const focus = decks.find(deck => deck.id === focusId);
  const mostDue = dueDeck(new Map(decks.map(deck => [deck.id, deck.due])));
  return { daily: dailyProgress(data.facts, at, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), decks,
    dueTotal: dueIds.size, ...(mostDue ? { dueDeck: mostDue } : {}),
    ...(focus ? { focus: { ...focus, fresh: fresh.get(focus.id) ?? 0 } } : {}),
    ...(unfinished ? { open: { id: unfinished.state.plan.sessionId, deckId: (unfinished.state.plan as VocabularySessionPlan).request.deckId,
      taskIndex: unfinished.state.taskIndex, total: sessionTasks(unfinished.state).length } } : {}),
    titles: new Map(index.decks.map(deck => [deck.id, deck.title])) };
}

const deckHref = (id: string): string => `./session.html#deck=${encodeURIComponent(id)}`;

function show(action: HTMLAnchorElement, label: string, href: string | undefined): void {
  action.hidden = !href; action.textContent = label; if (href) action.href = href;
}

function render(): void {
  const t = TODAY_TEXT[language];
  document.documentElement.lang = language; document.title = `Latin DrillCards · ${t.title}`;
  $('title').textContent = t.title; $('languageLabel').textContent = sessionUiTranslations(language).interfaceLanguage;
  $('goalLabel').textContent = t.goal; $('streakLabel').textContent = t.streak; $('dueLabel').textContent = t.due;
  $('practiceLabel').textContent = t.practice; $('decksLabel').textContent = t.decks;
  renderPractice();
  if (!today) return;
  const { daily } = today; const left = Math.max(0, daily.goal - daily.today);
  $('goalValue').textContent = String(daily.today); $('goalOf').textContent = fill(t.goalOf, { goal: daily.goal });
  const meter = $('goalMeter'); meter.setAttribute('aria-valuemax', String(daily.goal)); meter.setAttribute('aria-valuenow', String(Math.min(daily.today, daily.goal)));
  meter.style.setProperty('--dc-done', `${Math.min(100, Math.round(daily.today / daily.goal * 100))}%`);
  $('goalNote').textContent = left ? fill(t.goalLeft, { n: left }) : t.goalDone;
  $('streakValue').textContent = count(language, daily.streak, 'day'); $('streakNote').textContent = fill(t.best, { n: daily.best });
  renderContinue(); renderQueues(); renderDecks();
}

function renderPractice(): void {
  const groups = HUBS.practice.groups; const section = (id: string): string => groups.find(group => group.id === id)!.title[language];
  const links: [string, string][] = [['./sentences.html', section('sentences')]];
  $('practiceLinks').replaceChildren(...links.map(([href, label]) => { const item = node('li'); const a = node('a', label); a.href = href; item.append(a); return item; }));
}

function renderContinue(): void {
  const open = today?.open; const home = homeUiTranslations(language);
  $('continue').hidden = !open; if (!open) return;
  $('continueTitle').textContent = home.continueTitle;
  $('continueLine').textContent = fill(home.continueLine, { deck: today!.titles.get(open.deckId) ?? open.deckId, n: open.taskIndex + 1, total: open.total });
  $('continueAction').textContent = home.continueAction; $('continueFinish').textContent = sessionUiTranslations(language).finish;
}

function renderQueues(): void {
  if (!today) return; const t = TODAY_TEXT[language];
  $('dueValue').textContent = today.dueTotal ? count(language, today.dueTotal, 'word') : '—';
  $('dueNote').textContent = today.dueTotal ? '' : t.dueNone;
  show($<HTMLAnchorElement>('dueAction'), t.review, today.dueTotal && today.dueDeck ? deckHref(today.dueDeck) : undefined);
  const focus = today.focus; const hasFresh = !!focus && focus.fresh > 0;
  $('freshLabel').textContent = fill(t.fresh, { deck: focus?.title ?? '' });
  $('freshValue').textContent = hasFresh ? fill(t.freshLeft, { n: focus!.fresh }) : '—';
  $('freshNote').textContent = !focus ? '' : hasFresh || focus.started < focus.total
    ? fill(t.started, { started: focus.started, total: focus.total }) : t.freshDone;
  show($<HTMLAnchorElement>('freshAction'), t.learn, hasFresh ? deckHref(focus!.id) : undefined);
}

function renderDecks(): void {
  if (!today) return; const t = TODAY_TEXT[language]; const home = homeUiTranslations(language);
  $('decks').replaceChildren(...today.decks.map(deck => {
    const item = node('li'); const a = node('a'); a.href = deckHref(deck.id);
    a.dataset.level = /^[abc][12]$/.test(deck.id) ? deck.id : 'themed';
    if (deck.id === today!.focus?.id) a.dataset.focus = 'true';
    const meter = node('span', undefined, 'dc-deck-meter'); meter.setAttribute('aria-hidden', 'true');
    const done = node('span'); done.style.setProperty('--dc-done', `${deck.started ? Math.max(2, Math.round(deck.started / deck.total * 100)) : 0}%`); meter.append(done);
    a.append(node('strong', deck.title), node('span', fill(home.deckCounts, { total: deck.total, started: deck.started })));
    if (deck.due) a.append(node('span', fill(t.dueBadge, { n: deck.due }), 'dc-deck-due'));
    a.append(meter); item.append(a); return item;
  }));
}

async function refresh(): Promise<void> {
  if (!learning) return;
  try { today = await load(learning); $('notice').textContent = ''; }
  catch { today = undefined; $('notice').textContent = TODAY_TEXT[language].loadError; }
  render();
}

async function finishOpen(): Promise<void> {
  if (!scope || !today?.open || finishing) return;
  finishing = true;
  try {
    const open = await SessionRunner.open(scope, env, today.open.id);
    try { await open.finish(); } finally { open.dispose(); }
    await refresh();
  } catch { $('notice').textContent = TODAY_TEXT[language].finishError; }
  finally { finishing = false; }
}

$('language').addEventListener('change', event => {
  language = (event.target as HTMLSelectElement).value as Lang;
  storeLanguage(language);
  // The answer language of the queues follows the interface language: recount.
  void refresh();
}, { signal: page.signal });
$('continueFinish').addEventListener('click', () => { void finishOpen(); }, { signal: page.signal });
window.addEventListener('pagehide', () => { page.abort(); learning?.dispose(); }, { once: true });
// A page restored from the back/forward cache shows stale counts: start over from storage.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

$<HTMLSelectElement>('language').value = language;
render();
openLearningPage().then(opened => { learning = opened; scope = opened.store; return refresh(); })
  .catch(() => { $('notice').textContent = TODAY_TEXT[language].loadError; });
