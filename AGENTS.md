# DrillCards: v2 only

V1 is retired as of 2026-10-30. This is the current product decision and overrides
older plans, runbooks, comments and `.claude/skills/verify` instructions describing
a working v1 runtime, old routes, esm.sh imports or parallel release acceptance.

- Develop, test and release v2 only (`src/client/v2`, `public/v2`).
- `/` and obsolete paths go to `/v2/today.html`; do not restore v1 routes.
- Do not add v1 compatibility, dual writes, old-progress imports, migration UI,
  legacy regression tests, feature parity gates or a second release track.
- Retain the existing Supabase project, Auth users and Google configuration.
  Historical rows may stay as inactive archives. Never reset Auth or the database.
- `supabase/v2/transition/disable-v1.sql` retires the old API; run it once on the
  existing project and verify effective privileges. Re-running is safe. Do not
  replay migrations 001–007 on production: they grant access to the retired API.
- Shared content in `public/data` and shared `config.ts`, `i18n.ts`,
  `voice-selection.ts` are active v2 dependencies. Do not delete these as legacy.
- Git history is the archive for deleted v1 client code/tests. No archived app is
  part of build, preview, deployment or acceptance.

Start from fresh `main`, then branch. Run `npm ci`, `npm run build`, `npm test`,
`npx tsc -p test/tsconfig.json`, `npm run test:e2e`. Build before testing compiled
modules. `npm start` serves port 5173. There is no GitHub CI: local validation is
the gate. Bump `VERSION` for releases.

Deploys are manual and go straight to Cloudflare Pages: after a release PR is merged,
run `npm run deploy` from a clean, up-to-date `main` (builds with the production
`V2_*` values from the git-ignored `.env.v2.production`, runs the tests, uploads
`public/` with Wrangler and checks `/version.json`). Merging does not deploy.

Releases and hotfixes (what is releasable, bump, verify, ship, confirm live): follow
[.claude/skills/release-master/SKILL.md](.claude/skills/release-master/SKILL.md).
Never merge a release PR without the user's explicit go-ahead.

See [retirement and deployment](docs/v1-retirement.md),
[environment configuration](docs/v2-environments.md) and the v2 contracts in docs/.
