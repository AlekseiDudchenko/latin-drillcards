# Latin DrillCards

Latin vocabulary and sentence practice with spaced repetition (FSRS), built on the
[DrillCards](https://github.com/AlekseiDudchenko/de-trainer) platform: local-first, optional
Google sign-in with cloud sync, RU/EN translations.

Content is organised by the sections of the textbook lessons (Lectio I · A, B, T, …). Glosses
are translated from the textbook's German and should be checked against a dictionary.

## Development

```sh
npm ci
npm run build
npm test
npm start      # serves port 5173
```

Tests import compiled modules: always build first. V2 source lives in `src/client/v2/`,
HTML in `public/v2/`, content in `public/data/`, and the learning model in
`packages/vocabulary-core/`.

## Adding vocabulary

Add entries to `public/data/words-<deck>.json` (`id`, `la`, `pos`, `ru`, `en`, optional
`exampleLa`/`exampleRu`/`exampleEn`, `tags`), register a new deck in `DECKS`
(`scripts/vocabulary-seed.mjs`) and `SHARED_DECK_ORDER` (`src/client/v2/learning-context.ts`), then run
`npm run seed:assign` and commit the updated `content/vocabulary/`. Word IDs are permanent.
Macrons are optional when typing; case and u/v, i/j differences are recalled but not spelled.

## Deployment

Deploy `public/` to a separate Cloudflare Pages project on a subdomain, with its own Supabase
project (fresh bootstrap: `docs/catalog-schema.md`, `docs/v2-environments.md`). An unconfigured
build is a local guest preview. See [AGENTS.md](AGENTS.md).
