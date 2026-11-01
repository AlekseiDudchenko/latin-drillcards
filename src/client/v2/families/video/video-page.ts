import { createItemExerciseRegistry, isItemSessionPlan, planItemSession, projectExerciseProgress, videoSegmentContent,
  type ItemDataset, type ItemExerciseRegistry, type ItemExerciseTask, type ListeningExercise, type ListeningMode, type SentenceExercise,
  type TranslationLanguage } from '../../core/index.js';
import type { Lang } from '../../../i18n.js';
import { createCardShell } from '../../card-shell.js';
import { createCardSpeech } from '../../card-speech.js';
import { SessionRunner, type ItemRunnerView, type RunnerEnvironment } from '../../session-runner.js';
import { openLearningPage } from '../../account-bar.js';
import type { PageLearning } from '../../learning-context.js';
import { tokenAnswerText } from '../../token-state.js';
import { fill } from '../sentences/sentences-i18n.js';
import { videoUiTranslations } from './video-i18n.js';
import { ASSEMBLY_EXERCISE, assemblyAvailable, clampPosition, datasetId, DICTATION_EXERCISE, isVideoExercise, nextAssembly, parseState,
  segmentId, segmentIndex, segmentStats, stateHash, VIDEOS, videoStats, type VideoState, type VideoView } from './video-model.js';
import { createYouTubeMedia, type ClipMedia, type MediaError } from './youtube-media.js';

// M6 (#338): video dictation (FC09) and sentences from video (FC10) on the shared Runner and
// journal. One versioned dataset per video serves both: dictation is the M2 listening exercise
// with the clip as its prompt (played in order, one segment at a time), the sentences view is
// the M1 assembly of the same segments. Each shown segment is one single-task item session, so
// switching segment, mode, view or video never loses an answer or writes one twice, and a reload
// continues the open one. Playing a clip is page-local and writes nothing.
const MODE_KEY = 'de_trainer_k2_mode';
const env: RunnerEnvironment = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };
const datasetUrl = (videoId: string): URL => new URL(`../../../data/items/${datasetId(videoId)}.json`, import.meta.url);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('card');
const player = $<HTMLDivElement>('player');
const controls = { video: $<HTMLSelectElement>('video'), language: $<HTMLSelectElement>('language'), translation: $<HTMLSelectElement>('translation') };
const viewButtons = { dictation: $<HTMLButtonElement>('viewDictation'), sentences: $<HTMLButtonElement>('viewSentences') };
const modeButtons = { tokens: $<HTMLButtonElement>('modeTokens'), text: $<HTMLButtonElement>('modeText') };
const buttons = { replay: $<HTMLButtonElement>('replay'), previous: $<HTMLButtonElement>('previous'),
  tryAgain: $<HTMLButtonElement>('tryAgain'), retry: $<HTMLButtonElement>('retrySave'), restart: $<HTMLButtonElement>('restart'),
  mediaRetry: $<HTMLButtonElement>('mediaRetry'), speak: $<HTMLButtonElement>('speakFallback') };
const page = new AbortController();
const speech = createCardSpeech();

let language: Lang = stored('dc_v2_lang', ['ru', 'en', 'de']) as Lang ?? 'ru';
let translation: TranslationLanguage = stored('dc_v2_sentence_translation', ['ru', 'en']) as TranslationLanguage ?? 'ru';
// v1 key and values, shared with the v1 k2 pages.
let mode: ListeningMode = stored(MODE_KEY, ['type']) ? 'text' : 'tokens';
let state: VideoState = parseState(location.hash);
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
let finished = false;
let media: ClipMedia | undefined;
let mediaState: 'loading' | 'ready' | MediaError = 'loading';
let playing = false;
let speakFailed = false;
/** Shown sentences of the sentences view, for Previous. */
const visited: { readonly itemId: string; readonly seed: string }[] = [];
let progress: ReturnType<typeof projectExerciseProgress> | undefined;
const datasets = new Map<string, ItemDataset>();

