#!/usr/bin/env node

// Extracts YouTube subtitles and generates a video exercise JSON file.
//
// Usage:
//   node scripts/extract-subtitles.mjs <videoId> [options]
//
// Options:
//   --lang de        Subtitle language (default: de)
//   --level b2       CEFR level (default: b2)
//   --title "..."    Exercise title (default: videoId)
//   --out path       Output file path (default: public/data/video-<videoId>.json)
//   --input file     Use a pre-downloaded json3/vtt file instead of fetching
//   --input-json f   Read an existing video-<id>.json and add translations to it
//   --translate RU   Translate each segment via DeepL (requires DEEPL_API_KEY env var)
//
// Fetching requires yt-dlp with Chrome cookies:
//   python3 -m yt_dlp --cookies-from-browser chrome --write-sub --sub-lang de \
//     --sub-format json3 --skip-download "https://www.youtube.com/watch?v=VIDEO_ID"
//
// --cookies-from-browser chrome triggers a macOS Keychain password prompt on
// every run. Avoid repeated prompts by caching cookies to a file once:
//   python3 -m yt_dlp --cookies-from-browser chrome --cookies ~/.yt-dlp-cookies.txt \
//     --skip-download --simulate "https://www.youtube.com/watch?v=VIDEO_ID"
// If ~/.yt-dlp-cookies.txt exists, this script uses it automatically instead
// of touching the browser/Keychain.

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const args = process.argv.slice(2);

function getArg(flag, fallback) {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
}

const videoId = args.find((a) => !a.startsWith("--"));
const lang = getArg("--lang", "de");
const level = getArg("--level", "b2");
const title = getArg("--title", "");
const outPath = getArg("--out", "");
const inputFile = getArg("--input", "");
const inputJson = getArg("--input-json", "");
const translateLangs = getArg("--translate", "")
    .split(",").map((l) => l.trim().toUpperCase()).filter(Boolean);

if (!videoId && !inputJson) {
    console.error("Usage: node scripts/extract-subtitles.mjs <videoId> [--lang de] [--level b2] [--title \"...\"] [--input file.json3]");
    console.error("       node scripts/extract-subtitles.mjs --input-json public/data/video-<id>.json --translate RU,EN,ES");
    process.exit(1);
}

// ── Parsers ──

// Caption lines are not exercise segments: a line breaks wherever it fits on
// screen, mid-clause and mid-sentence. So the parsers below produce a flat
// stream of timed words, and buildSegments() re-cuts it at sentence and clause
// boundaries. Each word carries an absolute timestamp, which is what keeps a
// segment's pause aligned with its last word.
//
// Timing comes in two flavours:
//   - auto-captions (ASR) time every word (segs[].tOffsetMs) — used directly;
//   - human subtitles time whole lines — a word's time is interpolated across
//     the line by character position. Without that, several segments cut from
//     one line would all inherit the line's end time and the video would pause
//     in the same place for each of them.

function wordsFromLine(text, startMs, endMs, offsets) {
    const pieces = text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
    const totalChars = pieces.reduce((n, w) => n + w.length, 0) || 1;
    const words = [];
    let chars = 0;
    pieces.forEach((text, i) => {
        const offset = offsets?.[i];
        const at = offset !== undefined && offset !== null
            ? startMs + offset
            : startMs + (endMs - startMs) * (chars / totalChars);
        words.push({ text, at });
        chars += text.length;
    });
    return words;
}

function parseJson3Words(json3) {
    const events = (json3.events || []).filter((e) => e.segs?.length);
    const words = [];

    events.forEach((event, i) => {
        const start = event.tStartMs || 0;
        const nextStart = i + 1 < events.length ? (events[i + 1].tStartMs || 0) : Infinity;
        // The caption's own duration is the better estimate of when speech
        // stopped; the next line's start bounds it when captions overlap.
        const end = Math.min(start + (event.dDurationMs || 0), nextStart);

        for (const seg of event.segs) {
            const raw = seg.utf8 || "";
            if (!raw.trim()) continue;
            const segWords = wordsFromLine(raw, start, end, [seg.tOffsetMs]);
            // A word-timed seg holds exactly one word; a line-timed seg holds
            // the whole line, so only the first word can use the offset.
            if (seg.tOffsetMs !== undefined && segWords.length > 1) {
                words.push(...wordsFromLine(raw, start + seg.tOffsetMs, end, []));
            } else {
                words.push(...segWords);
            }
        }
    });

    return words;
}

