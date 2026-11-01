import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { HUBS, SECTIONS, pageName, sectionFor } from '../public/v2/site-nav-model.js';

test('every page of a section resolves to it, in any URL spelling', () => {
  for (const [path, id] of [['/v2/session', 'words'], ['/v2/session.html', 'words'], ['./kasus.html', 'practice'], ['/v2/practice', 'practice'],
    ['/v2/today.html', 'today'], ['/v2/video.html', 'video'], ['/v2/level-test.html', 'progress'], ['/v2/progress', 'progress']]) assert.equal(sectionFor(path), id, path);
  assert.equal(sectionFor('/v2/environment.html'), undefined);
  assert.equal(pageName('/v2/'), 'v2');
});

test('section landing pages exist and every label is filled in all languages', () => {
  const files = new Set(readdirSync('public/v2'));
  for (const section of SECTIONS) {
    assert.ok(files.has(section.page), section.page);
    assert.ok(section.pages.includes(section.page.replace(/\.html$/, '')), `${section.id} highlights its own landing page`);
    for (const lang of ['ru', 'en', 'de']) assert.ok(section.label[lang], `${section.id} ${lang}`);
  }
});

test('hub links point at existing pages, are unique, and carry text in every language', () => {
  const files = new Set(readdirSync('public/v2')); const seen = new Set();
  for (const hub of Object.values(HUBS)) for (const group of hub.groups) {
    for (const lang of ['ru', 'en', 'de']) assert.ok(group.title[lang], `${group.id} ${lang}`);
    for (const item of group.items) {
      assert.match(item.href, /^\.\/[a-z0-9-]+\.html$/);
      assert.ok(files.has(item.href.slice(2)), item.href);
      for (const lang of ['ru', 'en', 'de']) assert.ok(item.title[lang] && item.hint[lang], `${item.href} ${lang}`);
    }
  }
  for (const item of HUBS.practice.groups.flatMap(group => group.items)) { assert.ok(!seen.has(item.href), item.href); seen.add(item.href); }
});

test('every exercise page is reachable from the Practice hub, Progress or the Video section', () => {
  const linked = new Set(Object.values(HUBS).flatMap(hub => hub.groups.flatMap(group => group.items.map(item => item.href.slice(2)))));
  for (const section of SECTIONS) linked.add(section.page);
  for (const page of ['sentences', 'listening', 'gaps', 'kasus', 'konjunktiv2', 'redemittel', 'level-test', 'video', 'today', 'session']) assert.ok(linked.has(`${page}.html`), page);
});

test('hub pages declare their hub and load the hub module', () => {
  for (const id of ['practice', 'progress']) {
    const html = readFileSync(`public/v2/${id}.html`, 'utf8');
    assert.match(html, new RegExp(`data-hub="${id}"`));
    assert.match(html, /hub-page\.js/);
  }
});
