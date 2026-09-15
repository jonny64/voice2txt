# CLAUDE.md

Telegram voice → text pipeline. Node ≥ 24, CommonJS, zero deps, ffmpeg. Style: `~/.claude/CODESTYLE.md`.

- Run: `npm run pipeline` (all of `in/`) or per step: `split` / `txt` / `summary`
- `OPENROUTER_API_KEY` required; npm scripts set `NODE_USE_ENV_PROXY=1` (fetch must honor `HTTP(S)_PROXY`, else 403)
- Outputs: `out/<stem>/` — parts `.ogg/.json/.txt` + `<stem>_summary.txt`; all steps idempotent, resume by skipping existing files
- `docs/plans/**` IS committed here; `in/` `out/` data never committed
