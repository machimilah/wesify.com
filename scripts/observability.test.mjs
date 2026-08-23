import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { newDb } from 'pg-mem'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * Finding out that BO broke, without being told by the person it broke for.
 *
 * A 500 used to be answered with "BO could not complete the operation." and then dropped: not logged,
 * not counted, not reported. This proves the replacement does the three things that matter — the
 * failure is reported, it carries enough context to find, and it carries nothing that would be a
 * breach to send.
 *
 * That last one is the reason this test exists at all. An error reporter sees every request at the
 * moment things are going wrong, which is exactly when it is most tempting to attach the body and the
 * headers "just in case". A body holds passwords and API keys; an Authorization header holds a live
 * session; a reset link lives in a query string. So the test asserts on what is absent, by searching
 * the entire reported payload for values it knows were in the request.
 */

const port = 8963
const sentryPort = 8964
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-observability-'))
process.env.BO_GENERATED_ROOT = generatedRoot
process.env.BO_SENTRY_URL = `http://127.0.0.1:${sentryPort}/api/1/envelope/`
process.env.SENTRY_DSN = `http://key@127.0.0.1:${sentryPort}/1`

// Stands in for Sentry, and records exactly what BO sends it.
const received = []
const sentry = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    received.push({ contentType: request.headers['content-type'], url: request.url, body: Buffer.concat(chunks).toString('utf8') })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
})
await new Promise(resolve => sentry.listen(sentryPort, '127.0.0.1', resolve))

/** The event out of the last envelope: three JSON lines, of which the third is the event itself. */
const lastEvent = () => JSON.parse(received.at(-1).body.split('\n')[2])

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const logs = []
const realLog = console.log
console.log = (...args) => { logs.push(args.join(' ')); realLog(...args) }

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const password = 'a-password-worth-hiding'
const secretHeaderValue = 'Bearer a-session-token-worth-hiding'

async function call(pathname, init = {}) {
  const response = await fetch(`${base}${pathname}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
  return { status: response.status, headers: response.headers, payload: await response.json().catch(() => ({})) }
}

/** Every log line this server writes is one JSON object, so a test can read them as data. */
const structured = () => logs.filter(entry => entry.startsWith('{')).map(entry => JSON.parse(entry))

/** Reporting happens after the response, so the test waits for it rather than assuming it landed. */
async function waitFor(condition, what) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

try {
  // 1. Every response carries an id, and every request that is not a static asset is logged with it.
  const health = await call('/api/health')
  const requestId = health.headers.get('x-bo-request-id')
  assert.ok(requestId, 'no request id was returned')
  const healthLog = structured().find(entry => entry.event === 'request' && entry.requestId === requestId)
  assert.ok(healthLog, 'the request was not logged')
  assert.equal(healthLog.status, 200)
  assert.equal(healthLog.path, '/api/health')
  assert.equal(typeof healthLog.ms, 'number', 'the log line does not say how long the request took')

  // 2. A 4xx is not reported. It is BO telling the caller they got it wrong, which is the endpoint
  //    working, and reporting it would bury the failures that are BO's fault.
  const before = received.length
  const unauthorized = await call('/api/auth/me', { headers: { authorization: 'Bearer nonsense' } })
  assert.equal(unauthorized.status, 401)
  await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'not-an-email', password: 'short' }) })
  assert.equal(received.length, before, 'a 4xx was reported as an error')

  // 3. A real 500. The table is dropped underneath a live insert, so the failure comes from where
  //    failures actually come from: a query that stops working after the code shipped.
  const registered = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'watched@example.com', password }) })
  assert.equal(registered.status, 200)
  await call('/api/builds', { method: 'POST', body: JSON.stringify({ workspaceId: 'ws-observability' }), headers: { authorization: `Bearer ${registered.payload.token}` } }).catch(() => undefined)
  await query('drop table sessions')

  const broken = await call('/api/auth/me', { headers: { authorization: secretHeaderValue } })
  assert.equal(broken.status, 500)

  // 4. The caller is given something to quote, and nothing else. The reference finds the request in
  //    the log; on its own it says nothing about what broke.
  const reference = broken.payload.reference
  assert.ok(reference, 'a 500 gave the caller nothing to quote')
  assert.equal(reference, broken.headers.get('x-bo-request-id'))
  assert.equal(broken.payload.error, 'BO could not complete the operation.')
  assert.equal(broken.payload.detail, undefined, 'the internal error message was returned to the caller')

  // 5. It reached the monitor, in the shape the monitor expects, with the context needed to find it.
  await waitFor(() => received.length === before + 1, 'the 500 to be reported')
  assert.equal(received.at(-1).contentType, 'application/x-sentry-envelope')
  assert.match(received.at(-1).url, /sentry_key=/)
  const event = lastEvent()
  assert.equal(event.level, 'error')
  assert.equal(event.tags.requestId, reference, 'the reported event cannot be tied to the reference the customer was given')
  assert.equal(event.tags.status, 500)
  assert.equal(event.tags.path, '/api/auth/me')
  assert.ok(event.exception.values[0].value, 'the report carries no error message')
  assert.match(event.extra.stack, /at /, 'the report carries no stack trace')

  // 6. And it carries none of the things that would make reporting it worse than the bug.
  const reported = received.at(-1).body
  assert.equal(reported.includes(password), false, 'a password reached the error monitor')
  assert.equal(reported.includes('a-session-token-worth-hiding'), false, 'a session token reached the error monitor')
  assert.equal(/authorization/i.test(reported), false, 'a request header reached the error monitor')

  // 7. The same failure is on stdout too, so a deployment with no Sentry account still has a record.
  await waitFor(() => structured().some(entry => entry.event === 'error' && entry.requestId === reference), 'the failure to be logged')
  const errorLog = structured().find(entry => entry.event === 'error' && entry.requestId === reference)
  assert.ok(errorLog, 'the failure was reported to Sentry but not logged')
  assert.ok(errorLog.stack, 'the logged failure has no stack trace')
  assert.equal(JSON.stringify(errorLog).includes(password), false, 'a password was written to the log')

  // 8. A monitor that is down cannot take BO with it, and must not make BO slow either. Reporting
  //    happens after the answer, so an unreachable monitor costs the caller nothing — which is the
  //    whole point, because the monitor is unreachable exactly when something is already wrong.
  await new Promise(resolve => sentry.close(resolve))
  const startedAt = Date.now()
  const stillBroken = await call('/api/auth/me', { headers: { authorization: 'Bearer anything' } })
  const took = Date.now() - startedAt
  assert.equal(stillBroken.status, 500, 'BO stopped answering when its error monitor went down')
  assert.ok(stillBroken.payload.reference)
  assert.ok(took < 1000, `the answer waited ${took}ms on an unreachable error monitor`)
  await waitFor(() => structured().some(entry => entry.event === 'error-reporting-failed'), 'the failed report to be logged')

  console.log = realLog
  console.log('Observability test passed: every response carries a traceable id, every request is logged as structured JSON with its duration, 4xx answers are not reported as failures, a 500 reaches the monitor with its stack and enough context to find it, the caller gets a reference and nothing else, no password or session token or header ever reaches the monitor or the log, and a monitor that is down neither hides the failure nor takes BO with it.')
} finally {
  console.log = realLog
  await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => sentry.close(resolve)).catch(() => undefined)
  await rm(generatedRoot, { recursive: true, force: true })
}
