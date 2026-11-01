import { buildCorrectionTasks, createItemExerciseRegistry, createWordExerciseRegistry, isItemSessionPlan, sessionTasks, summarizeItemSession,
  summarizeVocabularySession, type Evaluation, type ItemExerciseRegistry, type ItemExerciseTask, type ItemSessionPlan, type ItemSessionSummary,
  type VocabularySessionSummary, type JsonValue, type LearningEvent, type SessionRequest, type SessionState,
  type VocabularySessionPlan, type WordExerciseRegistry, type WordExerciseTask } from './core/index.js';
import type { LearningScope, SessionArchive, StoredFact } from './storage/learning-db.js';

/** The S0 scope methods the Runner needs; tests may wrap it to inject failures. */
export type RunnerStore = Pick<LearningScope, 'owner' | 'epoch' | 'snapshot' | 'restore' | 'startSession' | 'saveSession' | 'commit'>;
/** Injected so the Runner never reads an implicit clock or random source. */
export interface RunnerEnvironment {
  now(): string;
  id(): string;
}
/** 'ready' is only visible when saving the session start failed; retry() repeats it. */
export type RunnerPhase = 'ready' | 'presenting' | 'feedback' | 'paused' | 'completed' | 'abandoned';
interface RunnerViewBase {
  readonly sessionId: string;
  readonly phase: RunnerPhase;
  readonly taskIndex: number;
  readonly total: number;
  /** The persisted answer of the current task, with the evaluation stored in the same transaction. */
  readonly answer?: { readonly rawAnswer: JsonValue; readonly evaluation: Evaluation };
  readonly revealed: boolean;
  /** The current task belongs to the circuit's correction round. */
  readonly correction: boolean;
  readonly busy: boolean;
  /** A failed command is retained and can be repeated with retry(). */
  readonly error?: 'save' | 'conflict';
}
/** Vocabulary sessions: word tasks, SRS evidence and a correction round. */
export interface VocabularyRunnerView extends RunnerViewBase {
  readonly family: 'vocabulary';
  /** The planned request: deck, intent, format and answer language. */
  readonly request: SessionRequest;
  /** Undefined only in terminal phases. */
  readonly task?: WordExerciseTask;
  readonly registry: WordExerciseRegistry;
  /** Components and mistakes per batch word; present once the session has ended. */
  readonly summary?: VocabularySessionSummary;
}
/** G3 (#332): sentence, grammar, phrase, audio/video and test sessions on the same Runner. */
export interface ItemRunnerView extends RunnerViewBase {
  readonly family: 'items';
  readonly plan: ItemSessionPlan;
  readonly task?: ItemExerciseTask;
  readonly registry: ItemExerciseRegistry;
  readonly summary?: ItemSessionSummary;
}
export type RunnerView = VocabularyRunnerView | ItemRunnerView;
export type RunnerFamily = RunnerView['family'];
type AnyTask = WordExerciseTask | ItemExerciseTask;
export type CommandResult = 'committed' | 'duplicate' | 'conflict';
export class RunnerDisposed extends Error {
  constructor() { super('Session runner is disposed'); this.name = 'RunnerDisposed'; }
}

type Command =
  | { readonly kind: 'event'; readonly event: LearningEvent; readonly receivedAt: string; readonly expected: number; readonly next: SessionState }
  | { readonly kind: 'state'; readonly expected: number; readonly next: SessionState };

const TERMINAL = ['completed', 'abandoned'];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * One Runner for one persisted session. Every command is built once with its identity
 * (commandId/eventId/attemptId and the next session revision) and the same object is
 * re-sent on retry, so a repeated submit cannot create a second answer.
 * The view is always derived from the stored session and its journal, never from UI state.
 */
export class SessionRunner {
  private archive: SessionArchive;
  private facts: readonly StoredFact[];
  private readonly registry: WordExerciseRegistry | ItemExerciseRegistry;
  private readonly listeners = new Set<(view: RunnerView) => void>();
  private inflight?: { readonly command: Command; readonly promise: Promise<CommandResult> };
  private failed?: Command;
  private conflict = false;
  private disposed = false;
  private summaryCache?: { readonly archive: SessionArchive; readonly value: VocabularySessionSummary | ItemSessionSummary };

