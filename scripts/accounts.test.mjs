import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import { useTestClerk, tokenFor } from './clerkStub.mjs'
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
// Clerk stands in as the identity provider; everything below the seam — the account row, the
// workspace, the membership — is the real thing. See clerkStub.mjs.
useTestClerk()
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

  // 2. Wesify no longer takes credentials of its own. Everything Clerk owns is gone from the API, and
  //    gone loudly rather than left as a route that quietly does nothing.
  for (const route of ['register', 'login', 'logout', 'forgot', 'reset']) {
    const removed = await call(`/api/auth/${route}`, { method: 'POST', body: { email: 'owner@example.com', password: 'a-long-enough-password' } })
    assert.equal(removed.status, 405, `/api/auth/${route} still answers, so Wesify still has a way to take a password`)
  }

  // 3. A token Clerk refuses names nobody.
  assert.equal((await call('/api/auth/me', { token: 'forged-token' })).status, 401, 'a forged token was accepted')

  // 4. Who am I. The first request from a Clerk session is also what creates the Wesify account.
  const ownerToken = tokenFor('user_owner')
  assert.equal((await call('/api/auth/me')).status, 401, 'an unauthenticated caller was told who they are')
  const me = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.equal(me.user.id, 'user_owner')
  assert.deepEqual(me.workspaces, [], 'a new account should not own anything yet')

  // 5. Using a workspace claims it for the signed-in account.
  const workspaceId = 'ws-owned-by-owner'
  const claimed = await call(`/api/discovery/sessions/${workspaceId}`, { token: ownerToken, workspaceId })
  assert.equal(claimed.status, 200, `an owner could not reach their own workspace: ${await claimed.text()}`)
  const after = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.equal(after.workspaces.length, 1, 'using a workspace did not record who it belongs to')
  assert.equal(after.workspaces[0].id, workspaceId)
  assert.equal(after.workspaces[0].role, 'owner')

  // The database membership, not a role header chosen by the browser, authorizes workspace actions.
  const specification = {
    version: 1, id: workspaceId,
    profile: { companyName: 'Role Test', description: 'Role authorization test', industry: 'Services', goals: [], terminology: {} },
    modules: ['customers'], capabilities: [],
    entities: [{ id: 'customers', label: 'Client', pluralLabel: 'Clients', module: 'customers', primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }],
    views: [{ id: 'customers-table', label: 'Clients', entityId: 'customers', type: 'table', columns: ['name'] }],
    navigation: [{ id: 'home', label: 'Home', kind: 'home' }, { id: 'customers', label: 'Clients', kind: 'entity', viewId: 'customers-table', module: 'customers' }],
    metrics: [], workflows: [],
    roles: [{ id: 'owner', label: 'Owner', permissions: ['admin'] }, { id: 'employee', label: 'Employee', permissions: ['view'] }],
  }
  const built = await call('/api/builds', { method: 'POST', token: ownerToken, workspaceId, body: { workspaceId, specification } })
  assert.equal(built.status, 201, `role test workspace did not build: ${await built.text()}`)
  const memberToken = tokenFor('user_member')
  await call('/api/auth/me', { token: memberToken })
  await query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [workspaceId, 'user_member', 'employee'])
  assert.equal((await call(`/api/projects/${workspaceId}/records/customers`, { token: memberToken, workspaceId })).status, 200, 'an employee could not read records')
  const forgedOwner = await call(`/api/projects/${workspaceId}/records/customers`, { method: 'POST', token: memberToken, workspaceId, body: { name: 'Unauthorized' } })
  assert.equal(forgedOwner.status, 403, 'an employee promoted their request by sending x-bo-role: owner')
  const promoted = await call(`/api/projects/${workspaceId}/members/user/user_member`, { method: 'PATCH', token: ownerToken, workspaceId, body: { role: 'manager' } })
  assert.equal(promoted.status, 200, `the owner could not change a member role: ${await promoted.text()}`)
  assert.equal((await query('select role from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, 'user_member'])).rows[0].role, 'manager')
  const forgedAdministrator = await call(`/api/projects/${workspaceId}/members/user/user_member`, { method: 'PATCH', token: memberToken, workspaceId, body: { role: 'admin' } })
  assert.equal(forgedAdministrator.status, 403, 'a member changed their own server-assigned role')
  const demotedOwner = await call(`/api/projects/${workspaceId}/members/user/user_owner`, { method: 'PATCH', token: ownerToken, workspaceId, body: { role: 'employee' } })
  assert.equal(demotedOwner.status, 409, 'the workspace owner could be demoted through member management')

  // 6. The rule. A different signed-in account cannot reach it, however it asks.
  const strangerToken = tokenFor('user_stranger')
  const intruderRead = await call(`/api/discovery/sessions/${workspaceId}`, { token: strangerToken, workspaceId })
  assert.equal(intruderRead.status, 403, `a stranger read someone else's workspace (${intruderRead.status})`)
  const intruderWrite = await call(`/api/discovery/sessions/${workspaceId}`, { method: 'PUT', token: strangerToken, workspaceId, body: { messages: [] } })
  assert.equal(intruderWrite.status, 403, 'a stranger wrote to someone else’s workspace')
  const intruderConnections = await call(`/api/connections/${workspaceId}`, { token: strangerToken, workspaceId })
  assert.equal(intruderConnections.status, 403, 'a stranger listed someone else’s connected apps')

  // 7. No session at all is refused, and the old self-issued token no longer buys anything.
  assert.equal((await call(`/api/discovery/sessions/${workspaceId}`, { workspaceId })).status, 401)
  const forged = await fetch(`${base}/api/discovery/sessions/${workspaceId}`, {
    headers: { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': 'x'.repeat(40) },
  })
  assert.equal(forged.status, 401, 'a self-issued workspace token still granted access once accounts exist')

  // 8. Signing out is Clerk's to do, and what it means here is that the token stops verifying. A
  //    token that no longer verifies reaches nothing, including a workspace it reached a moment ago.
  assert.equal((await call(`/api/discovery/sessions/${workspaceId}`, { token: 'test:', workspaceId })).status, 401)

  // 9. A later session for the same person reaches the same workspace: the account owns it, not the
  //    browser and not the token. This is the whole point of accounts.
  assert.equal((await call(`/api/discovery/sessions/${workspaceId}`, { token: tokenFor('user_owner'), workspaceId })).status, 200, 'signing back in lost the workspace')

  console.log('Accounts test passed: no credential routes left on the API, forged tokens refused, a workspace claimed by the account that first uses it, strangers refused on read and write, self-issued tokens worthless, and the same workspace reachable from a later session of the same account.')
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
