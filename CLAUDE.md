# DrillCards

Read [AGENTS.md](AGENTS.md) first. V2 is the only active application; v1 is retired.
Old instructions describing v1 pages, router, SRS, esm.sh or parallel release
acceptance are superseded, including the older local `verify` skill.
For releases and hotfixes use the `release-master` skill
(`.claude/skills/release-master/SKILL.md`).

TypeScript → native ES modules, without a framework or bundler. Edit v2 in
`src/client/v2/`, static pages in `public/v2/`, shared styles in `public/style.css`.
`public/sw.js` is tracked v2-only worker source. Other browser JavaScript is
build output. The SDK is self-hosted by `build-v2-environment.mjs`.

Build before testing: `npm ci` → `npm run build` → `npm test`.
Use `assetUrl()` for shared data. Keep all EN/RU/DE translation keys in sync.
When changing vocabulary source files, run `npm run seed:assign` and commit the
updated identities/duplicates. Word IDs are permanent. Validate content triples,
empty strings, duplicates and self-referential synonyms before committing.
