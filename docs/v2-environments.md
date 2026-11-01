# V2 environments, Google login and deployment (F4 / #308)

> **Latin DrillCards:** this project deploys to its own Supabase project and Cloudflare Pages
> project (`latin-drillcards`, `https://latin.drillcards.org`). See [deploy-latin.md](deploy-latin.md).
> Sections below that mention an "existing project", v1 or `disable-v1.sql` are historical.

## Public configuration and build

`npm run build` writes `public/v2/environment.json` from this explicit allowlist:

| Variable | Meaning |
| --- | --- |
| `DRILLCARDS_V2_ENV` | `local`, `preview`, `production` (default local) |
| `V2_SUPABASE_URL` | Existing hosted project's HTTPS URL; loopback URL locally |
| `V2_SUPABASE_PUBLISHABLE_KEY` | Publishable key or anon JWT, never a service/secret key |
| `V2_SITE_URL` | Exact app URL ending in `/v2/` |
| `V2_DATA_EPOCH` | Distinct v2 generation |
| `V2_EPOCH_STARTED_AT` | Canonical ISO start time |

With no values, the local diagnostic page explicitly stays unconfigured. Partial
or insecure hosted configurations fail. The existing project URL is accepted;
server/provider secrets and arbitrary JSON fields remain excluded. Client storage
is still separated by environment/project/epoch, even when Auth UUIDs and API URL
are shared with v1. No old local Auth/progress/outbox is silently imported.

The checked-in `.env.v2.production` contains only already-public
settings for the current project and `/v2/` on the existing site. It is opt-in:

```sh
npm run build
node --env-file=.env.v2.production scripts/build-v2-environment.mjs
node --env-file=.env.v2.production scripts/prepare-v2-deployment.mjs
```

Use a private copy for another preview origin. Preparation only generates files;
[the transition runbook](v2-existing-project-transition.md) distinguishes applying
SQL, adding a redirect, deploying the function/client and final site cutover.
The generated CLI folder is function-only, without Auth config, migrations or seed
that could accidentally be pushed to the existing project. Do not use `db reset`,
`db push` or `config push` for this transition.

The SDK is the lockfile-installed UMD bundle, self-hosted with its license.
`/v2/environment.html` is an F4 diagnostic entry and the Google callback. Since R1a
every other v2 page opens the same environment through `learning-context.ts`.
Configuration fetches use fresh URLs to bypass the old v1 offline cache.

## Auth and authoritative environment

Google uses PKCE with the fixed callback `V2_SITE_URL + environment.html`. Retain
existing Google credentials and Site URL, and append that exact callback to the
current Supabase redirect allowlist. The backend Google callback stays on the same
Supabase project, so there is no new project's callback to register. Sign-in from
another v2 page stores that page in `sessionStorage`; after the callback activates
the account it returns there once (same origin, under the v2 site path only).

The existing account is restored only through v2's own SDK storage key. Owner
changes/logout invalidate the learning scope synchronously and discard stale
async completions. Same-account token refresh preserves its scope. Failed logout
clears the active scope and cannot allow background refresh to reactivate it;
retry remains available. Guest learning is not silently copied into an account.

`public.v2_environment` is read-only to anon/authenticated/service roles. The
admin-applied transition sets the generation. Both client and smoke compare
metadata with public settings before exposing a learning context. One project has
one metadata row: initial preview and later production must be promoted together
with their client/function settings at R3, not installed as conflicting seeds.

## Edge Function and smoke

`v2-health` uses an injected publishable/anon key and rejects service keys. It
checks anonymous catalog access; if passed a Bearer token, it verifies it through
Auth's user endpoint before returning `signedIn:true`. No learning writes, raw
upstream errors, wildcard CORS or credential output. Requests have an upstream
timeout. Gateway JWT verification is disabled to permit guest/publishable-key
requests; user tokens are verified inside the handler.

Only `V2_ENVIRONMENT` and `V2_ALLOWED_ORIGINS` are added to function environment.
Deployment uses an explicit `--project-ref`; the complete commands and ordering
are in the transition runbook. After deployment:

```sh
node --env-file=.env.v2.production scripts/v2-smoke.mjs
```

An optional private `V2_TEST_ACCESS_TOKEN` stays in headers/memory and is never
printed or written into artifacts. Real Google/provider/redirect acceptance still
needs a live preview check; code and local fixtures alone do not close #308.

## Local validation

```sh
npm run verify
node node_modules/typescript/bin/tsc -p test/tsconfig.json
npx playwright test
npx --yes --package=deno deno check --check-js supabase/v2/functions/v2-health/index.ts
```

