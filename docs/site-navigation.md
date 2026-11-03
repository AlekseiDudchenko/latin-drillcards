# Site structure and navigation

Five sections, one bar under every page header (`src/client/v2/site-nav.ts`, data in
`site-nav-model.ts`; mounted by `openLearningPage()` so every v2 page gets it):

| Section | Landing page | Pages that highlight it |
| --- | --- | --- |
| Today | `today.html` | — |
| Words | `session.html` (decks, deck, word card, session; see [home-screen.md](home-screen.md)) | — |
| Practice | `practice.html` (hub, grouped by skill) | `sentences`, `listening`, `kasus`, `konjunktiv2`, `gaps`, `redemittel` |
| Video | `video.html` | — |
| Progress | `progress.html` (hub: level test, my words) | `level-test` |

The site entry (`/`, obsolete paths, the PWA `start_url`, the offline fallback in `sw.js`) is
`/v2/today.html`. A new exercise page needs an entry in `SECTIONS[].pages` and an item in
`HUBS` (both are checked by `test/site-nav.test.mjs`); labels exist in RU, EN and DE.

## Footer

`site-footer.ts`, mounted by `openLearningPage()` and by the legal pages, puts one footer after the `<main>` of every
v2 page a visitor reaches from the section bar (the developer pages `environment.html` and `*-demo.html` have none): the sections, contact (email), the legal pages, the author, the copyright and
the version. The version is `APP_VERSION` (`app-version.ts`), which `scripts/inject-version.mjs`
stamps from `VERSION` into the compiled module at build time, so it always matches the release.
The legal pages `privacy.html` and `terms.html` (`legal-page.ts`) render their RU/EN/DE texts and
the shared contacts from `legal-content.ts` without opening the learning store. `today.html` carries a static
`footer[data-static-footer]` with the legal links for readers without JS; the mounted footer replaces it. The v1 URLs
`/privacy` and `/terms` redirect to them (`build-site-entry.mjs`). Checked by `test/site-footer.test.mjs`.

## Today

`today-page.ts` reads the owner's projections, facts and the catalog and links into the
screens that already own the work; it never starts a session itself.

- **Daily goal** — answers (`kind: 'answer'`) of all exercise families in the local day, goal
  `DAILY_GOAL` = 25. **Streak** — consecutive days that reached the goal, ending today or, while
  today is open, yesterday; **best** — the longest such run. Days use the event's own
  `studyTimezone`. Reveals and introductions do not count (`today-model.ts`).
- **Continue** — the newest unfinished vocabulary session (Continue → `session.html#session`,
  Finish in place). Item sessions continue on their family's page.
- **Review** — distinct words due across all decks (circuit, all exercises, answer language from
  the interface language: EN → EN, otherwise RU); the link opens the deck with most due words.
- **Learn new** — deck chosen by `focusDeck`: last studied deck with words left, then the level-test
  recommendation, then the first deck with words left.
- **Practice** and **Decks** — links; a deck shows started/total and its due count.
