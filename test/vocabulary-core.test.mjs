import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { applicableComponents, isLearningEvent } from '../packages/vocabulary-core/dist/index.js';
import * as browser from '../public/v2/core/index.js';
import { words, answer } from '../packages/vocabulary-core/build-test/test/fixtures.js';

test('published fixtures distinguish homonyms and tolerate missing translations', () => {
  const [noun, verb, volume, ribbon] = words;
  assert.deepEqual(applicableComponents(noun), ['recognition', 'recall', 'spelling', 'article']);
  assert.deepEqual(applicableComponents(verb), ['recognition', 'recall', 'spelling']);
  assert.equal(verb.meanings.en, undefined);
  assert.equal(volume.lemma, ribbon.lemma);
  assert.notEqual(volume.id, ribbon.id);
  assert.notEqual(volume.senseId, ribbon.senseId);
  assert.notEqual(volume.article, ribbon.article);
});

test('browser and server use byte-identical ESM and accept the same serialized event', async () => {
  // Recursive: family adapters live in dist/families/.
  const entries = await readdir(new URL('../packages/vocabulary-core/dist/', import.meta.url), { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => `${entry.parentPath ?? entry.path}/${entry.name}`
    .split('/packages/vocabulary-core/dist/')[1] ?? entry.name);
  assert.ok(files.includes('families/sentences.js'));
  for (const file of files) {
    const server = await readFile(new URL(`../packages/vocabulary-core/dist/${file}`, import.meta.url));
    const client = await readFile(new URL(`../public/v2/core/${file}`, import.meta.url));
    assert.deepEqual(client, server, file);
  }
  assert.equal(isLearningEvent(JSON.parse(JSON.stringify(answer))), true);
  assert.equal(browser.isLearningEvent(answer), true);
});

test('all exercise target families share one event envelope', () => {
  for (const kind of ['sentence', 'grammar-item', 'phrase', 'video-segment', 'assessment']) {
    assert.equal(isLearningEvent({ ...answer, target: { kind, datasetId: 'dataset-1', itemId: 'item-1' } }), true);
  }
});

test('offline events retain practice/review intent and translation language for server replay', () => {
  const practice = JSON.parse(JSON.stringify({ ...answer, intent: 'practice', answerLanguage: 'en' }));
  const review = JSON.parse(JSON.stringify(answer));
  assert.equal(isLearningEvent(practice), true);
  assert.equal(isLearningEvent(review), true);
  assert.equal(practice.intent, 'practice');
  assert.equal(review.intent, 'review-due');
  assert.equal(practice.answerLanguage, 'en');
  assert.equal(review.answerLanguage, 'ru');
  const { intent, ...withoutIntent } = review;
  const { answerLanguage, ...withoutLanguage } = review;
  assert.equal(isLearningEvent(withoutIntent), false);
  assert.equal(isLearningEvent(withoutLanguage), false);
});

test('introduction and reveal do not masquerade as answers', () => {
  const { rawAnswer, attemptId, assisted, ...context } = answer;
  for (const kind of ['introduction', 'reveal']) {
    assert.equal(isLearningEvent({ ...context, kind, exposure: ['recognition'] }), true);
    assert.equal(isLearningEvent({ ...answer, kind }), false);
  }
});

test('reject malformed or unsupported events before replay', () => {
  const invalid = [null, [], {}, { ...answer, schemaVersion: 2 },
    { ...answer, eventId: '' }, { ...answer, commandId: ' ' },
    { ...answer, contentVersion: 0 }, { ...answer, contentVersion: 1.5 },
    { ...answer, target: { kind: 'word', wordId: '' } },
    { ...answer, target: { kind: 'word', wordId: 'w', datasetId: 'extra' } },
    { ...answer, target: { kind: 'assessment', itemId: 'x' } },
    { ...answer, target: { kind: 'unknown', datasetId: 'd', itemId: 'i' } },
    { ...answer, target: { kind: ['sentence'], datasetId: 'd', itemId: 'i' } },
    { ...answer, intent: ['practice'] }, { ...answer, intent: 'unknown' },
    { ...answer, answerLanguage: ['ru'] }, { ...answer, answerLanguage: 'unknown' },
    { ...answer, studyTimezone: 'invalid' }, { ...answer, occurredAt: '2026-02-30T12:00:00.000Z' },
    { ...answer, occurredAt: 'yesterday' }, { ...answer, assisted: 'false' },
    { ...answer, exposure: ['recognition', 'recognition'] }, { ...answer, exposure: ['unknown'] },
    { ...answer, ownerId: 'spoofed-user' }, { ...answer, evaluation: { outcome: 'correct' } },
    { ...answer, rawAnswer: undefined }, { ...answer, rawAnswer: NaN },
    { ...answer, rawAnswer: new Date() }, { ...answer, rawAnswer: () => 'Tisch' }];
  const cyclic = {}; cyclic.self = cyclic;
  invalid.push({ ...answer, rawAnswer: cyclic });
  for (const event of invalid) assert.equal(isLearningEvent(event), false);
});
