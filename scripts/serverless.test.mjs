import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import './noSpend.mjs'

/**
 * BO's API answering the way a serverless platform calls it.
 *
 * Vercel does not run `server/index.mjs`; it invokes a function with the same `(request, response)`
 * pair Node's http server passes, so `api/[...path].mjs` is an adapter over the real router rather
 * than a second server. What this covers is the part of that platform which is not a Node server:
 *
 * - The body may already have been read. Vercel's Node runtime parses JSON into `request.body` and
 *   leaves the stream drained, so a handler that only iterates the stream sees every POST as empty —
 *   a build with no specification, an interview turn with no conversation, and no error to explain it.
 * - There is no listener, so nothing proves the routing works except calling it directly.
 *
 * The request is a real Readable and the response a real ServerResponse-shaped object, so this is the
 * router under test rather than a mock of it.
 */

const workingDirectory = await mkdtemp(path.join(tmpdir(), 'bo-serverless-'))
process.env.BO_GENERATED_ROOT = path.join(workingDirectory, 'generated')

const { handleRequest } = await import('../server/index.mjs')

/** A Vercel-shaped request: a stream, plus the parsed body it may already have consumed. */
function request({ method = 'GET', url = '/', headers = {}, body, parsed }) {
  const stream = Readable.from(parsed === undefined && body ? [Buffer.from(body)] : [])
  return Object.assign(stream, {
    method,
    url,
    headers: { host: 'bo.vercel.app', ...headers },
    ...(parsed === undefined ? {} : { body: parsed }),
  })
}

/** Captures what the handler wrote, the way the platform serialises it back to the caller. */
function response() {
  const chunks = []
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    getHeader(name) { return this.headers[String(name).toLowerCase()] },
    writeHead(status, headers = {}) {
      this.statusCode = status
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
      return this
    },
    end(chunk) { if (chunk) chunks.push(chunk); this.finished = true },
    get text() { return Buffer.concat(chunks.map(item => Buffer.isBuffer(item) ? item : Buffer.from(String(item)))).toString('utf8') },
    get json() { try { return JSON.parse(this.text) } catch { return null } },
  }
}

const call = async options => {
  const answer = response()
  await handleRequest(request(options), answer)
  return answer
}

try {
  // 1. Routing works with no server listening — the adapter really is the router.
  const health = await call({ url: '/api/health' })
  assert.equal(health.statusCode, 200, `health did not answer: ${health.text}`)
  assert.equal(health.json.status, 'healthy')

  /**
   * 2. A POST whose body the platform already parsed still arrives intact.
   *
   * The assertion has to tell "the body arrived" apart from "the body was empty", and the two are
   * only distinguishable by which refusal comes back. A turn carrying a catalog is refused for
   * having no model configured; a turn carrying nothing is refused earlier, for having no catalog.
   * An assertion loose enough to accept both passes with the fix removed — this one does not.
   */
  const turn = { mode: 'DISCOVER', conversation: [{ role: 'user', content: 'We run a bakery.' }], capabilityIds: ['crm.contacts'], modules: ['customers'] }

  const parsed = await call({ method: 'POST', url: '/api/discovery/turn', headers: { 'content-type': 'application/json' }, parsed: turn })
  assert.match(parsed.json?.error ?? '', /model/i, `the parsed body did not reach the route; BO answered: ${parsed.text}`)
  assert.doesNotMatch(parsed.json?.error ?? '', /catalog/i, 'the route saw an empty body, so the parsed body never reached it')

  // 3. And a POST that arrives as a stream, the way a normal Node server delivers it.
  const streamed = await call({ method: 'POST', url: '/api/discovery/turn', headers: { 'content-type': 'application/json' }, body: JSON.stringify(turn) })
  assert.match(streamed.json?.error ?? '', /model/i, `the streamed body did not reach the route: ${streamed.text}`)
  assert.doesNotMatch(streamed.json?.error ?? '', /catalog/i, 'the streamed body never reached the route')

  // 3b. And the distinction those two rest on is real: a request that truly carries nothing is
  //     refused for the catalog, earlier and differently.
  const empty = await call({ method: 'POST', url: '/api/discovery/turn', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.match(empty.json?.error ?? '', /catalog/i, 'an empty body was not refused for the catalog, so the check above proves nothing')

  // 4. Malformed JSON is still the caller's fault, not a 500 BO reports as its own.
  const broken = await call({ method: 'POST', url: '/api/discovery/turn', headers: { 'content-type': 'application/json' }, body: '{not json' })
  assert.equal(broken.statusCode, 400, `malformed JSON answered ${broken.statusCode}`)

  // 5. Every response carries the request id, which is what a customer quotes when reporting a fault.
  assert.ok(health.getHeader('x-bo-request-id'), 'no request id on a serverless response')

  // 6. An unknown API path is a 404 from BO rather than the index page from the CDN.
  const missing = await call({ url: '/api/nothing-here' })
  assert.equal(missing.statusCode, 404)

  console.log('Serverless test passed: the router answers without a listener, a body the platform already parsed still reaches the route, a streamed body still works, malformed JSON is still a 400, and every response carries its request id.')
} finally {
  await rm(workingDirectory, { recursive: true, force: true })
}
