# Deploying Latin DrillCards

Own infrastructure only: never reuse the German project's Supabase, Cloudflare Pages project or Google client secret.

1. **Supabase**: create a new project (dashboard). Note the URL and the publishable key.
2. **Database**: `npm ci && npm run build`, then `npm run catalog:bootstrap -- --output build/latin-catalog.sql`
   (fresh-project preflight + catalog schema + seed) and run it in the new project's SQL editor.
   Apply `supabase/v2/migrations/003_learning.sql` after `learning-preflight.sql`, then `004_item_learning.sql`
   and the item datasets (`npm run catalog:datasets`). `npm run v2:prepare` generates all of them in
   `build/v2/<env>/` once `.env.v2.production` exists.
3. **Edge Functions**: deploy `v2-health` and `v2-learning-events` (`build/v2/<env>/supabase/functions`) with
   `V2_ALLOWED_ORIGINS=https://latin.drillcards.org`.
4. **Google sign-in**: enable the Google provider in the new project (own OAuth client or the existing one with the
   new Supabase callback added), and add `https://latin.drillcards.org/v2/environment.html` to the redirect allowlist.
5. **Config**: copy `.env.v2.production.example` to `.env.v2.production` and fill in the five public values.
6. **Cloudflare Pages**: `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`),
   `npx wrangler pages project create latin-drillcards --production-branch=main`, add the custom domain
   `latin.drillcards.org` (Pages → Custom domains; the DNS CNAME is created in the drillcards.org zone).
7. **Release**: from a clean checkout at `origin/main` with Node >= 22: `npm run deploy` (builds, tests,
   uploads `public/`, checks `/version.json`). Use `npm run deploy -- --dry-run` first. The script refuses a
   build whose environment or epoch differs from the live `/v2/environment.json`; the first deploy (no live
   site yet) and deliberate changes need `-- --allow-environment-change`.