function stored(key: string, allowed: readonly string[]): string | undefined {
  try { const value = localStorage.getItem(key); return value && allowed.includes(value) ? value : undefined; } catch { return undefined; }
}
function store(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* preference only */ }
}
/** v1 key: the dictation position of each video. */
const positionKey = (videoId: string): string => `vd_pos_${videoId}`;
const ASSISTED_KEY = 'dc_v2_video_assisted';
function assistedSessions(): string[] {
  try { return JSON.parse(sessionStorage.getItem(ASSISTED_KEY) ?? '[]') as string[]; } catch { return []; }
}
function markAssisted(sessionId: string): void {
  try { sessionStorage.setItem(ASSISTED_KEY, JSON.stringify([...assistedSessions().slice(-50), sessionId])); } catch { /* best effort */ }
}

function view(): ItemRunnerView | undefined {
  const current = runner?.view;
  return current?.family === 'items' ? current : undefined;
}
function currentItemId(): string | undefined { return view()?.plan.tasks[0]?.target.itemId; }
const listening = (task: ItemExerciseTask): ListeningExercise => task.specification.exercise as unknown as ListeningExercise;
const assembly = (task: ItemExerciseTask): SentenceExercise => task.specification.exercise as unknown as SentenceExercise;
const exerciseFor = (target: VideoView): string => target === 'dictation' ? DICTATION_EXERCISE[mode] : ASSEMBLY_EXERCISE;

async function refreshProgress(): Promise<void> {
  if (!scope) return;
  const data = await scope.snapshot();
  progress = projectExerciseProgress(data.facts, { owner: scope.owner, ...scope.epoch, asOf: env.now() });
}
async function loadDataset(videoId: string): Promise<ItemDataset> {
  const known = datasets.get(videoId);
  if (known) return known;
  const response = await fetch(datasetUrl(videoId));
  if (!response.ok) throw new Error(`Dataset: ${response.status}`);
  const loaded = await response.json() as ItemDataset;
  datasets.set(videoId, loaded); return loaded;
}

/** Leave the shown segment: an answered one is completed, an unanswered one abandoned (no event). */
async function leave(): Promise<void> {
  const active = runner; const current = view();
  if (!active || !current) return;
  if (current.phase === 'feedback') await active.next();
  else if (current.phase === 'presenting' || current.phase === 'paused' || current.phase === 'ready') await active.finish();
}
function detach(): void { unsubscribe?.(); unsubscribe = undefined; runner?.dispose(); runner = undefined; closeCard(); }

async function show(itemId: string, options: { seed?: string; assisted?: boolean; remember?: boolean; play?: boolean } = {}): Promise<void> {
  if (!scope || !registry || !dataset || busy) return;
  busy = true; stopSound(); render();
  try {
    await leave();
    const shown = view();
    if (state.view === 'sentences' && shown && options.remember !== false) visited.push({ itemId: shown.plan.tasks[0]!.target.itemId, seed: shown.plan.seed });
    const sessionId = env.id(); const seed = options.seed ?? env.id();
    const plan = planItemSession({ registry, owner: scope.owner, sessionId, dataEpoch: scope.epoch.dataEpoch,
      studyTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', seed, createdAt: env.now(),
      answerLanguage: translation, datasetId: dataset.id, items: [{ itemId, exerciseId: exerciseFor(state.view) }] });
    if (options.assisted) markAssisted(sessionId);
    finished = false;
    attach(await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 },
      catalogVersion: '', words: [], datasets: [dataset] }));
    if (state.view === 'dictation') store(positionKey(state.videoId), String(segmentIndex(itemId)));
  } finally { busy = false; await refreshProgress().catch(() => {}); render(); }
  if (state.view === 'dictation' && options.play !== false) playClip();
}
function attach(next: SessionRunner): void {
  unsubscribe?.(); runner?.dispose();
  runner = next; unsubscribe = next.subscribe(() => render());
}

