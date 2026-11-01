# Video dictation and sentences from video (M6 / #338)

FC09 and FC10 of the [capability matrix](exercise-capability-matrix.ru.md). They run on the
G3 item contracts with the M1 sentence adapter ([sentences-v2.md](sentences-v2.md)) and the
M2 listening adapter ([listening-v2.md](listening-v2.md)). Page: `/v2/video.html`, linked
from `/v2/session.html`. It replaces v1 `video-dictation.ts` and `video-sentences.ts`.

## Content

`npm run items:videos` (`scripts/build-video-datasets.mjs`) converts every v1
`public/data/video-<id>.json` into one immutable `ItemDataset` of kind `video-segment` at
`public/data/items/video-<id>.json`. That is 7 videos and 1,634 segments. The `version`
(`video-<id>-<hash>`) is derived from the content.

A segment (`seg-<index>`, in v1 order) is sentence content plus its clip:
`video: { videoId, index, start, end, shorts }`. `start` is the previous pause point and
`end` is its own. `test/video.test.mjs` fails when a file is stale, when a v1 video has no
dataset, or when a segment's sentence, tokens, RU/EN/ES translations or pause point is
lost.

## Adapters

There are no new exercise definitions. `videoSegmentContent` (`families/video.ts`)
validates the clip.
- **Dictation (FC09)** is `listening-tokens` / `listening-text`. For a video segment the task
  carries `media: { kind: 'youtube', videoId, start, end }` as its prompt. `audio` (the
  German text) is used only for the speech fallback. The text check is the v1 dictation
  rule; assembly uses the shared sentence check.
- **Sentences (FC10)** is `sentence-assembly`, with the translation as the prompt. As in v1,
  only translated segments offer it: the 565 segments of the four translated videos. The
  other three videos offer dictation only, and the page says so.
- **Token order:** the same for both views of a segment and seed.
- **Statistics:** keyed by exercise and dataset. The two dictation modes, assembly and the
  sentence corpus never mix.

## Page

- **Player** (`youtube-media.ts`): a media adapter over the YouTube IFrame API. It plays one
  clip at a time (seek to `start`, play, pause at `end`) and owns the polling timer and the
  iframe. `dispose()` releases both on a view or video change and on `pagehide`. Shorts get
  a portrait frame.
- **Sessions:** one single-task item session per shown segment, on the shared Runner and
  journal. Next, Previous, a mode, view or video switch, or Start over completes the shown
  session if answered or abandons it if not (no event). Replaying a clip writes nothing.
  Try again and Previous are `assisted`.
- **Dictation:**
  - Segments in video order. The German text and translations appear only after the
    answer.
  - Controls: Replay clip (or `R`), text/tokens mode (`de_trainer_k2_mode`, as in v1), and
    the end of the video with Start over.
  - The position is saved per video (`vd_pos_<id>`, as in v1). A reload continues the open
    session: video, view, mode, segment and answer.
- **Sentences:** they start on the current dictation segment. Then the next one comes from
  `selectItems`: never answered first, then last wrong, then the oldest. Previous goes back
  through the shown ones. The other translations (RU/EN/ES) are shown, and German speech is
  available after the answer. Switching back to dictation returns to the saved position.
- **Errors:**
  - A failed IFrame API load, a YouTube error or being offline is shown with its cause.
  - The notice offers Load the video again and a speech fallback for the clip's text.
  - There is no promise of offline playback, and the task stays answerable.
- **Keyboard and screens:** the TokenInput/TextInput keys, Enter to check, `R`, → next,
  ← previous, and Enter after the answer. The interface is RU/EN/DE, and the page works at
  360 px.

Verification: `node --test test/video.test.mjs` and
`npx playwright test test/video-v2.spec.ts`. The spec replaces the IFrame API with a fake
player whose time advances quickly.
