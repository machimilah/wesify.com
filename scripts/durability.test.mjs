import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * Everything a workspace is made of survives the machine it was made on.
 *
 * Records moved to Postgres in migration 002 and industry knowledge in 005. Two things were left on
 * the local disk that Render, Railway, Fly and Vercel wipe on every redeploy, and they were the two
 * halves of what the operator actually cared about: the interview that produced the workspace, and
 * the description of what the workspace is. Every record could survive while the meaning of those
 * records — which table, which fields, which pages — did not.
 *
 * This runs the real server against an in-memory Postgres, the way records.test.mjs does.
 */

const port = 8961
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-durability-'))
process.env.BO_GENERATED_ROOT = generatedRoot

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const workspaceId = 'ws-durability-test'

// With a database configured, BO requires an account for every workspace route — the token-only path
// is the no-infrastructure fallback, not a second way in. So this signs up the way an operator does.
const registered = await fetch(`${base}/api/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'durable@example.com', password: 'a-long-enough-password' }),
})
const owner = await registered.json()
if (!owner.token) throw new Error(`Could not create an account: ${JSON.stringify(owner)}`)
const access = { 'x-bo-workspace-id': workspaceId, authorization: `Bearer ${owner.token}`, 'x-bo-role': 'owner', 'content-type': 'application/json' }

const entities = [{
  id: 'customers', label: 'Client', pluralLabel: 'Clients', module: 'customers', primaryField: 'name',
  fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
}]
const specification = {
  version: 1, id: workspaceId,
  profile: { companyName: 'Durable Co', description: 'A company for testing that nothing is left on local disk.', archetype: 'generic', industry: 'Testing' },
  modules: ['customers'], capabilities: [], entities,
  views: [{ id: 'customers-table', label: 'Clients', entityId: 'customers', type: 'table', columns: ['name'] }],
  navigation: [{ id: 'home', label: 'Dashboard', kind: 'home' }, { id: 'customers', label: 'Clients', kind: 'entity', viewId: 'customers-table', module: 'customers' }],
  metrics: [], workflows: [],
  roles: [{ id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'admin'] }],
}

const session = {
  workspaceId, conversationId: 'c1', projectId: '', phase: 'AWAITING_APPROVAL', architectureVersion: 1,
  businessState: {
    companySummary: 'A company for testing durability', industry: 'Testing', facts: [], businessModel: [], productsOrServices: [],
    customers: [], revenueModel: [], team: [], operations: [], resources: [], locations: [], currentTools: [], painPoints: [],
    goals: [], knownEntities: [], knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
  },
  messages: [{ id: 'u1', role: 'user', content: 'We test whether BO forgets things when the disk is wiped.', createdAt: new Date().toISOString() }],
  currentQuestion: null, architecture: null,
  metrics: { discoveryTurns: 1, questionsAsked: 1, architectureEdits: 0, architectureApproved: false, startedAt: new Date().toISOString(), approvedAt: '' },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

try {
  // 1. The interview is a row, not a file.
  const saved = await fetch(`${base}/api/discovery/sessions/${workspaceId}`, { method: 'PUT', headers: access, body: JSON.stringify(session) })
  assert.equal(saved.status, 200, 'The interview could not be saved.')
  const rows = await query('select session from discovery_sessions where workspace_id = $1', [workspaceId])
  assert.equal(rows.rows.length, 1, 'The interview did not reach Postgres.')
  assert.equal(rows.rows[0].session.messages[0].content, session.messages[0].content)

  const read = await (await fetch(`${base}/api/discovery/sessions/${workspaceId}`, { headers: access })).json()
  assert.equal(read.workspaceId, workspaceId, 'The interview did not come back out of Postgres.')

  // 2. The build — what this workspace *is* — is a row too.
  const built = await fetch(`${base}/api/builds`, { method: 'POST', headers: access, body: JSON.stringify({ workspaceId, specification, changeDescription: 'Initial Command Center' }) })
  assert.equal(built.status, 201, `The build failed: ${await built.text()}`)
  const builds = await query('select version, manifest from workspace_builds where workspace_id = $1', [workspaceId])
  assert.equal(builds.rows.length, 1, 'The build did not reach Postgres.')
  assert.equal(builds.rows[0].manifest.specification.entities[0].id, 'customers', 'The stored build does not describe the workspace.')

  // 3. The workspace row exists and belongs to the person who built it, so its records can too.
  const created = await fetch(`${base}/api/projects/${workspaceId}/records/customers`, { method: 'POST', headers: access, body: JSON.stringify({ name: 'First client' }) })
  assert.equal(created.status, 201, `The workspace could not hold a record: ${await created.text()}`)
  const stored = await query('select owner_id from workspaces where id = $1', [workspaceId])
  assert.equal(stored.rows[0].owner_id, owner.user.id, 'The workspace is not owned by the account that built it.')

  // 4. And the disk holds nothing that only the disk holds. Generated code stays — it is regenerable
  //    output — but the interview must not be sitting in a file that a redeploy deletes.
  const onDisk = await readdir(path.join(generatedRoot, '.discovery-sessions')).catch(() => [])
  assert.deepEqual(onDisk, [], `The interview was also written to disk: ${onDisk.join(', ')}`)

  // 5. What a redeploy actually looks like: the disk is gone, the database is not.
  await rm(path.join(generatedRoot, workspaceId), { recursive: true, force: true })
  const afterWipe = await (await fetch(`${base}/api/projects/${workspaceId}`, { headers: access })).json()
  assert.equal(afterWipe.workspaceId, workspaceId, 'A wiped disk left the workspace undescribable.')
  assert.equal(afterWipe.specification.entities[0].id, 'customers', 'The recovered build does not describe the workspace.')
  const survivingRecords = await (await fetch(`${base}/api/projects/${workspaceId}/records`, { headers: access })).json()
  assert.equal((survivingRecords.customers ?? []).length, 1, 'The records did not survive the wipe.')

  console.log('Durability test passed: the interview and the build are rows in Postgres, the workspace belongs to the account that built it, nothing is left in a session file, and a wiped disk still opens the workspace with its records intact.')
} finally {
  server.close()
  await rm(generatedRoot, { recursive: true, force: true })
}
