---
name: add-video-dictation
description: Use when adding a new video to the video dictation exercise feature in de-trainer (downloading YouTube captions, generating a video-<id>.json dataset, and wiring it into the home page). Triggers on "add a new video dictation", "add a video to video dictation", "new dictation video".
---

# Add a video dictation entry

Each video is its own JSON dataset at `public/data/video-<youtubeVideoId>.json`,
served generically by `/de/video/<id>` (`src/client/router.ts`,
`src/client/pages/video-dictation.ts`). There is no manifest file listing all
videos — entry points are hardcoded cards in `src/client/pages/home.ts`
(currently two, in the "B2: sonstiges" section, ~line 376).

## 1. Prerequisites

- `yt-dlp` (here available as `python3 -m yt_dlp`).
- `--cookies-from-browser chrome` is required even for public videos —
  without it, caption downloads fail with "PO token was not provided" /
  "The page needs to be reloaded." Confirm Chrome is logged into YouTube.
- Optional: `DEEPL_API_KEY` env var for RU/EN/ES translation hints.

## 2. Generate the dataset

    node scripts/extract-subtitles.mjs <youtubeVideoId> \
      --level b2 --title "Video title" [--translate RU,EN,ES]

- `--level`: CEFR string (a1..c2). Pick based on vocabulary density/topic
  abstraction, not just video length — a dense interview/argumentative
  piece can be C1 even if visually similar to a B2 news clip.
- `--title`: sets the exercise title; without it defaults to the video ID.
- Writes `public/data/video-<videoId>.json` (override with `--out`).
- The script auto-merges caption fragments under 10 chars into the next
  segment, but does NOT strip broadcaster metadata lines.

If auto-fetch fails, download manually and feed it in:

    python3 -m yt_dlp --cookies-from-browser chrome --write-sub \
      --sub-lang de --sub-format json3 --skip-download \
      "https://www.youtube.com/watch?v=<videoId>"
    node scripts/extract-subtitles.mjs <videoId> --input <downloaded.json3>

To add/refresh translations on an already-generated file without
re-extracting captions:

    DEEPL_API_KEY=xxx node scripts/extract-subtitles.mjs \
      --input-json public/data/video-<videoId>.json --translate RU,EN,ES

## 3. Clean up the generated JSON

Auto-captions routinely include non-content lines that shouldn't be
dictation prompts — check the first few and last few segments especially:

- Broadcaster/channel credit lines (e.g. `"UNTERTITEL: Hessischer Rundfunk"`).
- Trailing copyright lines (e.g. `"Copyright Untertitel: hr 2026"`).

Scan for anomalies before wiring it in:

    python3 -c "
    import json
    d = json.load(open('public/data/video-<id>.json'))
    segs = d['segments']
    for i, s in enumerate(segs):
        if len(s['sentence']) < 8:
            print('SHORT', i, s['pauseAt'], repr(s['sentence']))
        if i > 0 and s['sentence'] == segs[i-1]['sentence']:
            print('DUP', i, s['pauseAt'])
    "

Remove any bad segments by index, then re-save (`ensure_ascii=False`,
`indent=2` to match existing file style).

Shape reference (`src/client/types.ts` `VideoExercise`/`VideoSegment`):

    {
      "videoId": "...",
      "level": "b2",
      "title": "...",
      "segments": [
        { "pauseAt": 3.8, "sentence": "...", "tokens": ["...", "..."],
          "translation_ru": "...", "translation_en": "...", "translation_es": "..." }
      ]
    }

`translation_*` fields are optional — the UI handles their absence fine,
so it's OK to ship without a `DEEPL_API_KEY` and backfill later.

## 4. Add a home page card

Edit `src/client/pages/home.ts`, in the "B2: sonstiges" section (adjust if
using a different level). Add a new card next to the existing one(s):

    <a class="card-link" href="de/video/<newId>">
      <div class="card small">
        <h3>${t().videoDictLabel}</h3>
        <p>„<video title>“ (<short source note>)</p>
      </div>
    </a>

`videoDictLabel`/`videoDictDesc` (`src/client/i18n.ts`, ~lines 177-179,
576-578, 775-777) are generic across all videos, not video-specific. Since
multiple cards would otherwise look identical, use the description `<p>`
to show the video's own (German) title so cards are distinguishable —
no i18n changes needed for this.

No changes needed in `video-dictation.ts`, `router.ts`, or `types.ts` —
all are generic over `videoId`.

## 5. Verify

    npm run build
    npm run serve   # http://localhost:3000

- Confirm both/all video cards appear with distinct link targets.
- Open the new video's page: player loads, pauses at first segment, type
  and drag modes both work, reaches "finished" state cleanly (check both
  ends of the segment list — that's where credit-line artifacts live).
- Confirm existing videos still work (regression check).
