# Recorded B2 word audio

Scope: 199 unique headwords from `public/data/words-b2.json`, including articles.
Examples, other decks and sentences are not generated. The initial release contains 105 decoded/verified Google Translate recordings in
`public/audio/words/b2/`, with SHA-256 filenames and a relative-URL manifest.
The remaining 94 words use device speech. These small static assets deploy through
the existing Cloudflare Pages pipeline; Supabase Storage remains an optional
publisher for future batches.

For the same voice as the initial der Tisch example, set
`TTS_PROVIDER=google-translate` for generate and upload. This route requires no
Cloud API key; requests run sequentially with 1.2–2.8 second jitter. HTTP limits
stop the batch, retaining completed files for a later resumption. The default
`google-cloud` provider below remains available as a different voice choice.

`npm run audio:b2 -- plan` lists the word/character count without network access.
`npm run audio:b2 -- generate` uses Google Cloud TTS (default German Chirp 3 HD Kore).
Enable the Text-to-Speech API and billing first, then supply `GOOGLE_ACCESS_TOKEN`
or `GOOGLE_TTS_API_KEY` through the local environment. For user access tokens,
`GOOGLE_CLOUD_PROJECT` sets the quota project. Never commit or paste these secrets.
`TTS_VOICE` optionally chooses another de-DE voice; use the same value for generate
and upload. MP3 encoding uses the provider's default bitrate at 24 kHz; no 96 kbps
bitrate is promised. Completed audio is reused from ignored `build/word-audio-b2/`.
Audition representative files before uploading.

`npm run audio:b2 -- upload` needs local `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. It creates a dedicated public `word-audio` bucket
(or uses `TTS_STORAGE_BUCKET`), with immutable content-addressed MP3 filenames.
An existing private bucket is never made public. No client upload policies are
created; uploads require privileged authoring credentials. Only verified MP3
public URLs are written to `public/data/audio/words-b2.json` after the whole batch
succeeds. Re-running generation/upload retains completed work.

Deploy that manifest with the client, bumping VERSION for the release. The player
looks up exact normalized speech text, plays the recording, and falls back to the
existing German device voice if the manifest/file cannot load or playback fails.
Stopping/disposal cancels both pending lookup and active playback. Files are
fetched on demand and may use the browser HTTP cache (one-year immutable URLs).
Range requests bypass the service worker to avoid caching partial responses.
Cross-origin audio is not added to the service worker's offline cache by this change.

Offline local synthesis is a separate voice choice; this pipeline does not silently
substitute another provider or voice for the configured cloud recordings.

For an initial subset, set `TTS_ALLOW_PARTIAL=1` when uploading. Only valid
existing recordings are published; missing words retain device speech. An empty
batch is refused. The public manifest is replaced by the selected batch.
