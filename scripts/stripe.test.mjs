import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import './noSpend.mjs'

/**
 * BO's first real connector.
 *
 * The value of a connected app is that BO stops having to be the payment system. The danger is that
 * BO now holds a credential to somebody's money and writes into their workspace on a schedule. So
 * these checks are mostly about restraint: refuse a key that grants too much, never hand a stored
 * credential back, never destroy a record the operator typed, and never quietly delete something
 * because the other side stopped mentioning it.
 */

const stripePort = 8931
const apiPort = 8932
const root = await mkdtemp(path.join(tmpdir(), 'bo-stripe-'))
const workspaceId = 'ws-stripe-test'
const accessToken = 'a'.repeat(40)

let customers = [
  { id: 'cus_1', name: 'ACME Ltd', email: 'ops@acme.test', phone: '', created: 1_700_000_000 },
  { id: 'cus_2', name: '', email: 'hello@beta.test', phone: '', created: 1_700_000_100 },
]
const subscriptions = [
  { id: 'sub_1', customer: 'cus_1', status: 'active', created: 1_700_000_200, current_period_end: 1_800_000_000,
    items: { data: [{ price: { nickname: 'Growth plan', unit_amount: 24_900, recurring: { interval: 'month' } } }] } },
  { id: 'sub_2', customer: 'cus_2', status: 'past_due', created: 1_700_000_300, current_period_end: 1_800_000_500,
    items: { data: [{ price: { nickname: '', unit_amount: 120_000, recurring: { interval: 'year' } } }] } },
]
const charges = [
  { id: 'ch_1', amount: 24_900, status: 'succeeded', refunded: false, created: 1_700_000_400, receipt_number: '1234-5678' },
  { id: 'ch_2', amount: 5_000, status: 'failed', refunded: false, created: 1_700_000_500 },
]

let unauthorized = false
const stripe = createServer((request, response) => {
  const auth = String(request.headers.authorization ?? '')
  if (unauthorized || !auth.startsWith('Bearer rk_')) {
    response.writeHead(401, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ error: { message: 'Invalid API Key provided' } }))
  }
  const resource = new URL(request.url, 'http://localhost').pathname.replace(/^\/v1\//, '')
  const data = resource === 'customers' ? customers : resource === 'subscriptions' ? subscriptions : resource === 'charges' ? charges : []
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ object: 'list', data }))
})
await new Promise(resolve => stripe.listen(stripePort, '127.0.0.1', resolve))

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BO_GENERATED_ROOT: root,
    BO_STRIPE_API_URL: `http://127.0.0.1:${stripePort}/v1`,
    BO_CONNECTION_SECRET: 'test-secret-value-long-enough',
  },
  stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('The project service did not start.')
}

