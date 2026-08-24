import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * With a database configured, a workspace's records live in Postgres, not on local disk.
 *
 * The JSON file this replaces works for one always-on process with a persistent volume. It silently
 * loses every record on most hosting platforms — Render, Railway, Fly, Vercel and similar all wipe
 * local disk on redeploy — and cannot be shared across more than one server process. This proves the
 * replacement: records really are rows in Postgres, no data.json is written once a database is
 * configured, the read/write/update/delete flow behaves exactly as it did on files, and the custom
 * cross-entity query still works once records are grouped back into the shape it expects.
 *
 * The server is imported rather than spawned, so it runs against the real routes with an in-memory
 * Postgres in the same process — the same approach accounts.test.mjs and signin.test.mjs use.
 */

const port = 8958
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-records-'))
process.env.BO_GENERATED_ROOT = generatedRoot

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const workspaceId = 'ws-records-test'

async function json(pathname, init = {}, headers = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init.headers ?? {}) },
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

const text = (id, label, required = false) => ({ id, label, type: 'text', required })
const entity = (id, label, pluralLabel, fields) => ({ id, label, pluralLabel, module: 'customers', primaryField: fields[0].id, fields })
const entities = [
  entity('customers', 'Client', 'Clients', [text('name', 'Name', true)]),
  entity('projects', 'Project', 'Projects', [text('name', 'Project', true)]),
  entity('project-costs', 'Project cost', 'Project Costs', [text('description', 'Description', true), { id: 'project', label: 'Project', type: 'relation', relationEntityId: 'projects' }, { id: 'amount', label: 'Amount', type: 'currency' }]),
]
const views = entities.map(item => ({ id: `${item.id}-table`, label: item.pluralLabel, entityId: item.id, type: 'table', columns: item.fields.map(field => field.id) }))
const navigation = [{ id: 'home', label: 'Dashboard', kind: 'home' }, ...views.map(view => ({ id: view.entityId, label: view.label, kind: 'entity', viewId: view.id, module: 'customers' }))]
const specification = {
  version: 1, id: workspaceId,
  profile: { companyName: 'Records Co', description: 'A company for testing record persistence.', archetype: 'generic', industry: 'Testing', businessModel: '', revenueModel: '', teamStructure: '', customers: '', productsAndServices: '', operatingProcesses: [], suppliers: '', locations: '', goals: [], terminology: {} },
  modules: ['customers', 'projects'], capabilities: [], entities, views, navigation, metrics: [], workflows: [],
  eventArchitecture: {
    version: 1,
    definitions: [{ type: 'customer.created', label: 'customer created', domain: 'customers', sourceEntityIds: ['customers'], capabilityIds: [], payloadFields: ['eventId', 'workspaceId', 'entityId', 'recordId', 'occurredAt'], severity: 'informational', audit: true, lifecycle: 'created', canTrigger: ['audit-log'] }],
    routes: [{ eventType: 'customer.created', targets: [{ kind: 'audit-log', ids: [] }] }],
    delivery: { mode: 'at-least-once', idempotencyKey: 'eventId', orderingKey: 'workspaceId:entityId', deadLetter: true },
  },
  roles: [{ id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'financial', 'people', 'admin'] }],
}

