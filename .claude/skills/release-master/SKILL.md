---
name: release-master
description: Use to prepare, ship and verify a DrillCards release (or hotfix) — bump VERSION, build, test, open the release PR, merge it and deploy to Cloudflare Pages on the user's go-ahead, and confirm the live site. Triggers on "сделай релиз", "новый релиз", "подготовь релиз", "что готово для релиза", "release", "hotfix", "ship it".
---

# Release master

Policy lives in `AGENTS.md` ("Bump `VERSION` for releases"; v2 only); read it if
this file and it ever disagree. A release is one small PR that bumps `VERSION`.
`scripts/inject-version.mjs` (run by `npm run build`) stamps it into `public/sw.js`, `public/index.html` and
`public/404.html`; the new service-worker version rolls the offline cache so
installed clients drop the old scripts and styles. Merging to `main` does **not**
deploy: there is no GitHub CI and the Cloudflare Git integration is off. A release
goes live when `npm run deploy` is run from an up-to-date `main`, which uploads
`public/` to Cloudflare Pages (latin.drillcards.org). Nothing else is part of a release.

Talk to the user in Russian. **Merging a release PR and deploying are
production-facing: ask and wait for a clear yes for each, every time** ("Слить"
for one PR does not cover the next, and a merge does not cover the deploy). Never
merge other people's PRs as a side effect of a release.

## Agent checklist

1. Read what the user asked and do **only that step** (table below).
2. Fetch, then compare `main`'s `VERSION`, the live `version.json` and the commits
   since the last `Release …` commit (step 1).
3. Work only in a fresh worktree off `origin/main`; leave other sessions' files alone.
4. Verify locally and say exactly what ran and what did not.
5. Open the PR, report, and stop. Merge and deploy each need their own explicit yes.
6. After a deploy, read the live site back before saying "done".

| The user says | Do this, and stop there |
|---|---|
| «что готово для релиза» | Report only (step 1). Change nothing. |
| «сделай / подготовь релиз» | Steps 2–4: branch, bump, verify, open the PR, report. Do not merge. |
| «слить / сливай» (a named PR) | Merge that PR (step 5). Then ask about the deploy. |
| «деплой / деплоай» | Deploy from up-to-date `main` (step 5) and confirm the live version. If the release PR is not merged yet, say so and ask first. |
| «сделай хотфикс» | Hotfix flow below. |

## 1. Find out what is releasable

```bash
git fetch origin -q
git show origin/main:VERSION; curl -s https://latin.drillcards.org/version.json
L=$(git log origin/main --format=%H --grep='^Release ' -1); git log --oneline $L..origin/main
gh pr list --state open --json number,title,headRefName,mergeable
```

- If `main`'s `VERSION` is ahead of the live `version.json`, a release is merged
  but **not deployed**: that is what is "ready" — go to the deploy step.
- The commits after the last `Release …` commit are the release content. Nothing
  there means there is nothing to release — say so, do not bump for the sake of it.
- Other sessions release too: re-fetch right before branching, and if `main`'s
  `VERSION` moved, recompute the version.
- Branches showing "+N ahead of main" are mostly squash-merged leftovers. Only a
  branch with recent commits and no PR is live work (leave it alone).
