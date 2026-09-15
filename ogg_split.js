#!/usr/bin/env node
// ogg_split.js <in/file.ogg> — split a voice message into SEGMENT_SECS chunks at STRIDE offsets (ffmpeg, lossless stream copy).
// Output: out/<stem>/<stem>_part_NNN.ogg. Idempotent: skips if parts already exist.
const {existsSync, mkdirSync, readdirSync, statSync, unlinkSync} = require ('node:fs')
const {basename} = require ('node:path')
const {spawnSync} = require ('node:child_process')

////////////////////////////////////////////////////////////////////////////////
const OUT_DIR      = process.env.OUT_DIR || 'out'
const SEGMENT_SECS = Number (process.env.SEGMENT_SECS || 120) // 2 min: inside OpenRouter's ~60s processing timeout at whisper-large-v3 speed
const OVERLAP_SECS = Number (process.env.OVERLAP_SECS || 5)   // shared with previous chunk: keeps boundary words intact
const STRIDE = SEGMENT_SECS - OVERLAP_SECS
if (!Number.isFinite (STRIDE) || STRIDE <= 0) {
    console.error (`error: bad SEGMENT_SECS=${SEGMENT_SECS} OVERLAP_SECS=${OVERLAP_SECS} — stride must be a positive finite number`)
    process.exit (1)
}

const f = process.argv [2]
if (!f) {
    console.error ('usage: node ogg_split.js <file.ogg>')
    process.exit (1)
}
if (!existsSync (f) || !statSync (f).size) {
    console.error (`error: '${f}' missing or 0 bytes`)
    process.exit (1)
}

const stem    = basename (f).replace (/\.[^.]+$/, '')
const partDir = `${OUT_DIR}/${stem}`

const _parts = () => existsSync (partDir)
    ? readdirSync (partDir).filter (n => n.startsWith (`${stem}_part_`) && n.endsWith ('.ogg'))
    : []

if (_parts ().length) {
    console.log (`skip: parts already exist in ${partDir}`)
    process.exit (0)
}
mkdirSync (partDir, {recursive: true})

const d = spawnSync ('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f,
], {encoding: 'utf8'})
if (d.status !== 0) {
    console.error (`error: ffprobe failed for '${f}': ${String (d.stderr || d.error?.message || 'unknown').trim ()}`)
    process.exit (d.status ?? 1)
}
const duration = parseFloat (d.stdout)
if (!(duration > 0)) {
    console.error (`error: ffprobe duration failed for '${f}'`)
    process.exit (1)
}

let parts = 0
for (let start = 0; start < duration; start += STRIDE) {
    if (start && duration - start <= OVERLAP_SECS) break // tail fully inside previous chunk's overlap
    const r = spawnSync ('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-ss', String (start), '-t', String (SEGMENT_SECS), '-i', f, '-c', 'copy',
        `${partDir}/${stem}_part_${String (parts).padStart (3, '0')}.ogg`,
    ], {stdio: 'inherit'})
    if (r.status !== 0) {
        for (const p of _parts ()) unlinkSync (`${partDir}/${p}`) // no partial split left for the skip guard
        process.exit (r.status ?? 1)
    }
    parts ++
}

console.log (`split: ${f} -> ${partDir}/ (${_parts ().length} parts, ${SEGMENT_SECS}s chunks, ${STRIDE}s stride)`)
