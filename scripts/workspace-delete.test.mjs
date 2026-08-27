import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import { useTestClerk, tokenFor } from './clerkStub.mjs'
import './noSpend.mjs'

/**
 * Deleting a workspace really deletes it.
 *
 * The dashboard offers this beside the workspace it names, and an operator who chooses it is owed
 * the whole thing: the records, the interview, the business profile and everything it was made of,
 * the operating graph, the history, every version Wesify built, and the folder on disk. A deletion
 * that leaves any of those behind is worse than none — the workspace disappears from the list while
 * the data it held is still there.
 *
 * Several of those are checked especially. `discovery_sessions`, `workspace_builds` and
 * `business_profile` carry a workspace id with no foreign key behind them, deliberately — they exist
 * before a workspace belongs to anybody — so nothing cascades into them and they have to be deleted
 * by name.
 *
 * The server is imported rather than spawned, so the real routes run against an in-memory Postgres.
 */

const port = 8961
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-delete-'))
process.env.BO_GENERATED_ROOT = generatedRoot

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
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

const exists = async target => {
  try { await access(target); return true } catch { return false }
}

const workspaceId = 'ws-delete-test'
const specification = {
  version: 1, id: workspaceId,
  profile: { companyName: 'Deletable', description: 'A workspace built to be deleted', industry: 'Services', goals: [], terminology: {} },
  modules: ['customers'], capabilities: [],
  entities: [{ id: 'customers', label: 'Client', pluralLabel: 'Clients', module: 'customers', primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }],
  views: [{ id: 'customers-table', label: 'Clients', entityId: 'customers', type: 'table', columns: ['name'] }],
  navigation: [{ id: 'home', label: 'Home', kind: 'home' }, { id: 'customers', label: 'Clients', kind: 'entity', viewId: 'customers-table', module: 'customers' }],
  metrics: [], workflows: [],
  roles: [{ id: 'owner', label: 'Owner', permissions: ['admin'] }, { id: 'employee', label: 'Employee', permissions: ['view'] }],
}