  private constructor(private readonly store: RunnerStore, private readonly env: RunnerEnvironment,
    archive: SessionArchive, facts: readonly StoredFact[]) {
    this.archive = archive; this.facts = facts;
    if (isItemSessionPlan(archive.state.plan)) this.registry = createItemExerciseRegistry(archive.datasets ?? []);
    else if ('request' in archive.state.plan) this.registry = createWordExerciseRegistry(archive.words, archive.catalogVersion);
    else throw new RangeError('Runner requires a vocabulary or item session plan');
  }

  /** Persist a planned revision-zero session (idempotent by sessionId) and open it. */
  static async start(store: RunnerStore, env: RunnerEnvironment, archive: SessionArchive): Promise<SessionRunner> {
    await store.startSession(archive);
    return SessionRunner.open(store, env, archive.state.plan.sessionId);
  }

  /** Reopen after reload: rebuild projections at the current time and continue the same tasks. */
  static async open(store: RunnerStore, env: RunnerEnvironment, sessionId: string): Promise<SessionRunner> {
    const data = await store.restore(env.now());
    const archive = data.sessions.find(s => s.state.plan.sessionId === sessionId);
    if (!archive) throw new RangeError('Unknown session');
    const runner = new SessionRunner(store, env, archive, data.facts.filter(f => f.event.sessionId === sessionId));
    await runner.settle();
    return runner;
  }

  /** The most recently created session of that family that is neither completed nor abandoned. */
  static async latestOpenSession(store: RunnerStore, family: RunnerFamily = 'vocabulary'): Promise<string | undefined> {
    const data = await store.snapshot();
    return data.sessions.filter(s => !TERMINAL.includes(s.state.status) && (isItemSessionPlan(s.state.plan) ? 'items' : 'vocabulary') === family)
      .sort((a, b) => b.state.plan.createdAt.localeCompare(a.state.plan.createdAt))[0]?.state.plan.sessionId;
  }

  get view(): RunnerView {
    const { state } = this.archive;
    const tasks = sessionTasks(state);
    const task: AnyTask | undefined = state.taskIndex < tasks.length ? this.registry.validateTask(tasks[state.taskIndex]!) : undefined;
    const own = task ? this.facts.filter(f => f.event.taskId === task.id) : [];
    const answered = own.filter(f => f.event.kind === 'answer').slice(-1)[0];
    // 'answered' requires a persisted answer in storage; the Runner itself commits straight to feedback.
    const phase: RunnerPhase = state.status === 'answered' ? 'feedback' : state.status;
    const family = isItemSessionPlan(state.plan)
      ? { family: 'items' as const, plan: state.plan, registry: this.registry as ItemExerciseRegistry }
      : { family: 'vocabulary' as const, request: (state.plan as VocabularySessionPlan).request, registry: this.registry as WordExerciseRegistry };
    return { sessionId: state.plan.sessionId, ...family, phase, taskIndex: state.taskIndex, total: tasks.length,
      revealed: own.some(f => f.event.kind === 'reveal'), busy: !!this.inflight,
      correction: state.taskIndex >= state.plan.tasks.length && !!task,
      ...(TERMINAL.includes(state.status) ? { summary: this.summary() } : {}),
      ...(task ? { task } : {}),
      ...(answered?.event.kind === 'answer' && answered.evaluation ? { answer: { rawAnswer: answered.event.rawAnswer, evaluation: answered.evaluation } } : {}),
      ...(this.failed ? { error: 'save' as const } : this.conflict ? { error: 'conflict' as const } : {}) } as RunnerView;
  }

