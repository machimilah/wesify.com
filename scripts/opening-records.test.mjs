import './noSpend.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The workspace opens holding what the operator already said.
 *
 * Somebody answers "one supplier, five regular shops, thirty days to pay" and then used to be handed
 * empty tables and a button saying "Add your first client" — every fact they had just given sitting
 * in a transcript and nowhere in the software. This covers the replacement, and the two ways it can
 * go wrong: nothing recorded at all, or something recorded that nobody said.
 */

const geminiPort = 8957
const apiPort = 8958
const workspaceId = 'opening-records-workspace-1'

const specification = {
  version: 1,
  id: workspaceId,
  profile: { name: 'Iberia Import', industry: 'Food import', description: 'We sell Uruguayan and Argentinian products to Spanish shops.', archetype: 'distribution' },
  modules: ['customers', 'procurement'],
  entities: [
    {
      id: 'customers', label: 'Shop', pluralLabel: 'Shops', module: 'customers', primaryField: 'name',
      fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'city', label: 'City', type: 'text' }, { id: 'email', label: 'Email', type: 'email' }],
    },
    {
      id: 'suppliers', label: 'Supplier', pluralLabel: 'Suppliers', module: 'procurement', primaryField: 'name',
      fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'country', label: 'Country', type: 'text' }],
    },
  ],
  views: [{ id: 'customers-list', label: 'Shops', entityId: 'customers', type: 'table' }, { id: 'suppliers-list', label: 'Suppliers', entityId: 'suppliers', type: 'table' }],
  navigation: [{ id: 'customers', label: 'Shops', viewId: 'customers-list' }, { id: 'suppliers', label: 'Suppliers', viewId: 'suppliers-list' }],
  metrics: [], workflows: [],
  // The owner role, because reading the workspace back is an authorized act like any other.
  roles: [{ id: 'owner', label: 'Owner', permissions: ['admin'] }],
}

const session = {
  workspaceId, conversationId: 'c1', projectId: '', phase: 'AWAITING_APPROVAL', architectureVersion: 1,
  businessState: {
    companySummary: 'Importer selling Uruguayan and Argentinian products in Spain', industry: 'Food import',
    facts: [], businessModel: [], productsOrServices: [], customers: ['Five regular shops'], revenueModel: [], team: [],
    operations: [], resources: [], locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: [],
    knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
  },
  messages: [
    { id: 'u1', role: 'user', content: 'We sell Uruguayan and Argentinian products to the Spanish market.', createdAt: new Date().toISOString() },
    { id: 'a1', role: 'assistant', content: 'Who do you buy from, and who buys from you?', createdAt: new Date().toISOString() },
    { id: 'u2', role: 'user', content: 'One supplier, Frigorifico Tacuarembo, and about five regular shops in Madrid.', createdAt: new Date().toISOString() },
  ],
  currentQuestion: null, architecture: null,
  metrics: { discoveryTurns: 2, questionsAsked: 2, architectureEdits: 0, architectureApproved: false, startedAt: new Date().toISOString(), approvedAt: '' },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

/** What a recorder should come back with: named things named, counted things counted, nothing else. */
const proposal = {
  summary: 'I put in the supplier you named and the five Madrid shops you mentioned. Rename the shops as you go.',
  records: [
    { entityId: 'suppliers', label: 'Frigorifico Tacuarembo', values: [{ field: 'country', value: 'Uruguay' }], because: 'You said you buy from Frigorifico Tacuarembo.' },
    ...[1, 2, 3, 4, 5].map(number => ({ entityId: 'customers', label: `Shop ${number}`, values: [{ field: 'city', value: 'Madrid' }], because: 'You said about five regular shops in Madrid.' })),
    // Everything below must be dropped by the server: an entity this workspace does not have, a
    // field nobody defined, and an email address the operator never gave.
    { entityId: 'invoices', label: 'Invoice 1', values: [], because: 'invented entity' },
    { entityId: 'customers', label: '', values: [{ field: 'vat_number', value: 'ESB123' }], because: 'invented field' },
  ],
}

let seen = null
const gemini = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  seen = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(proposal) }] }, finishReason: 'STOP' }] }))
})
await new Promise(resolve => gemini.listen(geminiPort, '127.0.0.1', resolve))

