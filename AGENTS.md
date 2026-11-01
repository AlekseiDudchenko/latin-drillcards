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
- Deploys are manual (`npm run deploy`) to a separate Cloudflare Pages project; never merge or deploy
  without the user's go-ahead.
