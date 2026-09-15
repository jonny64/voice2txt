# Overlap Split Seam Fix

## Overview
- 120 s blind cuts clip words at part boundaries (25 seams on a 50-min file). Fix: 5 s overlap between chunks so every boundary word is fully captured by the neighboring chunk.
- No trimming, no dedup: the summary LLM is told (via `ogg_summary_prompt.txt`) that fragments overlap ~5 s and literal repeats are not new thoughts or re-asked questions.
- Cost: +1 chunk per 50-min file, +4% audio (~$0.001). Timestamps stay absolute and correct.

## Context (from discovery)
- Files involved: `ogg_split.js` (per-chunk ffmpeg), `ogg2txt.js` (timestamp offset), `ogg_summary_prompt.txt` (overlap note)
- Project: Node >= 24 CommonJS, zero deps, style per `~/.claude/CODESTYLE.md`, ffmpeg via `spawnSync`
- Layout: `in/<file>.ogg` → `out/<stem>/<stem>_part_NNN.{ogg,json,txt}` + `<stem>_summary.txt`
- Existing `out/3563438329_37663_107215/` was split with the old no-overlap stride → stale, must be wiped
- Whisper API has no start-offset param; absolute time = `idx × (SEGMENT_SECS − OVERLAP_SECS) + segment.start`

## Development Approach
- **testing approach**: smoke checks (no test framework in repo)
- complete each task fully before moving to the next; small focused changes
- every task ends with its smoke check passing before the next starts

## Progress Tracking
- mark completed items with `[x]` immediately; ➕ for new tasks, ⚠️ for blockers

## Solution Overview
- Stride becomes `SEGMENT_SECS − OVERLAP_SECS = 120 − 5 = 115 s`; each chunk is still up to 120 s of audio (`-ss idx*115 -t 120`), so neighbors share 5 s.
- `ogg_split.js`: single segment-muxer call is replaced by ffprobe-duration + per-chunk `-ss/-t` loop (segment muxer cannot overlap). `-c copy` kept (lossless, fast); `-reset_timestamps` not needed with `-ss` before `-i` (timestamps rebase to 0 — verify in smoke check).
- `ogg2txt.js`: offset line changes from `idx * SEGMENT_SECS` to `idx * (SEGMENT_SECS - OVERLAP_SECS)`. All segments kept.
- Summary prompt absorbs the ~5 s duplicate zones.

## Technical Details
- Constants (env-overridable, same names in both files): `SEGMENT_SECS=120`, new `OVERLAP_SECS=5`
- Chunk count: `ceil((duration − SEGMENT_SECS) / stride) + 1` → 50:32 file: 27 parts (was 26)
- Last chunk: `-t` beyond EOF is fine, ffmpeg stops at end
- txt format unchanged: lines `[MM:SS] text` (absolute); overlap zones appear in two adjacent txts with ~equal timestamps
- ffprobe call: `ffprobe -v error -show_entries format=duration -of csv=p=0 <file>`

## Implementation Steps

### Task 1: Overlap loop in ogg_split.js

**Files:**
- Modify: `ogg_split.js`

- [x] add `OVERLAP_SECS = process.env.OVERLAP_SECS || '5'` constant; derive `STRIDE = SEGMENT_SECS - OVERLAP_SECS`
- [x] get duration via `spawnSync('ffprobe', ...)`; parse float, error out on failure
- [x] replace segment-muxer call with loop: for `start = 0; start < duration; start += STRIDE` → `ffmpeg -ss <start> -t <SEGMENT_SECS> -i <f> -c copy part_%03d.ogg` (idx from loop counter, zero-padded to 3)
- [x] keep skip-if-parts-exist and 0-byte guards unchanged
- [x] update log line to be stride-aware (e.g. `${_parts().length} parts, ${SEGMENT_SECS}s chunks, ${STRIDE}s stride`), count derived from the loop
- [x] smoke: wipe `out/3563438329_37663_107215/`, run `npm run split -- in/3563438329_37663_107215.ogg` → 27 parts; `ffprobe` durations: part_000…part_025 ≈ 120 s each, part_026 ≈ 42 s; sum ≈ 3162 s (3032 + 26×5 overlap). Source-offset of part_001 is NOT ffprobe-verifiable — covered by Task 2's `[01:55]` timestamp check instead

### Task 2: Stride-based offset in ogg2txt.js

**Files:**
- Modify: `ogg2txt.js`

- [x] add `OVERLAP_SECS` constant (same env name); offset = `idx * (SEGMENT_SECS - OVERLAP_SECS)`
- [x] no other logic changes (no trim, no dedup)
- [x] smoke: `npm run txt -- in/3563438329_37663_107215.ogg 2` → part_001.txt first timestamp ≈ [01:55] (115 s), not [02:00]; seam text (t≈115–120) present in both part_000.txt and part_001.txt with near-equal `[MM:SS]`

### Task 3: Overlap note in summary prompt

**Files:**
- Modify: `ogg_summary_prompt.txt`

- [x] REPLACE the clipped-words clause («на стыках фрагментов возможны обрезанные слова — не трактуй их как отдельные мысли») with the overlap clause: fragments overlap ~5 s; literal repeats between neighbors are duplicates, not new thoughts or re-asked questions (leaving both would contradict)
- [x] smoke: file reads as one coherent prompt (used as-is by `ogg_summary.js`)

### Task 4: Full run on the 50-min file

**Files:**
- Modify: none (data only)

- [x] `npm run pipeline -- in/3563438329_37663_107215.ogg` (27 chunks parallel + summary)
- [x] verify: 27×.ogg + 27×.json + 27×.txt + `<stem>_summary.txt`; no 0-byte .txt
- [x] verify: summary lines match `^\[\d{2}:\d{2}\] .+\?$`; cited timestamps look monotonic-ish
- [x] verify resume: re-run pipeline → split skips, txt skips all 27, summary skips; zero API calls
- [x] negative: `OPENROUTER_API_KEY= npm run txt -- in/…` → clear error before any request

### Task 5: Verify acceptance criteria
- [x] seam zone (e.g. t≈01:55–02:00) fully transcribed in both neighbors — no clipped words at any checked seam (spot-check 3 seams)
- [x] summary contains questions with `[MM:SS]` pointing into correct 2-min chunk
- [x] all smoke checks from Tasks 1–4 green

### Task 6: Update documentation
- [x] README: overlap behavior (SEGMENT_SECS/OVERLAP_SECS envs, duplicate zones in txt are expected)
- [x] README: update layout line "120s chunks" → 120s chunks at 115s stride (5s overlap)
- [x] README: update cost line (~$0.023 → ~$0.024 per 50-min file, +4% overlap audio)
- [x] `git add` changed files (plan file NOT committed per repo rules), propose commit `master FIX seam word loss via 5s overlap split`
- [x] move this plan to `docs/plans/completed/`

## Post-Completion
- Manual: listen to one seam region in the original voice to confirm no word loss (human ear check)
- Deferred (not in scope): seam probe task #5 from session task list is superseded by this fix; LLM paragraphing (option C from brainstorm) remains unscheduled
