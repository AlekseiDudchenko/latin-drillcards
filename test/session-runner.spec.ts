import { test, expect, type Page } from '@playwright/test';

// Compiled Runner on the real S0 adapter and Chromium IndexedDB; failures are injected around the port.
const fixture = `
const { LearningDatabase } = await import('/v2/storage/learning-db.js');
const { SessionRunner, RunnerDisposed } = await import('/v2/session-runner.js');
const { PREVIEW_WORDS, PREVIEW_DECK, PREVIEW_CATALOG_VERSION } = await import('/v2/preview-catalog.js');
const core = await import('/v2/core/index.js');
const epoch = { dataEpoch: 'v2', epochStartedAt: '2026-10-01T00:00:00.000Z' };
const owner = { kind: 'guest', id: 'G' };
let clock = Date.parse('2026-10-24T09:00:00.000Z'); let ids = 0;
const env = { now: () => new Date(clock += 1000).toISOString(), id: () => 'id-' + (++ids) };
const dbName = 'test-runner-' + crypto.randomUUID();
let db = await LearningDatabase.open(indexedDB, dbName);
let scope = await db.scope(owner, epoch);
async function reopen() { db.close(); db = await LearningDatabase.open(indexedDB, dbName); scope = await db.scope(owner, epoch); return scope; }
function archive(exerciseId, intent = 'learn-new', wordIds, sessionId = 'session') {
  const deck = wordIds ? { ...PREVIEW_DECK, wordIds } : PREVIEW_DECK;
  const planned = core.planVocabularySession({ request: { deckId: deck.id, intent, format: 'single', exerciseId, answerLanguage: 'ru' },
    deck, words: PREVIEW_WORDS, progress: [], owner, dataEpoch: epoch.dataEpoch, sessionId, seed: 'seed-' + sessionId,
    catalogVersion: PREVIEW_CATALOG_VERSION, at: '2026-10-24T09:00:00.000Z', studyTimezone: 'Europe/Berlin' });
  if (planned.kind !== 'ready') throw new Error('empty plan');
  return { state: { plan: planned.plan, status: 'ready', taskIndex: 0, revision: 0 }, words: PREVIEW_WORDS, catalogVersion: PREVIEW_CATALOG_VERSION };
}
function circuitArchive(wordIds, sessionId = 'circuit') {
  const deck = { ...PREVIEW_DECK, wordIds };
  const planned = core.planVocabularySession({ request: { deckId: deck.id, intent: 'learn-new', format: 'circuit', circuitScope: 'all-exercises', answerLanguage: 'ru' },
    deck, words: PREVIEW_WORDS, progress: [], owner, dataEpoch: epoch.dataEpoch, sessionId, seed: 'seed-' + sessionId,
    catalogVersion: PREVIEW_CATALOG_VERSION, at: '2026-10-24T09:00:00.000Z', studyTimezone: 'Europe/Berlin' });
  if (planned.kind !== 'ready') throw new Error('empty plan');
  return { state: { plan: planned.plan, status: 'ready', taskIndex: 0, revision: 0 }, words: PREVIEW_WORDS, catalogVersion: PREVIEW_CATALOG_VERSION };
}
const rightAnswer = task => task.input === 'choice' ? task.specification.correctOptionId : task.input === 'text' ? task.specification.answer.text : 'remembered';
/** Drive the runner to the end of the planned tasks; \`fail(task)\` picks tasks answered wrongly. */
async function playPlanned(runner, fail = () => false) {
  while (!runner.view.correction && runner.view.task) {
    const task = runner.view.task;
    if (task.exerciseId !== 'introduction') {
      if (task.input === 'reveal') await runner.reveal();
      const answer = !fail(task) ? rightAnswer(task) : task.input === 'choice'
        ? task.specification.options.find(o => o.id !== task.specification.correctOptionId).id : task.input === 'text' ? 'falsch' : 'forgotten';
      check(await runner.submit(answer) === 'committed', 'submit');
    }
    check(await runner.next() !== 'conflict', 'next');
  }
}
const correct = view => view.task.specification.correctOptionId;
const wrong = view => view.task.specification.options.find(o => o.id !== correct(view)).id;
async function answers(sessionId = 'session') {
  return (await scope.snapshot()).facts.filter(f => f.event.sessionId === sessionId && f.event.kind === 'answer');
}
/** Port wrapper: 'before' fails without writing, 'after' writes and then loses the acknowledgement. */
function flaky(target) {
  // mode applies to the next write of either kind; commit/save target only that method.
  const control = { mode: undefined, commit: undefined, save: undefined, events: [] };
  const port = { owner: target.owner, epoch: target.epoch,
    snapshot: () => target.snapshot(), restore: at => target.restore(at), startSession: a => target.startSession(a),
    saveSession: async (s, r) => fail(control, 'save', () => target.saveSession(s, r)),
    commit: async input => { control.events.push(input.event); return fail(control, 'commit', () => target.commit(input)); } };
  return { port, control };
}
async function fail(control, method, write) {
  const mode = control[method] ?? control.mode; control[method] = undefined; control.mode = undefined;
  if (mode === 'before') throw new Error('QuotaExceededError');
  const result = await write();
  if (mode === 'after') throw new Error('connection lost after write');
  return result;
}
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function rejects(fn, pattern) {
  try { await fn(); } catch (e) { if (pattern && !pattern.test(String(e))) throw e; return; }
  throw new Error('Expected rejection');
}
`;
async function run<T = unknown>(page: Page, body: string): Promise<T> {
  await page.goto('/v2/word-exercises-demo.html');
  return page.evaluate<T>(`(async () => { ${fixture}\n${body}\n })()`);
}

