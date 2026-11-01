# Recorded A1 sentences

All 130 `public/data/sentences-a1.json` targets receive one saved MP3 each.
Assignments alternate in source order: `de-DE-KatjaNeural` (female) and
`de-DE-ConradNeural` (male), 65 sentences per voice. The first sentence,
“Ich heiße Anna.”, uses Katja. Voice identity is retained in the manifest.

The shared card speech adapter looks up exact normalized text in the B2 word
and A1 sentence manifests. Batches load independently: an unavailable batch
cannot suppress recordings from the other one. Missing text, failed playback
or offline assets fall back to the existing German system voice. Cancellation
and disposal stop pending lookups as well as active playback; disclosure and
auto-speech permissions stay with the existing card/session code.

MP3s live in `public/audio/sentences/a1/` under SHA-256 filenames. The manifest,
`public/data/audio/sentences-a1.json`, uses base-relative URLs for root and
`/de-trainer/` hosting. Files load on demand; there is no client synthesis call
or API key. Existing B2 recordings are retained.

## Authoring

Install optional Python authoring dependencies from
`scripts/requirements-audio.txt` in a local virtual environment, then run:

```
python scripts/sentence-audio-a1.py
python scripts/publish-sentence-audio-a1.py
```

Generation calls Microsoft Edge TTS sequentially with 1.2–2.8 second jitter.
Completed files are checkpointed in ignored `build/sentence-audio-a1/` and
reused when resuming. A denied or rate-limited request stops the batch. Only
connection failures and server errors have bounded backoff retries.
Publication requires the complete current source, expected voice assignments,
matching SHA-256 checksums and successful decoding through macOS `afconvert`
or FFmpeg. Every clip must contain non-empty 24 kHz mono audio. All clips are
verified before the public manifest is replaced. The cloud service's native
MP3 encoding is retained; voices use their normal rate.

Follow the release workflow for merge and deployment. Generating audio or
opening a PR alone does not publish it to drillcards.org.
