# V2 catalog schema and optional fresh bootstrap (F2 / #307)

Current deployment uses the existing project: see
[v2-existing-project-transition.md](v2-existing-project-transition.md). The fresh
bootstrap below remains an isolated test utility, not the current rollout path.

Implemented: isolated catalog storage, revision/relationship constraints, published
read models, private/public decks, and a reproducible initial editorial import.
No v1 migrations, users, progress, SRS state, compatibility RPCs or production
connection are needed for isolated tests. Configuring the existing project is F4
(#308); contribution/review/publication endpoints are C1–C5 (#320–#324).

## Local verification

```sh
npm ci
npm run verify
node --test test/catalog-schema.test.mjs
```

The catalog test is already included in `npm test`. It executes the **real SQL**
and complete repository seed using PGlite (embedded PostgreSQL), with Supabase
`auth.users`, `auth.uid()`, `anon`, `authenticated` and `service_role` as fixtures.
It imports no old migrations. SQL, foreign keys, triggers, privileges, views and
RLS execute normally; the tests do not mock their behavior. The service fixture
has `BYPASSRLS`, matching Supabase's service role. This is not an OAuth/PostgREST
integration test; preview integration belongs to F4.

## One-command artifact for a clean database

```sh
npm run catalog:bootstrap -- --output /tmp/v2-catalog.sql
```

This builds the shared core and writes one transaction containing
the optional fresh-project preflight, `supabase/v2/migrations/001_catalog.sql`
plus the F3 catalog seed. It **does not
connect** to a database, read credentials, reset data or create users. The output
pins the repository commit and source-file hashes. The schema path is separate
from `supabase/migrations/001–007`, which belong to the old application.

### Target database

v2 adds its catalog to the **existing Supabase project** without resetting the
application database or Auth. Accounts, Google settings, Site URL and v1
rows/RLS/grants/RPCs stay intact until the separate R3 cutover. Use the generated
`transition.sql` from [the runbook](v2-existing-project-transition.md), whose
preflight checks name collisions before creating objects. Never apply the old
CLI migrations again, or run `db reset`, `db push` or `config push` for this path.

The optional fresh bootstrap is only for an empty local/test database. Its
separate preflight refuses v1 tables; that restriction is not in the additive
catalog migration. Both paths commit schema and seed atomically, refuse repeat
installation without overwriting data, and require Supabase Auth/API roles.
Later catalog changes use reviewed forward migrations; seed updates use
`catalog:import` (below).
Source URLs pin the current commit, so seed sources must be committed first.
Keep `catalog_private` out of the exposed PostgREST schemas.

The old migration's v1-RPC absence gate is replaced by an **R3-only** read-only
cutover check (`supabase/v2/transition/r3-cutover-check.sql`). It requires all v1
RPC overloads and direct table writes to be inaccessible to client roles after
acceptance. Functions may remain for archival purposes; disabling access does not
require deleting accounts, history or function definitions. F4 deliberately keeps
them working and tests their preservation.

The initial import marks each repository text and sense association separately
as an editorial `seed` review, with no fabricated participant UUID. This is a
privileged initial import, not a user-visible bulk-confirm feature. It preserves
canonical IDs, content versions, example IDs, preferred/accepted translations and
deck order from F3. Both German noun articles and separate homonymous senses are
retained.

- Each translation credits only the source entries that wrote that text
  (`seed.translationSources`).
- A translation's entity ID is `<wordId>/<lang>/<hash of language and text>`, not
  its position, so reordering never relabels it. The preferred-first order is the
  manifest position.
- The sources of a detail example, its translations and its association with the
  word point to the `-detail.json` file.
- Retired seed IDs are inserted as `words` without a publication: they are
  reserved and never visible.
- `catalog_imports` records the seed's `catalogVersion`, seed version and commit. No uniqueness rule equates a spelling or translation with a sense.

## Seed updates on a live catalog (#356)

Once users exist the catalog cannot be recreated: progress is tied to `wordId`
and publications are immutable. A new seed version goes in as a diff, in two
steps that never connect to a database themselves:

```sh
npm run catalog:import -- --state-query /tmp/catalog-state.sql
psql "$V2_DATABASE_URL" -qAt --set ON_ERROR_STOP=on --file /tmp/catalog-state.sql --output /tmp/catalog-state.json
npm run catalog:import -- --state /tmp/catalog-state.json --output /tmp/catalog-import.sql
psql "$V2_DATABASE_URL" --set ON_ERROR_STOP=on --file /tmp/catalog-import.sql
```

The state query is read-only (`BEGIN READ ONLY`, service role). It exports every
word, publication model and manifest, the shared decks and a fingerprint. The
import is one transaction under `SET LOCAL ROLE service_role` (Supabase grants
that role to `postgres`), so it can only do what the service role may: append
history, move `published_version` and write shared decks.

- **New words** are written as in the bootstrap.
- **Changed words** (higher `contentVersion`) get a new publication. Only elements
  whose body or sources changed get a new revision, a seed review and provenance
  at the new commit. Unchanged elements are reused with their existing review.
  Translations are identified by text hash and examples by source ID. A
  translation or association pins its example and root revision, so a new
  example text or root renews those too. The pointer moves to the new version.
  Old publications stay in `published_word_versions` for tasks pinned to them.
- **Retired words** keep their row and history. Only `published_version` becomes
  `NULL`: they leave `catalog_words` and shared decks and stay reserved. A
  personal deck keeps its membership, which the deck projection hides while the
  word is unpublished. A revived word gets its publication back.
- **Shared decks** (`owner_id IS NULL`) get title, composition and order from the
  seed. Personal decks are never touched.
- A new `catalog_imports` row records `catalogVersion` and the commit, so
  `catalog_release` names the new snapshot.

The plan refuses instead of guessing: a seed version lower than the published one,
a published version whose model differs from the seed, a published word or shared
deck the seed does not know, or an earlier catalog version that no longer matches.
The import file starts with an advisory lock and a check that the catalog
fingerprint still matches the exported state. A stale file, or the same file
applied twice, fails before any write ("already imported"). Exporting again after
a successful import gives "Nothing to import" and writes no file. Any failure,
including deferred checks at `COMMIT`, rolls back the whole transaction, so there
are no half-publications.

A change in provenance alone, without new content, does not bump `contentVersion`
and is not re-imported. Words created outside the seed (future C4 contributions)
are refused until the import learns to leave them alone.

`test/catalog-import.test.mjs` runs this on PGlite. It bootstraps the real seed,
then edits a word (new EN gloss and RU example translation), adds a word, retires
one and reorders a deck. It checks that the import gives exactly the new seed
models, that the old versions stay in history and that only the 9 changed
revisions are new. It also checks the personal deck, the repeat no-op and the
stale-file refusal, and the rollback of an import that fails at `COMMIT`.

## Storage and publication contract

All source data lives in `catalog_private`, without browser schema/table/function
grants. Every table also has RLS; there are no permissive client policies there.
`service_role` gets SELECT/INSERT and may change only `words.published_version`.

- `words`: permanent identity and sense, with a nullable current-publication pointer.
  A word without a publication (e.g. a retired seed ID) is reserved and invisible.
- `catalog_imports`: append-only record of each catalog import (catalog version,
  seed version, source commit).
- `content_revisions`: stable entity, revision, kind, word owner, SHA-256 hash.
- `word_revisions`, `word_translations`, `examples`, `example_translations`:
  typed bodies of those revisions. RU and EN are independent; one confirmed
  translation language is sufficient.
- `word_examples`: versioned association of an exact example revision to an exact
  word revision/sense. An example and its translations do not imply this review.
- `content_sources`: provenance **per revision** (provider, source identity and
  revision/hash, URL, attribution, license, import time, modification flag).
- `content_reviews`: decision bound by FK to the exact revision and content hash.
  Participant reviews need a reviewer UUID; seed reviews have a separate kind.
  Reviewer identity is historical and does not cascade from deletion of Auth users.
- `word_publications`, `publication_items`: immutable manifests selecting exact
  revisions and their exact confirmed reviews, with stable display ordering.

The service writes all revisions, typed bodies, sources and reviews, then inserts
manifest items **before** inserting the publication row, in one transaction.
The manifest-to-publication FK is deferred. Manifest insertion and publication
sealing lock the same word row until transaction end, so concurrent requests
cannot append an item after the publication check. Inserting the publication seals it:
missing reviewed root/meaning, unrelated revisions, duplicate element revisions,
duplicate answers, incomplete/unrelated examples or missing provenance fail.
The current pointer can move only to an existing publication (deferred FK).

Revisions, reviews, sources, manifests and publications reject UPDATE/DELETE.
An existing publication also rejects extra manifest items. Editing or reviewing
a candidate cannot change an old snapshot. The private
`published_word_versions` view keeps historical `Word` models readable by the
service for version-pinned evaluation. It is not exposed to the browser.

These constraints are the storage boundary. Future C4 must additionally enforce
authenticated contribution ownership, expected revision/concurrency, actual hash
calculation, provider licensing rules, request limits and atomic publication
through a narrow server endpoint. A browser never receives generic catalog writes.
No enrichment jobs, external provider integrations or contribution API are added
by F2.

## Public API read models

| Relation | Shape / access |
| --- | --- |
| `public.catalog_words` | `id`, `content_version`, `word` (JSON matching core `Word` exactly). Current publications only; anonymous SELECT. |
| `public.catalog_sources` | Included revision provenance of current publications; anonymous SELECT. No reviewer UUIDs or candidates. |
| `public.catalog_decks` | `id`, `title`, `wordIds` (JSON array matching core `Deck`). Shared decks plus the signed-in user's own decks. |
| `public.catalog_release` | `catalog_version`, `seed_version`, `source_ref`, `imported_at` of the latest import: the snapshot version a client pins for its exercise registry. Anonymous SELECT. |
| `public.decks` | Shared rows have `owner_id=NULL` and an ID without `:`; private rows have the Auth UUID and an ID `<owner UUID>:<name>`. A user cannot take a shared ID, and a unique violation reveals nothing about other users' decks. RLS isolates SELECT and owner-only INSERT/UPDATE/DELETE. |
| `public.deck_memberships` | Stable `(deck_id,word_id)`, distinct order position. SELECT requires a visible deck and a published word. Owner-only INSERT/DELETE; INSERT requires a published word. |

Catalog projection views have owner access and explicit, curated outputs; raw
candidate tables remain unreachable. Deck projection uses `security_invoker=true`
so underlying owner policies apply. Anonymous deck reads explicitly allow only
shared decks, even if a subject claim is present. Clients cannot transfer a deck
to another owner, modify shared decks, alter someone else's memberships, or delete
a global word by removing a personal membership. No user-wide or progress fields
appear in the public word model.

Repository-source provenance uses `LicenseRef-RepositorySeed` to identify inherited
repository material; it is **not** a claim of a new license or a grant of external
redistribution rights. Commit URLs and file hashes identify the actual material.
Imported Wiktionary/Tatoeba texts must later retain their own actual licenses,
authors and source revisions; this seed marker must not be used for those imports.

## Verification coverage

Tests compare all seeded Word/Deck models with F3, including cross-deck identity,
all examples, accepted translations and ordering. Additional SQL scenarios cover
client denial of internal writes/reads, two users, anonymous access, owner changes,
private membership isolation, candidate exclusion, historical snapshots, revision
and hash mismatches, independent example/link/translation reviews, immutable
published manifests, provenance (per translation and for detail examples),
text-based translation IDs, the catalog release, reserved retired IDs, deck ID
namespaces, duplicate answers/memberships and invalid articles.

No VERSION bump or production deployment is part of this schema change.