test('single learn-new session commits introductions, one answer per submit and resumes the same tasks', async ({ page }) => {
  expect(await run(page, `
    const a = archive('meaning-choice', 'learn-new', ['tisch', 'stuhl']);
    let runner = await SessionRunner.start(scope, env, a);
    // Introduction is persisted before the card may show its details.
    check(runner.view.phase === 'feedback' && runner.view.task.exerciseId === 'introduction', 'introduction not committed on present');
    await runner.next(); await runner.next();
    let view = runner.view;
    check(view.phase === 'presenting' && view.task.exerciseId === 'meaning-choice' && view.taskIndex === 2, 'cursor ' + view.taskIndex);
    const options = JSON.stringify(view.task.specification.options);
    const first = runner.submit(correct(view)); const again = runner.submit(correct(view));
    await rejects(() => again, /still being saved/);
    check(await first === 'committed' && runner.view.phase === 'feedback', 'feedback');
    await rejects(() => runner.submit(correct(view)), /requires presenting/);
    check((await answers()).length === 1, 'second answer created');
    const facts = (await scope.snapshot()).facts.map(f => f.event.kind).join();
    check(facts === 'introduction,introduction,answer', facts);
    // Reload in feedback: same task, options and stored evaluation.
    runner.dispose(); await reopen();
    runner = await SessionRunner.open(scope, env, 'session');
    view = runner.view;
    check(view.phase === 'feedback' && view.taskIndex === 2 && JSON.stringify(view.task.specification.options) === options, 'variants changed');
    check(view.answer.evaluation.outcome === 'correct' && view.answer.rawAnswer === correct(view), 'evaluation lost');
    await runner.next();
    // Reload in presenting: still the same next task, no answer yet.
    runner.dispose(); await reopen(); runner = await SessionRunner.open(scope, env, 'session');
    check(runner.view.phase === 'presenting' && runner.view.taskIndex === 3 && !runner.view.answer, 'presenting resume');
    check(await runner.submit(wrong(runner.view)) === 'committed' && runner.view.answer.evaluation.outcome === 'incorrect', 'wrong answer');
    await runner.next();
    check(runner.view.phase === 'completed' && !runner.view.task, 'not completed');
    check(await SessionRunner.latestOpenSession(scope) === undefined, 'completed session still open');
    const data = await scope.snapshot();
    check(data.outbox.length === 4 && data.sessions[0].state.revision === 9, 'outbox/revision ' + data.outbox.length + '/' + data.sessions[0].state.revision);
    db.close(); return true;
  `)).toBe(true);
});

