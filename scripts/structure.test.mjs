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
// prove Wesify refuses one. What is looked for is a credential with real entropy.
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
 * So each suite must either drop the keys (scripts/noSpend.mjs) or point a provider at its own stub
 * (ANTHROPIC_BASE_URL, GEMINI_BASE_URL). One of the two, never neither. A suite that stubs one
 * provider and holds its key configures the provider Wesify prefers, so the other is never reached.
 */
// Helpers rather than suites: they are imported *by* the suites, which is where the rule belongs.
const helpers = ['/browser.mjs', '/noSpend.mjs', '/clerkStub.mjs']
const suites = files.filter(item => /^scripts\/[^/]+\.mjs$/.test(item.file) && item.file !== SELF && !helpers.some(helper => item.file.endsWith(helper)))
const spenders = suites
  .filter(item => /server\/index\.mjs|\.\.\/server\//.test(item.text))
  .filter(item => !item.text.includes('noSpend.mjs') && !item.text.includes('ANTHROPIC_BASE_URL') && !item.text.includes('GEMINI_BASE_URL'))
  .map(item => item.file)
assert.deepEqual(spenders, [], 'these suites would call the real API if a key is configured')

/**
 * A suite that stubs one provider must pin that provider.
 *
 * Wesify now has two, and it picks between them from the environment — including `.env.local`, which is
 * loaded in every child process. So a developer holding a Gemini key had `interview.test.mjs` quietly
 * ignore its Anthropic stub, spend real free-tier quota, and fail on a question it never asked for.
 * Stubbing a base URL is only half the instruction; the other half is saying which provider to use.
 */
const unpinned = suites
  .filter(item => item.text.includes('ANTHROPIC_BASE_URL') && item.text.includes('server/index.mjs'))
  .filter(item => !item.text.includes('BO_INTERVIEW_PROVIDER'))
  .map(item => item.file)
assert.deepEqual(unpinned, [], 'these suites stub one provider but let the environment choose another')

/**
 * Every server import has to exist inside the image that runs the server.
 *
 * The runtime stage of the Dockerfile copies `server` and the built `dist`, and nothing else — so a
 * server module that reaches into `src/` resolves perfectly on a laptop, where the whole repo is
 * present, and cannot resolve at all in the container. The first time one did, nothing caught it:
 * every suite passed, the image built, and the failure appeared as a container dying in CI with
 * ERR_MODULE_NOT_FOUND. This reads the Dockerfile rather than hard-coding what it copies, so adding
 * a COPY line is all it takes to legitimise a new shared file.
 */
const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
const runtimeStage = dockerfile.slice(dockerfile.indexOf('AS runtime'))
const shipped = [...runtimeStage.matchAll(/^COPY\s+(?!--from)(.+)$/gm)]
  .flatMap(match => match[1].trim().split(/\s+/).slice(0, -1))
  .map(item => item.replace(/\*$/, '').replace(/\\/g, '/'))

/**
 * Anchored to the start of a line, because Wesify writes code as well as running it.
 *
 * `project-builder.mjs` emits a generated self-test whose source text contains
 * `import { selfTest } from '../runtime.mjs'`. A regex looking anywhere for `from '...'` reads that
 * string as an import of the builder itself and reports a file that does not exist. A real import
 * statement begins its own line; a quoted one inside a template literal does not.
 */
const importsOf = text => [
  // `import x from './y'`, `export * from './y'` — one line, so the match cannot run past its own
  // statement. A pattern allowed to cross lines walks from `export const BUILD_STATES = …` all the
  // way to the next quoted `from` it can find, which is exactly the generated string above.
  ...[...text.matchAll(/^(?:import|export)\s[^\n]*?\sfrom\s+'([^']+)'/gm)].map(match => match[1]),
  // The braced form, which may span lines — bounded by the closing brace rather than by hope.
  ...[...text.matchAll(/^(?:import|export)\s*\{[^}]*\}\s*from\s+'([^']+)'/gm)].map(match => match[1]),
  // A side-effect import: `import './env.mjs'`.
  ...[...text.matchAll(/^import\s+'([^']+)'/gm)].map(match => match[1]),
].filter(specifier => specifier.startsWith('.'))

const escapes = []
for (const item of files.filter(candidate => candidate.file.startsWith('server/'))) {
  for (const specifier of importsOf(item.text)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(item.file), specifier))
    if (shipped.some(entry => resolved === entry || resolved.startsWith(`${entry}/`))) continue
    escapes.push(`${item.file} -> ${specifier}`)
  }
}
assert.deepEqual(escapes, [], 'these server imports are not copied into the runtime image, so the container cannot start')

/**
 * No frontend call may assume the API is on the same origin.
 *
 * It is, on a laptop and in the container — one process serves both. It is not on a static host,
 * where the interface is a CDN and the server lives somewhere that can hold a process. A bare
 * '/api/...' fetch works in every place it is developed and fails only in that deployment, where it
 * lands on the CDN and comes back as the index page. apiUrl() is the one place that decides, so a
 * call site that skips it is the bug, not the deployment.
 */
const sameOrigin = files
  .filter(item => item.file.startsWith('src/') && !item.file.endsWith('apiBase.ts') && !item.file.includes('.test.'))
  .flatMap(item => [...item.text.matchAll(/fetch\(\s*['"`](\/api\/[^'"`]*)/g)].map(match => `${item.file} -> ${match[1]}`))
assert.deepEqual(sameOrigin, [], 'these calls hard-code the API onto the current origin; route them through apiUrl()')

console.log(`Structure test passed: ${files.length} source files, none over 800 lines, no route module over 400, every route module wired into the server, no unfinished-work markers, no credential-shaped literal committed, and no suite that would spend real money on a live API key.`)
