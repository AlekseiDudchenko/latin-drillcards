import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// #424: exercise pages must not carry their own audio preference or switch markup.
const families = 'src/client/v2/families';
const pages = readdirSync(families).flatMap(dir => readdirSync(`${families}/${dir}`).filter(f => f.endsWith('-page.ts')).map(f => `${families}/${dir}/${f}`));
test('no exercise page keeps its own auto-speech preference', () => {
  assert.ok(pages.length >= 1);
  for (const page of pages) {
    const source = readFileSync(page, 'utf8');
    assert.doesNotMatch(source, /dc_v2_auto_speak|dc_v2_listening_autoplay|'auto_speak'|AUTOPLAY_KEY|autoSpeakOn/, page);
  }
});
test('no exercise HTML page has its own auto-speech checkbox', () => {
  for (const file of readdirSync('public/v2').filter(f => f.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(`public/v2/${file}`, 'utf8'), /id="(autoSpeak|autoPlay)"/, file);
  }
});