test('a failed save keeps the command; retry and resubmission reuse its identity', async ({ page }) => {
  expect(await run(page, `
    const { port, control } = flaky(scope);
    const runner = await SessionRunner.start(port, env, archive('german-type', 'learn-new', ['tisch']));
    await runner.next();
    const views = []; runner.subscribe(v => views.push(v));
    // Write rejected before anything is stored: nothing changes, the error is reported.
    control.mode = 'before';
    await rejects(() => runner.submit('Tisch'), /Quota/);
    check(runner.view.error === 'save' && runner.view.phase === 'presenting' && !runner.view.busy, 'error state');
    check((await answers()).length === 0, 'partial write');
    check(views.some(v => v.busy) && views.at(-1).error === 'save', 'listeners not notified');
    // Write succeeded but its acknowledgement was lost: the retry is a duplicate, not a second answer.
    control.mode = 'after';
    await rejects(() => runner.submit('Tisch'), /connection lost/);
    check(await runner.retry() === 'duplicate', 'retry not duplicate');
    const saved = await answers();
    check(saved.length === 1 && runner.view.phase === 'feedback' && !runner.view.error, 'duplicate answer');
    // All three sends of that answer carried one command identity.
    const sent = control.events.filter(e => e.kind === 'answer').map(e => JSON.stringify(e));
    check(sent.length === 3 && new Set(sent).size === 1 && saved[0].event.eventId === JSON.parse(sent[0]).eventId, 'identity changed');
    // State-only command: lost acknowledgement of next() is recognised as already applied.
    control.mode = 'after';
    await rejects(() => runner.next(), /connection lost/);
    check(await runner.retry() === 'duplicate' && runner.view.phase === 'completed', 'next retry');
    await rejects(() => runner.retry(), /No failed command/);
    db.close(); return true;
  `)).toBe(true);
});

test('resubmitting the same answer after a failure repeats the stored command', async ({ page }) => {
  expect(await run(page, `
    const { port, control } = flaky(scope);
    const runner = await SessionRunner.start(port, env, archive('german-type', 'learn-new', ['tisch']));
    await runner.next();
    control.mode = 'after';
    await rejects(() => runner.submit('Tish'), /connection lost/);
    check(await runner.submit('Tish') === 'duplicate', 'resubmission created a new command');
    const saved = await answers();
    check(saved.length === 1 && runner.view.answer.evaluation.outcome === 'incorrect', 'answers ' + saved.length);
    db.close(); return true;
  `)).toBe(true);
});

test('self-assessment reveal, pause and resume survive reload in every phase', async ({ page }) => {
  expect(await run(page, `
    let runner = await SessionRunner.start(scope, env, archive('meaning-recall', 'learn-new', ['tisch']));
    await runner.next();
    await rejects(() => runner.submit('remembered'), /Reveal/);
    check(await runner.reveal() === 'committed' && runner.view.revealed, 'reveal');
    check(await runner.reveal() === 'duplicate', 'second reveal stored');
    await runner.pause();
    runner.dispose(); await reopen(); runner = await SessionRunner.open(scope, env, 'session');
    check(runner.view.phase === 'paused' && runner.view.revealed, 'paused reveal lost');
    await runner.resume();
    check(runner.view.phase === 'presenting' && runner.view.revealed, 'resume to presenting');
    await runner.submit('remembered'); await runner.pause();
    runner.dispose(); await reopen(); runner = await SessionRunner.open(scope, env, 'session');
    await runner.resume();
    check(runner.view.phase === 'feedback' && runner.view.answer.rawAnswer === 'remembered', 'resume to feedback');
    const kinds = (await scope.snapshot()).facts.map(f => f.event.kind).join();
    check(kinds === 'introduction,reveal,answer', kinds);
    check(await runner.finish() === 'committed' && runner.view.phase === 'abandoned', 'finish');
    await rejects(() => runner.finish(), /already ended/);
    db.close(); return true;
  `)).toBe(true);
});

test('a second tab cannot add another answer; the stale runner shows the saved state', async ({ page }) => {
  expect(await run(page, `
    const a = await SessionRunner.start(scope, env, archive('german-type', 'learn-new', ['tisch']));
    await a.next();
    const b = await SessionRunner.open(scope, env, 'session');
    check(await a.submit('Tisch') === 'committed', 'first tab');
    check(await b.submit('Tusch') === 'conflict', 'second tab not rejected');
    check(b.view.error === 'conflict' && b.view.phase === 'feedback' && b.view.answer.rawAnswer === 'Tisch', 'stale view');
    check((await answers()).length === 1, 'two answers');
    db.close(); return true;
  `)).toBe(true);
});

