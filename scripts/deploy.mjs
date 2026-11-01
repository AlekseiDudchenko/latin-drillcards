import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Production deploy straight to Cloudflare Pages from this machine: no CI, no Git integration.
// Usage: npm run deploy [-- --dry-run] [-- --allow-environment-change]. Needs Node >= 22 (wrangler@4) and `wrangler login`
// (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
const PROJECT = 'latin-drillcards'; // its own Cloudflare Pages project: never the German 'drillcards' one
const SITE = 'https://latin.drillcards.org';
// Git-ignored (.env.v2.*): the five public V2_* values of the hosted build, optionally DRILLCARDS_V2_ENV (default production).
// The environment must equal the one the live site and its Supabase row use (see the check below).
const ENV_FILE = '.env.v2.production';
const KEYS = ['DRILLCARDS_V2_ENV', 'V2_SUPABASE_URL', 'V2_SUPABASE_PUBLISHABLE_KEY', 'V2_SITE_URL', 'V2_DATA_EPOCH', 'V2_EPOCH_STARTED_AT'];
const dryRun = process.argv.includes('--dry-run');
const allowEnvironmentChange = process.argv.includes('--allow-environment-change');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = message => { console.error(`deploy: ${message}`); process.exit(1); };
const run = (cmd, args, env = process.env) => {
  const { status } = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (status !== 0) fail(`${cmd} ${args.join(' ')} failed`);
};

// Only what is on origin/main ships, from a clean tree: the deployed build must match a commit.
if (git('status', '--porcelain')) fail('the working tree is not clean');
git('fetch', 'origin', 'main', '--quiet');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('HEAD differs from origin/main (git pull --ff-only, or a detached worktree at origin/main)');
if (!dryRun && Number(process.versions.node.split('.')[0]) < 22) fail(`wrangler@4 needs Node >= 22 (this is ${process.versions.node})`);

if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} is missing: put the production ${KEYS.join(', ')} there (KEY=value per line)`);
const env = { ...process.env, DRILLCARDS_V2_ENV: 'production' };
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match && !line.trimStart().startsWith('#')) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
const missing = KEYS.filter(key => !env[key]);
if (missing.length) fail(`${ENV_FILE} lacks ${missing.join(', ')}`);

// A client compares its environment and epoch with the server's, so a build that differs from the live one breaks the site
// until the server is promoted too (docs/v2-environments.md). Stop unless the change is deliberate.
if (!['preview', 'production'].includes(env.DRILLCARDS_V2_ENV)) fail('DRILLCARDS_V2_ENV must be preview or production');
const live = await fetch(`${SITE}/v2/environment.json`, { cache: 'no-store' }).then(res => res.json(), () => null);
// The very first deploy has no live site yet: pass --allow-environment-change for it.
if (!live && !allowEnvironmentChange) fail(`cannot read ${SITE}/v2/environment.json to compare the environment (first deploy: pass --allow-environment-change)`);
const differs = !live ? [] : [['environment', env.DRILLCARDS_V2_ENV], ['supabaseUrl', env.V2_SUPABASE_URL], ['siteUrl', env.V2_SITE_URL],
  ['dataEpoch', env.V2_DATA_EPOCH], ['epochStartedAt', env.V2_EPOCH_STARTED_AT]].filter(([key, value]) => live[key] !== value).map(([key]) => key);
if (differs.length && !allowEnvironmentChange) fail(`the build differs from the live site in ${differs.join(', ')}; deploy only after the server is promoted, then pass --allow-environment-change`);

const version = readFileSync('VERSION', 'utf8').trim();
const commit = git('rev-parse', 'HEAD');
console.log(`Deploying ${version} (${commit.slice(0, 7)}) to ${PROJECT}${dryRun ? ' [dry run]' : ''}`);

run('npm', ['run', 'build'], env);
run('npm', ['test'], env);
if (dryRun) { console.log('Dry run: built and tested, nothing uploaded.'); process.exit(0); }

run('npx', ['--yes', 'wrangler@4', 'pages', 'deploy', 'public', `--project-name=${PROJECT}`, '--branch=main',
  `--commit-hash=${commit}`, `--commit-message=Release ${version}`, '--commit-dirty=false'], env);

// The edge may serve the previous deploy for a moment.
for (let attempt = 1; attempt <= 6; attempt++) {
  const live = await fetch(`${SITE}/version.json`, { cache: 'no-store' }).then(res => res.json(), () => null);
  if (live?.version === version) { console.log(`Live: ${SITE} serves ${version}`); process.exit(0); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
fail(`${SITE}/version.json still does not report ${version}; check the Cloudflare dashboard`);