// --- Dictation: segments in video order, the clip is the prompt. ---
async function dictationStep(delta: 1 | -1): Promise<void> {
  if (!dataset) return;
  const id = currentItemId();
  const index = id ? segmentIndex(id) + delta : 0;
  if (index < 0) return;
  if (index >= dataset.items.length) {
    await leave(); detach(); finished = true; store(positionKey(state.videoId), null); stopSound(); render(); return;
  }
  // Going back returns to a clip whose text was shown: the new attempt is assisted.
  await show(segmentId(index), { assisted: delta < 0 });
}
async function goNext(): Promise<void> {
  if (state.view === 'dictation') { await dictationStep(1); return; }
  if (!registry || !progress || !dataset) return;
  const id = nextAssembly(registry, progress, dataset.id, currentItemId());
  if (id) await show(id); else { failure = 'noData'; render(); }
}
async function goPrevious(): Promise<void> {
  if (state.view === 'dictation') { await dictationStep(-1); return; }
  const previous = visited.pop();
  if (previous) await show(previous.itemId, { seed: previous.seed, assisted: true, remember: false });
}
async function tryAgain(): Promise<void> {
  const current = view();
  if (current) await show(current.plan.tasks[0]!.target.itemId, { seed: current.plan.seed, assisted: true, remember: false });
}
async function restart(): Promise<void> { finished = false; await show(segmentId(0)); }

async function switchMode(next: ListeningMode): Promise<void> {
  if (next === mode) return;
  mode = next; store(MODE_KEY, next === 'text' ? 'type' : 'drag');
  const current = view();
  if (state.view !== 'dictation' || !current) { render(); return; }
  const answered = current.phase === 'feedback' || assistedSessions().includes(current.sessionId);
  await show(current.plan.tasks[0]!.target.itemId, { seed: current.plan.seed, assisted: answered, remember: false, play: false });
}

/** Another view of the same video. The sentences view starts on the current segment when it can. */
async function switchView(next: VideoView): Promise<void> {
  if (next === state.view || !registry || !dataset) return;
  if (next === 'sentences' && !assemblyAvailable(registry, dataset, translation)) return;
  const shownId = currentItemId();
  await leave(); detach(); visited.length = 0; finished = false;
  setState({ ...state, view: next });
  if (next === 'sentences') {
    disposeMedia();
    const keep = shownId && registry.isAvailable(ASSEMBLY_EXERCISE, dataset.id, shownId, { answerLanguage: translation, seed: 'check', taskId: 'check' });
    await (keep ? show(shownId) : goNext());
  } else {
    setupMedia();
    await show(segmentId(clampPosition(stored(positionKey(state.videoId), [...dataset.items.keys()].map(String)), dataset.items.length)), { play: false });
  }
}
async function switchVideo(videoId: string): Promise<void> {
  if (videoId === state.videoId && dataset) return;
  await leave().catch(() => {}); detach(); disposeMedia(); visited.length = 0; finished = false; failure = undefined;
  setState({ ...state, videoId });
  await openVideo();
}
function setState(next: VideoState): void {
  state = next;
  if (location.hash !== stateHash(next)) window.history.replaceState(null, '', stateHash(next));
}

/** Load the chosen video and show its first task: the saved dictation position or the next sentence. */
async function openVideo(): Promise<void> {
  try { dataset = await loadDataset(state.videoId); } catch { failure = 'loadError'; dataset = undefined; render(); return; }
  registry = createItemExerciseRegistry([dataset]);
  if (state.view === 'sentences' && !assemblyAvailable(registry, dataset, translation)) setState({ ...state, view: 'dictation' });
  localize();
  if (state.view === 'dictation') {
    setupMedia();
    await show(segmentId(clampPosition(stored(positionKey(state.videoId), [...dataset.items.keys()].map(String)), dataset.items.length)), { play: false });
  } else await goNext();
}