test('dispose stops notifications and commands; a pending write still completes', async ({ page }) => {
  expect(await run(page, `
    const runner = await SessionRunner.start(scope, env, archive('german-type', 'learn-new', ['tisch']));
    let calls = 0; runner.subscribe(() => calls++);
    const pending = runner.next(); const before = calls;
    runner.dispose();
    await pending;
    check(calls === before, 'notified after dispose');
    await rejects(() => runner.submit('Tisch'), /disposed/);
    try { runner.subscribe(() => {}); throw new Error('subscribed'); } catch (e) { check(e instanceof RunnerDisposed, String(e)); }
    check((await scope.snapshot()).sessions[0].state.taskIndex === 1, 'pending write lost');
    db.close(); return true;
  `)).toBe(true);
});

test('a lost acknowledgement is reconciled before a different command instead of reporting a conflict', async ({ page }) => {
  expect(await run(page, `
    const { port, control } = flaky(scope);
    let runner = await SessionRunner.start(port, env, archive('meaning-recall', 'learn-new', ['tisch']));
    await runner.next();
    control.mode = 'after';
    await rejects(() => runner.reveal(), /connection lost/);
    check(await runner.reveal() === 'duplicate' && runner.view.revealed && !runner.view.error, 'reveal retry: ' + runner.view.error);
    const reveals = (await scope.snapshot()).facts.filter(f => f.event.kind === 'reveal');
    check(reveals.length === 1 && control.events.filter(e => e.kind === 'reveal').length === 1, 'reveal resent');
    // A different answer after a lost acknowledgement: the stored first answer stands, no false conflict.
    control.mode = 'after';
    await rejects(() => runner.submit('remembered'), /connection lost/);
    check(await runner.submit('forgotten') === 'duplicate', 'different answer');
    check(!runner.view.error && runner.view.phase === 'feedback' && runner.view.answer.rawAnswer === 'remembered', 'view ' + runner.view.error);
    check((await answers()).length === 1, 'two answers');
    db.close(); return true;
  `)).toBe(true);
});

test('failed start or introduction saves are reported and retried; commands reject asynchronously', async ({ page }) => {
  expect(await run(page, `
    const { port, control } = flaky(scope);
    control.save = 'before';
    let runner = await SessionRunner.start(port, env, archive('german-type', 'learn-new', ['tisch']));
    check(runner.view.phase === 'ready' && runner.view.error === 'save', 'start failure ' + runner.view.phase);
    const paused = runner.pause(); check(paused instanceof Promise, 'pause threw synchronously');
    await rejects(() => paused, /Nothing to pause/);
    await rejects(() => runner.submit('Tisch'), /requires presenting/);
    // Retrying the start also commits the introduction before it can be shown.
    check(await runner.retry() === 'committed' && runner.view.phase === 'feedback' && runner.view.task.exerciseId === 'introduction', 'start retry');
    runner.dispose();
    const second = await SessionRunner.start(port, env, archive('german-type', 'learn-new', ['stuhl'], 'second'));
    await second.finish();
    control.commit = 'before';
    runner = await SessionRunner.start(port, env, archive('german-type', 'learn-new', ['tuer'], 'third'));
    check(runner.view.phase === 'presenting' && runner.view.task.exerciseId === 'introduction' && runner.view.error === 'save', 'intro failure');
    check(await runner.retry() === 'committed' && runner.view.phase === 'feedback', 'intro retry');
    const kinds = (await scope.snapshot()).facts.filter(f => f.event.sessionId === 'third').map(f => f.event.kind).join();
    check(kinds === 'introduction', kinds);
    db.close(); return true;
  `)).toBe(true);
});

