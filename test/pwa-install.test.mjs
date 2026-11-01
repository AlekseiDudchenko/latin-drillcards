import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

test('every v2 page links the manifest, theme colour and touch icon so the browser offers installation', () => {
  const pages = readdirSync('public/v2').filter(file => file.endsWith('.html'));
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const html = readFileSync(`public/v2/${page}`, 'utf8');
    assert.match(html, /<link rel="manifest" href="\.\.\/manifest\.json">/, page);
    assert.match(html, /<meta name="theme-color" content="#2563eb">/, page);
    assert.match(html, /<link rel="apple-touch-icon" href="\.\.\/apple-touch-icon\.png">/, page);
  }
});

test('the manifest starts on the v2 home and its icons exist', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  assert.equal(manifest.start_url, '/v2/today.html');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.ok(readFileSync(`public${icon.src}`).length > 0, icon.src);
});