// --- Media: YouTube clips, with an explicit error and a speech fallback. ---
function setupMedia(): void {
  disposeMedia();
  const entry = VIDEOS.find(video => video.videoId === state.videoId)!;
  player.classList.toggle('dc-video-portrait', entry.shorts);
  player.hidden = false; mediaState = 'loading'; playing = false;
  const videoId = state.videoId;
  media = createYouTubeMedia(player, videoId, {
    onReady() { if (videoId === state.videoId) { mediaState = 'ready'; render(); } },
    onClipEnd() { playing = false; render(); },
    onPlaying(value) { playing = value; renderMedia(); },
    onError(error) { if (videoId === state.videoId) { mediaState = error; playing = false; render(); } },
  });
}
function disposeMedia(): void { media?.dispose(); media = undefined; playing = false; player.hidden = true; }
function playClip(): void {
  const task = view()?.task;
  const clip = task ? listening(task).media : undefined;
  if (!clip || !media || state.view !== 'dictation') return;
  speakFailed = false; media.play(clip);
}
function stopSound(): void { media?.pause(); speech.cancel(); playing = false; }
async function speakFallback(): Promise<void> {
  const task = view()?.task;
  if (!task || state.view !== 'dictation') return;
  const result = await speech.speak(listening(task).audio.text);
  speakFailed = result !== 'completed' && result !== 'cancelled'; renderMedia();
}
function renderMedia(): void {
  const labels = videoUiTranslations(language);
  const dictation = state.view === 'dictation' && !!dataset && !finished;
  const notice = $('mediaNotice');
  const problem = mediaState === 'offline' ? labels.mediaOffline : mediaState === 'unavailable' ? labels.mediaUnavailable
    : mediaState === 'failed' ? labels.mediaFailed : mediaState === 'loading' ? labels.mediaLoading : '';
  notice.hidden = !dictation || !problem;
  $('mediaMessage').textContent = [problem, speakFailed ? labels.speakFailed : ''].filter(Boolean).join(' ');
  notice.setAttribute('role', mediaState === 'loading' ? 'status' : 'alert');
  const broken = mediaState !== 'ready' && mediaState !== 'loading';
  buttons.mediaRetry.hidden = !broken; buttons.speak.hidden = !broken;
  buttons.replay.hidden = !dictation;
  buttons.replay.disabled = busy || mediaState !== 'ready' || !view()?.task;
  buttons.replay.setAttribute('aria-busy', String(playing));
}

function localize(): void {
  const labels = videoUiTranslations(language);
  document.documentElement.lang = language;
  document.title = `DrillCards · ${labels.title}`;
  $('title').textContent = labels.title;
  for (const [id, key] of [['languageLabel', 'interfaceLanguage'], ['translationLabel', 'translation'], ['videoLabel', 'video'], ['taskLabel', 'task'],
    ['modeLabel', 'mode'], ['keyboard', 'keyboard'], ['finishedText', 'finished']] as const) $(id).textContent = labels[key];
  viewButtons.dictation.textContent = labels.viewDictation; viewButtons.sentences.textContent = labels.viewSentences;
  modeButtons.tokens.textContent = labels.modeTokens; modeButtons.text.textContent = labels.modeText;
  buttons.replay.textContent = labels.replay; buttons.previous.textContent = labels.previous;
  buttons.tryAgain.textContent = labels.tryAgain; buttons.retry.textContent = labels.retrySave; buttons.restart.textContent = labels.restart;
  buttons.mediaRetry.textContent = labels.mediaRetry; buttons.speak.textContent = labels.speakFallback;
  controls.video.replaceChildren(...VIDEOS.map(video => {
    const node = document.createElement('option'); node.value = video.videoId; node.lang = 'de';
    node.textContent = `${video.level} · ${video.title}${video.shorts ? ` (${labels.shorts})` : ''}`; return node;
  }));
  controls.video.value = state.videoId;
}

