import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import './noSpend.mjs'

/**
 * Reading a company out of its Odoo.
 *
 * Wesify does not run on top of an ERP — it reads one, rebuilds the operation as a workspace of its
 * own, and owns the records from then on. This covers the reading: both API dialects produce the
 * same answer, the credential never touches disk in the clear, an installed module with no records
 * in it is reported as what it is, and an incremental sync does not mistake "unchanged" for
 * "deleted" — which is the one bug in this area that would quietly condemn a company's whole dataset.
 */

const odooPort = 8975
const port = 8976
process.env.BO_GENERATED_ROOT = await mkdtemp(path.join(tmpdir(), 'bo-odoo-'))
process.env.BO_CONNECTION_SECRET = 'odoo-test-secret-odoo-test-secret'
process.env.BO_CONNECTOR_ALLOW_INSECURE_URL = '1'

/** What the fake Odoo holds. Two modules installed, one of them never used. */
const partners = [
  { id: 7, name: 'Molino Rossi', email: 'orders@molinorossi.it', write_date: '2026-08-01 09:00:00' },
  { id: 9, name: 'Cafe Verde', email: 'hola@cafeverde.es', write_date: '2026-08-02 09:00:00' },
]
const orders = [
  { id: 21, name: 'PO0001', partner_id: [7, 'Molino Rossi'], state: 'purchase', amount_total: 480.5, write_date: '2026-08-03 10:00:00' },
]
let requests = []
let dialect = 'json2'

const models = {
  'ir.module.module': [
    { id: 1, name: 'purchase', shortdesc: 'Purchase', state: 'installed' },
    { id: 2, name: 'mrp', shortdesc: 'Manufacturing', state: 'installed' },
  ],
  'res.company': [{ id: 1, name: 'Panaderia Uno', country_id: [68, 'Spain'], currency_id: [1, 'EUR'] }],
  'ir.model': [
    { id: 10, model: 'res.partner', name: 'Contact' },
    { id: 11, model: 'purchase.order', name: 'Purchase Order' },
    // Installed, described by ir.model, and holding nothing at all.
    { id: 12, model: 'mrp.production', name: 'Production Order' },
    { id: 13, model: 'x_batch_log', name: 'Batch Log' },
  ],
  'ir.model.fields': [
    { id: 100, model: 'purchase.order', name: 'name', field_description: 'Order Reference', ttype: 'char', required: true, relation: false, selection: false },
    { id: 101, model: 'purchase.order', name: 'partner_id', field_description: 'Vendor', ttype: 'many2one', required: true, relation: 'res.partner', selection: false },
    { id: 102, model: 'purchase.order', name: 'state', field_description: 'Status', ttype: 'selection', required: false, relation: false, selection: "[('draft','RFQ'),('purchase','Purchase Order'),('done','Locked')]" },
    { id: 103, model: 'purchase.order', name: 'amount_total', field_description: 'Total', ttype: 'monetary', required: false, relation: false, selection: false },
    { id: 104, model: 'purchase.order', name: 'x_studio_pallet_code', field_description: 'Pallet code', ttype: 'char', required: false, relation: false, selection: false },
    { id: 105, model: 'purchase.order', name: 'message_ids', field_description: 'Messages', ttype: 'one2many', required: false, relation: 'mail.message', selection: false },
    { id: 106, model: 'res.partner', name: 'name', field_description: 'Name', ttype: 'char', required: true, relation: false, selection: false },
    { id: 107, model: 'res.partner', name: 'email', field_description: 'Email', ttype: 'char', required: false, relation: false, selection: false },
  ],
  'res.groups': [{ id: 30, name: 'Manager', full_name: 'Purchase / Manager' }],
  'res.users': [{ id: 2, name: 'Ops' }],
}

const counts = { 'res.partner': () => partners.length, 'purchase.order': () => orders.length, 'mrp.production': () => 0, x_batch_log: () => 3 }

function rowsFor(model, kwargs) {
  if (model === 'res.partner') return applyDomain(partners, kwargs)
  if (model === 'purchase.order') return applyDomain(orders, kwargs)
  if (model === 'ir.model.fields') {
    const target = (kwargs.domain ?? []).find(item => item[0] === 'model')?.[2]
    return models['ir.model.fields'].filter(item => item.model === target)
  }
  return models[model] ?? []
}

/** Only the one operator this suite needs: `write_date > '…'`. */
function applyDomain(rows, kwargs) {
  const since = (kwargs.domain ?? []).find(item => item[0] === 'write_date' && item[1] === '>')?.[2]
  return since ? rows.filter(row => row.write_date > since) : rows
}

