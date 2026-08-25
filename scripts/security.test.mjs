import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate } from '../server/db.mjs'
import { safeWebhookUrl } from '../server/automations.mjs'
import './noSpend.mjs'

/**
 * The defences that are invisible until the day they are not there.
 *
 * `auth.test.mjs` covers passwords and sessions. This covers the rest of the surface: what every
 * response tells a browser, what Wesify refuses to be pointed at, how much a stranger can make it hold
 * in memory, and whether a failure ever hands back something it should not.
 *
 * These are exactly the checks that get skipped because nothing visibly depends on them, and are
 * exactly the ones nobody notices are missing until they are being exploited.
 */

const port = 8967
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-security-'))
process.env.BO_GENERATED_ROOT = generatedRoot
delete process.env.SENTRY_DSN

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${port}`

try {
  // 1. Every response carries the headers, not just the ones somebody remembered.
  const expected = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  }
  // A success, a refusal and a not-found: a header set only on the happy path is not set.
  for (const pathname of ['/api/health', '/api/auth/me', '/api/nothing-here']) {
    const response = await fetch(`${base}${pathname}`)
    for (const [header, value] of Object.entries(expected)) {
      assert.equal(response.headers.get(header), value, `${pathname} is missing ${header}`)
    }
    const policy = response.headers.get('content-security-policy') ?? ''
    assert.match(policy, /default-src 'self'/, `${pathname} has no content security policy`)
    assert.match(policy, /frame-ancestors 'none'/)
    assert.match(policy, /object-src 'none'/)
    // The one allowance that would matter: scripts must never be allowed inline, because that is
    // what turns any injected string into running code.
    assert.equal(/script-src[^;]*'unsafe-inline'/.test(policy), false, 'the policy allows inline script')
    assert.equal(/script-src[^;]*'unsafe-eval'(?!-)/.test(policy), false, 'the policy allows eval')
  }

  // The browser model needs these three, and a policy tightened without noticing would break the
  // no-API-key path silently — the path where Wesify still works for someone with no account anywhere.
  const policy = (await fetch(`${base}/api/health`)).headers.get('content-security-policy')
  for (const needed of ["'wasm-unsafe-eval'", 'worker-src', 'blob:']) {
    assert.ok(policy.includes(needed), `the policy would break the in-browser model: no ${needed}`)
  }

  // 2. Wesify will not be pointed at things only Wesify can reach. A server that POSTs to any URL it is
  //    given is a way into a private network from outside it.
  const refused = [
    'http://example.com/hook',                    // not https
    'https://user:pass@example.com/hook',         // credentials in the URL
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://[::1]/hook',
    'https://10.0.0.5/hook',                      // private range
    'https://192.168.1.10/hook',
    'https://172.16.4.2/hook',
    'https://169.254.169.254/latest/meta-data/',   // the cloud metadata endpoint, the classic target
    'https://[fd00::1]/hook',                      // unique-local v6
    'https://[fe80::1]/hook',                      // link-local v6
    'https://[::ffff:10.0.0.1]/hook',              // a private v4 address spelled as v6
    'https://0.0.0.0/hook',
    'https://printer.local/hook',
    'https://db.internal/hook',
    'not-a-url',
    '',
  ]
  for (const candidate of refused) {
    assert.throws(() => safeWebhookUrl(candidate), /HTTPS|allowed|valid/, `Wesify accepted a webhook target it should refuse: ${candidate}`)
  }
  assert.equal(safeWebhookUrl('https://hook.example.com/abc'), 'https://hook.example.com/abc', 'a legitimate webhook target was refused')

  // 3. A stranger cannot make Wesify hold as much memory as they feel like sending.
  // `connection: close` so the socket this deliberately breaks is not handed to the next request.
  const oversized = await fetch(`${base}/api/builds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ workspaceId: 'ws-oversized', padding: 'x'.repeat(3_000_000) }),
  }).catch(() => null)
  // Refused, or the connection dropped mid-upload. What must not happen is acceptance — and what
  // must not happen either is a 500, which would be Wesify calling the sender's fault its own and
  // waking the error monitor every time somebody pasted something large.
  assert.notEqual(oversized?.status, 200, 'Wesify accepted a three megabyte request body')
  if (oversized) assert.equal(oversized.status, 413, `an oversized body answered ${oversized.status} rather than 413`)

  // 4. A failure says nothing about how Wesify is built. A stack trace or a SQL error in a response is a
  //    map of the inside of the server, handed to whoever asked for it.
  const broken = await fetch(`${base}/api/builds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })
  const detail = JSON.stringify(await broken.json())
  assert.equal(broken.status, 400)
  for (const leak of ['node_modules', 'at Object', '.mjs:', 'M:\\\\', 'select ', 'password_hash']) {
    assert.equal(detail.includes(leak), false, `an error response leaked internals: ${leak}`)
  }

  /**
   * 5. This suite cannot spend money, and proves it rather than assuming it.
   *
   * `noSpend.mjs` blanks the API key so the frontier path reports itself unavailable. The static
   * check in structure.test.mjs proves every suite imports it; this proves importing it actually
   * works — including through `server/env.mjs`, which re-reads `.env.local` in every process and
   * would otherwise hand the key straight back.
   */
  const research = await (await fetch(`${base}/api/research/status`)).json()
  assert.equal(research.available, false, 'the test suite is configured to call the real API, which costs real money')

  // 6. The workspace routes refuse a request with no identity at all, before doing any work.
  for (const [method, pathname] of [['GET', '/api/projects/ws-any'], ['POST', '/api/builds'], ['GET', '/api/connections/ws-any']]) {
    const response = await fetch(`${base}${pathname}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
    assert.ok([401, 403].includes(response.status), `${method} ${pathname} answered ${response.status} to a request with no session`)
  }

  console.log('Security test passed: every response carries its headers on success, refusal and not-found alike, the content policy allows no inline script or eval while still permitting the in-browser model, webhook targets on private networks and the cloud metadata endpoint are refused, an oversized body is not accepted, a failure leaks no stack or SQL, workspace routes refuse a request carrying no identity, and the suite itself cannot reach a paid API.')
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(generatedRoot, { recursive: true, force: true })
}