function render(): void {
  const labels = videoUiTranslations(language);
  const current = view();
  const notice = $('notice');
  notice.textContent = failure ? labels[failure] : current?.error === 'save' ? labels.saveError : '';
  notice.setAttribute('role', failure === 'loadError' || current?.error ? 'alert' : 'status');
  const disabled = busy || !!current?.busy;
  Object.values(buttons).forEach(button => { button.disabled = disabled; });
  const dictation = state.view === 'dictation';
  const canAssemble = !!registry && !!dataset && assemblyAvailable(registry, dataset, translation);
  for (const [key, node] of Object.entries(viewButtons)) { node.setAttribute('aria-pressed', String(key === state.view)); node.disabled = disabled || (key === 'sentences' && !canAssemble); }
  for (const [key, node] of Object.entries(modeButtons)) { node.setAttribute('aria-pressed', String(key === mode)); node.disabled = disabled; }
  $('modeGroup').hidden = !dictation;
  $('noAssembly').textContent = dataset && !canAssemble ? labels.noAssembly : '';
  buttons.retry.hidden = current?.error !== 'save';
  const task = current?.task;
  const index = task ? segmentIndex(task.target.itemId) : -1;
  buttons.previous.disabled ||= dictation ? index <= 0 : visited.length === 0;
  const answered = current?.phase === 'feedback' && current.answer ? current.answer : undefined;
  buttons.tryAgain.hidden = !answered || answered.evaluation.outcome === 'correct';
  $('finished').hidden = !finished;
  renderMeta(task, !!answered);
  renderMedia();
  if (!current || !task || finished || (current.phase !== 'presenting' && current.phase !== 'feedback')) { closeCard(); return; }
  const feedbackTarget = dictation ? listening(task).target : assembly(task).target;
  const feedback = answered ? answered.evaluation.outcome === 'correct'
    ? { kind: 'correct' as const, message: labels.correct } : { kind: 'incorrect' as const, message: fill(labels.wrong, { target: feedbackTarget }) } : undefined;
  // Dictation never offers the German text before the answer; assembly reads it only after the answer.
  const presentation = { language, busy: disabled, permissions: { reveal: false, details: false, speech: !dictation && !!answered }, ...(feedback ? { feedback } : {}) };
  const key = `${current.sessionId}|${current.phase}`;
  if (card && key === cardKey) { card.setPresentation(presentation); return; }
  closeCard(); cardKey = key;
  const active = runner!;
  const assisted = assistedSessions().includes(current.sessionId);
  const tokenAnswer = dictation ? listening(task).mode === 'tokens' : true;
  const actions = {
    async onSubmit(answer: { value: string; tokens?: readonly string[] }) {
      const result = await active.submit(tokenAnswer ? [...(answer.tokens ?? [])] : answer.value, { assisted });
      if (result === 'conflict') throw new Error('Session changed elsewhere');
      await refreshProgress().catch(() => {}); render();
    },
    onNext: goNext,
    onReveal() {}, onSpeech() {},
  };
  const exerciseTokens = dictation ? listening(task).tokens : assembly(task).tokens;
  const title = Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, dictation ? videoUiTranslations(lang).dictationTitle : videoUiTranslations(lang).viewSentences])) as Record<Lang, string>;
  const prompt = dictation ? { text: listening(task).mode === 'tokens' ? labels.promptTokens : labels.promptText, lang: language } : assembly(task).prompt;
  const base = { id: task.id, title, prompt, translationLanguage: task.specification.answerLanguage, ...(dictation ? {} : { speechText: assembly(task).target }) };
  if (tokenAnswer) {
    const tokens = exerciseTokens!.map(token => ({ id: token.id, text: token.text }));
    const raw = answered && Array.isArray(answered.rawAnswer) ? answered.rawAnswer as string[] : undefined;
    const placement = raw ? { answer: raw, pool: tokens.map(t => t.id).filter(id => !raw.includes(id)) } : undefined;
    card = createCardShell(host, { ...base, input: { kind: 'tokens', answerLang: 'de', tokens, autoSubmit: false } }, presentation, actions,
      placement ? { value: tokenAnswerText(tokens, placement), revealed: false, submitted: true, detailsOpen: false, tokens: placement } : undefined);
  } else {
    const raw = answered && typeof answered.rawAnswer === 'string' ? answered.rawAnswer : undefined;
    card = createCardShell(host, { ...base, input: { kind: 'text', answerLang: 'de' } }, presentation, actions,
      raw !== undefined ? { value: raw, revealed: false, submitted: true, detailsOpen: false } : undefined);
  }
  if (answered) host.querySelector<HTMLButtonElement>('[data-focus-key="next"]')?.focus();
}