  subscribe(listener: (view: RunnerView) => void): () => void {
    if (this.disposed) throw new RunnerDisposed();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Record the answer and its feedback state in one transaction. `assisted` marks an answer given
   * after the solution was shown (e.g. a retry of the same item), so it is never independent evidence. */
  async submit(rawAnswer: JsonValue, options: { readonly assisted?: boolean } = {}): Promise<CommandResult> {
    if (this.failed && await this.reconcile() && this.view.phase !== 'presenting') return 'duplicate';
    const task = this.current('presenting');
    if (task.exerciseId === 'introduction') throw new RangeError('Introductions are continued, not answered');
    if (task.input === 'reveal' && !this.view.revealed) throw new RangeError('Reveal the answer before rating it');
    // A failed save of the same answer is repeated with its original identity.
    const failed = this.failed;
    if (failed?.kind === 'event' && failed.event.kind === 'answer' && failed.event.taskId === task.id &&
        same(failed.event.rawAnswer, rawAnswer)) return this.retry();
    return this.execute(this.eventCommand(task, 'feedback', { kind: 'answer', attemptId: this.env.id(),
      rawAnswer, assisted: options.assisted ?? false, exposure: [] }));
  }

  /** Persist the self-assessment reveal before the answer is shown. Repeats are no-ops. */
  async reveal(): Promise<CommandResult> {
    if (this.failed) await this.reconcile();
    const task = this.current('presenting');
    if (task.input !== 'reveal') throw new RangeError('This task has no answer reveal');
    if (this.view.revealed) return 'duplicate';
    const failed = this.failed;
    if (failed?.kind === 'event' && failed.event.kind === 'reveal' && failed.event.taskId === task.id) return this.retry();
    return this.execute(this.eventCommand(task, 'presenting', { kind: 'reveal', exposure: [] }));
  }

  /** Advance after a persisted answer/introduction. Leaving a circuit's last planned task appends
   * one correction round for its mistakes (same words, never new ones); the last task completes. */
  async next(): Promise<CommandResult> {
    if (this.failed) await this.reconcile();
    this.current('feedback');
    const { state } = this.archive;
    const index = state.taskIndex + 1;
    const corrections = index === state.plan.tasks.length && state.corrections === undefined && !isItemSessionPlan(state.plan)
      ? buildCorrectionTasks(state.plan as VocabularySessionPlan, this.registry as WordExerciseRegistry, this.facts) : [];
    const next: SessionState = corrections.length ? { ...state, corrections } : state;
    const result = await this.execute({ kind: 'state', expected: state.revision, next: { ...next, revision: state.revision + 1,
      taskIndex: index, status: index === sessionTasks(next).length ? 'completed' : 'presenting' } });
    if (result !== 'conflict') await this.settle();
    return result;
  }

  async pause(): Promise<CommandResult> {
    if (this.failed) await this.reconcile();
    const { state } = this.archive;
    if (state.status !== 'presenting' && state.status !== 'feedback') throw new RangeError('Nothing to pause');
    return this.execute({ kind: 'state', expected: state.revision, next: { ...state, revision: state.revision + 1, status: 'paused' } });
  }

  /** Resume returns to feedback only when the current task already has a persisted answer. */
  async resume(): Promise<CommandResult> {
    if (this.failed) await this.reconcile();
    const { state } = this.archive;
    if (state.status !== 'paused') throw new RangeError('Session is not paused');
    const result = await this.execute({ kind: 'state', expected: state.revision,
      next: { ...state, revision: state.revision + 1, status: this.hasEvidence() ? 'feedback' : 'presenting' } });
    if (result !== 'conflict') await this.settle();
    return result;
  }

  /** End the session early. Recorded answers stay; the remaining tasks are not attempted. */
  async finish(): Promise<CommandResult> {
    if (this.failed) await this.reconcile();
    const { state } = this.archive;
    if (TERMINAL.includes(state.status)) throw new RangeError('Session already ended');
    return this.execute({ kind: 'state', expected: state.revision, next: { ...state, revision: state.revision + 1, status: 'abandoned' } });
  }

  /** Repeat the last failed command with exactly the same identity and expected revision. */
  async retry(): Promise<CommandResult> {
    const command = this.failed;
    if (!command) throw new RangeError('No failed command to retry');
    const result = await this.execute(command);
    if (result !== 'conflict') await this.settle();
    return result;
  }

  /** Components and mistakes so far (vocabulary), or each task's first outcome (items), from the stored journal. */
  summary(): VocabularySessionSummary | ItemSessionSummary {
    // Every reload replaces the archive object, so it keys the cache.
    if (this.summaryCache?.archive !== this.archive)
      this.summaryCache = { archive: this.archive, value: isItemSessionPlan(this.archive.state.plan)
        ? summarizeItemSession(this.archive.state, this.facts)
        : summarizeVocabularySession(this.archive.state, this.registry as WordExerciseRegistry, this.facts) };
    return this.summaryCache.value;
  }

  /** Stop notifying and accepting commands. A write already running may still complete. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private current(status: 'presenting' | 'feedback'): AnyTask {
    if (this.disposed) throw new RunnerDisposed();
    const view = this.view;
    if (view.phase !== status || !view.task) throw new RangeError(`Command requires ${status}`);
    return view.task;
  }

  /** Before a different command, learn whether a failed one was in fact stored (lost acknowledgement).
   * Then the new command is built from the real state instead of reporting a false conflict.
   * Callers skip it without a failed command, so a normal write starts synchronously. */
  private async reconcile(): Promise<boolean> {
    if (this.disposed) throw new RunnerDisposed();
    const failed = this.failed;
    if (!failed || this.inflight) return false;
    try { await this.reload(); } catch { return false; }
    const stored = failed.kind === 'event' ? this.facts.some(f => f.event.eventId === failed.event.eventId)
      : same(this.archive.state, failed.next);
    if (stored && this.failed === failed) { this.failed = undefined; this.notify(); }
    return stored;
  }

  private hasEvidence(): boolean {
    const task = this.view.task;
    return !!task && this.facts.some(f => f.event.taskId === task.id && (f.event.kind === 'answer' || f.event.kind === 'introduction'));
  }

  private eventCommand(task: AnyTask, status: SessionState['status'],
    fields: { kind: 'answer'; attemptId: string; rawAnswer: JsonValue; assisted: boolean; exposure: [] } | { kind: 'reveal' | 'introduction'; exposure: [] }): Command {
    const { state } = this.archive;
    const plan = state.plan;
    const at = this.env.now();
    const intent = isItemSessionPlan(plan) ? plan.intent : (plan as VocabularySessionPlan).request.intent;
    const event = { schemaVersion: 1, eventId: this.env.id(), commandId: this.env.id(), sessionId: plan.sessionId,
      taskId: task.id, target: task.target, exerciseId: task.exerciseId, intent,
      answerLanguage: task.specification.answerLanguage, occurredAt: at, studyTimezone: plan.studyTimezone,
      taskVersion: task.taskVersion, contentVersion: task.contentVersion, policyVersion: plan.policyVersion,
      dataEpoch: plan.dataEpoch, ...fields } as LearningEvent;
    return { kind: 'event', event, receivedAt: at, expected: state.revision, next: { ...state, revision: state.revision + 1, status } };
  }

  /** Bring a loaded or advanced session to a presentable state: start it, and commit an
   * introduction before its details may be shown. */
  private async settle(): Promise<void> {
    const { state } = this.archive;
    if (state.status === 'ready') {
      const started = await this.execute({ kind: 'state', expected: state.revision,
        next: { ...state, revision: state.revision + 1, status: 'presenting' } }).catch(() => 'failed' as const);
      if (started !== 'committed' && started !== 'duplicate') return;
    }
    const task = this.view.task;
    // A failure is retained as the failed command: the view reports it and retry() repeats it.
    if (this.archive.state.status === 'presenting' && task?.exerciseId === 'introduction' && !this.hasEvidence())
      await this.execute(this.eventCommand(task, 'feedback', { kind: 'introduction', exposure: [] })).catch(() => {});
  }

  private execute(command: Command): Promise<CommandResult> {
    if (this.disposed) return Promise.reject(new RunnerDisposed());
    if (this.inflight) {
      if (this.inflight.command === command) return this.inflight.promise;
      return Promise.reject(new Error('Another command is still being saved'));
    }
    const promise = this.run(command).finally(() => {
      this.inflight = undefined;
      this.notify();
    });
    this.inflight = { command, promise };
    this.notify();
    return promise;
  }

  private async run(command: Command): Promise<CommandResult> {
    let result: CommandResult;
    try {
      result = command.kind === 'event'
        ? await this.store.commit({ owner: this.store.owner, dataEpoch: this.store.epoch.dataEpoch, event: command.event,
          receivedAt: command.receivedAt, session: command.next, expectedSessionRevision: command.expected })
        : await this.store.saveSession(command.next, command.expected);
      await this.reload();
    } catch (error) {
      this.failed = command;
      throw error;
    }
    this.failed = undefined;
    // Events are deduplicated by the store. A state-only write whose acknowledgement was lost
    // reports a conflict on retry, with exactly the intended state already saved.
    if (result === 'conflict' && command.kind === 'state' && same(this.archive.state, command.next)) result = 'duplicate';
    this.conflict = result === 'conflict';
    return result;
  }

  private async reload(): Promise<void> {
    const data = await this.store.snapshot();
    const sessionId = this.archive.state.plan.sessionId;
    const archive = data.sessions.find(s => s.state.plan.sessionId === sessionId);
    if (!archive) throw new RangeError('Session disappeared from storage');
    this.archive = archive;
    this.facts = data.facts.filter(f => f.event.sessionId === sessionId);
  }

  private notify(): void {
    if (this.disposed) return;
    const view = this.view;
    for (const listener of [...this.listeners]) listener(view);
  }
}
