// M6 (#338): YouTube as a media adapter. It plays one clip (start → end) at a time, pauses at
// its end, and owns every timer and the iframe, so dispose() releases all of it. The IFrame API
// needs the network: there is no offline playback, and a load failure is reported, never hidden.
interface YTPlayer {
  playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number; destroy(): void;
}
interface YTNamespace {
  Player: new (element: HTMLElement, options: {
    videoId: string; playerVars?: Record<string, string | number>;
    events?: { onReady?: () => void; onStateChange?: (event: { data: number }) => void; onError?: (event: { data: number }) => void };
  }) => YTPlayer;
}
/** The API's globals, typed locally (v1 declares its own global `YT`). */
const host = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

export type MediaError = 'offline' | 'unavailable' | 'failed';
export interface ClipMediaEvents {
  onReady(): void;
  /** The clip reached its end (or the video ended) and is paused. */
  onClipEnd(): void;
  onPlaying(playing: boolean): void;
  onError(error: MediaError): void;
}
export interface ClipMedia {
  play(clip: { readonly start: number; readonly end: number }): void;
  pause(): void;
  dispose(): void;
}

const API = 'https://www.youtube.com/iframe_api';
const LOAD_TIMEOUT = 10_000;
const PLAYING = 1; const ENDED = 0;
let api: Promise<YTNamespace> | undefined;

function loadApi(): Promise<YTNamespace> {
  if (host.YT?.Player) return Promise.resolve(host.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => fail(), LOAD_TIMEOUT);
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); api = undefined; reject(new Error('YouTube API unavailable')); };
    const previous = host.onYouTubeIframeAPIReady;
    host.onYouTubeIframeAPIReady = () => { previous?.(); clearTimeout(timer); if (host.YT?.Player) resolve(host.YT); else fail(); };
    script.src = API; script.async = true; script.onerror = fail;
    document.head.append(script);
  });
  return api;
}

export function createYouTubeMedia(container: HTMLElement, videoId: string, events: ClipMediaEvents): ClipMedia {
  let player: YTPlayer | undefined;
  let ready = false;
  let disposed = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let clip: { start: number; end: number } | undefined;
  let pending: { start: number; end: number } | undefined;
  const stopPoll = () => { if (poll !== undefined) clearInterval(poll); poll = undefined; };
  const reachEnd = () => {
    stopPoll();
    if (!clip) return;
    clip = undefined; player?.pauseVideo(); events.onClipEnd();
  };
  const startPoll = () => {
    if (poll !== undefined) return;
    poll = setInterval(() => {
      if (!player || !clip) { stopPoll(); return; }
      if (player.getCurrentTime() >= clip.end) reachEnd();
    }, 100);
  };
  const error = (value: MediaError) => { if (!disposed) { stopPoll(); events.onError(value); } };

  if (navigator.onLine === false) queueMicrotask(() => error('offline'));
  else loadApi().then(YT => {
    if (disposed) return;
    const node = document.createElement('div'); container.replaceChildren(node);
    player = new YT.Player(node, {
      videoId, playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 0, cc_lang_pref: 'de' },
      events: {
        onReady: () => {
          if (disposed) return;
          ready = true; events.onReady();
          if (pending) { const next = pending; pending = undefined; play(next); }
        },
        onStateChange: ({ data }) => {
          if (disposed) return;
          events.onPlaying(data === PLAYING);
          if (data === PLAYING) startPoll(); else stopPoll();
          if (data === ENDED) reachEnd();
        },
        // 2 invalid id, 5 HTML5 error, 100 removed, 101/150 embedding not allowed.
        onError: ({ data }) => error(data === 5 ? 'failed' : 'unavailable'),
      },
    });
  }).catch(() => error(navigator.onLine === false ? 'offline' : 'failed'));

  function play(next: { readonly start: number; readonly end: number }): void {
    if (disposed) return;
    if (!ready || !player) { pending = { start: next.start, end: next.end }; return; }
    clip = { start: next.start, end: next.end };
    player.seekTo(next.start, true); player.playVideo();
  }
  return {
    play,
    pause() { pending = undefined; clip = undefined; stopPoll(); player?.pauseVideo(); },
    dispose() {
      if (disposed) return;
      disposed = true; stopPoll(); pending = undefined; clip = undefined;
      try { player?.destroy(); } catch { /* the iframe may already be gone */ }
      player = undefined; container.replaceChildren();
    },
  };
}
