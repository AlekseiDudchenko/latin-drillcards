import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

function policy(path) {
  const matches = [];
  for (const block of readFileSync('public/_headers', 'utf8').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(line => line && !line.startsWith('#'));
    if (!lines.length) continue;
    const pattern = new RegExp('^' + lines[0].split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    if (pattern.test(path)) matches.push(...lines.slice(1).map(line => line.trim()));
  }
  return matches;
}

test('every v2 document route and mutable app asset revalidates on Cloudflare Pages', () => {
  const routes = ['/', '/index.html', '/404.html', '/v2', '/v2/', '/style.css', '/i18n.js', '/sw.js',
    '/version.json', '/manifest.json', '/v2/environment.json', '/v2/core/index.js', '/v2/card-ui.css'];
  for (const file of readdirSync('public/v2').filter(file => file.endsWith('.html')))
    routes.push(`/v2/${file}`, `/v2/${file.slice(0, -5)}`);
  for (const route of routes) assert.deepEqual(policy(route), ['Cache-Control: no-cache'], route);
});

test('media and catalog data retain their existing HTTP cache policy', () => {
  for (const path of ['/audio/words/b2/word.mp3', '/icons/icon-192.png', '/favicon.svg',
    '/data/words-a1.json', '/v2/catalog/deck-a1.json']) assert.deepEqual(policy(path), [], path);
});
