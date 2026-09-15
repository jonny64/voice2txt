# voice — Telegram voice → text pipeline

.ogg voice message → 2-min chunks → Whisper transcript (timestamped) → «Поднимаемые вопросы» summary.

## Install (Ubuntu 22.04, versions verified)

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg          # 7:4.4.2-0ubuntu0.22.04.1
# Node.js >= 24 required (core fetch/FormData/Blob) — via nvm/nodesource, NOT apt (22.04 ships v12)
# verified: node v24.14.1
```

## Setup

```bash
export OPENROUTER_API_KEY=...   # openrouter.ai key, used for both STT and summary
```

If a proxy is needed to reach openrouter.ai: set `HTTPS_PROXY` / `HTTP_PROXY` — the npm scripts
enable `NODE_USE_ENV_PROXY=1` so Node's fetch honors them (plain `node script.js` bypasses
the proxy and gets a 403 from the provider's security policy).

## Layout

```
in/<file>.ogg                            # inputs (drop voice files here)
out/<stem>/<stem>_part_NNN.ogg           # 120s chunks at 115s stride, 5s overlap (lossless -c copy)
out/<stem>/<stem>_part_NNN.json          # raw whisper verbose_json (segments)
out/<stem>/<stem>_part_NNN.txt           # transcript, lines "[MM:SS] text" (absolute time)
out/<stem>/<stem>_summary.txt            # Поднимаемые вопросы, lines "[MM:SS] Вопрос?"
ogg_summary_prompt.txt                   # summary system prompt (edit to tune)
```

## Usage

```bash
npm run pipeline                  # all files in in/
npm run pipeline -- in/file.ogg   # one file
```

Or step by step:

```bash
npm run split   -- in/file.ogg       # -> out/<stem>/<stem>_part_*.ogg
npm run txt     -- in/file.ogg [N]   # -> part .json/.txt, all missing parts in parallel (N = first N only, for smoke tests)
npm run summary -- in/file.ogg       # -> <stem>_summary.txt (aborts unless all parts transcribed)
```

All steps are idempotent: existing outputs are skipped, re-runs resume where they stopped.

## Overlap

Chunks overlap so words at cut boundaries aren't clipped: `SEGMENT_SECS` (default 120) per chunk,
stride = `SEGMENT_SECS - OVERLAP_SECS` (default 5) = 115 s. Both are env-overridable. Adjacent
part txts share a ~5 s duplicate zone with near-equal `[MM:SS]` timestamps — expected, not a bug.
If you override them, set the same values for both split and txt steps — txt derives absolute
timestamps from them. Changing `SEGMENT_SECS`/`OVERLAP_SECS` for an already-split file requires
deleting `out/<stem>/` first.

## Provider constants

Endpoint / key / models live at the top of `ogg2txt.js` (STT) and `ogg_summary.js` (chat) —
swap there to change provider. Defaults: OpenRouter, `openai/whisper-large-v3`, `z-ai/glm-5.3-flash`.

## Cost

~$0.0009 per 2-min chunk ≈ $0.024 per 50-min file (+4% overlap audio; whisper-large-v3, measured 2026-09).