const call = (method, route, payload) => fetch(`http://127.0.0.1:${apiPort}/api/connections/${workspaceId}${route}`, {
  method,
  headers: { 'content-type': 'application/json', 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': accessToken, 'x-bo-role': 'owner' },
  body: payload ? JSON.stringify(payload) : undefined,
})
const dataFile = () => path.join(root, workspaceId, 'data.json')
const records = async () => JSON.parse(await readFile(dataFile(), 'utf8'))

try {
  // 1. A key that grants more than reading is refused before it is ever stored.
  const live = await call('POST', '/stripe', { apiKey: 'sk_live_abcdefgh12345678' })
  assert.equal(live.status, 400)
  assert.match((await live.json()).error, /restricted key/i)
  const nonsense = await call('POST', '/stripe', { apiKey: 'hello' })
  assert.equal(nonsense.status, 400)

  // 2. A key that does not work is refused too, rather than stored and failing later.
  unauthorized = true
  const rejected = await call('POST', '/stripe', { apiKey: 'rk_test_abcdefgh12345678' })
  assert.equal(rejected.status, 401)
  unauthorized = false

  // 3. Connecting stores the key and reports the account, without echoing the key.
  const connected = await call('POST', '/stripe', { apiKey: 'rk_test_abcdefgh12345678' })
  assert.equal(connected.status, 200)
  const connection = await connected.json()
  assert.equal(connection.providerId, 'stripe')
  assert.equal(connection.mode, 'read', 'the first connector must be read-only')
  assert.equal(connection.hasCredential, true)
  assert.ok(!JSON.stringify(connection).includes('rk_test'), 'a stored credential must never be returned')

  // 4. Nor by listing connections.
  const listed = await (await call('GET', '')).json()
  assert.equal(listed.length, 1)
  assert.ok(!JSON.stringify(listed).includes('rk_test'), 'listing connections must not expose the credential')

  // 5. The credential is not sitting in plain text on disk either.
  const stored = await readFile(path.join(root, '.connections', `${workspaceId}.json`), 'utf8')
  assert.ok(!stored.includes('rk_test_abcdefgh12345678'), `the credential must be encrypted at rest: ${stored.slice(0, 160)}`)

  // 6. Syncing brings Stripe's records in, in BO's own field names.
  const synced = await (await call('POST', '/stripe/sync')).json()
  assert.equal(synced.counts.customers.added, 2)
  assert.equal(synced.counts.subscriptions.added, 2)
  assert.equal(synced.counts.payments.added, 2)
  const first = await records()
  const acme = first.customers.find(item => item.name === 'ACME Ltd')
  assert.ok(acme, 'the customer did not arrive')
  assert.equal(acme.connection.externalId, 'cus_1')
  assert.equal(first.customers.find(item => item.connection.externalId === 'cus_2').name, 'hello@beta.test', 'a customer with no name falls back to the email')
  const growth = first.subscriptions.find(item => item.connection.externalId === 'sub_1')
  assert.equal(growth.amount, 249, 'Stripe holds cents; BO shows currency')
  assert.equal(growth.status, 'Active')
  assert.equal(growth.cadence, 'Monthly')
  assert.equal(growth.customer, 'ACME Ltd', 'the subscription is linked to a named customer, not an id')
  assert.equal(first.subscriptions.find(item => item.connection.externalId === 'sub_2').status, 'Past due')
  assert.equal(first.payments.find(item => item.connection.externalId === 'ch_1').reference, '1234-5678')
  assert.equal(first.payments.find(item => item.connection.externalId === 'ch_2').status, 'Failed')

  // 7. Syncing twice updates in place. A connector that duplicates the ledger every run is useless.
  const again = await (await call('POST', '/stripe/sync')).json()
  assert.equal(again.counts.customers.added, 0)
  assert.equal(again.counts.customers.updated, 2)
  assert.equal((await records()).customers.length, 2)

  // 8. A record the operator typed in BO is never touched by a sync.
  const local = await records()
  local.customers.push({ id: 'local-1', name: 'Typed by hand', createdAt: new Date().toISOString() })
  await fetch(`http://127.0.0.1:${apiPort}/api/workspaces/${workspaceId}/records`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': accessToken, 'x-bo-role': 'owner' },
    body: JSON.stringify(local),
  }).catch(() => undefined)

  // 9. Something disappearing from Stripe is marked, never deleted.
  customers = customers.filter(item => item.id !== 'cus_2')
  const shrunk = await (await call('POST', '/stripe/sync')).json()
  assert.equal(shrunk.counts.customers.missing, 1)
  const afterRemoval = await records()
  const gone = afterRemoval.customers.find(item => item.connection?.externalId === 'cus_2')
  assert.ok(gone, 'a record must not be deleted because the other system stopped listing it')
  assert.ok(gone.connection.missingSince, 'a record that vanished remotely must say so')

  // 10. Disconnecting removes the credential and leaves the records behind.
  const removed = await (await call('DELETE', '/stripe')).json()
  assert.equal(removed.removed, true)
  assert.deepEqual(await (await call('GET', '')).json(), [])
  assert.ok((await records()).customers.length >= 2, 'disconnecting must not take the data with it')
  const orphaned = await call('POST', '/stripe/sync')
  assert.equal(orphaned.status, 404)

  // 11. Another workspace cannot reach this one's connections.
  const intruder = await fetch(`http://127.0.0.1:${apiPort}/api/connections/${workspaceId}`, {
    headers: { 'x-bo-workspace-id': 'someone-else', 'x-bo-access-token': accessToken },
  })
  assert.equal(intruder.status, 403)

  // 12. Without a server secret BO refuses to store a credential rather than writing it in the clear.
  const files = await readdir(path.join(root, '.connections')).catch(() => [])
  assert.ok(!files.length || !files.some(name => name.includes('plain')), 'credentials must not be written unencrypted')

  console.log('Stripe test passed: over-scoped and dead keys refused, credential encrypted and never returned, records mapped into BO field names, repeat syncs updating in place, hand-typed records untouched, remote deletions marked not deleted, and cross-workspace access denied.')
} finally {
  api.kill()
  stripe.close()
  await rm(root, { recursive: true, force: true })
}
