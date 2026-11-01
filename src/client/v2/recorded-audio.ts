import { assetUrl } from '../config.js';

export function normalizeSpeechText(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}
const manifests = ['data/audio/words-b2.json', 'data/audio/sentences-a1.json'];
let recordings: Promise<Map<string, string>> | undefined;

async function loadManifest(path: string): Promise<[string, string][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(assetUrl(path), { signal: controller.signal });
    if (!response.ok) return [];
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) return [];
    const entries: [string, string][] = [];
    for (const entry of data.entries) {
      if (typeof entry.text !== 'string' || typeof entry.url !== 'string') continue;
      try {
        const url = new URL(assetUrl(entry.url));
        if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin)) {
          entries.push([normalizeSpeechText(entry.text), url.href]);
        }
      } catch { /* A malformed entry must not disable the rest of the batch. */ }
    }
    return entries;
  } catch { return []; }
  finally { clearTimeout(timer); }
}

// Each batch fails independently. Only public asset URLs and voice metadata reach the browser.
export async function recordedSpeechUrl(text: string): Promise<string | undefined> {
  recordings ??= Promise.all(manifests.map(loadManifest)).then(batches => new Map(batches.flat()));
  return (await recordings).get(normalizeSpeechText(text));
}
