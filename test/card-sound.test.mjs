import test from 'node:test';
import assert from 'node:assert/strict';
import { resultNotes } from '../public/v2/card-sound.js';

test('a right answer rises in pitch on pleasant sine tones', () => {
  const notes = resultNotes('correct');
  assert.ok(notes.every(note => note.type === 'sine'));
  assert.deepEqual(notes.map(note => note.freq), [...notes.map(note => note.freq)].sort((a, b) => a - b));
});

test('a wrong answer falls in pitch on a harsh low tone', () => {
  const notes = resultNotes('incorrect');
  assert.ok(notes.every(note => note.type === 'sawtooth' && note.freq < 250));
  assert.deepEqual(notes.map(note => note.freq), [...notes.map(note => note.freq)].sort((a, b) => b - a));
});