try {
  const ownerToken = tokenFor('user_owner')
  await call('/api/auth/me', { token: ownerToken })

  // A workspace with everything a real one has: a build, a record, an interview, a business profile,
  // the dimensions that profile is made of, an operating graph, a setting and a history.
  const built = await call('/api/builds', { method: 'POST', token: ownerToken, workspaceId, body: { workspaceId, specification } })
  assert.equal(built.status, 201, `the workspace did not build: ${await built.text()}`)
  const written = await call(`/api/projects/${workspaceId}/records/customers`, { method: 'POST', token: ownerToken, workspaceId, body: { name: 'Northwind' } })
  assert.equal(written.status, 201, `a record could not be written: ${await written.text()}`)
  await call(`/api/discovery/sessions/${workspaceId}`, { method: 'PUT', token: ownerToken, workspaceId, body: { messages: [] } })

  await query('insert into business_profile (workspace_id, industry, revenue_model) values ($1, $2, $3)', [workspaceId, 'Distribution', 'Invoice on delivery'])
  await query('insert into business_dimensions (workspace_id, dimension, id, label) values ($1, $2, $3, $4)', [workspaceId, 'location', 'madrid', 'Madrid warehouse'])
  await query('insert into workspace_settings (workspace_id, key, value) values ($1, $2, $3)', [workspaceId, 'theme', JSON.stringify('dark')])
  await query('insert into operating_nodes (workspace_id, id, kind, label) values ($1, $2, $3, $4), ($1, $5, $3, $6)', [workspaceId, 'order', 'entity', 'Order', 'invoice', 'Invoice'])
  await query('insert into operating_edges (workspace_id, id, from_node, to_node, flow) values ($1, $2, $3, $4, $5)', [workspaceId, 'order-invoice', 'order', 'invoice', 'order-to-cash'])
  await query('insert into event_history (id, workspace_id, actor_type, actor_id, action) values ($1, $2, $3, $4, $5)', ['ev-1', workspaceId, 'ai', 'discovery-agent', 'profile.updated'])

  assert.equal((await query('select 1 from records where workspace_id = $1', [workspaceId])).rows.length, 1, 'the test wrote no record to delete')
  assert.ok((await query('select 1 from workspace_builds where workspace_id = $1', [workspaceId])).rows.length, 'the test built nothing to delete')
  assert.ok(await exists(path.join(generatedRoot, workspaceId)), 'the workspace has no folder on disk')

  // 1. A stranger cannot delete somebody else's workspace, however they ask.
  const strangerToken = tokenFor('user_stranger')
  await call('/api/auth/me', { token: strangerToken })
  const intruder = await call(`/api/projects/${workspaceId}`, { method: 'DELETE', token: strangerToken, workspaceId })
  assert.equal(intruder.status, 403, `a stranger deleted someone else's workspace (${intruder.status})`)

  // 2. Nor can any other signed-in account, however it describes itself. There is no membership to
  //    grant, so there is no role short of owner that could ever reach this.
  const otherToken = tokenFor('user_member')
  await call('/api/auth/me', { token: otherToken })
  const otherAccount = await call(`/api/projects/${workspaceId}`, { method: 'DELETE', token: otherToken, workspaceId })
  assert.equal(otherAccount.status, 403, 'an account that does not own the workspace deleted it')
  assert.equal((await query('select 1 from workspaces where id = $1', [workspaceId])).rows.length, 1, 'a refused deletion still removed the workspace')

  // 3. The owner deletes it, and everything it held goes with it.
  const deleted = await call(`/api/projects/${workspaceId}`, { method: 'DELETE', token: ownerToken, workspaceId })
  assert.equal(deleted.status, 200, `the owner could not delete their own workspace: ${await deleted.text()}`)

  // Every table that can hold something belonging to a workspace, named one at a time. A table added
  // later and forgotten here is a table that quietly keeps a deleted company's data.
  for (const table of ['records', 'discovery_sessions', 'business_profile', 'business_dimensions', 'workspace_settings', 'workspace_builds', 'operating_nodes', 'operating_edges', 'event_history']) {
    const left = await query(`select 1 from ${table} where workspace_id = $1`, [workspaceId])
    assert.equal(left.rows.length, 0, `${table} still holds rows for a deleted workspace`)
  }
  assert.equal(await exists(path.join(generatedRoot, workspaceId)), false, 'the deleted workspace still has its files on disk')

  // The one row that outlives the workspace, holding nothing but the fact that this id is spent.
  const tombstone = (await query('select name, logo, deleted_at from workspaces where id = $1', [workspaceId])).rows[0]
  assert.ok(tombstone?.deleted_at, 'a deleted workspace left no tombstone, so its id can be claimed all over again')
  assert.equal(tombstone.name, '', 'a tombstone kept the company name')
  assert.equal(tombstone.logo, '', 'a tombstone kept the logo')

  // 4. It is gone from the account that owned it, which is the list the dashboard draws.
  const remaining = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.deepEqual(remaining.workspaces, [], 'a deleted workspace is still listed on the account')

  // 5. The reason the tombstone exists. Mentioning the id again used to claim it exactly like a
  //    brand new workspace, so a tab left open on the deleted workspace, or any retry, brought it
  //    back — empty, owned, and in the list. Every way back in is refused now.
  for (const [route, method, body] of [
    ['/api/discovery/sessions/', 'GET', undefined],
    ['/api/discovery/sessions/', 'PUT', { messages: [] }],
    ['/api/projects/', 'GET', undefined],
    ['/api/builds', 'POST', { workspaceId, specification }],
  ]) {
    const target = route === '/api/builds' ? route : `${route}${workspaceId}`
    const revived = await call(target, { method, token: ownerToken, workspaceId, body })
    assert.equal(revived.status, 410, `${method} ${target} brought a deleted workspace back (${revived.status})`)
  }
  const stillEmpty = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.deepEqual(stillEmpty.workspaces, [], 'a deleted workspace came back into the account list')

  // 6. Deleting what is already deleted is not an error worth showing anybody. It cannot ask who is
  //    calling — the membership that authorized the first deletion went with it — so it answers the
  //    only true thing there is to say.
  const again = await call(`/api/projects/${workspaceId}`, { method: 'DELETE', token: ownerToken, workspaceId })
  assert.equal(again.status, 200, `deleting an already-deleted workspace failed: ${await again.text()}`)

  // 7. A different workspace is untouched by any of it: this deletes one thing, not a category.
  const survivorId = 'ws-not-deleted'
  await call(`/api/discovery/sessions/${survivorId}`, { token: ownerToken, workspaceId: survivorId })
  const survivors = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.deepEqual(survivors.workspaces.map(workspace => workspace.id), [survivorId], 'deleting one workspace disturbed another')

  // 8. The bug an operator actually hit. Deleting used to go through the same door as using a
  //    workspace, and that door claims an unclaimed id — which costs a workspace against the plan.
  //    So an account at its limit, holding several workspaces that only ever existed in its browser,
  //    was told to upgrade in order to delete one. A quota quoted at somebody trying to get under it.
  const localOnlyId = 'ws-local-only'
  const atTheLimit = await call(`/api/projects/${localOnlyId}`, { method: 'DELETE', token: ownerToken, workspaceId: localOnlyId })
  assert.equal(atTheLimit.status, 200, `an account at its plan limit could not delete an unclaimed workspace: ${await atTheLimit.text()}`)
  const untouched = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.deepEqual(untouched.workspaces.map(workspace => workspace.id), [survivorId], 'deleting an unclaimed workspace changed what the account owns')
  assert.equal((await query('select 1 from workspaces where id = $1', [localOnlyId])).rows.length, 0, 'deleting an unclaimed workspace created one')

  console.log('Workspace delete test passed: strangers and other accounts refused, the owner allowed, the records, interview, business profile, dimensions, settings, operating graph, history, builds and files all gone with it, and the id refused to every way back in, with no plan limit standing in the way.')
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(generatedRoot, { recursive: true, force: true })
}
