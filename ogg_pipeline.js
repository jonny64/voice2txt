#!/usr/bin/env node
// ogg_pipeline.js [file.ogg ...] — run split -> transcribe -> summarize per file.
// No args: every *.ogg/*.oga in IN_DIR. Per-file failures don't stop the batch.
const {existsSync, readdirSync, statSync} = require ('node:fs')
const {join} = require ('node:path')
const {spawnSync} = require ('node:child_process')

////////////////////////////////////////////////////////////////////////////////
const IN_DIR = process.env.IN_DIR || 'in'

let files = process.argv.slice (2)
if (!files.length) {
    files = existsSync (IN_DIR)
        ? readdirSync (IN_DIR).filter (n => /\.(ogg|oga)$/i.test (n)).map (n => join (IN_DIR, n))
        : []
}
if (!files.length) {
    console.log (`no input files in ${IN_DIR}`)
    process.exit (0)
}

const _run = (script, f) =>
    spawnSync (process.execPath, [join (__dirname, script), f], {stdio: 'inherit'}).status === 0

let ok = 0
const failed = []
for (const f of files) {
    if (!existsSync (f) || !statSync (f).size) {
        console.log (`skip (empty): ${f}`)
        continue
    }
    console.log (`=== ${f}`)
    if (_run ('ogg_split.js', f) && _run ('ogg2txt.js', f) && _run ('ogg_summary.js', f)) ok++
    else failed.push (f)
}

console.log (`=== done: ok=${ok} failed=${failed.length}${failed.length ? ' : ' + failed.join (', ') : ''}`)
process.exit (failed.length ? 1 : 0)
