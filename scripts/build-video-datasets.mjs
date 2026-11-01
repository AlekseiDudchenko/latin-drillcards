import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// M6 (#338): every v1 video (public/data/video-<id>.json) as one immutable ItemDataset of
// `video-segment` items. A segment is sentence content (the M1/M2 adapters read it) plus its
// clip: the video, its start (the previous pause point), its end (its own pause point) and
// whether it is a portrait short.
// Deterministic: the same sources give the same files; `--check` fails when one is stale.
export const VIDEO_SOURCE = /^video-([A-Za-z0-9_-]{11})\.json$/;
export const videoDatasetPath = videoId => `public/data/items/video-${videoId}.json`;
const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';

export function videoSources(root = '.') {
  return readdirSync(`${root}/public/data`).filter(name => VIDEO_SOURCE.test(name)).sort()
    .map(name => JSON.parse(readFileSync(`${root}/public/data/${name}`, 'utf8')));
}

/** One v1 video as a dataset. Segment IDs are their v1 positions (`seg-<index>`). */
export function buildVideoDataset(source) {
  const videoId = clean(source.videoId);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !Array.isArray(source.segments) || !source.segments.length) throw new RangeError(`Invalid video ${videoId}`);
  const level = clean(source.level).toUpperCase();
  const shorts = source.shorts === true;
  let start = 0;
  const items = source.segments.map((segment, index) => {
    const end = segment.pauseAt;
    if (typeof end !== 'number' || !(end > start)) throw new RangeError(`${videoId}#${index}: pause points must increase`);
    const translations = Object.fromEntries(['ru', 'en', 'es'].map(lang => [lang, clean(segment[`translation_${lang}`])]).filter(([, value]) => value));
    const content = { deck: 'video', level, tags: [], target: clean(segment.sentence), tokens: segment.tokens.map(clean).filter(Boolean), alternatives: [],
      translations, video: { videoId, index, start, end, shorts } };
    start = end;
    return { id: `seg-${index}`, contentVersion: 1, wordIds: [], content };
  });
  const head = { schemaVersion: 1, id: `video-${videoId}`, kind: 'video-segment', title: clean(source.title) };
  const version = `video-${videoId}-${createHash('sha256').update(JSON.stringify([head, items])).digest('hex').slice(0, 16)}`;
  return { schemaVersion: 1, id: head.id, version, kind: head.kind, title: head.title, items };
}
export const buildVideoDatasets = (root = '.') => videoSources(root).map(buildVideoDataset);
/** One item per line: readable diffs, no indentation weight. */
export const serialize = ({ items, ...head }) => JSON.stringify(head).slice(0, -1) + ',"items":[\n' +
  items.map(item => JSON.stringify(item)).join(',\n') + '\n]}\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const dataset of buildVideoDatasets()) {
    const path = videoDatasetPath(dataset.id.slice('video-'.length)); const next = serialize(dataset);
    if (process.argv.includes('--check')) {
      if (readFileSync(path, 'utf8') !== next) throw new Error(`${path} is stale; run npm run items:videos`);
    } else { writeFileSync(path, next); console.log(`Wrote ${path} (${dataset.items.length} segments)`); }
  }
}
