import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'plan';
if (!['plan', 'generate', 'upload'].includes(mode)) throw new Error('Use plan, generate or upload');
const provider = process.env.TTS_PROVIDER ?? 'google-cloud';
if (!['google-cloud', 'google-translate'].includes(provider)) throw new Error('Unknown TTS_PROVIDER');
const voice = provider === 'google-translate' ? 'de-DE-Translate' : process.env.TTS_VOICE ?? 'de-DE-Chirp3-HD-Kore';
if (!/^de-DE-[A-Za-z0-9-]+$/.test(voice)) throw new Error('TTS_VOICE must be a German de-DE voice');
const normalize = text => text.normalize('NFC').trim().replace(/\s+/g, ' ');
const words = JSON.parse(await readFile(resolve(root, 'public/data/words-b2.json'), 'utf8'));
const texts = [...new Set(words.map(w => {
  const article = (w.article ?? '').trim(); const de = w.de.trim();
  return normalize(!article || de.startsWith(article + ' ') ? de : article + ' ' + de);
}))];
const items = texts.map(text => ({ text, key: `words/b2/${createHash('sha256').update(JSON.stringify({ text, provider, voice, encoding: 'MP3', sampleRateHertz: 24000 })).digest('hex')}.mp3` }));
const directory = resolve(root, 'build/word-audio-b2');
const localPath = item => resolve(directory, item.key.split('/').at(-1));
const mp3 = bytes => bytes.length > 500 && (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224));
const cached = async item => { try { const bytes = await readFile(localPath(item)); return mp3(bytes) ? bytes : null; } catch { return null; } };
console.log(`${items.length} unique B2 words, ${texts.reduce((n, t) => n + t.length, 0)} characters, voice ${voice}`);
if (mode === 'plan') process.exit(0);
await mkdir(directory, { recursive: true });
if (mode === 'generate') {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (provider === 'google-cloud' && !token && !apiKey) throw new Error('Set GOOGLE_ACCESS_TOKEN or GOOGLE_TTS_API_KEY locally. Do not commit credentials.');
  for (const [index, item] of items.entries()) {
    if (await cached(item)) continue;
    let bytes;
    if (provider === 'google-translate') {
      // Sequential requests with jitter. Respect service limits rather than bypassing them.
      await new Promise(resolve => setTimeout(resolve, 1200 + Math.random() * 1600));
      const query = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: 'de', q: item.text });
      const response = await fetch(`https://translate.google.com/translate_tts?${query}`, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`Translate TTS returned ${response.status}; completed files retained. Stop and retry later if rate limited.`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { 'x-goog-api-key': apiKey }), ...(process.env.GOOGLE_CLOUD_PROJECT ? { 'x-goog-user-project': process.env.GOOGLE_CLOUD_PROJECT } : {}) },
        body: JSON.stringify({ input: { text: item.text }, voice: { languageCode: 'de-DE', name: voice }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 } }),
      });
      if (!response.ok) throw new Error(`Google TTS returned ${response.status} at word ${index + 1}; completed files are retained. Check API access, billing and quota.`);
      const data = await response.json();
      bytes = Buffer.from(data.audioContent ?? '', 'base64');
    }
    if (!mp3(bytes)) throw new Error(`Invalid MP3 for word ${index + 1}`);
    await writeFile(localPath(item) + '.tmp', bytes);
    await rename(localPath(item) + '.tmp', localPath(item));
    console.log(`Generated ${index + 1}/${items.length}`);
  }
  const size = (await Promise.all(items.map(i => stat(localPath(i))))).reduce((n, s) => n + s.size, 0);
  console.log(`Ready: ${items.length} MP3 files, ${(size / 1e6).toFixed(2)} MB. Listen to samples before upload.`);
} else {
  // Validate the whole batch before changing remote storage or the public manifest.
  const uploadItems = [];
  for (const item of items) {
    if (await cached(item)) uploadItems.push(item);
    else if (process.env.TTS_ALLOW_PARTIAL !== '1') throw new Error('Generate all B2 files before upload, or explicitly set TTS_ALLOW_PARTIAL=1');
  }
  if (!uploadItems.length) throw new Error('No generated B2 audio to upload');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY locally');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = process.env.TTS_STORAGE_BUCKET ?? 'word-audio';
  const { data: existing, error: lookupError } = await client.storage.getBucket(bucket);
  if (lookupError && String(lookupError.status ?? lookupError.statusCode) !== '404' && !/not found/i.test(lookupError.message)) throw new Error('Could not inspect audio bucket');
  if (!existing) {
    const { error } = await client.storage.createBucket(bucket, { public: true, allowedMimeTypes: ['audio/mpeg'], fileSizeLimit: 1048576 });
    if (error) throw new Error('Could not create audio bucket');
  } else if (!existing.public) throw new Error('Audio bucket must be public; refusing to change an existing private bucket');
  const entries = [];
  for (const item of uploadItems) {
    const { error } = await client.storage.from(bucket).upload(item.key, await cached(item), { contentType: 'audio/mpeg', cacheControl: '31536000', upsert: false });
    // Content-addressed names are immutable. A duplicate is safe on a resumed upload.
    if (error && String(error.statusCode) !== '409' && !/already exists|duplicate/i.test(error.message)) throw new Error(`Upload failed: ${item.key}`);
    const publicUrl = client.storage.from(bucket).getPublicUrl(item.key).data.publicUrl;
    const check = await fetch(publicUrl, { signal: AbortSignal.timeout(15000) });
    if (!check.ok || !mp3(Buffer.from(await check.arrayBuffer()))) throw new Error(`Public audio verification failed: ${item.key}`);
    entries.push({ text: item.text, url: publicUrl });
  }
  const target = resolve(root, 'public/data/audio/words-b2.json');
  await writeFile(target + '.tmp', JSON.stringify({ schemaVersion: 1, provider, voice, entries }, null, 2) + '\n');
  await rename(target + '.tmp', target);
  console.log(`Published ${entries.length} verified audio URLs to the B2 manifest. Deploy the manifest with the client.`);
}
