import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Production deploy straight to Cloudflare Pages from this machine: no CI, no Git integration.
// Usage: npm run deploy [-- --dry-run]. Needs `wrangler login` (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
const PROJECT = 'drillcards';
const SITE = 'https://drillcards.org';
const ENV_FILE = '.env.v2.production'; // git-ignored (.env.v2.*): the five public V2_* values of the hosted build
const KEYS = ['V2_SUPABASE_URL', 'V2_SUPABASE_PUBLISHABLE_KEY', 'V2_SITE_URL', 'V2_DATA_EPOCH', 'V2_EPOCH_STARTED_AT'];
const dryRun = process.argv.includes('--dry-run');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = message => { console.error(`deploy: ${message}`); process.exit(1); };
const run = (cmd, args, env = process.env) => {
  const { status } = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (status !== 0) fail(`${cmd} ${args.join(' ')} failed`);
};

// Only what is on origin/main ships, from a clean tree: the deployed build must match a commit.
if (git('branch', '--show-current') !== 'main') fail('deploy from main (git switch main)');
if (git('status', '--porcelain')) fail('the working tree is not clean');
git('fetch', 'origin', 'main', '--quiet');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main differs from origin/main (git pull --ff-only)');

if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} is missing: put the production ${KEYS.join(', ')} there (KEY=value per line)`);
const env = { ...process.env, DRILLCARDS_V2_ENV: 'production' };
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match && !line.trimStart().startsWith('#')) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
const missing = KEYS.filter(key => !env[key]);
if (missing.length) fail(`${ENV_FILE} lacks ${missing.join(', ')}`);

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
