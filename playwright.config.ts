import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: {
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    baseURL: 'http://localhost:5173',
    // The service worker proxies fetches, which would bypass page.route
    // stubs used by the specs. Block it everywhere; pwa.spec.ts re-enables
    // it locally to test registration.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