function parseVttWords(vtt) {
    const toSeconds = (stamp) => {
        const parts = stamp.trim().split(" ")[0].split(":");
        if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
        if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
        return 0;
    };

    const words = [];
    for (const block of vtt.split(/\n\n+/)) {
        const lines = block.trim().split("\n");
        const timeLine = lines.find((l) => l.includes("-->"));
        if (!timeLine) continue;
        const [startStr, endStr] = timeLine.split("-->");
        const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ")
            .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        words.push(...wordsFromLine(text, toSeconds(startStr) * 1000, toSeconds(endStr) * 1000, []));
    }
    return words;
}

// Cuts the word stream into exercise segments: whole sentences, and for
// sentences longer than maxTokens, clause-sized pieces broken at commas — so
// every segment ends where the speaker naturally pauses.
function buildSegments(words, maxTokens = 14) {
    const TERMINAL = /[.!?…]["»«]?$/;
    // Caption artifacts that are not spoken text: [Musik], (lacht), …
    const ANNOTATION = /\([^)]*\)|\[[^\]]*\]/g;

    const sentences = [];
    let current = [];
    for (const word of words) {
        current.push(word);
        if (TERMINAL.test(word.text)) {
            sentences.push(current);
            current = [];
        }
    }
    if (current.length) sentences.push(current);

    const chunks = [];
    for (const sentence of sentences) {
        if (sentence.length <= maxTokens) {
            chunks.push(sentence);
            continue;
        }
        const clauses = [];
        let clause = [];
        for (const word of sentence) {
            clause.push(word);
            if (word.text.endsWith(",")) {
                clauses.push(clause);
                clause = [];
            }
        }
        if (clause.length) clauses.push(clause);

        let buffer = [];
        for (const cl of clauses) {
            if (cl.length > maxTokens) {
                if (buffer.length) { chunks.push(buffer); buffer = []; }
                for (let i = 0; i < cl.length; i += maxTokens) chunks.push(cl.slice(i, i + maxTokens));
                continue;
            }
            if (buffer.length && buffer.length + cl.length > maxTokens) {
                chunks.push(buffer);
                buffer = [...cl];
            } else {
                buffer.push(...cl);
            }
        }
        if (buffer.length) chunks.push(buffer);
    }

    const segments = [];
    chunks.forEach((chunk, i) => {
        const sentence = chunk.map((w) => w.text).join(" ")
            .replace(ANNOTATION, " ").replace(/\s+/g, " ").trim();
        if (!sentence) return;
        // Pause where the next segment starts speaking; the last one gets a
        // second of tail so the final words are not clipped.
        const pauseMs = i + 1 < chunks.length ? chunks[i + 1][0].at : chunk[chunk.length - 1].at + 1000;
        segments.push({ pauseAt: Math.round(pauseMs / 100) / 10, sentence, tokens: sentence.split(" ") });
    });

    // Timestamps must never step backwards, or the player would pause before
    // the segment it belongs to.
    for (let i = 1; i < segments.length; i++) {
        if (segments[i].pauseAt < segments[i - 1].pauseAt) segments[i].pauseAt = segments[i - 1].pauseAt;
    }
    // A trailing one-letter stub is a sign-off initial, not an exercise.
    while (segments.length && segments[segments.length - 1].sentence.length <= 2) segments.pop();

    return segments;
}

// ── Fetching ──

