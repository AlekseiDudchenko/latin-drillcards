import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { APP_VERSION } from '../public/v2/app-version.js';
import { CONTACT, LEGAL, LEGAL_PAGES } from '../public/v2/legal-content.js';
import { FOOTER_LABELS } from '../public/v2/site-footer.js';

const LANGS = ['ru', 'en', 'de'];

test('the footer shows the version of this build', () => {
  assert.equal(APP_VERSION, readFileSync('VERSION', 'utf8').trim());
});

test('every footer label is filled in all languages', () => {
  const keys = Object.keys(FOOTER_LABELS.ru);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(FOOTER_LABELS[lang]), keys, lang);
    for (const key of keys) assert.ok(FOOTER_LABELS[lang][key].trim(), `${lang} ${key}`);
  }
  assert.match(CONTACT.email, /^[^@\s]+@[^@\s]+$/);
  for (const url of [CONTACT.authorUrl]) assert.match(url, /^https:\/\//);
});

test('legal pages exist and load the legal page module', () => {
  const files = new Set(readdirSync('public/v2'));
  for (const [id, page] of Object.entries(LEGAL_PAGES)) {
    assert.ok(files.has(page), page);
    const html = readFileSync(`public/v2/${page}`, 'utf8');
    assert.match(html, new RegExp(`data-legal="${id}"`));
    assert.match(html, /legal-page\.js/);
  }
});

test('legal texts are complete and parallel in every language; their links resolve', () => {
  const files = new Set(readdirSync('public/v2'));
  for (const [id, texts] of Object.entries(LEGAL)) {
    const count = texts.ru.sections.length;
    for (const lang of LANGS) {
      const text = texts[lang];
      for (const field of ['title', 'updated', 'intro']) assert.ok(text[field].trim(), `${id} ${lang} ${field}`);
      assert.equal(text.sections.length, count, `${id} ${lang} has as many sections as ru`);
      for (const section of text.sections) {
        assert.ok(section.title.trim() && section.body.length, `${id} ${lang} ${section.title}`);
        for (const part of section.body) {
          if (typeof part === 'string') { assert.ok(part.length, `${id} ${lang} ${section.title}`); continue; }
          assert.ok(part.text.trim(), part.href);
          assert.match(part.href, /^(?:https:\/\/|mailto:|\.\/[a-z-]+\.html$)/);
          if (part.href.startsWith('./')) assert.ok(files.has(part.href.slice(2)), part.href);
        }
      }
    }
  }
});

test('the site entry links its legal pages without JS; the mounted footer replaces that static footer', () => {
  const html = readFileSync('public/v2/today.html', 'utf8');
  const fallback = html.match(/<footer [^>]*data-static-footer[^>]*>(.*?)<\/footer>/s);
  assert.ok(fallback, 'today.html has a static footer');
  for (const page of Object.values(LEGAL_PAGES)) assert.ok(fallback[1].includes(`href="./${page}"`), page);
});

test('the legal pages do not open the learning store', () => {
  const module = readFileSync('public/v2/legal-page.js', 'utf8');
  assert.doesNotMatch(module, /openLearningPage|learning-context/);
});