const workingDirectory = await mkdtemp(path.join(tmpdir(), 'bo-opening-'))
const env = {
  ...process.env,
  GEMINI_API_KEY: 'gemini-mock-key',
  GEMINI_BASE_URL: `http://127.0.0.1:${geminiPort}`,
  BO_GENERATED_ROOT: path.join(workingDirectory, 'generated-projects'),
}
const api = spawn(process.execPath, [path.resolve('server/index.mjs'), '--port', String(apiPort)], { cwd: workingDirectory, env, stdio: 'pipe' })
api.stderr.on('data', chunk => process.stderr.write(chunk))
if (process.env.BO_DEBUG) api.stdout.on('data', chunk => process.stdout.write(chunk))
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the project service.')
}

// The same self-issued workspace token the browser sends. Without accounts it is what proves the
// caller is the one who created this workspace.
const token = 'openingrecordstoken'.repeat(2)
const access = { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': token, 'x-bo-role': 'owner', 'content-type': 'application/json' }
const post = (path, payload) => fetch(`http://127.0.0.1:${apiPort}${path}`, { method: 'POST', headers: access, body: JSON.stringify(payload) })
const get = path => fetch(`http://127.0.0.1:${apiPort}${path}`, { headers: access })

try {
  // The interview is stored server-side, which is the only reason the build can read it back.
  const stored = await fetch(`http://127.0.0.1:${apiPort}/api/discovery/sessions/${workspaceId}`, {
    method: 'PUT', headers: access, body: JSON.stringify(session),
  })
  assert.equal(stored.status, 200, 'The interview could not be saved.')

  const built = await post('/api/builds', { workspaceId, specification, changeDescription: 'Initial Command Center' })
  assert.equal(built.status, 201, `The build failed: ${await built.text()}`)

  const records = await (await get(`/api/projects/${workspaceId}/records`)).json()

  // What they named is there under the name they used.
  const suppliers = records.suppliers ?? []
  assert.equal(suppliers.length, 1, `Expected the one supplier they named, saw ${suppliers.length}.`)
  assert.equal(suppliers[0].name, 'Frigorifico Tacuarembo')
  assert.equal(suppliers[0].country, 'Uruguay')

  // What they counted is there as that many rows, as placeholders rather than invented businesses.
  const shops = records.customers ?? []
  assert.equal(shops.length, 5, `Expected five shops from "about five regular shops", saw ${shops.length}.`)
  assert.ok(shops.every(shop => shop.city === 'Madrid'), 'The city they gave was not kept.')
  assert.ok(shops.every(shop => /^Shop \d$/.test(shop.name)), `A shop name was invented: ${shops.map(shop => shop.name).join(', ')}`)

  // And nothing else. An entity this workspace does not have, a field nobody defined, and any
  // contact detail nobody gave are all dropped rather than stored.
  assert.equal(records.invoices, undefined, 'A record was written to an entity this workspace does not have.')
  assert.ok(!shops.some(shop => !shop.name), 'A row with nothing in it but an undefined field was stored anyway.')
  assert.ok(!JSON.stringify(records).includes('vat_number'), 'An undefined field reached storage.')
  assert.ok(!JSON.stringify(records).includes('@'), 'BO invented a contact detail nobody gave it.')

  // The operator is told what was put in and why, inside the workspace, in their own words.
  const notifications = await (await get(`/api/projects/${workspaceId}/notifications`)).json()
  assert.ok(notifications.some(item => item.message.includes('five Madrid shops')), `The workspace does not say what BO recorded: ${JSON.stringify(notifications)}`)

  // The recorder was given the interview and the workspace's own field names, or it is guessing.
  const prompt = seen?.contents?.[0]?.parts?.[0]?.text ?? ''
  assert.ok(prompt.includes('Frigorifico Tacuarembo'), 'The recorder was not told what the operator said.')
  assert.ok(prompt.includes('primaryField') || prompt.includes('Name field'), 'The recorder was not told what the workspace can hold.')

  // Building again must not re-add rows somebody has since deleted.
  const before = JSON.stringify(await (await get(`/api/projects/${workspaceId}/records`)).json())
  await post('/api/builds', { workspaceId, specification: { ...specification, profile: { ...specification.profile, description: 'A second description to force a rebuild.' } }, changeDescription: 'Rebuild' })
  const after = JSON.stringify(await (await get(`/api/projects/${workspaceId}/records`)).json())
  assert.equal(before, after, 'A rebuild wrote the opening records a second time.')

  console.log('Opening records test passed: the workspace opens with the supplier they named and the shops they counted, nothing they did not say, a note explaining what was recorded, and no repeat on rebuild.')
} finally {
  api.kill()
  gemini.close()
  await rm(workingDirectory, { recursive: true, force: true })
}