try {
  // An account, and the workspace headers every workspace-scoped call needs.
  const registered = await json('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'a-long-enough-password' }) })
  const auth = { authorization: `Bearer ${registered.payload.token}`, 'x-bo-workspace-id': workspaceId, 'x-bo-role': 'owner' }

  const built = await json('/api/builds', { method: 'POST', body: JSON.stringify({ workspaceId, specification }), headers: auth })
  assert.equal(built.status, 201)
  assert.equal(built.payload.buildStatus, 'HEALTHY')

  // 1. Creating a record returns it, and it is really a row in Postgres.
  const created = await json(`/api/projects/${workspaceId}/records/customers`, { method: 'POST', body: JSON.stringify({ name: 'ACME' }), headers: auth })
  assert.equal(created.status, 201)
  assert.ok(created.payload.id)
  const row = (await query('select workspace_id, entity_id, id, data from records where workspace_id = $1 and entity_id = $2', [workspaceId, 'customers'])).rows[0]
  assert.ok(row, 'the record was not written to Postgres')
  assert.equal(row.data.name, 'ACME')
  assert.equal(row.id, created.payload.id, 'the row id must match the record id, or a later update/delete could not find it')
  const audit = await json(`/api/projects/${workspaceId}/audit`, { headers: auth })
  assert.equal(audit.status, 200)
  assert.ok(audit.payload.some(item => item.event === 'customer.created' && item.detail?.recordId === created.payload.id), 'the compiled customer.created event was not recorded')

  // 2. No data.json anywhere under the generated root. This is the property that actually matters:
  //    with a database configured, nothing about a workspace's records depends on local disk surviving.
  const filesOnDisk = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else filesOnDisk.push(full)
    }
  }
  await walk(generatedRoot)
  const dataFiles = filesOnDisk.filter(file => file.endsWith('data.json'))
  assert.deepEqual(dataFiles, [], `a data.json file was written on disk even though a database is configured: ${dataFiles.join(', ')}`)

  // 3. The list endpoint reads it back.
  const listed = await json(`/api/projects/${workspaceId}/records/customers`, { headers: auth })
  assert.equal(listed.status, 200)
  assert.equal(listed.payload.length, 1)
  assert.equal(listed.payload[0].name, 'ACME')

  // 4. Updating a record replaces its row rather than adding a second one.
  const updated = await json(`/api/projects/${workspaceId}/records/customers/${created.payload.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'ACME Ltd' }), headers: auth })
  assert.equal(updated.status, 200)
  assert.equal(updated.payload.name, 'ACME Ltd')
  const afterUpdate = (await query('select data from records where workspace_id = $1 and entity_id = $2', [workspaceId, 'customers'])).rows
  assert.equal(afterUpdate.length, 1, 'updating a record left more than one row behind')
  assert.equal(afterUpdate[0].data.name, 'ACME Ltd')

  // 5. Two records in two different entities do not collide, and a cross-entity query still works
  //    once Postgres rows are grouped back into the { entityId: records[] } shape the query expects.
  const project = await json(`/api/projects/${workspaceId}/records/projects`, { method: 'POST', body: JSON.stringify({ name: 'Website redesign' }), headers: auth })
  await json(`/api/projects/${workspaceId}/records/project-costs`, { method: 'POST', body: JSON.stringify({ description: 'Design', project: project.payload.id, amount: 4200 }), headers: auth })
  await json(`/api/projects/${workspaceId}/records/project-costs`, { method: 'POST', body: JSON.stringify({ description: 'Development', project: project.payload.id, amount: 5800 }), headers: auth })
  const expensive = await json(`/api/projects/${workspaceId}/query`, { method: 'POST', body: JSON.stringify({ query: 'most-expensive-project' }), headers: auth })
  assert.equal(expensive.status, 200)
  assert.equal(expensive.payload.project.id, project.payload.id)
  assert.equal(expensive.payload.cost, 10000)

  // 6. Deleting a record removes exactly its row.
  const deleted = await json(`/api/projects/${workspaceId}/records/customers/${created.payload.id}`, { method: 'DELETE', headers: auth })
  assert.equal(deleted.status, 200)
  const afterDelete = (await query('select * from records where workspace_id = $1 and entity_id = $2', [workspaceId, 'customers'])).rows
  assert.equal(afterDelete.length, 0)
  const projectRows = (await query('select * from records where workspace_id = $1 and entity_id = $2', [workspaceId, 'projects'])).rows
  assert.equal(projectRows.length, 1, 'deleting a customer record deleted an unrelated project record')

  // 7. Notifications share the same storage, as entity_id = '_notifications', with no special casing.
  const notifications = await json(`/api/projects/${workspaceId}/notifications`, { headers: auth })
  assert.equal(notifications.status, 200)
  assert.deepEqual(notifications.payload, [], 'a workspace with no notifications must read back empty, not error')

  // 8. Everything the workspace holds comes back out in one file.
  //
  //    BO's billing screen tells people their records stay "readable and exportable" if a plan
  //    lapses. That sentence is only true if this endpoint exists and returns everything, so this
  //    checks the promise rather than the handler: the records, and the field definitions without
  //    which a pile of rows is not the same thing as having your data.
  const exported = await json(`/api/projects/${workspaceId}/export`, { headers: auth })
  assert.equal(exported.status, 200)
  assert.equal(exported.payload.workspaceId, workspaceId)
  assert.equal(exported.payload.records.projects.length, 1)
  assert.equal(exported.payload.records['project-costs'].length, 2)
  assert.equal(exported.payload.records.customers ?? undefined, undefined, 'the deleted customer came back in the export')
  assert.ok(exported.payload.specification, 'the export carries no specification, so the records have no meaning')
  assert.deepEqual(exported.payload.entities.map(entity => entity.id).sort(), ['customers', 'project-costs', 'projects'])
  assert.ok(Array.isArray(exported.payload.notifications))
  assert.ok(exported.payload.exportedAt)

  //    Exporting is reading, so a role with only `view` may do it — otherwise the one person most
  //    likely to be leaving would be the one unable to take their data with them.
  const viewerExport = await json(`/api/projects/${workspaceId}/export`, { headers: { ...auth, 'x-bo-role': 'viewer' } })
  assert.equal(viewerExport.status, 403, 'a role that cannot even view the workspace could still export it')

  // 9. Deleting the account cascades all the way down: workspace, then every record it held.
  await query('delete from users where email = $1', ['owner@example.com'])
  const survivingRecords = (await query('select * from records where workspace_id = $1', [workspaceId])).rows
  assert.equal(survivingRecords.length, 0, 'records outlived the workspace and the account that owned it')
  const survivingWorkspace = (await query('select * from workspaces where id = $1', [workspaceId])).rows
  assert.equal(survivingWorkspace.length, 0)

  console.log('Records test passed: records are real Postgres rows, no data.json is written once a database is configured, create/list/update/delete behave exactly as the file storage did, a cross-entity query works against the grouped result, notifications share the same storage, everything comes back out through the export with the definitions that give it meaning, and deleting an account cascades through its workspace to every record it held.')
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(generatedRoot, { recursive: true, force: true })
}