test('a circuit runs every stage for its fixed words, then one correction round, then a summary', async ({ page }) => {
  expect(await run(page, `
    const a = circuitArchive(['tisch', 'stuhl']);
    let runner = await SessionRunner.start(scope, env, a);
    const planned = a.state.plan.tasks.length;
    check(planned === 14, 'planned ' + planned);
    const failed = task => task.target.wordId === 'stuhl' && ['german-type', 'meaning-choice'].includes(task.exerciseId);
    await playPlanned(runner, failed);
    let view = runner.view;
    check(view.correction && view.total === planned + 2 && view.taskIndex === planned && view.phase === 'presenting', 'no correction round');
    check(view.task.target.wordId === 'stuhl' && view.task.exerciseId === 'meaning-choice', 'correction order ' + view.task.exerciseId);
    const options = JSON.stringify(view.task.specification.options);
    // Reload inside the correction round: same corrections and options.
    runner.dispose(); await reopen(); runner = await SessionRunner.open(scope, env, 'circuit');
    view = runner.view;
    check(view.correction && view.taskIndex === planned && JSON.stringify(view.task.specification.options) === options, 'correction resume');
    await runner.submit(correct(view)); await runner.next();
    check(runner.view.task.exerciseId === 'german-type', 'second correction');
    await runner.submit('Falsch'); await runner.next();
    view = runner.view;
    check(view.phase === 'completed' && view.summary && !view.task, 'not completed');
    const s = view.summary;
    check(JSON.stringify(s.words.map(w => w.wordId)) === JSON.stringify(a.state.plan.batch.wordIds), 'batch grew');
    check(s.tasks === planned + 2 && s.mistakes === 3, 'totals ' + s.tasks + '/' + s.mistakes);
    const stuhl = s.words.find(w => w.wordId === 'stuhl');
    const mistakes = stuhl.mistakes.map(m => m.exerciseId + ':' + m.corrected).join();
    check(mistakes === 'meaning-choice:true,german-type:false,german-type:false', mistakes);
    check(s.words.find(w => w.wordId === 'tisch').mistakes.length === 0, 'tisch mistakes');
    // A single correction round only: the session ends instead of correcting the correction.
    const saved = (await scope.snapshot()).sessions[0].state;
    check(saved.corrections.length === 2 && saved.status === 'completed', 'stored corrections');
    db.close(); return true;
  `)).toBe(true);
});

test('a circuit without mistakes completes without corrections', async ({ page }) => {
  expect(await run(page, `
    const runner = await SessionRunner.start(scope, env, circuitArchive(['tisch']));
    await playPlanned(runner);
    check(runner.view.phase === 'completed' && runner.view.summary.mistakes === 0, 'not completed');
    check((await scope.snapshot()).sessions[0].state.corrections === undefined, 'empty round stored');
    db.close(); return true;
  `)).toBe(true);
});

test('storage rejects corrections that do not match the journal or come at the wrong time', async ({ page }) => {
  expect(await run(page, `
    const a = circuitArchive(['tisch']);
    const runner = await SessionRunner.start(scope, env, a);
    const registry = core.createWordExerciseRegistry(PREVIEW_WORDS, PREVIEW_CATALOG_VERSION);
    const forged = task => registry.get(task.exerciseId).buildTask(PREVIEW_WORDS.find(w => w.id === task.target.wordId),
      { taskId: core.correctionTaskId('circuit', task.target.wordId, task.exerciseId), seed: 'forged', answerLanguage: 'ru' });
    // Too early: corrections may only be appended when leaving the last planned task.
    let state = (await scope.snapshot()).sessions[0].state;
    await rejects(() => scope.saveSession({ ...state, revision: state.revision + 1, status: 'paused', corrections: [forged(a.state.plan.tasks[1])] }, state.revision), /append-once/);
    await playPlanned(runner, task => task.exerciseId === 'article-choice');
    state = (await scope.snapshot()).sessions[0].state;
    check(state.corrections.length === 1, 'corrections');
    // Corrections cannot be replaced afterwards, nor exist on single sessions.
    await rejects(() => scope.saveSession({ ...state, revision: state.revision + 1, status: 'paused',
      corrections: [forged(state.corrections[0])] }, state.revision), /append-once/);
    const single = archive('german-type', 'learn-new', ['stuhl'], 'single');
    await rejects(() => scope.startSession({ ...single, state: { ...single.state, corrections: [] } }), /Only circuits/);
    // A round that does not match the mistakes in the journal is refused when appended.
    const b = circuitArchive(['stuhl'], 'other'); const other = await SessionRunner.start(scope, env, b);
    const last = b.state.plan.tasks.length - 1;
    while (other.view.taskIndex < last) {
      const task = other.view.task;
      if (task.exerciseId !== 'introduction') { if (task.input === 'reveal') await other.reveal(); await other.submit(rightAnswer(task)); }
      await other.next();
    }
    if (other.view.task.input === 'reveal') await other.reveal();
    await other.submit(rightAnswer(other.view.task));
    state = (await scope.snapshot()).sessions.find(x => x.state.plan.sessionId === 'other').state;
    await rejects(() => scope.saveSession({ ...state, revision: state.revision + 1, taskIndex: last + 1, status: 'presenting',
      corrections: [forged(b.state.plan.tasks[1])] }, state.revision), /journal/);
    db.close(); return true;
  `)).toBe(true);
});

