import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INSTALL_GUIDE, INSTALL_PLATFORMS, installPlatform, platformOrder } from '../public/v2/install-guide.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
};

test('the install guide recognises the visitor’s device', () => {
  assert.equal(installPlatform(UA.iphone, 5), 'ios');
  assert.equal(installPlatform(UA.ipad, 5), 'ios', 'iPadOS reports as a Mac with touch');
  assert.equal(installPlatform(UA.android, 5), 'android');
  assert.equal(installPlatform(UA.macSafari, 0), 'mac-safari');
  for (const ua of [UA.macChrome, UA.macFirefox, UA.windowsEdge]) assert.equal(installPlatform(ua, 0), 'desktop', ua);
});

test('the visitor’s device comes first, every platform exactly once', () => {
  for (const platform of INSTALL_PLATFORMS) {
    const order = platformOrder(platform);
    assert.equal(order[0], platform);
    assert.deepEqual([...order].sort(), [...INSTALL_PLATFORMS].sort());
  }
});

test('the install guide is complete and parallel in every language', () => {
  for (const lang of ['ru', 'en', 'de']) {
    const guide = INSTALL_GUIDE[lang];
    for (const field of ['title', 'lead', 'install', 'installed', 'yourDevice']) assert.ok(guide[field].trim(), `${lang} ${field}`);
    assert.deepEqual(Object.keys(guide.platforms).sort(), [...INSTALL_PLATFORMS].sort(), lang);
    for (const platform of INSTALL_PLATFORMS) {
      const text = guide.platforms[platform];
      assert.ok(text.title.trim(), `${lang} ${platform}`);
      assert.equal(text.steps.length, INSTALL_GUIDE.ru.platforms[platform].steps.length, `${lang} ${platform} steps`);
      for (const step of text.steps) assert.ok(step.trim(), `${lang} ${platform}`);
      assert.equal(Boolean(text.note), Boolean(INSTALL_GUIDE.ru.platforms[platform].note), `${lang} ${platform} note`);
    }
  }
});

test('the install page exists and loads its module', () => {
  const html = readFileSync('public/v2/install.html', 'utf8');
  assert.match(html, /install-page\.js/);
  for (const id of ['title', 'lead', 'installed', 'install', 'platforms', 'language']) assert.match(html, new RegExp(`id="${id}"`), id);
});
