# Latin DrillCards

Forked from the German DrillCards v2 (copied, not a GitHub fork; origin: de-trainer v2.57.2).
There is no v1 and no legacy compatibility.

- Develop in `src/client/v2`, `public/v2`, `packages/vocabulary-core`, content in `public/data`.
- Fresh Supabase project only: use `supabase/v2/migrations` through the fresh-project preflight
  (`npm run catalog:bootstrap`, `npm run v2:prepare`). Never point this app at the German project.
- Run `npm ci`, `npm run build`, `npm test` before every commit. Build before testing compiled modules.
- Vocabulary changes: edit `public/data/words-*.json`, run `npm run seed:assign`, commit
  `content/vocabulary/`. Sentences: edit `public/data/sentences-*.json`, run `npm run items:sentences`.
- Word IDs are permanent. Validate content (empty strings, duplicates) before committing.
- The `article` component is dormant (Latin has no articles); it may become noun gender later.
- Speech uses the device voice (`la`, falling back to `it`); there is no recorded audio yet.
- Deploys are manual (`npm run deploy`) to a separate Cloudflare Pages project, from a clean checkout
  at `origin/main` (Node >= 22). The script builds with `.env.v2.production`, refuses a build whose
  environment or epoch differs from the live site (`--allow-environment-change` for a deliberate change
  or the first deploy), runs the tests, uploads `public/` and checks `/version.json`. Never merge or
  deploy without the user's go-ahead.