- An open PR is not part of the release unless the user says so. Before offering
  one, trial-merge it into a scratch worktree: a stale branch can conflict or be
  superseded by what is already on `main` (#394 was — #395 had done it).

### Server function compatibility (check every release)

The site and the `v2-learning-events` Edge Function both run the compiled core
(`packages/vocabulary-core`). The function validates every task and evaluates every answer
with the core it was **deployed** with, and `npm run deploy` does not deploy it. When the
release changes how tasks are built or answers evaluated (a task or normalization version,
choice options, evaluation), the deployed function refuses the new answers as
`invalid-task`. Refused answers silently drop out of progress, and the account bar shows
"the server did not accept N answers". This happened twice in the German DrillCards:
choice options (2.59.1) and typed tasks of version 2 shipped without a function deploy (2.62.0).

So for **every** release, not only for the PRs you wrote yourself:

```bash
npm run build && node scripts/check-server-core.mjs   # exit 1 = the deployed core would refuse something
```

The script reads the deployed commit from `supabase/v2/functions/v2-learning-events/DEPLOYED_CORE`
(or takes it as an argument). That file does not exist yet: ask the user which commit the
function was last deployed from, or record it after the next function deploy. If the check
refuses anything or the core changed since that commit:
- Say so in the release report and the PR body, and name the PRs that changed the core.
- The function is deployed **before** the site (`npm run v2:prepare`, then
  `supabase --workdir build/v2/<env> functions deploy v2-learning-events --project-ref …`).
  That deploy needs its own yes and the user's Supabase access. Then update `DEPLOYED_CORE`.
- Answers already refused need a one-time requeue rule in `learning-db.ts`, shipped only
  after the function is deployed.
- A question about sync risk covers the whole release: run this check on what ships,
  not only on your own diff.

Pick the version from history: user-visible feature or behavior change → minor
(2.50.0, 2.51.0, 2.53.0); fix, content or test-only → patch (2.52.1, 2.53.1).
Propose it and let the user override.

## 2. Prepare in a clean worktree

Never work in a checkout with uncommitted changes you did not make — other
sessions leave work in progress in these folders (`git status` first). Make a
fresh worktree off `origin/main` and reuse the existing `node_modules`:

```bash
git worktree add -b release/X.Y.Z ../dc-release-XYZ origin/main
cd ../dc-release-XYZ && ln -s <path-to-a-checkout>/node_modules node_modules
echo X.Y.Z > VERSION && npm run build
git status --short   # exactly: VERSION, public/404.html, public/index.html, public/sw.js
```

Do not `git stash pop` (the stash is shared between worktrees); add the four files
by name (the symlink is git-ignored). Remove the worktree when done. The symlink may
point at a checkout whose `node_modules` is stale (seen: no `@types/node`, so the spec
typecheck fails): if a tool is missing, run `npm ci` in the worktree instead.

## 3. Verify locally

```bash
npm test                          # build first; all must pass
npx tsc -p test/tsconfig.json     # typecheck the specs (needs the built tree)
npm run test:e2e                  # full e2e
```

This is the gate `AGENTS.md` prescribes (v2 only: no v1 compatibility checks, no
parallel release acceptance). There is no GitHub CI, so the local run is the gate
and the PR body says so.

The spec typecheck can fail on `main` itself (seen at 2.53.1: `session-page.spec.ts(330)`
`.at` on `string[]`, introduced before the release). Compare with a clean
`origin/main`: the same errors there are not the release's — do not block on
them, list them in the PR body and tell the user. New errors are yours to fix.

**Port 5173.** `npm run test:e2e` starts `npm start` on 5173 but *reuses whatever
already listens there* (`reuseExistingServer`). Another session's dev server
serves another checkout, and you get unrelated failures (audio, word-exercises).
Before e2e run `lsof -nP -iTCP:5173 -sTCP:LISTEN` and look at that process's cwd
(`lsof -p <pid> -a -d cwd`). If it is not yours, do not kill it: ask the user to
stop it. Running on another port only works for specs that do not hard-code
`http://localhost:5173` — `sync-races`, `sync-service`, `v2-account`,
`v2-environment` do — so those cannot be verified that way. If a part of e2e could not
be run, say so in the PR body and in the report; update the body if you run it later.

A red e2e test that is not yours: run the same e2e on a clean `origin/main` worktree and
`diff` the two lists of failed tests (`… | grep -E '^\s+test/.*›' | sort`). An identical
list means the release adds nothing; say so in the PR body with the counts.

For a red test: re-run it alone with `--repeat-each=4` on the release branch
**and** on a clean `origin/main`. Same result on both and passing on rerun is a
flake (seen: `sentences-v2` "keyboard only", `card-ui` "typing, option identity…").
Report flakes honestly in the PR; never hide a real failure.

If the release changes HTML together with scripts, remember the worker serves
`.js`/`.css` network-first (since 2.51.1) so a page and its script come from the
same deploy; do not weaken that in `sw.js`.

## 4. Commit and open the PR

Commit and PR title: `Release X.Y.Z: <short summary of what ships>`. Commit body:
`Rolls the offline cache so installed clients pick up the new <pages/styles/scripts>.`
Add the attribution line the session asks for.

PR body:

```
## Summary
Version bump A → X.Y.Z (`VERSION`, `public/sw.js`, `public/index.html`, `public/404.html`) as in the previous releases; the new service-worker version rolls the offline cache for installed clients.

Since A:
- #NNN <what changed for the user>

## Testing
- `npm run build`, `npm test`: N pass.
- Full e2e: …(failures and why they are flakes/known)
- There is no GitHub CI; the checks above were run locally.
```

Open it, make sure the session is bound to it (`ccd_pr` `get_status`; `bind_pr`
if not), then report to the user: what ships, what does not (open PRs, WIP
branches), test results, the proposed version — and ask for the merge.

## 5. Merge, deploy and confirm live (each only after the user says yes)

```bash
gh pr merge N --squash --subject "Release X.Y.Z: … (#N)" --body "<one line>\n\nCo-Authored-By: …"
```

Do not add `--delete-branch` while `main` is checked out in another worktree: the merge
succeeds on GitHub but `gh` then fails to switch the local checkout to `main`.

The merge ships nothing. Report it, then ask separately whether to deploy. If
`check-server-core.mjs` refused anything, the function must be deployed first: do not deploy
the site until the user confirms it is (or explicitly accepts the refusals). On a
yes, from a clean checkout at `origin/main` (the script needs `HEAD == origin/main` and
a clean tree; `main` itself is often held by another worktree, so a detached
`git worktree add --detach ../dc-deploy origin/main` with the `node_modules` symlink works):

```bash
node -v                      # wrangler@4 needs Node >= 22 (Homebrew: /opt/homebrew/opt/node@22/bin)
ls .env.v2.production         # git-ignored; see docs/deploy-latin.md and the environment rule below
npm run deploy -- --dry-run  # build, test and the environment check; uploads nothing
npm run deploy               # the same, then wrangler pages deploy, then polls /version.json
```

**The environment must match the live site.** A client compares its environment and data
epoch with the server's `v2_environment` row and stops on a mismatch, so a build that
differs from the live one breaks the site. `.env.v2.production` carries the five public
`V2_*` values (and optionally `DRILLCARDS_V2_ENV`, default `production`); the script reads
`https://latin.drillcards.org/v2/environment.json` and refuses to deploy if `environment`,
`supabaseUrl`, `siteUrl`, `dataEpoch` or `epochStartedAt` differ. Pass
`--allow-environment-change` only for a deliberate change (server row and client together)
or the very first deploy, when there is no live site yet. Never invent or ask for values in
chat; if Wrangler is
not logged in (`npx wrangler@4 login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
tell the user — `wrangler login` needs them at the browser. By hand, confirm too:

```bash
curl -s https://latin.drillcards.org/version.json          # {"version":"X.Y.Z"}
curl -s https://latin.drillcards.org/sw.js | grep 'const VERSION'
```

Report the live version. A bad deploy is undone with a rollback in the Cloudflare
dashboard (Pages → latin-drillcards → Deployments), then fix forward.

If the page misbehaves for a user right after a release (blank cards, console
error in `session-page.js`), suspect a stale cached script first, then ship a
hotfix through this same flow.

## Housekeeping (only when the user asks)

- Squash-merged branches stay on `origin` and show as "+N ahead". Delete a remote
  branch only if its tip equals the head SHA of a **merged** PR
  (`gh pr list --state merged --json headRefName,headRefOid`), re-checking right
  before the delete. Never delete the branch of a closed-unmerged PR, a branch with
  newer commits than its PR, or a branch with no PR.
- Closing a stale PR: leave a comment with the reason (superseded by #N, conflicts).
- zsh does not word-split `$VAR`: loop over arrays (`B=(a b c); for b in $B`), or the
  loop silently runs once on the whole string.
- Remove your scratch worktrees (`git worktree remove`) and the `node_modules`
  symlink first; never touch worktrees that hold changes you did not make.

## Hotfix

Same flow, patch version, branched from the current `origin/main`. Write a
regression test that fails on the old code before fixing (`test/sw-code-freshness.test.mjs`
is the model), state the cause in the PR body, and mention in it any client that
needs one reload to pick the fix up.