test('storage refuses a correction round at start, an empty one, or a missing/abandoning one at the plan end', async ({ page }) => {
  expect(await run(page, `
    const registry = core.createWordExerciseRegistry(PREVIEW_WORDS, PREVIEW_CATALOG_VERSION);
    const a = circuitArchive(['tisch']);
    const foreign = registry.get('german-type').buildTask(PREVIEW_WORDS.find(w => w.id === 'lampe'),
      { taskId: core.correctionTaskId('circuit', 'lampe', 'german-type'), seed: 'x', answerLanguage: 'ru' });
    await rejects(() => scope.startSession({ ...a, state: { ...a.state, corrections: [foreign] } }), /Invalid initial session/);
    const runner = await SessionRunner.start(scope, env, a);
    let state = (await scope.snapshot()).sessions[0].state;
    await rejects(() => scope.saveSession({ ...state, revision: state.revision + 1, status: 'paused', corrections: [] }, state.revision), /correction round/);
    // Answer the last planned task wrongly and try to leave without the round, or append it while abandoning.
    await playPlanned(runner, task => task.exerciseId === 'meaning-recall');
    runner.dispose();
    const fresh = circuitArchive(['stuhl'], 'second'); const other = await SessionRunner.start(scope, env, fresh);
    const last = fresh.state.plan.tasks.length - 1;
    while (other.view.taskIndex < last) {
      const task = other.view.task;
      if (task.exerciseId !== 'introduction') { if (task.input === 'reveal') await other.reveal(); await other.submit(rightAnswer(task)); }
      await other.next();
    }
    await other.reveal(); await other.submit('forgotten');
    state = (await scope.snapshot()).sessions.find(x => x.state.plan.sessionId === 'second').state;
    const round = core.buildCorrectionTasks(state.plan, registry, (await scope.snapshot()).facts);
    check(round.length === 1, 'round');
    await rejects(() => scope.saveSession({ ...state, revision: state.revision + 1, taskIndex: last + 1, status: 'completed' }, state.revision), /journal/);
    await rejects(() => scope.saveSession({ ...state, revision: state.revision + 1, taskIndex: last + 1, status: 'abandoned', corrections: round }, state.revision), /journal|archive/);
    check(await scope.saveSession({ ...state, revision: state.revision + 1, taskIndex: last + 1, status: 'presenting', corrections: round }, state.revision) === 'committed', 'valid round');
    db.close(); return true;
  `)).toBe(true);
});

test('a due-components review circuit runs on the same Runner and starts with one diagnostic per word', async ({ page }) => {
  expect(await run(page, `
    await playPlanned(await SessionRunner.start(scope, env, circuitArchive(['tisch', 'stuhl'], 'learn')));
    clock = Date.parse('2027-01-15T09:00:00.000Z');
    const at = env.now(); const data = await scope.restore(at);
    const deck = { ...PREVIEW_DECK, wordIds: ['tisch', 'stuhl'] };
    const planned = core.planVocabularySession({ request: { deckId: deck.id, intent: 'review-due', format: 'circuit', circuitScope: 'due-components', answerLanguage: 'ru' },
      deck, words: PREVIEW_WORDS, progress: data.projections.map(p => p.progress), owner, dataEpoch: epoch.dataEpoch, sessionId: 'review',
      seed: 'review', catalogVersion: PREVIEW_CATALOG_VERSION, at, studyTimezone: 'Europe/Berlin' });
    check(planned.kind === 'ready', 'no review plan');
    const plan = planned.plan;
    check(new Set(plan.tasks.slice(0, 2).map(t => t.target.wordId)).size === 2, 'diagnostics first');
    const runner = await SessionRunner.start(scope, env, { state: { plan, status: 'ready', taskIndex: 0, revision: 0 }, words: PREVIEW_WORDS, catalogVersion: PREVIEW_CATALOG_VERSION });
    check(runner.view.phase === 'presenting' && runner.view.task.exerciseId !== 'introduction', 'review starts with a task');
    await playPlanned(runner);
    const summary = runner.view.summary;
    check(runner.view.phase === 'completed' && summary.mistakes === 0, 'not completed');
    for (const word of summary.words) check(word.components.some(c => c.first === 'independent'), word.wordId + ' has no independent diagnostic');
    const reviewed = (await scope.restore(env.now())).projections.flatMap(p => Object.values(p.progress.components)).filter(c => c.reviewCount > 0);
    check(reviewed.length > 0, 'no review recorded');
    db.close(); return true;
  `)).toBe(true);
});