function findYtDlpCmd() {
    for (const cmd of ["yt-dlp", "python3 -m yt_dlp", "python -m yt_dlp"]) {
        try {
            execSync(`${cmd} --version`, { stdio: "ignore" });
            return cmd;
        } catch {}
    }
    return null;
}

const COOKIE_FILE = resolve(process.env.HOME || "", ".yt-dlp-cookies.txt");

function fetchWithYtDlp() {
    const ytdlp = findYtDlpCmd();
    if (!ytdlp) {
        console.error("yt-dlp not found. Install: pip3 install yt-dlp");
        return null;
    }

    // A cached Netscape cookie file avoids a macOS Keychain password prompt
    // on every run. Bootstrap it once with:
    //   python3 -m yt_dlp --cookies-from-browser chrome --cookies ~/.yt-dlp-cookies.txt --skip-download --simulate <any-youtube-url>
    const cookieArgs = existsSync(COOKIE_FILE)
        ? `--cookies "${COOKIE_FILE}"`
        : "--cookies-from-browser chrome";
    console.log(`Using ${ytdlp} with ${existsSync(COOKIE_FILE) ? "cached cookie file" : "Chrome cookies"}...`);
    const tmpDir = `/tmp/yt-sub-${videoId}-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });

    try {
        const cmd = `${ytdlp} ${cookieArgs} --write-sub --write-auto-sub --sub-lang ${lang} --sub-format json3 --skip-download -o "${tmpDir}/sub" "https://www.youtube.com/watch?v=${videoId}" 2>&1`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
        console.log(output);

        const files = readdirSync(tmpDir);
        if (files.length === 0) {
            console.log("No subtitle files downloaded");
            return null;
        }

        const json3File = files.find((f) => f.endsWith(".json3"));
        if (json3File) {
            return { type: "json3", data: JSON.parse(readFileSync(`${tmpDir}/${json3File}`, "utf-8")) };
        }
        const vttFile = files.find((f) => f.endsWith(".vtt"));
        if (vttFile) {
            return { type: "vtt", data: readFileSync(`${tmpDir}/${vttFile}`, "utf-8") };
        }
        console.log(`Unexpected files: ${files.join(", ")}`);
        return null;
    } catch (e) {
        const msg = (e.stdout || e.stderr || e.message || "").trim().split("\n").slice(-3).join("\n");
        console.error(`yt-dlp failed:\n${msg}`);
        if (existsSync(COOKIE_FILE) && /cookies|sign in|not a bot/i.test(msg)) {
            console.error(
                `\nThis may mean ${COOKIE_FILE} is stale. Regenerate it with:\n` +
                `  python3 -m yt_dlp --cookies-from-browser chrome --cookies "${COOKIE_FILE}" --skip-download --simulate <any-youtube-url>`
            );
        }
        return null;
    }
}

// ── Translation ──

async function translateWithDeepL(sentences, targetLang, apiKey) {
    const endpoint = apiKey.endsWith(":fx")
        ? "https://api-free.deepl.com/v2/translate"
        : "https://api.deepl.com/v2/translate";

    const BATCH_SIZE = 50;
    const results = [];

    for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
        const batch = sentences.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(sentences.length / BATCH_SIZE);
        console.log(`Translating batch ${batchNum}/${totalBatches} (${batch.length} sentences)…`);

        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Authorization": `DeepL-Auth-Key ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: batch, source_lang: "DE", target_lang: targetLang.toUpperCase() }),
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`DeepL API error ${res.status}: ${body}`);
        }

        const data = await res.json();
        if (data.translations.length !== batch.length) {
            throw new Error(`DeepL returned ${data.translations.length} translations for ${batch.length} inputs (batch ${batchNum}/${totalBatches})`);
        }
        results.push(...data.translations.map((t) => t.text));
    }

    return results;
}

// ── Main ──

