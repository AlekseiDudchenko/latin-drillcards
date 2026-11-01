import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

test.use({ serviceWorkers: 'allow' });

test('ordinary reload sees a release through a warm HTTP cache; the new release also opens offline', async ({ page, context }) => {
  let version = 'old';
  let deployed = false;
  const worker = readFileSync('public/sw.js', 'utf8');
  // The previous worker's network-first fetch still trusted fresh HTTP entries.
  const previousWorker = `
    self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));
  `;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    if (path === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
      return res.end(deployed ? worker : previousWorker);
    }
    // Deliberately retain the old deployment's bad headers, including in the browser's HTTP cache.
    const etag = `"${version}-${path}"`;
    res.setHeader('Cache-Control', 'public, max-age=14400, must-revalidate');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    if (path === '/v2/app.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end(`document.querySelector('h1').textContent = '${version}';`);
    }
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
      return res.end(`:root { --release: ${version}; }`);
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html data-release="${version}"><link rel="stylesheet" href="/style.css"><h1>loading</h1><script src="/v2/app.js"></script></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.goto(`${origin}/v2/today`);
    await expect(page.locator('h1')).toHaveText('old');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    await page.reload();
    await expect(page.locator('h1')).toHaveText('old');
    version = 'new';
    deployed = true;
    await page.evaluate(async () => {
      const previous = navigator.serviceWorker.controller;
      await (await navigator.serviceWorker.getRegistration())!.update();
      if (navigator.serviceWorker.controller === previous)
        await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'new');
    await expect(page.locator('h1')).toHaveText('new');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--release').trim())).toBe('new');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'new');
    await expect(page.locator('h1')).toHaveText('new');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--release').trim())).toBe('new');
  } finally {
    await context.setOffline(false);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
