import { recordedSpeechUrl } from './recorded-audio.js';
import { pickVoice, SPEECH_LANG } from '../voice-selection.js';

export type SpeechResult = 'completed' | 'cancelled' | 'unavailable' | 'no-voice' | 'failed';
export interface CardSpeech {
  speak(text: string): Promise<SpeechResult>;
  cancel(): void;
  dispose(): void;
}
let activePlayback: { token: symbol; stop: () => void } | null = null;
let activeRequest: { token: symbol; stop: () => void } | null = null;

/** Scoped adapter: waiting voices and callbacks are cancelled along with owned playback. */
function createBrowserCardSpeech(): CardSpeech {
  let disposed = false;
  let stop: (() => void) | undefined;
  const cancel = () => { stop?.(); stop = undefined; };
  return {
    cancel,
    dispose() { disposed = true; cancel(); },
    speak(text) {
      cancel();
      if (disposed) return Promise.resolve('cancelled');
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve('unavailable');
      const synth = window.speechSynthesis;
      return new Promise(resolve => {
        const token = Symbol();
        let finished = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let poll: ReturnType<typeof setInterval> | undefined;
        let utterance: SpeechSynthesisUtterance | undefined;
        const finish = (result: SpeechResult, cancelPlayback = false) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer); clearInterval(poll);
          synth.removeEventListener('voiceschanged', voicesReady);
          if (utterance) { utterance.onend = null; utterance.onerror = null; }
          if (activeRequest?.token === token) activeRequest = null;
          if (activePlayback?.token === token) {
            activePlayback = null;
            if (cancelPlayback) { try { synth.cancel(); } catch { /* Release callbacks even if the platform cannot cancel. */ } }
          }
          stop = undefined;
          resolve(result);
        };
        const voicesReady = () => {
          if (finished) return;
          const voices = synth.getVoices();
          if (!voices.length) return;
          start(voices);
        };
        const start = (voices: SpeechSynthesisVoice[]) => {
          clearTimeout(timer);
          synth.removeEventListener('voiceschanged', voicesReady);
          const voice = pickVoice(voices);
          if (!voice) { finish('no-voice'); return; }
          try {
            utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = SPEECH_LANG; utterance.voice = voice; utterance.rate = 0.9;
            utterance.onend = () => finish('completed');
            utterance.onerror = () => finish('failed');
            // Replace existing speech, but this adapter only cancels playback it still owns.
            activePlayback?.stop();
            synth.cancel(); activePlayback = { token, stop: () => finish('cancelled', true) };
            // Some voices never send `end`: a reading that is over must not leave the card looking like it still plays.
            timer = setTimeout(() => finish('failed', true), Math.min(30000, 5000 + text.length * 200));
            synth.speak(utterance);
            if (typeof synth.speaking === 'boolean') {
              const began = Date.now(); let idle = 0;
              poll = setInterval(() => {
                if (synth.speaking || synth.pending) { idle = 0; return; }
                if (Date.now() - began > 500 && ++idle >= 2) finish('completed');
              }, 250);
            }
          } catch { finish('failed', true); }
        };
        stop = () => finish('cancelled', true);
        // Supersede waiting requests as well as active playback. An old voiceschanged
        // callback must never interrupt a more recent request from another card.
        activeRequest?.stop();
        activeRequest = { token, stop };
        try {
          const voices = synth.getVoices();
          if (voices.length) start(voices);
          else {
            synth.addEventListener('voiceschanged', voicesReady);
            timer = setTimeout(() => finish('no-voice'), 1500);
          }
        } catch { finish('failed'); }
      });
    },
  };
}

// One owner across recorded audio, manifest loading and device speech.
let currentSpeaker: (() => void) | undefined;
export function createCardSpeech(): CardSpeech {
  const browser = createBrowserCardSpeech();
  let disposed = false;
  let stop: (() => void) | undefined;
  const cancel = () => { stop?.(); };
  return {
    cancel,
    dispose() { disposed = true; cancel(); browser.dispose(); },
    speak(text) {
      cancel();
      if (disposed) return Promise.resolve('cancelled');
      currentSpeaker?.();
      return new Promise<SpeechResult>(resolve => {
        let done = false;
        let usingBrowser = false;
        let audio: HTMLAudioElement | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (result: SpeechResult) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
          browser.cancel();
          if (currentSpeaker === cancelRequest) currentSpeaker = undefined;
          if (stop === cancelRequest) stop = undefined;
          resolve(result);
        };
        const cancelRequest = () => finish('cancelled');
        stop = currentSpeaker = cancelRequest;
        const fallback = () => {
          if (done || usingBrowser) return;
          usingBrowser = true;
          clearTimeout(timer);
          if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = undefined; }
          void browser.speak(text).then(finish, () => finish('failed'));
        };
        void recordedSpeechUrl(text).then(url => {
          if (done) return;
          if (!url || typeof Audio === 'undefined') { fallback(); return; }
          try {
            audio = new Audio(url);
            audio.onended = () => finish('completed');
            audio.onerror = fallback;
            // Bound offline/network waits; a stalled file must not leave the button active forever.
            timer = setTimeout(fallback, 15000);
            void audio.play().catch(fallback);
          } catch { fallback(); }
        }, fallback);
      });
    },
  };
}
