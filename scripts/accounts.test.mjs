import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * With accounts configured, a workspace belongs to somebody.
 *
 * `auth.test.mjs` proves the account primitives. This proves the rule that actually protects data:
 * that the routes ask who is calling, and that a signed-in stranger is refused a workspace they are
 * not a member of. Before accounts, presenting any token for a workspace id was enough to own it.
 *
 * The server is imported rather than spawned, so the real routes run against an in-memory Postgres.
 */

const port = 8957
process.env.BO_GENERATED_ROOT = await mkdtemp(path.join(tmpdir(), 'bo-accounts-'))

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const call = (route, { method = 'GET', token = '', workspaceId = '', body: payload } = {}) => fetch(`${base}${route}`, {
  method,
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(workspaceId ? { 'x-bo-workspace-id': workspaceId } : {}),
    'x-bo-role': 'owner',
  },
  body: payload ? JSON.stringify(payload) : undefined,
})

try {
  // 1. Wesify says whether it has accounts at all, so the interface never guesses.
  assert.equal((await (await call('/api/health')).json()).accounts, true)

  // 2. Signing up returns a session token exactly once.
  const registered = await call('/api/auth/register', { method: 'POST', body: { email: 'owner@example.com', password: 'a-long-enough-password' } })
  assert.equal(registered.status, 200)
  const owner = await registered.json()
  assert.ok(owner.token, 'no session token was issued')
  assert.equal(owner.user.email, 'owner@example.com')
  assert.ok(!JSON.stringify(owner.user).includes('password'), 'the account response carried a password field')

  // 3. A weak password is refused before an account exists.
  const weak = await call('/api/auth/register', { method: 'POST', body: { email: 'weak@example.com', password: 'short' } })
  assert.equal(weak.status, 400)

  // 4. Who am I.
  assert.equal((await call('/api/auth/me')).status, 401, 'an unauthenticated caller was told who they are')
  const me = await (await call('/api/auth/me', { token: owner.token })).json()
  assert.equal(me.user.email, 'owner@example.com')
  assert.deepEqual(me.workspaces, [], 'a new account should not own anything yet')

  // 5. Using a workspace claims it for the signed-in account.
  const workspaceId = 'ws-owned-by-owner'
  const claimed = await call(`/api/discovery/sessions/${workspaceId}`, { token: owner.token, workspaceId })
  assert.equal(claimed.status, 200, `an owner could not reach their own workspace: ${await claimed.text()}`)
  const after = await (await call('/api/auth/me', { token: owner.token })).json()
  assert.equal(after.workspaces.length, 1, 'using a workspace did not record who it belongs to')
  assert.equal(after.workspaces[0].id, workspaceId)
  assert.equal(after.workspaces[0].role, 'owner')

  // 6. The rule. A different signed-in account cannot reach it, however it asks.
  const other = await (await call('/api/auth/register', { method: 'POST', body: { email: 'stranger@example.com', password: 'another-long-password' } })).json()
  const intruderRead = await call(`/api/discovery/sessions/${workspaceId}`, { token: other.token, workspaceId })
  assert.equal(intruderRead.status, 403, `a stranger read someone else's workspace (${intruderRead.status})`)
  const intruderWrite = await call(`/api/discovery/sessions/${workspaceId}`, { method: 'PUT', token: other.token, workspaceId, body: { messages: [] } })
  assert.equal(intruderWrite.status, 403, 'a stranger wrote to someone else’s workspace')
  const intruderConnections = await call(`/api/connections/${workspaceId}`, { token: other.token, workspaceId })
  assert.equal(intruderConnections.status, 403, 'a stranger listed someone else’s connected apps')

  // 7. No session at all is refused, and the old self-issued token no longer buys anything.
  assert.equal((await call(`/api/discovery/sessions/${workspaceId}`, { workspaceId })).status, 401)
  const forged = await fetch(`${base}/api/discovery/sessions/${workspaceId}`, {
    headers: { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': 'x'.repeat(40) },
  })
  assert.equal(forged.status, 401, 'a self-issued workspace token still granted access once accounts exist')

  // 8. Signing out ends the session everywhere it was accepted.
  await call('/api/auth/logout', { method: 'POST', token: owner.token })
  assert.equal((await call('/api/auth/me', { token: owner.token })).status, 401, 'the session survived signing out')
  assert.equal((await call(`/api/discovery/sessions/${workspaceId}`, { token: owner.token, workspaceId })).status, 401)

  // 9. Signing back in reaches the same workspace: the account owns it, not the browser.
  const back = await (await call('/api/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: 'a-long-enough-password' } })).json()
  assert.equal((await call(`/api/discovery/sessions/${workspaceId}`, { token: back.token, workspaceId })).status, 200, 'signing back in lost the workspace')

  console.log('Accounts test passed: sessions issued once, weak passwords refused, a workspace claimed by the account that first uses it, strangers refused on read and write, self-issued tokens worthless, sign-out honoured, and the same workspace reachable from a new sign-in.')
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
