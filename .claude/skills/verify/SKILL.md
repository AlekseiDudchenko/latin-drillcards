---
name: verify
description: Build, launch, and drive DrillCards in a headless browser to verify changes end-to-end. Use when confirming a feature or fix works in the running app.
---

# Verifying DrillCards changes

## Build & launch

```bash
npm ci                 # once per container (@supabase/supabase-js is a real dep)
npm run build          # tsc → public/ + version inject
npm start              # express dev server on http://localhost:5173 (SPA fallback)
```

Unit tests (`npm test`) import compiled modules from `public/`, so always build first.

## Driving the app headlessly

Use Playwright with the preinstalled Chromium. The script must live inside the
repo (or set NODE_PATH) so `@playwright/test` resolves from node_modules:

```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

## Gotcha: supabase importmap

`public/index.html` loads `@supabase/supabase-js` from `https://esm.sh/...` via
an importmap. In a sandbox without outbound network the whole app stays on
"Loading..." — stub the module with a Playwright route before `page.goto`:

```js
await page.route('https://esm.sh/@supabase/supabase-js@2', (route) => route.fulfill({
  contentType: 'application/javascript',
  body: `export function createClient() { return {
    auth: { getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: () => {}, signInWithOAuth: async () => {}, signOut: async () => {} },
    rpc: async () => ({ error: null }),
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  }; }`,
}));
```

The app then runs fully in anonymous (localStorage) mode.

## Useful hooks for assertions

- Every exercise card shows the current item id in `.item-id` — map it to
  `public/data/*.json` to compute the expected answer in the script.
- Home page cards are `a.card-link[href="de/..."]`; level sections are
  `<details id="level-a1">`, sublevels `#sub-a1-words` — click summaries to expand.
- Answer/progress badges hydrate asynchronously — wait ~500ms after navigation.
- A fresh browser context = clean localStorage = fresh SRS state (20 new cards due).
