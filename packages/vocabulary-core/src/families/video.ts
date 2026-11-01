import type { JsonValue } from '../exercise.js';
import { sentenceContent, type SentenceContent } from './sentences.js';

/** M6 (#338): video segments (FC09 dictation, FC10 assembly). A segment is sentence content
 * plus its clip, so the M1 sentence and M2 listening adapters serve it unchanged: dictation is
 * `listening-tokens` / `listening-text` with the clip as the prompt, assembly is `sentence-assembly`.
 * The clip is data only: playing it is a page concern (YouTube), never an event. */
export interface VideoClip {
  readonly videoId: string;
  /** Position of the segment in its video (v1 order). */
  readonly index: number;
  /** Seconds: from the previous pause point to this segment's pause point. */
  readonly start: number;
  readonly end: number;
  /** Portrait YouTube short. */
  readonly shorts: boolean;
}
export interface VideoSegmentContent extends SentenceContent { readonly video: VideoClip }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Structural check of a video segment's content, or null. */
export function videoSegmentContent(content: JsonValue): VideoSegmentContent | null {
  const sentence = sentenceContent(content);
  const video = record(content) ? content.video : undefined;
  if (!sentence || !record(video) || typeof video.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(video.videoId) ||
      !Number.isSafeInteger(video.index) || (video.index as number) < 0 || !time(video.start) || !time(video.end) ||
      !(video.end > video.start) || typeof video.shorts !== 'boolean') return null;
  return sentence as VideoSegmentContent;
}
