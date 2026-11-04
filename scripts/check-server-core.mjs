import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Would the deployed `v2-learning-events` function accept what this site sends? The function validates every task
 * and evaluates every answer with the compiled core it was deployed with. A site whose core builds tasks that core
 * does not know (a new task or normalization version, other options) has its answers refused as `invalid-task`:
 * they silently drop out of progress (2.59.1 choice options, 2.62.0 typed tasks).
 *
 * `node scripts/check-server-core.mjs [ref]` builds the core at `ref` (default: the commit recorded in
 * supabase/v2/functions/v2-learning-events/DEPLOYED_CORE) and validates, for every word exercise, a task the
 * current build (`npm run build` first) makes for one word of each kind. Exit code 1 when any is refused.
 */
const RECORD = 'supabase/v2/functions/v2-learning-events/DEPLOYED_CORE';
if (!process.argv[2] && !existsSync(RECORD)) throw new Error(`Pass the deployed commit or record it in ${RECORD}`);
const ref = process.argv[2] ?? readFileSync(RECORD, 'utf8').trim();
const current = await import(pathToFileURL('packages/vocabulary-core/dist/index.js').href);
const { buildSeed, loadSources, IDENTITIES_PATH } = await import(pathToFileURL('scripts/vocabulary-seed.mjs').href);
const seed = buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')), loadSources());

const dir = mkdtempSync(join(tmpdir(), 'dc-server-core-'));
let refused = 0;
try {
  execFileSync('git', ['worktree', 'add', '-q', '--detach', dir, ref], { stdio: 'inherit' });
  symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build-core.mjs'], { cwd: dir, stdio: 'ignore' });
  const deployed = await import(pathToFileURL(join(dir, 'packages/vocabulary-core/dist/index.js')).href);
  const build = current.createWordExerciseRegistry(seed.words, seed.catalogVersion);
  const server = deployed.createWordExerciseRegistry(seed.words, seed.catalogVersion);
  // One translated word per part of speech, and a noun with an article where the catalog has one.
  const translated = seed.words.filter(w => Object.values(w.meanings).some(m => m?.preferred));
  const samples = [...new Map(translated.map(w => [w.partOfSpeech, w])).values(), translated.find(w => w.article)].filter(Boolean);
  for (const exerciseId of current.WORD_EXERCISE_IDS) for (const word of samples) {
    const context = { taskId: `check-${exerciseId}`, seed: 'check', answerLanguage: word.meanings.ru?.preferred ? 'ru' : 'en' };
    if (!build.availability(exerciseId, word, context).available) continue;
    const task = build.get(exerciseId).buildTask(word, context);
    try { server.validateTask(task); console.log(`ok       ${exerciseId} (${task.taskVersion}, ${word.partOfSpeech})`); }
    catch (error) { refused++; console.log(`REFUSED  ${exerciseId} (${task.taskVersion}, ${word.partOfSpeech}): ${error.message}`); }
  }
} finally {
  if (existsSync(dir)) execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' });
  rmSync(dir, { recursive: true, force: true });
}
console.log(refused ? `${refused} sample tasks would be refused by the server core ${ref.slice(0, 7)}: deploy v2-learning-events first.`
  : `The server core ${ref.slice(0, 7)} accepts every task kind of this build.`);
process.exitCode = refused ? 1 : 0;