PostgreSQL tests cover both a populated v1 project and an empty local test fixture.
They execute the generated transaction and verify Auth/v1 preservation, catalog
contents, grants, collision/reapply refusal and late-failure rollback. Browser
checks use the real SDK with controlled Auth HTTP responses, plus an actual old
service-worker cache scenario. A full CLI local stack needs Docker; its absence
is not presented as a passing stack integration check.

Official references:
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[CLI configuration](https://supabase.com/docs/guides/local-development/cli/config),
[Edge Function authentication](https://supabase.com/docs/guides/functions/auth).

## Page wiring (R1a)

R1a (#325) connected every v2 page — the vocabulary home `/v2/session.html` and the
eight family pages — through one module, `src/client/v2/learning-context.ts`
(`openLearningPage()` in `account-bar.ts` adds the account bar — the topmost line
with the Google photo and the sign-in / sign-out button):

- **Unconfigured build** (`configured:false`): the local preview journal as before —
  one guest in the fixed epoch `preview-1`, the default IndexedDB and the static seed
  catalog. No account bar, no network beyond static files.
- **Configured build**: the public config is checked against `v2_environment`, the
  self-hosted SDK is loaded, and the learning store is the signed-in account's (or
  the namespaced guest's) scope in `<namespace>:learning`. The vocabulary home reads
  `catalog_release`, `catalog_decks` and `catalog_words` with that user's access;
  any backend error is shown and never replaced by the static seed.
- **Sync**: an account runs one `SyncService`. The Runner's store is wrapped so that
  every committed answer calls `sync()`; online, visibility and a one-minute idle
  timer also trigger a pass. The bar shows saved-locally vs. sent.
- **Owner change** (sign-in/out here or in another tab): the page's store goes through
  the auth context's active scope, so from the synchronous invalidation on every read
  or write rejects (`StaleLearningContext`) — also while a failed sign-out waits for
  its retry. When the new owner is ready the page reloads, which drops the Runner,
  its card and every owner-derived view; the old owner's open session stays in its
  own partition.
- **Catalog order**: the server has no deck position, so the client sorts shared decks
  by `SHARED_DECK_ORDER` (the seed's `DECKS` order, checked by a unit test), then the
  owner's decks by ID. One `catalog_release` and one `catalog_decks` read per page give every deck one version
  and avoid fetching each deck descriptor again. Concurrent and repeated deck reads share a promise;
  failed reads can retry. After checking this fresh index, words from a per-owner snapshot may be
  reused only if the catalog version and complete deck descriptor (including word order) match.
  A changed release, changed membership or damaged snapshot fetches words again. Cache storage
  failures do not prevent online learning.

Family pages (M1–M8) load their item datasets from `public/data/items/`; the intake
rejects an answer whose `datasetVersion` is not in `catalog_private.item_datasets`
(`unknown-dataset`). `prepare-v2-deployment.mjs` therefore writes
`item-datasets.sql` with exactly the served files (runbook step 6).

**Offline (R3).** Every v2 page registers the v2-only `sw.js?app=v2`. The worker caches each v2 page
under its own extensionless path (`/v2/session.html` and `/v2/session` are one
entry), never as the v1 shell. The page starts offline from the last environment it
started with online (a hosted one only after its server check), and the home reads
the deck list and decks it last read online from a per-owner Cache Storage snapshot
(`dc-v2-catalog:*`) — only while `navigator.onLine` is false. Online word reuse
requires the successful release/index checks above, so a failing backend is never masked. The site entry switch is in the runbook
([v2-existing-project-transition.md](v2-existing-project-transition.md#переключение-сайта-на-v2-r3-клиент)).

**Application updates.** `public/_headers` requires HTTP revalidation (`Cache-Control: no-cache`)
for documents (including extensionless v2 routes), scripts, styles, the worker, manifest,
version and environment configuration. Add new extensionless page routes to that file;
`test/cache-headers.test.mjs` checks coverage. Audio, images and catalog JSON keep their
existing policies. The worker also fetches navigations, code and its install shell with
`cache: "no-cache"`: a network-first fetch without this flag can still return an old,
fresh HTTP cache entry. Conditional requests reuse unchanged bytes, while successful
responses refresh the offline copy. No connection still falls back to that copy.
Each release must bump `VERSION` so an installed worker updates. Once the new worker
activates, ordinary navigation/reload loads current code without clearing browser data;
an already-open page can need a further ordinary reload after that activation.
`test/code-update.spec.ts` covers replacing a previous worker over four-hour HTTP entries,
then ordinary reload of the new HTML/JS/CSS and reopening those files offline.

Not done: copying a guest's local progress into an account (`transferGuest` is not
offered in the UI).