/** Counter and statistics always; in dictation the German text and translations only after the answer. */
function renderMeta(task: ItemExerciseTask | undefined, answered: boolean): void {
  const labels = videoUiTranslations(language);
  const meta = $('meta'); const extra = $('extra'); const stats = $('stats');
  meta.textContent = ''; extra.replaceChildren(); stats.textContent = '';
  if (!dataset || !registry) return;
  const entry = VIDEOS.find(video => video.videoId === state.videoId)!;
  if (!task) { meta.textContent = fill(labels.level, { level: entry.level }); return; }
  const item = registry.getItem(dataset.id, task.target.itemId);
  const content = videoSegmentContent(item.content)!;
  meta.textContent = [fill(labels.level, { level: content.level }),
    fill(labels.segment, { n: String(content.video.index + 1), total: String(dataset.items.length) })].join(' · ');
  const dictation = state.view === 'dictation';
  if (dictation && answered) {
    const target = document.createElement('p'); target.className = 'dc-listening-target'; target.lang = 'de'; target.textContent = content.target;
    extra.append(target);
    const own = content.translations[task.specification.answerLanguage];
    if (own) {
      const line = document.createElement('p'); line.className = 'dc-listening-translation'; line.lang = task.specification.answerLanguage;
      line.textContent = `${labels.translationHint}: ${own}`; extra.append(line);
    }
  }
  if (!dictation || answered) {
    const others = (['ru', 'en', 'es'] as const).filter(lang => lang !== task.specification.answerLanguage && content.translations[lang]);
    if (others.length) {
      const details = document.createElement('details'); details.className = 'dc-translations';
      const summary = document.createElement('summary'); summary.textContent = labels.otherTranslations; details.append(summary);
      for (const lang of others) { const line = document.createElement('p'); line.lang = lang; line.textContent = `${lang.toUpperCase()}: ${content.translations[lang]}`; details.append(line); }
      extra.append(details);
    }
  }
  if (progress) {
    const exerciseId = task.exerciseId;
    const own = segmentStats(progress, dataset.id, item.id, exerciseId);
    const all = videoStats(registry, progress, dataset.id, exerciseId);
    const kind = exerciseId === ASSEMBLY_EXERCISE ? labels.viewSentences : `${labels.viewDictation}, ${exerciseId === DICTATION_EXERCISE.text ? labels.modeText : labels.modeTokens}`;
    stats.textContent = `${own ? fill(labels.stats, { answers: String(own.answers), independent: String(own.independent) }) : labels.statsNew} · ` +
      fill(labels.videoStats, { mode: kind, attempted: String(all.attempted), total: String(all.total),
        accuracy: all.accuracy === null ? '—' : `${Math.round(all.accuracy * 100)}%` });
  }
}
function closeCard(): void { card?.dispose(); card = undefined; cardKey = ''; }

