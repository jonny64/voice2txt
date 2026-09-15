#!/usr/bin/env node
// ogg2txt.js <in/file.ogg> [max_parts] — transcribe out/<stem>/<stem>_part_*.ogg via OpenRouter Whisper (verbose_json).
// Per part: <part>.json (raw response) + <part>.txt (lines "[MM:SS] text", absolute time in the source file).
// Idempotent: skips parts that already have a .txt. All missing parts are transcribed in parallel (Promise.allSettled).
const {existsSync, readdirSync, readFileSync, writeFileSync} = require ('node:fs')
const {basename, join} = require ('node:path')

////////////////////////////////////////////////////////////////////////////////
// provider constants — swap here to change endpoint/key/model
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
const API_KEY  = process.env.OPENROUTER_API_KEY
const MODEL    = process.env.ASR_MODEL            || 'openai/whisper-large-v3'
////////////////////////////////////////////////////////////////////////////////
const OUT_DIR      = process.env.OUT_DIR || 'out'
const SEGMENT_SECS = Number (process.env.SEGMENT_SECS || 120) // must match ogg_split.js
const OVERLAP_SECS = Number (process.env.OVERLAP_SECS || 5)   // must match ogg_split.js
const STRIDE = SEGMENT_SECS - OVERLAP_SECS
if (!Number.isFinite (STRIDE) || STRIDE <= 0) {
    console.error (`error: bad SEGMENT_SECS=${SEGMENT_SECS} OVERLAP_SECS=${OVERLAP_SECS} — stride must be a positive finite number`)
    process.exit (1)
}
const MAX_TIME_MS  = 120_000
const RETRIES      = 3

const _ts    = sec => `[${String (Math.floor (sec / 60)).padStart (2, '0')}:${String (Math.floor (sec % 60)).padStart (2, '0')}]`
const _sleep = ms => new Promise (r => setTimeout (r, ms))

main ().catch (err => {
    console.error (`error: ${err.message}`)
    process.exit (1)
})

async function main () {

    if (!API_KEY) throw new Error ('OPENROUTER_API_KEY not set')
    const [file, maxArg] = process.argv.slice (2)
    if (!file) throw new Error ('usage: node ogg2txt.js <file.ogg> [max_parts]')
    const maxParts = Number (maxArg || 0)

    const stem    = basename (file).replace (/\.[^.]+$/, '')
    const partDir = `${OUT_DIR}/${stem}`
    if (!existsSync (partDir)) throw new Error (`no ${partDir} — run ogg_split.js first`)

    const parts = readdirSync (partDir).filter (n => n.startsWith (`${stem}_part_`) && n.endsWith ('.ogg')).sort ()
    if (!parts.length) throw new Error (`no parts in ${partDir} — run ogg_split.js first`)

    const todo = parts
        .map ((part, i) => ({part, i: i + 1, base: join (partDir, part.replace (/\.ogg$/, ''))}))
        .filter (p => !existsSync (`${p.base}.txt`))
    const skipped = parts.length - todo.length
    const batch   = maxParts ? todo.slice (0, maxParts) : todo

    if (!batch.length) {
        console.log (`done: ok=0 skipped=${skipped} failed=0 cost=$0`)
        return
    }

    let costSum = 0
    const results = await Promise.allSettled (batch.map (p => _transcribe (p, parts.length)))

    let fail = 0
    for (const r of results) {
        if (r.status === 'fulfilled') costSum += r.value
        else fail++
    }
    console.log (`done: ok=${batch.length - fail} skipped=${skipped} failed=${fail} cost=$${costSum}`)
    process.exit (fail ? 1 : 0)

}

async function _transcribe ({part, i, base}, total) {

    const fd = new FormData ()
    fd.append ('model', MODEL)
    fd.append ('response_format', 'verbose_json')
    fd.append ('file', new Blob ([readFileSync (`${base}.ogg`)], {type: 'audio/ogg'}), part)

    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
            const ctrl  = new AbortController ()
            const timer = setTimeout (() => ctrl.abort (), MAX_TIME_MS)
            const resp  = await fetch (`${BASE_URL}/audio/transcriptions`, {
                method:  'POST',
                headers: {Authorization: `Bearer ${API_KEY}`},
                body:    fd,
                signal:  ctrl.signal,
            })
            clearTimeout (timer)
            const body = await resp.text ()
            let j = null
            try { j = JSON.parse (body) }
            catch (err) { /* non-JSON error body */ }
            if (!resp.ok || !Array.isArray (j?.segments)) throw new Error (`http=${resp.status} ${body.slice (0, 200)}`)

            writeFileSync (`${base}.json`, body)
            const off = parseInt (part.match (/_part_(\d+)\.ogg$/) [1], 10) * STRIDE
            const txt = j.segments.map (sg => `${_ts (off + sg.start)}${sg.text}`).join ('\n') + (j.segments.length ? '\n' : '')
            writeFileSync (`${base}.txt`, txt)
            const cost = j.usage?.cost ?? 0
            console.log (`[${i}/${total}] ${part} -> ${txt.length} chars ($${cost})`)
            return cost
        }
        catch (err) {
            console.error (`[${i}/${total}] attempt ${attempt} failed: ${err.message}`)
            if (attempt < RETRIES) await _sleep (2 ** attempt * 1000)
        }
    }
    throw new Error (`${part}: failed after ${RETRIES} attempts`)

}