async function main() {
    // ── Mode: enrich existing JSON with translations ──
    if (inputJson) {
        if (!existsSync(inputJson)) {
            console.error(`File not found: ${inputJson}`);
            process.exit(1);
        }
        if (!translateLangs.length) {
            console.error("--translate <lang> is required when using --input-json (e.g. --translate RU,EN,ES)");
            process.exit(1);
        }
        const apiKey = process.env.DEEPL_API_KEY;
        if (!apiKey) {
            console.error("DEEPL_API_KEY environment variable is not set");
            process.exit(1);
        }

        const exercise = JSON.parse(readFileSync(inputJson, "utf-8"));

        // Strip legacy single-field translation if present
        exercise.segments = exercise.segments.map(({ translation: _legacy, ...rest }) => rest);

        console.log(`Loaded ${exercise.segments.length} segments from ${inputJson}`);

        const dest = outPath ? resolve(outPath) : resolve(inputJson);
        const sentences = exercise.segments.map((s) => s.sentence);
        for (const lang of translateLangs) {
            const key = `translation_${lang.toLowerCase()}`;
            if (exercise.segments.every((s) => s[key])) {
                console.log(`Skipping ${lang} — all segments already have ${key}`);
                continue;
            }
            const translations = await translateWithDeepL(sentences, lang, apiKey);
            exercise.segments = exercise.segments.map((seg, i) => ({ ...seg, [key]: translations[i] }));
            writeFileSync(dest, JSON.stringify(exercise, null, 2) + "\n", "utf-8");
            console.log(`Added ${lang} translations → saved`);
        }

        console.log(`\nWritten ${exercise.segments.length} segments with translations (${translateLangs.join(", ")}) → ${dest}`);
        return;
    }

    // ── Mode: extract subtitles (+ optionally translate) ──
    console.log(`Processing video: ${videoId} (lang: ${lang})\n`);

    let segments;

    if (inputFile) {
        if (!existsSync(inputFile)) {
            console.error(`File not found: ${inputFile}`);
            process.exit(1);
        }
        const content = readFileSync(inputFile, "utf-8");
        const words = inputFile.endsWith(".json3") || inputFile.endsWith(".json")
            ? parseJson3Words(JSON.parse(content))
            : parseVttWords(content);
        console.log(`Parsed ${words.length} timed words from ${inputFile}`);
        segments = buildSegments(words);
    } else {
        const result = fetchWithYtDlp();
        if (!result) {
            console.error("\nFailed to fetch subtitles.");
            console.error("You can download manually and use --input:\n");
            console.error(`  python3 -m yt_dlp --cookies-from-browser chrome --write-sub --sub-lang ${lang} --sub-format json3 --skip-download "https://www.youtube.com/watch?v=${videoId}"`);
            console.error(`  node scripts/extract-subtitles.mjs ${videoId} --input <downloaded-file.json3>`);
            process.exit(1);
        }
        const words = result.type === "json3" ? parseJson3Words(result.data) : parseVttWords(result.data);
        console.log(`Parsed ${words.length} timed words`);
        segments = buildSegments(words);
    }

    console.log(`Cut into ${segments.length} segments (sentence and clause boundaries)`);

    if (translateLangs.length) {
        const apiKey = process.env.DEEPL_API_KEY;
        if (!apiKey) {
            console.error("DEEPL_API_KEY environment variable is not set");
            process.exit(1);
        }
        for (const tLang of translateLangs) {
            const translations = await translateWithDeepL(segments.map((s) => s.sentence), tLang, apiKey);
            const key = `translation_${tLang.toLowerCase()}`;
            segments = segments.map((seg, i) => ({ ...seg, [key]: translations[i] }));
            console.log(`Translated ${segments.length} segments to ${tLang}`);
        }
    }

    const exercise = {
        videoId,
        level,
        title: title || videoId,
        segments,
    };

    const output = outPath
        ? resolve(outPath)
        : resolve("public", "data", `video-${videoId}.json`);

    writeFileSync(output, JSON.stringify(exercise, null, 2) + "\n", "utf-8");
    console.log(`\nWritten ${segments.length} segments to ${output}`);
    console.log("Review the file and adjust sentences/tokens as needed.");
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