async function init(): Promise<void> {
  controls.language.value = language; controls.translation.value = translation;
  localize(); render();
  try {
    learning = await openLearningPage();
    scope = learning.store;
    await refreshProgress();
  } catch { failure = 'loadError'; render(); return; }
  // A reload continues the open video session: its video, view, mode, segment and answer.
  const data = await scope.snapshot();
  const open = data.sessions.filter(s => isItemSessionPlan(s.state.plan) && isVideoExercise(s.state.plan.tasks[0]?.exerciseId) &&
    s.state.plan.datasets.some(d => d.datasetId.startsWith('video-')) && !['completed', 'abandoned'].includes(s.state.status))
    .sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0];
  const openTask = open && isItemSessionPlan(open.state.plan) ? open.state.plan.tasks[0] : undefined;
  const openVideoId = openTask?.target.datasetId.slice('video-'.length);
  const named = new URLSearchParams(location.hash.slice(1)).get('v');
  if (open && openTask && openVideoId && VIDEOS.some(video => video.videoId === openVideoId) && (!named || named === openVideoId)) {
    try {
      dataset = await loadDataset(openVideoId);
      if (open.datasets?.[0]?.version !== dataset.version) throw new Error('Dataset changed');
      registry = createItemExerciseRegistry([dataset]);
      const openView: VideoView = openTask.exerciseId === ASSEMBLY_EXERCISE ? 'sentences' : 'dictation';
      if (openView === 'dictation') mode = openTask.exerciseId === DICTATION_EXERCISE.text ? 'text' : 'tokens';
      setState({ videoId: openVideoId, view: openView });
      localize();
      const resumed = await SessionRunner.open(scope, env, open.state.plan.sessionId);
      if (resumed.view.phase === 'paused') await resumed.resume().catch(() => {});
      attach(resumed);
      if (openView === 'dictation') setupMedia();
      render(); return;
    } catch { dataset = undefined; registry = undefined; }
  }
  if (open) await SessionRunner.open(scope, env, open.state.plan.sessionId).then(old => old.finish().finally(() => old.dispose())).catch(() => {});
  setState(state);
  await openVideo();
}

const signal = page.signal;
const guard = (action: () => Promise<void>) => () => { void action().catch(() => { render(); }); };
buttons.replay.addEventListener('click', () => playClip(), { signal });
buttons.previous.addEventListener('click', guard(goPrevious), { signal });
buttons.tryAgain.addEventListener('click', guard(tryAgain), { signal });
buttons.restart.addEventListener('click', guard(restart), { signal });
buttons.retry.addEventListener('click', guard(async () => { await runner?.retry(); }), { signal });
buttons.mediaRetry.addEventListener('click', () => { setupMedia(); render(); }, { signal });
buttons.speak.addEventListener('click', guard(speakFallback), { signal });
viewButtons.dictation.addEventListener('click', guard(() => switchView('dictation')), { signal });
viewButtons.sentences.addEventListener('click', guard(() => switchView('sentences')), { signal });
modeButtons.tokens.addEventListener('click', guard(() => switchMode('tokens')), { signal });
modeButtons.text.addEventListener('click', guard(() => switchMode('text')), { signal });
controls.video.addEventListener('change', guard(() => switchVideo(controls.video.value)), { signal });
controls.language.addEventListener('change', () => {
  language = controls.language.value as Lang; store('dc_v2_lang', language); localize(); closeCard(); render();
}, { signal });
// The shown task keeps its pinned prompt language; the next segment uses the new one.
controls.translation.addEventListener('change', () => { translation = controls.translation.value as TranslationLanguage; store('dc_v2_sentence_translation', translation); render(); }, { signal });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('.dc-tokens, select, input, textarea, summary, a, iframe')) return;
  const current = view();
  if (event.key === 'ArrowRight' && !finished) { event.preventDefault(); guard(goNext)(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); guard(goPrevious)(); }
  else if ((event.key === 'r' || event.key === 'R') && state.view === 'dictation') { event.preventDefault(); playClip(); }
  else if (event.key === 'Enter' && current?.phase === 'feedback' && target?.tagName !== 'BUTTON') {
    event.preventDefault();
    guard(goNext)();
  }
}, { signal });
// Leaving releases the player, its timers and the speech.
window.addEventListener('pagehide', () => { unsubscribe?.(); runner?.dispose(); closeCard(); disposeMedia(); speech.dispose(); page.abort(); learning?.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void init();
