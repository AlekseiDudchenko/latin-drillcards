import { test, expect, type Page } from '@playwright/test';

// Actual compiled browser adapter and Chromium IndexedDB; no storage mock.
const fixture = `
const { LearningDatabase, ActiveLearningContext } = await import('/v2/storage/learning-db.js');
const core = await import('/v2/core/index.js');
const epoch = { dataEpoch: 'v2', epochStartedAt: '2026-10-01T00:00:00.000Z' };
const at = '2026-10-23T12:00:00.000Z';
const owner = id => ({ kind: 'account', id });
const word = { schemaVersion: 1, contentVersion: 1, id: 'table', lemma: 'Tisch', article: 'der',
  partOfSpeech: 'noun', senseId: 'table', meanings: { ru: { preferred: 'стол', accepted: [] } },
  acceptedForms: [], tags: [], examples: [] };
const words = [word, ...[['chair','Stuhl','стул'],['door','Tür','дверь'],['window','Fenster','окно']].map(([id,lemma,ru]) =>
  ({ ...word, id, lemma, meanings: { ru: { preferred: ru, accepted: [] } } }))];
const registry = core.createWordExerciseRegistry(words, 'catalog/1');
const dbName = 'test-learning-' + crypto.randomUUID();
let db = await LearningDatabase.open(indexedDB, dbName);
const scope = await db.scope(owner('A'), epoch);
function archive(s = scope, id = 'session', exercise = 'target-type') {
  const task = registry.get(exercise).buildTask(word, { taskId: id + '-task', seed: 'seed', answerLanguage: 'ru' });
  return { catalogVersion: 'catalog/1', words, state: { status: 'ready', revision: 0, taskIndex: 0,
    plan: { schemaVersion: 1, sessionId: id, owner: s.owner, dataEpoch: s.epoch.dataEpoch,
      createdAt: at, studyTimezone: 'Europe/Berlin', seed: 'seed', policyVersion: core.EVIDENCE_POLICY_VERSION, tasks: [task] } } };
}
function command(a, id = 'event', patch = {}) {
  const task = a.state.plan.tasks[0];
  return { owner: a.state.plan.owner, dataEpoch: a.state.plan.dataEpoch, expectedSessionRevision: 0, receivedAt: at,
    session: { ...a.state, revision: 1, status: 'feedback' }, event: {
      schemaVersion: 1, kind: 'answer', eventId: id, commandId: id + '-command', attemptId: id + '-attempt',
      sessionId: a.state.plan.sessionId, taskId: task.id, target: task.target, exerciseId: task.exerciseId,
      intent: 'review-due', answerLanguage: 'ru', occurredAt: at, studyTimezone: 'Europe/Berlin',
      taskVersion: task.taskVersion, contentVersion: task.contentVersion, policyVersion: core.EVIDENCE_POLICY_VERSION,
      dataEpoch: a.state.plan.dataEpoch, rawAnswer: task.input === 'choice' ? task.specification.options.find(o => o.wordId === word.id).id : 'Tisch',
      assisted: false, exposure: [], ...patch } };
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

test('atomic answer survives reopening with immutable task, journal, projection, cursor and outbox', async ({ page }) => {
  const result = await run<{ result: unknown[]; dbName: string }>(page, `
    localStorage.setItem('progress_v2', 'foreign'); localStorage.setItem('srs_v1', 'foreign');
    localStorage.setItem('daily_answers_2026-10-23', '999');
    check((await scope.snapshot()).facts.length === 0, 'legacy imported');
    const a = archive(scope, 'choice', 'meaning-choice'); await scope.startSession(a);
    const cmd = command(a); check(await scope.commit(cmd) === 'committed', 'commit');
    check(await scope.commit(cmd) === 'duplicate', 'retry');
    db.close(); db = await LearningDatabase.open(indexedDB, dbName);
    const restored = await db.scope(owner('A'), epoch); const data = await restored.snapshot();
    check(JSON.stringify(data.sessions[0].state.plan) === JSON.stringify(a.state.plan), 'task changed');
    const saved = data.sessions[0]; const r = core.createWordExerciseRegistry(saved.words, saved.catalogVersion);
    check(r.validateTask(saved.state.plan.tasks[0]).specification.seed === 'seed', 'seed');
    const result = [data.facts.length, data.outbox.length, saved.state.revision, saved.state.status,
      data.projections.length, data.facts[0].receivedAt];
    db.close(); return { result, dbName };
  `);
  expect(result.result).toEqual([1, 1, 1, 'feedback', 1, '2026-10-23T12:00:00.000Z']);
  await page.reload();
  expect(await page.evaluate(async (dbName: string) => {
    const path = '/v2/storage/learning-db.js'; const { LearningDatabase } = await import(path);
    const reopened = await LearningDatabase.open(indexedDB, dbName);
    const scope = await reopened.scope({ kind: 'account', id: 'A' }, { dataEpoch: 'v2', epochStartedAt: '2026-10-01T00:00:00.000Z' });
    const data = await scope.restore('2026-10-23T12:10:00.000Z'); reopened.close();
    return [data.facts.length, data.outbox.length, data.sessions[0].state.status];
  }, result.dbName)).toEqual([1, 1, 'feedback']);
});

test('planner output persists its fixed batch, introductions and choice snapshot through the S0 port', async ({ page }) => {
  expect(await run(page, `
    const planned = core.planVocabularySession({ request: { deckId: 'one', intent: 'learn-new', format: 'single',
      exerciseId: 'meaning-choice', answerLanguage: 'ru' }, deck: { id: 'one', title: 'one', wordIds: [word.id] },
      words, progress: [], owner: scope.owner, dataEpoch: epoch.dataEpoch, catalogVersion: 'catalog/1',
      sessionId: 'planned', seed: 'planned-seed', at, studyTimezone: 'Europe/Berlin' });
    check(planned.kind === 'ready', 'empty plan');
    const plan = planned.plan; const a = { catalogVersion: 'catalog/1', words,
      state: { plan, status: 'ready', revision: 0, taskIndex: 0 } };
    await scope.startSession(a);
    const initial = command(a, 'intro');
    const { rawAnswer, attemptId, assisted, ...envelope } = initial.event;
    await scope.commit({ ...initial, event: { ...envelope, intent: plan.request.intent, kind: 'introduction', exposure: ['recognition'] },
      session: { ...initial.session, status: 'presenting' } });
    await scope.saveSession({ ...a.state, taskIndex: 1, status: 'presenting', revision: 2 }, 1);
    db.close(); db = await LearningDatabase.open(indexedDB, dbName);
    const restored = await db.scope(owner('A'), epoch); const data = await restored.restore(at);
    const saved = data.sessions[0].state;
    check(saved.taskIndex === 1 && saved.plan.batch.wordIds.length === 1, 'batch/cursor changed');
    check(JSON.stringify(saved.plan) === JSON.stringify(plan), 'planner metadata lost');
    const task = saved.plan.tasks[1]; const r = core.createWordExerciseRegistry(data.sessions[0].words, data.sessions[0].catalogVersion);
    check(r.validateTask(task).specification.options.length === 4, 'choice archive lost');
    check(data.facts.length === 1 && data.outbox.length === 1 && data.projections[0].progress.introducedAt === at, 'introduction not atomic');
    db.close(); return true;
  `)).toBe(true);
});

test('late receipt cannot roll projection backwards and restore applies deferred facts', async ({ page }) => {
  expect(await run(page, `
    const first = archive(scope, 'early'); const second = archive(scope, 'later');
    await scope.startSession(first); await scope.startSession(second);
    const late = '2026-10-23T12:02:00.000Z'; const early = '2026-10-23T12:01:00.000Z';
    await scope.commit({ ...command(second, 'later', { occurredAt: late }), receivedAt: late });
    await scope.commit({ ...command(first, 'early', { occurredAt: early }), receivedAt: early });
    let data = await scope.snapshot();
    check(data.projectionAsOf === late && data.projections[0].processedEventIds.length === 2, 'projection rolled back');
    const future = archive(scope, 'future'); await scope.startSession(future);
    await scope.commit({ ...command(future, 'future', { occurredAt: '2026-10-23T12:03:00.000Z' }), receivedAt: late });
    data = await scope.snapshot(); check(data.projections[0].deferredEventIds.includes('future'), 'future not deferred');
    data = await scope.restore('2026-10-23T12:04:00.000Z');
    check(data.projections[0].processedEventIds.length === 3, 'deferred not applied on restore');
    data = await scope.restore(early); check(data.projectionAsOf === '2026-10-23T12:04:00.000Z', 'restore rolled back');
    db.close(); return true;
  `)).toBe(true);
});

test('cursor-only saves require prior atomic evidence, pause/resume and next survive recovery', async ({ page }) => {
  expect(await run(page, `
    const a = archive(); await scope.startSession(a);
    await rejects(() => scope.saveSession({ ...a.state, taskIndex: 1, status: 'completed', revision: 1 }, 0), /persisted/);
    await rejects(() => scope.saveSession({ ...a.state, status: 'feedback', revision: 1 }, 0), /atomic/);
    check(await scope.saveSession({ ...a.state, status: 'paused', revision: 1 }, 0) === 'committed', 'pause');
    check(await scope.saveSession({ ...a.state, status: 'presenting', revision: 2 }, 1) === 'committed', 'resume');
    const cmd = command(a); await scope.commit({ ...cmd, expectedSessionRevision: 2, session: { ...cmd.session, revision: 3 } });
    check(await scope.saveSession({ ...a.state, status: 'paused', revision: 4 }, 3) === 'committed', 'pause feedback');
    check(await scope.saveSession({ ...a.state, status: 'feedback', revision: 5 }, 4) === 'committed', 'resume feedback');
    check(await scope.saveSession({ ...a.state, taskIndex: 1, status: 'completed', revision: 6 }, 5) === 'committed', 'next');
    const data = await scope.restore(at);
    check(data.sessions[0].state.status === 'completed' && data.sessions[0].state.revision === 6 && data.facts.length === 1, 'cursor not restored');
    const two = archive(scope, 'two'); two.state.plan.tasks.push(registry.get('target-type').buildTask(word,
      { taskId: 'two-next', seed: 'seed', answerLanguage: 'ru' }));
    await scope.startSession(two); await scope.commit(command(two, 'two-answer'));
    await rejects(() => scope.saveSession({ ...two.state, taskIndex: 1, status: 'feedback', revision: 2 }, 1), /atomic/);
    db.close(); return true;
  `)).toBe(true);
});

test('abort after successful put never acknowledges or partially saves; retry succeeds', async ({ page }) => {
  expect(await run(page, `
    const a = archive(); await scope.startSession(a); const cmd = command(a);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const req = original.apply(this, args); req.addEventListener('success', () => this.transaction.abort()); return req;
    };
    await rejects(() => scope.commit(cmd)); IDBObjectStore.prototype.put = original;
    const after = await scope.snapshot();
    check(after.facts.length === 0 && after.outbox.length === 0 && after.projections.length === 0 && after.sessions[0].state.revision === 0, 'partial commit');
    check(await scope.commit(cmd) === 'committed', 'retry'); db.close(); return true;
  `)).toBe(true);
});

test('A → logout → B and late async completion stay isolated, including same guest/account ID', async ({ page }) => {
  expect(await run(page, `
    const a = archive(); await scope.startSession(a);
    const b = await db.scope(owner('B'), epoch); const guest = await db.scope({ kind: 'guest', id: 'A' }, epoch);
    let clears = 0; const active = new ActiveLearningContext(() => clears++); active.switchTo(scope);
    let release; const waiting = new Promise(r => release = r);
    const pending = active.run(async captured => { await waiting; return captured.commit(command(a)); });
    active.switchTo(); active.switchTo(b); release(); await rejects(() => pending, /no longer active/);
    check(clears === 3, 'UI not cleared');
    check((await active.run(s => s.snapshot())).facts.length === 0, 'A revealed to B');
    check((await guest.snapshot()).facts.length === 0, 'account leaked to guest');
    check((await scope.snapshot()).facts.length === 1, 'late write lost its owner');
    check((await b.snapshot()).outbox.length === 0, 'foreign outbox');
    active.switchTo(scope); check((await active.run(s => s.snapshot())).facts.length === 1, 'A cannot resume');
    db.close(); return true;
  `)).toBe(true);
});

test('concurrent connections use session CAS and reject changed command/attempt identities', async ({ page }) => {
  expect(await run(page, `
    const a = archive(); await scope.startSession(a);
    const secondDb = await LearningDatabase.open(indexedDB, dbName); const second = await secondDb.scope(owner('A'), epoch);
    const results = await Promise.all([scope.commit(command(a)), second.commit(command(a, 'other'))]);
    check(results.includes('committed') && results.includes('conflict'), 'CAS');
    const saved = (await scope.snapshot()).facts[0].event; const duplicate = { ...command(a), event: saved };
    check(await second.commit(duplicate) === 'duplicate', 'duplicate after CAS');
    await rejects(() => second.commit({ ...duplicate, event: { ...saved, rawAnswer: 'Stuhl' } }), /collision/);
    await rejects(() => second.commit({ ...duplicate, event: { ...saved, eventId: 'new', commandId: 'new' } }), /collision/);
    check((await scope.snapshot()).outbox.length === 1, 'duplicate outbox');
    secondDb.close(); db.close(); return true;
  `)).toBe(true);
});

test('invalid binding, projection, plan mutation and failed start leave persisted state intact', async ({ page }) => {
  expect(await run(page, `
    const a = archive(); await scope.startSession(a); const cmd = command(a);
    await rejects(() => scope.commit({ ...cmd, owner: owner('B') }), /scope/);
    await rejects(() => scope.commit({ ...cmd, event: { ...cmd.event, taskId: 'foreign' } }), /binding/);
    await rejects(() => scope.commit({ ...cmd, wordProgress: { owner: owner('B') } }), /projection/);
    await rejects(() => scope.commit({ ...cmd, session: { ...cmd.session, plan: { ...a.state.plan, seed: 'changed' } } }), /plan/);
    const forged = structuredClone(a); forged.state.plan.tasks[0].specification.answer.text = 'forged';
    await rejects(() => scope.startSession(forged), /canonical/);
    const data = await scope.snapshot(); check(data.facts.length === 0 && data.sessions[0].state.revision === 0, 'invalid write');
    const mutable = command(a); const pending = scope.commit(mutable); mutable.event.rawAnswer = 'Stuhl';
    await pending; check((await scope.snapshot()).facts[0].event.rawAnswer === 'Tisch', 'input mutated after await');
    db.close(); return true;
  `)).toBe(true);
});

test('explicit guest transfer replays shared history once and retires guest writes atomically', async ({ page }) => {
  expect(await run(page, `
    const guest = await db.scope({ kind: 'guest', id: 'new-guest' }, epoch);
    const ga = archive(guest, 'guest-session'); await guest.startSession(ga); await guest.commit(command(ga, 'guest-event'));
    const account = archive(scope, 'account-session'); await scope.startSession(account); await scope.commit(command(account, 'account-event'));
    check((await scope.snapshot()).facts.length === 1, 'automatic transfer');
    check(await db.transferGuest(guest, scope, at) === 'committed', 'transfer');
    check(await db.transferGuest(guest, scope, at) === 'duplicate', 'transfer retry');
    const result = await scope.snapshot(); check(result.facts.length === 2 && result.outbox.length === 2 && result.sessions.length === 2, 'lost/duplicated transfer');
    check(result.projections.length === 1 && result.facts.every(f => f.owner.kind === 'account'), 'wrong projection owner');
    check(result.sessions.every(s => s.state.plan.owner.kind === 'account'), 'wrong session owner');
    await rejects(() => guest.commit(command(ga)), /transferred/);
    const other = await db.scope(owner('B'), epoch); await rejects(() => db.transferGuest(guest, other, at), /another account/);
    db.close(); return true;
  `)).toBe(true);
});

test('epoch reset rejects stale handles, prevents old guest resurrection and epoch reuse', async ({ page }) => {
  expect(await run(page, `
    const a = archive(); await scope.startSession(a); await scope.commit(command(a));
    const next = { ...epoch, dataEpoch: 'v3', epochStartedAt: at };
    await rejects(() => db.scope(owner('A'), next), /reset/);
    const fresh = await db.reset(scope, next); check((await fresh.snapshot()).facts.length === 0, 'old history restored');
    await rejects(() => scope.snapshot(), /Stale data epoch/);
    await rejects(() => scope.commit(command(a)), /Stale data epoch/);
    await rejects(() => db.reset(fresh, epoch), /reuse/);
    const guest = await db.scope({ kind: 'guest', id: 'old-guest' }, epoch);
    await rejects(() => db.transferGuest(guest, fresh, at), /same data epoch/);
    db.close(); return true;
  `)).toBe(true);
});
