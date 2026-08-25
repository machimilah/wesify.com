import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { newDb } from 'pg-mem'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchBrowser } from './browser.mjs'
import { useDatabase, migrate, query } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * Taking money, and what happens when it stops arriving.
 *
 * Billing is the one part of Wesify where a bug is not a bug but a loss: an entitlement check in the
 * wrong place gives the product away, and a webhook handler that trusts its caller gives it away to
 * anyone who knows the URL. So this test is mostly about the ways it can go wrong.
 *
 * The shape being proved: building a Command Center is free for everyone, because nobody buys a
 * workspace they have not seen built out of their own description. What costs money is scale after
 * that — records past a point, rebuilds, connected apps, a second workspace. And nothing is ever
 * taken away for non-payment: a lapsed account falls back to the free limits with every record it
 * ever had still readable.
 */

const port = 8965
const stripePort = 8966
const vitePort = 4196
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-billing-'))
process.env.BO_GENERATED_ROOT = generatedRoot
process.env.STRIPE_SECRET_KEY = 'sk_test_pretend'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_pretend'
process.env.BO_STRIPE_PRICE_PRO = 'price_pro'
process.env.BO_STRIPE_PRICE_BUSINESS = 'price_business'
process.env.BO_STRIPE_BILLING_API_URL = `http://127.0.0.1:${stripePort}/v1`
process.env.BO_PUBLIC_URL = 'https://bo.example.com'
delete process.env.SENTRY_DSN

// Stands in for Stripe, and records what Wesify asked it for.
const asked = []
const stripe = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
    asked.push({ path: request.url, authorization: request.headers.authorization, form })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }))
  })
})
await new Promise(resolve => stripe.listen(stripePort, '127.0.0.1', resolve))

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(port) }, stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the frontend server.')
}

const browser = await launchBrowser()
const errors = []

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  /**
   * Only Wesify's own pages count.
   *
   * Choosing a plan hands off to Stripe's hosted checkout, and this test's stand-in returns the real
   * checkout.stripe.com URL — so the browser genuinely goes there. Scripts on somebody else's page
   * throwing somebody else's errors is not a fault in Wesify, and letting them into this list makes the
   * suite fail depending on what Stripe shipped that morning.
   */
  const mine = () => page.url().includes('127.0.0.1')
  page.on('pageerror', error => { if (mine()) errors.push(error.message) })
  page.on('console', message => { if (message.type() === 'error' && mine()) errors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  return page
}

/** The browser acts after the assertion is written, so the test waits rather than assuming. */
async function waitFor(condition, what) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const base = `http://127.0.0.1:${port}`

async function json(pathname, init = {}) {
  const response = await fetch(`${base}${pathname}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
  return { status: response.status, payload: await response.json().catch(() => ({})) }
}
const post = (pathname, payload, headers) => json(pathname, { method: 'POST', body: JSON.stringify(payload), headers })

/** A webhook signed the way Stripe signs one. */
function signed(event, { secret = process.env.STRIPE_WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event)
  const signature = createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')
  return fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` },
    body: raw,
  }).then(async response => ({ status: response.status, payload: await response.json().catch(() => ({})) }))
}

const text = (id, label, required = false) => ({ id, label, type: 'text', required })
const entity = (id, label, pluralLabel, fields) => ({ id, label, pluralLabel, module: 'customers', primaryField: fields[0].id, fields })
const entities = [entity('customers', 'Client', 'Clients', [text('name', 'Name', true)])]
const views = entities.map(item => ({ id: `${item.id}-table`, label: item.pluralLabel, entityId: item.id, type: 'table', columns: item.fields.map(field => field.id) }))
const specification = {
  version: 1, id: 'ws-billing',
  profile: { companyName: 'Billing Co', description: 'A company for testing plans.', archetype: 'generic', industry: 'Testing', businessModel: '', revenueModel: '', teamStructure: '', customers: '', productsAndServices: '', operatingProcesses: [], suppliers: '', locations: '', goals: [], terminology: {} },
  modules: ['customers'], capabilities: [], entities, views,
  navigation: [{ id: 'home', label: 'Dashboard', kind: 'home' }, ...views.map(view => ({ id: view.entityId, label: view.label, kind: 'entity', viewId: view.id, module: 'customers' }))],
  metrics: [], workflows: [],
  roles: [{ id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'financial', 'people', 'admin'] }],
}