const odoo = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  const json2 = request.url.startsWith('/json/2/')

  if (json2 && dialect !== 'json2') { response.writeHead(404).end('{}'); return }

  if (json2) {
    const [, , , model, method] = request.url.split('/')
    requests.push({ dialect: 'json2', model, method, kwargs: payload })
    const result = method === 'search_count' ? (counts[model]?.() ?? 0) : rowsFor(model, payload)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    return
  }

  const { service, method, args } = payload.params ?? {}
  if (service === 'common' && method === 'authenticate') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', result: 4 }))
    return
  }
  const [, , , model, called, , kwargs] = args ?? []
  requests.push({ dialect: 'rpc', model, method: called, kwargs })
  const result = called === 'search_count' ? (counts[model]?.() ?? 0) : rowsFor(model, kwargs ?? {})
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', result }))
})
await new Promise(resolve => odoo.listen(odooPort, '127.0.0.1', resolve))

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const accessToken = 'odoo-test-token-odoo-test-token-99'
const workspaceId = 'ws-odoo-test'
const headers = { 'content-type': 'application/json', 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': accessToken }

const api = async (pathname, init = {}) => {
  const response = await fetch(`${base}${pathname}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  return { status: response.status, payload: await response.json().catch(() => ({})) }
}

const credential = { url: `http://127.0.0.1:${odooPort}`, db: 'acme-prod', login: 'ops@acme.com', apiKey: 'odoo-api-key-value' }
const connect = (body = credential) => api(`/api/connections/${workspaceId}/odoo`, { method: 'POST', body: JSON.stringify(body) })

// The connect form is public, and describes only shapes.
const providers = await (await fetch(`${base}/api/connections/providers`)).json()
const odooProvider = providers.find(item => item.id === 'odoo')
assert.ok(odooProvider, 'the registry should offer Odoo')
assert.equal(odooProvider.introspects, true, 'Odoo has a company structure to read')
assert.deepEqual(odooProvider.credentialFields.map(field => field.id), ['url', 'db', 'login', 'apiKey'])
assert.ok(!JSON.stringify(providers).includes('odoo-api-key-value'), 'the provider list carries shapes, never values')

// An unknown app is a 404 from the registry, not a crash.
assert.equal((await api(`/api/connections/${workspaceId}/sap`, { method: 'POST', body: '{}' })).status, 404)

// Shape is checked before anything is dialled.
requests = []
const incomplete = await connect({ url: `http://127.0.0.1:${odooPort}`, db: '', login: '', apiKey: '' })
assert.equal(incomplete.status, 400, 'a half-filled form is refused')
assert.equal(requests.length, 0, 'and refused without calling anything')

const connected = await connect()
assert.equal(connected.status, 200)
assert.ok(connected.payload.account.includes('acme-prod'), 'the operator can see which database they connected')
assert.ok(!JSON.stringify(connected.payload).includes('odoo-api-key-value'), 'no endpoint returns a credential')

// The credential is at rest, encrypted, outside the workspace directory.
const vault = path.join(process.env.BO_GENERATED_ROOT, '.connections')
const stored = await readFile(path.join(vault, `${workspaceId}.json`), 'utf8')
assert.ok(!stored.includes('odoo-api-key-value'), 'the API key is never written in the clear')
assert.ok(!stored.includes('ops@acme.com'), 'and neither is the login')

const introspected = await api(`/api/connections/${workspaceId}/odoo/introspect`, { method: 'POST', body: '{}' })
assert.equal(introspected.status, 200)
const read = introspected.payload
assert.equal(read.company.name, 'Panaderia Uno')
assert.deepEqual(read.modules.map(item => item.name), ['purchase', 'mrp'])

/**
 * The assertion the whole "better than an interview" claim rests on.
 *
 * Manufacturing is installed and has never been used. An interview would have asked "do you
 * manufacture?" and taken the answer; the count says so without asking anybody.
 */
assert.ok(!read.models.some(item => item.model === 'mrp.production'), 'an installed module with no records is not part of this company')
assert.ok(read.models.some(item => item.model === 'purchase.order'), 'a module holding records is')
assert.ok(read.models.some(item => item.model === 'x_batch_log' && item.custom), 'a custom model is carried even so')

const purchaseOrder = read.models.find(item => item.model === 'purchase.order')
assert.equal(purchaseOrder.count, 1)
const fieldNames = purchaseOrder.fields.map(field => field.name)
assert.ok(fieldNames.includes('x_studio_pallet_code'), 'the field somebody paid to add is the point')
assert.equal(purchaseOrder.fields.find(field => field.name === 'x_studio_pallet_code').custom, true)
assert.ok(!fieldNames.includes('message_ids'), 'Odoo plumbing is not a business field')
assert.deepEqual(
  purchaseOrder.fields.find(field => field.name === 'state').selection.map(option => option.label),
  ['RFQ', 'Purchase Order', 'Locked'],
  'the states the company actually uses come across as their own words',
)

const mapping = [
  { model: 'res.partner', entityId: 'suppliers', fields: [{ from: 'name', to: 'name', kind: 'text' }, { from: 'email', to: 'email', kind: 'text' }] },
  { model: 'purchase.order', entityId: 'purchase-orders', fields: [
    { from: 'name', to: 'number', kind: 'text' },
    { from: 'partner_id', to: 'supplier', kind: 'text' },
    { from: 'amount_total', to: 'amount', kind: 'currency' },
    { from: 'x_studio_pallet_code', to: 'pallet-code', kind: 'text' },
  ] },
]

const sync = (body = {}, query = '') => api(`/api/connections/${workspaceId}/odoo/sync${query}`, { method: 'POST', body: JSON.stringify(body) })

const first = await sync({ mapping })
assert.equal(first.status, 200)
assert.equal(first.payload.counts.suppliers.added, 2)
assert.equal(first.payload.counts['purchase-orders'].added, 1)

const dataFile = path.join(process.env.BO_GENERATED_ROOT, workspaceId, 'data.json')
const imported = JSON.parse(await readFile(dataFile, 'utf8'))
assert.equal(imported.suppliers[0].name, 'Molino Rossi')
// A many2one is a display name here: resolving it to a local record id is a later pass.
assert.equal(imported['purchase-orders'][0].supplier, 'Molino Rossi')
assert.equal(imported['purchase-orders'][0].amount, 480.5)
assert.equal(imported['purchase-orders'][0].connection.externalId, 'purchase.order:21')

/**
 * The trap this exists to prove is not there.
 *
 * A second sync asks only for what changed. Fed that delta, a sweep written for a full pull would
 * mark every record it did not see as having disappeared — condemning the entire dataset on the
 * second run, silently, in a way that looks like the ERP deleted everything.
 */
requests = []
const second = await sync({})
assert.equal(second.status, 200)
const domains = requests.filter(item => item.method === 'search_read').map(item => JSON.stringify(item.kwargs.domain ?? []))
assert.ok(domains.some(domain => domain.includes('write_date') && domain.includes('>')), 'an incremental sync asks only for what changed')
assert.ok(!domains.some(domain => domain.includes('T') && domain.includes('Z')), 'and asks in the format Odoo actually matches on')
const afterSecond = JSON.parse(await readFile(dataFile, 'utf8'))
assert.ok(afterSecond.suppliers.every(row => !row.connection.missingSince), 'unchanged is not deleted')

// A full sweep is what finds a real deletion.
const removed = partners.pop()
const swept = await sync({}, '?full=1')
assert.equal(swept.status, 200)
const afterSweep = JSON.parse(await readFile(dataFile, 'utf8'))
const gone = afterSweep.suppliers.find(row => row.connection.externalId === `res.partner:${removed.id}`)
assert.ok(gone.connection.missingSince, 'a record that really vanished is marked')
assert.ok(afterSweep.suppliers.some(row => row.name === 'Molino Rossi'), 'and nothing is actually removed from Wesify')
partners.push(removed)

/**
 * The same company, read through the older dialect.
 *
 * Odoo 17 and 18 are the deployed reality and speak `/jsonrpc`; 19 speaks JSON-2. One seam serves
 * both, and the proof that the seam holds is that the answer is identical.
 */
dialect = 'rpc'
await api(`/api/connections/${workspaceId}/odoo`, { method: 'DELETE' })
const reconnected = await connect()
assert.equal(reconnected.status, 200, 'the legacy dialect is detected when JSON-2 is not there')
const viaRpc = await api(`/api/connections/${workspaceId}/odoo/introspect`, { method: 'POST', body: '{}' })
assert.equal(viaRpc.status, 200)
assert.deepEqual(
  viaRpc.payload.models.map(item => item.model).sort(),
  read.models.map(item => item.model).sort(),
  'both dialects describe the same company',
)

// Nothing this connector does can write. The stub would have recorded it.
assert.ok(!requests.some(item => ['create', 'write', 'unlink'].includes(item.method)), 'Wesify never writes back to an ERP')

const files = await readdir(vault)
assert.deepEqual(files, [`${workspaceId}.json`], 'credentials stay outside the workspace directory')

server.close()
odoo.close()
console.log('Odoo test passed: both dialects read the same company, an installed-but-empty module is not part of it, custom fields and real states come across, credentials never hit disk in the clear, an incremental sync does not mistake unchanged for deleted, and nothing is ever written back.')
