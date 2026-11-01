# V1 retirement — 2026-10-30

V2 is the only active DrillCards application. This decision supersedes earlier
requirements to keep v1 running until R3, verify the v1 client, retain old URL/API
compatibility or support two releases. V2 readiness is evaluated against its own
contracts, without legacy feature parity or progress transfer gates.

The v1 client and its runtime-specific tests were removed. Git history retains
them. Shared content, i18n, asset configuration and voice selection remain v2
inputs. Builds remove old emitted JavaScript before compiling, so a reused build
workspace cannot republish the v1 app.

The root/404 entry directs to `v2/today.html`, including old installed-PWA launch
URLs and `/de-trainer/` base paths. Every v2 HTML entry first removes the unmarked old
`sw.js` registration and `drillcards-*` caches. A controlled page reloads before
loading v2 modules. The replacement `sw.js?app=v2` caches only v2 documents and uses
`drillcards-v2-*` caches. Its offline catalog snapshots are preserved. A tab that remains offline cannot receive new code; disabling the API also
prevents it from submitting old progress when it reconnects.

## Existing project: disable the old API

Use the existing project `xdwacapyjeeeeemlkaqq` and an administrative connection.
No new project, credential rotation, Auth reset or Google reconfiguration is
required for retirement. The SQL does not require the v2 schema to be installed.

```sh
psql "$V2_DATABASE_URL" --set ON_ERROR_STOP=on --file supabase/v2/transition/disable-v1.sql
psql "$V2_DATABASE_URL" --set ON_ERROR_STOP=on --file supabase/v2/transition/r3-cutover-check.sql
```

`disable-v1.sql` atomically revokes all client access to every overload of
`upsert_progress`, `sync_progress`, `sync_srs_card`, `sync_daily`, `increment_daily`
and to `progress`, `daily_stats`, `srs_cards`, including explicit column grants.
It checks effective privileges before committing and refuses inherited residual
access. It is idempotent. Auth, Google identities, archive rows and all v2 objects
remain intact. Never replay v1 migrations 001–007: they reopen the legacy API.

`npm run v2:prepare` also copies this exact SQL into the deployment directory.
Apply it separately from the one-time additive catalog install. That install
still preserves historical data; preserving data does not mean supporting v1.

## Verification and operational status

Local tests exercise the real SQL against PostgreSQL with a populated legacy
schema, check denied API calls, retained Auth/history, idempotency and v2 catalog
access. Browser tests cover redirects and worker/cache retirement.

Repository changes and local tests do not prove that hosted SQL was applied or
that the live site was deployed. Record the actual deployment and SQL application
separately. The v2 offline implementation must never restore the v1 shell.