try {
  const registered = await post('/api/auth/register', { email: 'payer@example.com', password: 'a-long-enough-password' })
  const token = registered.payload.token
  const auth = workspaceId => ({ authorization: `Bearer ${token}`, 'x-bo-workspace-id': workspaceId, 'x-bo-role': 'owner' })

  // 1. A new account is on the free plan, and is told what every plan costs without having to ask
  //    anyone. The free plan's own limits are the ones in force.
  const state = await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(state.status, 200)
  assert.equal(state.payload.plan, 'free')
  assert.equal(state.payload.limits.records, 200)
  assert.equal(state.payload.limits.connectedApps, false)
  assert.deepEqual(state.payload.plans.map(plan => [plan.id, plan.priceUsd]), [['free', 0], ['pro', 10], ['business', 50]])
  assert.equal(state.payload.limits.workspaces, 1)

  // 2. Building the first Command Center is free. This is the whole sales pitch, and putting it
  //    behind a card would mean nobody ever sees what Wesify does.
  const built = await post('/api/builds', { workspaceId: 'ws-billing', specification }, auth('ws-billing'))
  assert.equal(built.status, 201)
  assert.equal(built.payload.buildStatus, 'HEALTHY')
  const record = await post('/api/projects/ws-billing/records/customers', { name: 'First client' }, auth('ws-billing'))
  assert.equal(record.status, 201, 'a free account could not use the workspace it just built')

  // 3. A second workspace is not free, and the refusal names the plan that would allow it rather
  //    than being a wall.
  const second = await post('/api/builds', { workspaceId: 'ws-billing-2', specification: { ...specification, id: 'ws-billing-2' } }, auth('ws-billing-2'))
  assert.equal(second.status, 402)
  assert.match(second.payload.error, /Free plan covers 1 workspace/i)

  // 4. So are connected apps, and rebuilding after the first build.
  const connect = await post('/api/connections/ws-billing/stripe', { apiKey: 'rk_test_abcdefgh' }, auth('ws-billing'))
  assert.equal(connect.status, 402)
  const rebuild = await post('/api/projects/ws-billing/changes', { specification, changeDescription: 'Changed my mind' }, auth('ws-billing'))
  assert.equal(rebuild.status, 402)
  assert.match(rebuild.payload.error, /paid plans/i)
  assert.equal((await query('select * from rebuilds')).rows.length, 0, 'a refused rebuild was still counted against the quota')

  // 5. The record cap holds, and the refusal says the records already there are safe.
  for (let index = 0; index < 199; index += 1) {
    await query('insert into records (workspace_id, entity_id, id, data) values ($1, $2, $3, $4)', ['ws-billing', 'customers', `filler-${index}`, JSON.stringify({ id: `filler-${index}`, name: `Client ${index}` })])
  }
  const overCap = await post('/api/projects/ws-billing/records/customers', { name: 'One too many' }, auth('ws-billing'))
  assert.equal(overCap.status, 402)
  assert.match(overCap.payload.error, /stays readable/i)
  // Reading is untouched by the cap. Nothing is ever taken away for not paying.
  const listed = await json('/api/projects/ws-billing/records/customers', { headers: auth('ws-billing') })
  assert.equal(listed.status, 200)
  assert.equal(listed.payload.length, 200)

  // 6. Checkout goes to Stripe's hosted page, with the account named so the webhook can find it.
  const checkout = await post('/api/billing/checkout', { plan: 'pro' }, { authorization: `Bearer ${token}` })
  assert.equal(checkout.status, 200)
  assert.equal(checkout.payload.url, 'https://checkout.stripe.com/c/pay/cs_test_1')
  const request = asked.at(-1)
  assert.equal(request.path, '/v1/checkout/sessions')
  assert.equal(request.form['line_items[0][price]'], 'price_pro')
  assert.equal(request.form.mode, 'subscription')
  assert.equal(request.form.client_reference_id, registered.payload.user.id)
  assert.equal(request.form['subscription_data[metadata][bo_user_id]'], registered.payload.user.id)
  assert.equal(request.authorization, 'Bearer sk_test_pretend')

  // 7. An unsigned, wrongly signed, or stale webhook changes nothing. Without this check, upgrading
  //    yourself to Business is one forged POST to a URL anybody can guess.
  const upgrade = userId => ({
    id: 'evt_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', customer: 'cus_1', subscription: 'sub_1', client_reference_id: userId, metadata: { bo_user_id: userId, bo_plan: 'business' } } },
  })
  const unsigned = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(upgrade(registered.payload.user.id)) })
  assert.equal(unsigned.status, 400, 'an unsigned webhook was accepted')
  const forged = await signed(upgrade(registered.payload.user.id), { secret: 'whsec_guessed' })
  assert.equal(forged.status, 400, 'a webhook signed with the wrong secret was accepted')
  const stale = await signed(upgrade(registered.payload.user.id), { at: Math.floor(Date.now() / 1000) - 4000 })
  assert.equal(stale.status, 400, 'a captured webhook could be replayed later')
  assert.equal((await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })).payload.plan, 'free', 'a rejected webhook still changed the plan')

  // 8. A properly signed one upgrades the account, and the same event again does not do the work
  //    twice. Stripe delivers at least once, so a retry after a timeout is ordinary.
  const accepted = await signed(upgrade(registered.payload.user.id))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.payload.applied, true)
  const repeated = await signed(upgrade(registered.payload.user.id))
  assert.equal(repeated.status, 200, 'a duplicate webhook was answered with an error, which asks Stripe to retry forever')
  assert.equal(repeated.payload.applied, false)
  assert.equal(repeated.payload.reason, 'duplicate')
  assert.equal((await query('select * from subscriptions')).rows.length, 1)

  // 9. Paid, so the limits lift: records past the free cap, connected apps, a second workspace.
  const paid = await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(paid.payload.plan, 'business')
  assert.equal(paid.payload.limits.records, null, 'an unlimited plan must not send a number the interface would enforce')
  const nowAllowed = await post('/api/projects/ws-billing/records/customers', { name: 'Two hundred and one' }, auth('ws-billing'))
  assert.equal(nowAllowed.status, 201, 'a paid account was still held to the free record cap')
  const secondNow = await post('/api/builds', { workspaceId: 'ws-billing-2', specification: { ...specification, id: 'ws-billing-2' } }, auth('ws-billing-2'))
  assert.equal(secondNow.status, 201, 'a paid account could not create its second workspace')

  // 10. Rebuilds are metered rather than unlimited, and only successful ones count.
  const paidRebuild = await post('/api/projects/ws-billing/changes', { specification, changeDescription: 'Now I can' }, auth('ws-billing'))
  assert.equal(paidRebuild.status, 201)
  assert.equal((await query('select * from rebuilds')).rows.length, 1)
  assert.equal((await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })).payload.rebuildsUsedThisMonth, 1)

  // 11. A failed payment is not a cancellation. Stripe retries a card for days, and taking the
  //     product away on the first failure punishes an expired card as though it were a decision.
  await signed({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } })
  const pastDue = await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(pastDue.payload.status, 'past_due')
  assert.equal(pastDue.payload.plan, 'free', 'a past-due account kept its paid limits')

  // 12. Cancelling keeps what was already paid for until the period it was paid for ends.
  const stillPaidUntil = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
  await signed({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: stillPaidUntil, metadata: { bo_user_id: registered.payload.user.id, bo_plan: 'business' } } } })
  assert.equal((await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })).payload.plan, 'business')
  await signed({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: Math.floor(Date.now() / 1000) - 60, metadata: { bo_user_id: registered.payload.user.id, bo_plan: 'business' } } } })

  // 13. And once it has lapsed, the free limits are back — with every record still there. Losing a
  //     subscription must never mean losing what you typed.
  const lapsed = await json('/api/billing', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(lapsed.payload.plan, 'free')
  const afterLapse = await json('/api/projects/ws-billing/records/customers', { headers: auth('ws-billing') })
  assert.equal(afterLapse.status, 200)
  assert.equal(afterLapse.payload.length, 201, 'records disappeared when the subscription lapsed')
  const blockedAgain = await post('/api/projects/ws-billing/records/customers', { name: 'Not any more' }, auth('ws-billing'))
  assert.equal(blockedAgain.status, 402)
  // The second workspace it already had is not taken away either.
  assert.equal((await json('/api/projects/ws-billing-2', { headers: auth('ws-billing-2') })).status, 200, 'a lapsed account lost access to a workspace it already had')

  // 14. The plan screen, in a browser. Every number on it must come from the server: a price written
  //     down in the interface as well is one that will eventually disagree with what is charged.
  const page = await openPage()
  await page.evaluate(value => localStorage.setItem('bo-session-token', value), token)
  await page.goto(`http://127.0.0.1:${vitePort}/billing`, { waitUntil: 'networkidle' })
  await page.getByTestId('billing-current').waitFor({ timeout: 15_000 })

  const shown = await page.getByTestId('billing-current').innerText()
  assert.match(shown, /Free/, 'the lapsed account was not shown as being on the free plan')
  for (const [plan, price] of [['free', 'Free'], ['pro', '$10'], ['business', '$50']]) {
    const card = await page.getByTestId(`billing-plan-${plan}`).innerText()
    assert.ok(card.includes(price), `the ${plan} plan card does not show ${price}: ${card}`)
  }
  // The free plan is the current one, so it offers no button; the paid ones do.
  assert.equal(await page.getByTestId('billing-on-free').count(), 1)
  assert.equal(await page.getByTestId('billing-choose-pro').count(), 1)

  // Choosing a plan hands off to Stripe rather than asking for a card here. Wesify must never see one.
  const cardFields = await page.locator('input[autocomplete*="cc-"], input[name*="card"]').count()
  assert.equal(cardFields, 0, 'the billing page asks for card details, which must only ever happen on Stripe')
  const before = asked.length
  await page.getByTestId('billing-choose-pro').click()
  await waitFor(() => asked.length > before, 'checkout to be started')
  assert.equal(asked.at(-1).form['line_items[0][price]'], 'price_pro')
  assert.deepEqual(errors, [], `the browser reported errors: ${errors.join(' | ')}`)

  // 15. Deleting the account takes its subscription and its rebuild history with it.
  await query('delete from users where email = $1', ['payer@example.com'])
  assert.equal((await query('select * from subscriptions')).rows.length, 0)
  assert.equal((await query('select * from rebuilds')).rows.length, 0)

  console.log('Billing test passed: building is free for everyone, a second workspace and connected apps and rebuilds and records past the cap are not, refusals name the plan that would allow them, checkout happens on Stripe with the account named, an unsigned or forged or replayed webhook changes nothing, a duplicate is answered without doing the work twice, paying lifts every limit, a failed payment is not a cancellation, a cancelled subscription keeps what it paid for until the period ends, and a lapsed account keeps every record and every workspace it already had.')
} finally {
  await browser.close().catch(() => undefined)
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => stripe.close(resolve))
  await rm(generatedRoot, { recursive: true, force: true })
}
