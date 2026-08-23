import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guards on the shape of the codebase, not its behaviour.
 *
 * server/index.mjs reached 929 lines one honest feature at a time — three more handlers each time,
 * never worth stopping for, until reading any single endpoint meant scrolling past all the others.
 * Splitting it was a day's work that a few months of the same drift would quietly undo.
 *
 * So the limit is a test now. A file crossing it fails the build on the commit that crossed it,
 * when splitting is ten minutes, rather than on the day somebody finally cannot stand it.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = /\.(mjs|ts|tsx)$/
const SKIP = new Set(['node_modules', 'dist', '.git', 'generated-projects', 'coverage', '.attic'])
/** Generated tables and the capability catalog are data: nobody reads them top to bottom. */
const GENERATED = /naics\.generated\.ts$|capabilityCatalog\.ts$/
const SELF = 'scripts/structure.test.mjs'

function sourceFiles(directory) {
  return readdirSync(directory).flatMap(entry => {
    if (SKIP.has(entry)) return []
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return SOURCE.test(entry) ? [full] : []
  })
}

const files = sourceFiles(root).map(file => {
  const text = readFileSync(file, 'utf8')
  return { file: path.relative(root, file).replaceAll('\\', '/'), lines: text.split('\n').length, text }
})
// This file names the patterns it looks for, so it would always match itself.
const others = files.filter(item => item.file !== SELF)

// A broken directory walk must fail rather than pass by finding nothing.
assert.ok(files.length > 40, `only found ${files.length} source files, so this guard is not looking where it thinks`)

const oversized = files.filter(item => !GENERATED.test(item.file) && item.lines > 800).map(item => `${item.file} (${item.lines} lines)`)
assert.deepEqual(oversized, [], 'split these before adding to them')

// A route module is a surface, not a program. Past this it holds logic that belongs somewhere it
// can be tested without a request.
const fatRoutes = files.filter(item => item.file.startsWith('server/routes/') && item.lines > 400).map(item => `${item.file} (${item.lines} lines)`)
assert.deepEqual(fatRoutes, [], 'a route module this large is holding logic that belongs elsewhere')

// Not style policing: a TODO is a decision deferred silently, and whoever reads it next cannot tell
// whether it is a note or a landmine.
const marked = others.filter(item => /\b(TODO|FIXME|HACK|XXX)\b/.test(item.text)).map(item => item.file)
assert.deepEqual(marked, [], 'unfinished-work markers in shipped code')

// Deliberately fake fixtures are allowed — stripe.test.mjs holds a live-shaped key precisely to
// prove BO refuses one. What is looked for is a credential with real entropy.
const obviouslyFake = /(abcdef|12345678|pretend|example|placeholder|xxxx)/i
const suspicious = others.filter(item => {
  const found = item.text.match(/(sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|sk-ant-[A-Za-z0-9-]{12,}|postgres:\/\/[^\s'"]*:[^\s'"@]+@)/g) ?? []
  return found.some(value => !obviouslyFake.test(value))
}).map(item => item.file)
assert.deepEqual(suspicious, [], 'a credential belongs in the environment, never in a file')

// Every route module must be wired into the server, or it is dead code that reads as live code.
const registered = readFileSync(path.join(root, 'server/index.mjs'), 'utf8')
for (const item of files.filter(candidate => candidate.file.startsWith('server/routes/'))) {
  assert.ok(registered.includes(path.basename(item.file)), `${item.file} is not imported by server/index.mjs`)
}

/**
 * No test may spend the operator's money.
 *
 * The suites run the real server, and the server reaches for a frontier model whenever a key is
 * configured. The day a real ANTHROPIC_API_KEY appeared in .env.local, every browser suite that
 * reached the build screen started making real research calls — Opus, thinking, web search — and
 * nothing failed, nothing looked different, and the only signal was the bill.
 *
 * So each suite must either drop the key (scripts/noSpend.mjs) or point the client at its own stub
 * (ANTHROPIC_BASE_URL). One of the two, never neither.
 */
const suites = files.filter(item => /^scripts\/[^/]+\.mjs$/.test(item.file) && item.file !== SELF && !item.file.endsWith('/browser.mjs') && !item.file.endsWith('/noSpend.mjs'))
const spenders = suites
  .filter(item => /server\/index\.mjs|\.\.\/server\//.test(item.text))
  .filter(item => !item.text.includes('noSpend.mjs') && !item.text.includes('ANTHROPIC_BASE_URL'))
  .map(item => item.file)
assert.deepEqual(spenders, [], 'these suites would call the real API if a key is configured')

console.log(`Structure test passed: ${files.length} source files, none over 800 lines, no route module over 400, every route module wired into the server, no unfinished-work markers, no credential-shaped literal committed, and no suite that would spend real money on a live API key.`)
