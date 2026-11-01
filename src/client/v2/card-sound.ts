export type ResultSoundKind = 'correct' | 'incorrect';

interface Note { readonly freq: number; readonly start: number; readonly length: number; readonly type: OscillatorType; readonly gain: number }

/** A bright rising major arpeggio for a right answer, a low falling buzz for a wrong one. */
export function resultNotes(kind: ResultSoundKind): readonly Note[] {
  return kind === 'correct'
    ? [{ freq: 659.25, start: 0, length: 0.16, type: 'sine', gain: 0.22 },
       { freq: 830.61, start: 0.09, length: 0.16, type: 'sine', gain: 0.2 },
       { freq: 987.77, start: 0.18, length: 0.32, type: 'sine', gain: 0.2 }]
    : [{ freq: 196, start: 0, length: 0.2, type: 'sawtooth', gain: 0.14 },
       { freq: 138.59, start: 0.16, length: 0.34, type: 'sawtooth', gain: 0.14 }];
}

let context: AudioContext | undefined;

/** Plays the result cue. Silent (never throws) where Web Audio is missing or blocked. */
export function playResultSound(kind: ResultSoundKind): void {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    const audio = context;
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    const output = audio.createGain();
    output.gain.value = 1;
    if (kind === 'incorrect') {
      // Dull the sawtooth so the cue reads as unpleasant without being harsh.
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 900;
      filter.connect(output);
      output.connect(audio.destination);
      schedule(audio, filter, kind);
    } else {
      output.connect(audio.destination);
      schedule(audio, output, kind);
    }
  } catch { /* A sound is a nicety; failing to play must never affect the answer. */ }
}

function schedule(audio: AudioContext, destination: AudioNode, kind: ResultSoundKind): void {
  const now = audio.currentTime;
  for (const note of resultNotes(kind)) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const begin = now + note.start;
    const end = begin + note.length;
    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.freq, begin);
    if (kind === 'incorrect') oscillator.frequency.linearRampToValueAtTime(note.freq * 0.94, end);
    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.exponentialRampToValueAtTime(note.gain, begin + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope); envelope.connect(destination);
    oscillator.start(begin); oscillator.stop(end + 0.02);
  }
}
