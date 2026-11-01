# DrillCards

German practice with vocabulary, sentence building, grammar, listening and video.

**[drillcards.org](https://drillcards.org)** · **v2 is the only active application**

V1 has been retired. The root and obsolete URLs open `/v2/today.html`.
There is no v1 compatibility, dual runtime or old-progress import requirement.
Existing Auth accounts and Google configuration are retained.

## Development

```sh
npm ci
npm run build
npm test
npx tsc -p test/tsconfig.json
npm run test:e2e
npm start
```

`npm start` serves port 5173. Tests import compiled modules: always build first.
The build removes obsolete compiled v1 files before compiling the active client.
V2 source lives in `src/client/v2/`, HTML in `public/v2/`, shared content in
`public/data/`, and the learning model in `packages/vocabulary-core/`.

## Deployment

Deploy `public/` using the existing hosting configuration. Configure the v2
backend explicitly; an unconfigured build is a local guest preview, not an online
production deployment. See [v2 environments](docs/v2-environments.md).

Apply [v1 API retirement](docs/v1-retirement.md) to the existing Supabase project.
The prepared deployment includes `disable-v1.sql`. Static publication alone cannot
close the old backend to previously opened tabs. Do not reapply historical v1
migrations or reset the database/Auth.

See [AGENTS.md](AGENTS.md) for the current development and release policy.
