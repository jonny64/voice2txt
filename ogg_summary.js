#!/usr/bin/env node
// ogg_summary.js <in/file.ogg> — build out/<stem>/<stem>_summary.txt («Поднимаемые вопросы», lines "[MM:SS] Вопрос?").
// Requires every part .ogg to have a .txt (run ogg2txt.js first). Idempotent: skips if summary exists.
const {existsSync, readdirSync, readFileSync, writeFileSync} = require ('node:fs')
const {basename, join} = require ('node:path')

////////////////////////////////////////////////////////////////////////////////
// provider constants — swap here to change endpoint/key/model
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
const API_KEY  = process.env.OPENROUTER_API_KEY
const MODEL    = process.env.SUM_MODEL            || 'z-ai/glm-5.3-flash'
////////////////////////////////////////////////////////////////////////////////
const OUT_DIR     = process.env.OUT_DIR || 'out'
const MAX_TIME_MS = 300_000
const RETRIES     = 3
const PROMPT_FILE = join (__dirname, 'ogg_summary_prompt.txt')

const _sleep = ms => new Promise (r => setTimeout (r, ms))

main ().catch (err => {
    console.error (`error: ${err.message}`)
    process.exit (1)
})

async function main () {

    if (!API_KEY) throw new Error ('OPENROUTER_API_KEY not set')
    const f = process.argv [2]
    if (!f) throw new Error ('usage: node ogg_summary.js <file.ogg>')
    if (!existsSync (PROMPT_FILE)) throw new Error (`${PROMPT_FILE} missing`)

    const stem    = basename (f).replace (/\.[^.]+$/, '')
    const partDir = `${OUT_DIR}/${stem}`
    const out     = join (partDir, `${stem}_summary.txt`)
    if (existsSync (out)) {
        console.log (`skip: ${out} exists`)
        return
    }

    const oggs = existsSync (partDir)
        ? readdirSync (partDir).filter (n => n.startsWith (`${stem}_part_`) && n.endsWith ('.ogg')).sort ()
        : []
    const txts = existsSync (partDir)
        ? readdirSync (partDir).filter (n => n.startsWith (`${stem}_part_`) && n.endsWith ('.txt')).sort ()
        : []
    if (!oggs.length) throw new Error (`no parts in ${partDir} — run ogg_split.js first`)
    if (txts.length !== oggs.length) throw new Error (`${txts.length}/${oggs.length} parts transcribed — finish ogg2txt.js first`)

    const transcript = txts.map (t => readFileSync (join (partDir, t), 'utf8')).join ('\n')
    const system     = readFileSync (PROMPT_FILE, 'utf8')

    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
            const ctrl  = new AbortController ()
            const timer = setTimeout (() => ctrl.abort (), MAX_TIME_MS)
            const resp  = await fetch (`${BASE_URL}/chat/completions`, {
                method:  'POST',
                headers: {Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json'},
                body:    JSON.stringify ({
                    model:    MODEL,
                    messages: [
                        {role: 'system', content: system},
                        {role: 'user',   content: transcript},
                    ],
                }),
                signal: ctrl.signal,
            })
            clearTimeout (timer)
            const body = await resp.text ()
            let j = null
            try { j = JSON.parse (body) }
            catch (err) { /* non-JSON error body */ }
            const text = j?.choices?.[0]?.message?.content
            if (!resp.ok || !text) throw new Error (`http=${resp.status} ${body.slice (0, 200)}`)

            writeFileSync (out, text.trimEnd () + '\n')
            console.log (`summary: ${out} (${j.usage?.total_tokens ?? '?'} tokens)`)
            return
        }
        catch (err) {
            console.error (`attempt ${attempt} failed: ${err.message}`)
            if (attempt < RETRIES) await _sleep (2 ** attempt * 1000)
        }
    }
    process.exit (1)

}
