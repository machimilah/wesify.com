import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { databaseAvailable, query, queryOne } from './db.mjs'

/**
 * What an account may do, and how it comes to pay for more.
 *
 * The plans below follow from what BO actually costs to run, not from what looked round. Building a
 * Command Center is the expensive part — an interview turn per exchange, then a research pass on a
 * frontier model with web search. Running one afterwards is close to free: rows in Postgres and the
 * hosting they sit on.
 *
 * So building is free, for everyone, forever. It is also BO's only real sales pitch: nobody buys a
 * workspace they have not seen built out of their own description. What costs money afterwards is
 * scale — records past a point, rebuilds, connected apps, a second person — and that is what the paid
 * plans sell.
 *
 * Nothing here is ever deleted for non-payment. A lapsed subscription falls back to the free plan's
 * limits, and a workspace already past them stays entirely readable and exportable; it simply stops
 * accepting new records. That needs no rule about which records survive, because none are at risk.
 */

export const PLANS = {
  free: {
    id: 'free', name: 'Free', priceUsd: 0,
    workspaces: 1, records: 200, rebuildsPerMonth: 0, connectedApps: false, teamMembers: false,
    summary: 'Build your Command Center and keep using it.',
  },
  pro: {
    id: 'pro', name: 'Pro', priceUsd: 10,
    workspaces: 1, records: Infinity, rebuildsPerMonth: 5, connectedApps: true, teamMembers: false,
    summary: 'Unlimited records, rebuilds when the business changes, and your other tools connected.',
  },
  business: {
    id: 'business', name: 'Business', priceUsd: 50,
    workspaces: 5, records: Infinity, rebuildsPerMonth: 20, connectedApps: true, teamMembers: true,
    summary: 'Several workspaces, a team in them, and room to keep changing your mind.',
  },
}

const priceIdFor = plan => process.env[`BO_STRIPE_PRICE_${plan.toUpperCase()}`] || ''
const API = process.env.BO_STRIPE_BILLING_API_URL || 'https://api.stripe.com/v1'

/** Whether BO can take money at all. Without keys it still runs; everyone is simply on the free plan. */
export function billingAvailable() {
  return Boolean(process.env.STRIPE_SECRET_KEY && priceIdFor('pro'))
}

/**
 * The plan an account is on, defaulting to free.
 *
 * A subscription that has lapsed reads as free rather than as broken: `status` is what Stripe last
 * said, and anything other than an active or trialling subscription with time left on it means the
 * free limits apply again. The row is kept either way, so resubscribing restores everything at once.
 */
export async function planFor(userId) {
  if (!databaseAvailable() || !userId) return PLANS.free
  const row = await queryOne('select plan, status, current_period_end from subscriptions where user_id = $1', [userId])
  if (!row) return PLANS.free
  const paidUp = ['active', 'trialing'].includes(row.status)
  // Stripe keeps a subscription active until the end of a period already paid for, so a cancellation
  // today does not take away what was bought this month.
  const withinPeriod = !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now()
  return (paidUp && withinPeriod && PLANS[row.plan]) || PLANS.free
}

/** The account's plan and what it entitles them to, for the billing screen. */
export async function billingStateFor(userId) {
  const row = databaseAvailable() && userId
    ? await queryOne('select plan, status, current_period_end, stripe_customer_id from subscriptions where user_id = $1', [userId])
    : null
  const plan = await planFor(userId)
  return {
    plan: plan.id,
    planName: plan.name,
    status: row?.status ?? 'active',
    currentPeriodEnd: row?.current_period_end ?? null,
    // Infinity does not survive JSON, and a limit the interface cannot read is a limit it will
    // enforce wrongly. Null is the shape that means "no limit" on the wire.
    limits: { workspaces: plan.workspaces, records: Number.isFinite(plan.records) ? plan.records : null, rebuildsPerMonth: plan.rebuildsPerMonth, connectedApps: plan.connectedApps, teamMembers: plan.teamMembers },
    billingAvailable: billingAvailable(),
    plans: Object.values(PLANS).map(({ id, name, priceUsd, summary, workspaces, records, rebuildsPerMonth, connectedApps, teamMembers }) => ({
      id, name, priceUsd, summary,
      limits: { workspaces, records: Number.isFinite(records) ? records : null, rebuildsPerMonth, connectedApps, teamMembers },
    })),
  }
}

/** Refusals carry the plan that would allow it, so the interface can offer the upgrade rather than a wall. */
export function refuse(message, plan) {
  return Object.assign(new Error(message), { status: 402, upgradeTo: plan })
}

/** The cheapest plan that would allow what was just refused, so the message can name it. */
function cheapestWith(predicate) {
  return Object.values(PLANS).filter(predicate).sort((a, b) => a.priceUsd - b.priceUsd)[0]?.id
}

/**
 * Rebuilds used this calendar month. Monthly, not rolling, because that is what a person expects.
 *
 * The boundary is worked out here rather than with date_trunc, so the same statement runs on any
 * Postgres without depending on which functions it implements. UTC, so the month turns at one moment
 * for everybody rather than at whatever the server's timezone happens to be set to.
 */
export async function rebuildsThisMonth(userId) {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const row = await queryOne('select count(*) as used from rebuilds where user_id = $1 and created_at >= $2', [userId, monthStart])
  return Number(row?.used ?? 0)
}

export async function recordRebuild(userId, workspaceId) {
  await query('insert into rebuilds (id, user_id, workspace_id) values ($1, $2, $3)', [randomUUID(), userId, workspaceId])
}

/**
 * The four things a plan actually gates, each asked at the moment it is about to happen.
 *
 * Checked at the point of the action rather than at sign-in, because a plan can change between the
 * two — a subscription lapsing mid-session must take effect on the next thing done, not the next
 * time somebody signs in.
 */
export async function requireWorkspaceRoom(userId, currentCount) {
  const plan = await planFor(userId)
  if (currentCount < plan.workspaces) return plan
  throw refuse(
    `The ${plan.name} plan covers ${plan.workspaces} workspace${plan.workspaces === 1 ? '' : 's'}. Upgrade to build another.`,
    cheapestWith(candidate => candidate.workspaces > plan.workspaces),
  )
}

export async function requireRecordRoom(userId, currentCount) {
  const plan = await planFor(userId)
  if (currentCount < plan.records) return plan
  throw refuse(
    `The ${plan.name} plan holds ${plan.records} records. Everything you have stays readable — upgrade to add more.`,
    cheapestWith(candidate => candidate.records > plan.records),
  )
}

export async function requireRebuildRoom(userId) {
  const plan = await planFor(userId)
  const used = await rebuildsThisMonth(userId)
  if (used < plan.rebuildsPerMonth) return plan
  throw refuse(
    plan.rebuildsPerMonth === 0
      ? 'Rebuilding a Command Center after the first build is part of the paid plans.'
      : `The ${plan.name} plan includes ${plan.rebuildsPerMonth} rebuilds a month, and this month is spent.`,
    cheapestWith(candidate => candidate.rebuildsPerMonth > plan.rebuildsPerMonth),
  )
}

export async function requireConnectedApps(userId) {
  const plan = await planFor(userId)
  if (plan.connectedApps) return plan
  throw refuse('Connecting your other tools is part of the paid plans.', cheapestWith(candidate => candidate.connectedApps))
}

async function stripe(resource, form) {
  const response = await fetch(`${API}/${resource}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `Stripe returned ${response.status}.`), { status: 502 })
  return payload
}

/**
 * Starts a checkout, on Stripe's own hosted page.
 *
 * Hosted rather than embedded on purpose: a card number that never touches BO's servers is a card
 * number BO can never leak, and it takes the whole of PCI scope off a product that has no business
 * carrying it.
 */
export async function startCheckout(user, planId, origin) {
  const plan = PLANS[planId]
  if (!plan || plan.priceUsd === 0) throw Object.assign(new Error('That is not a plan you can subscribe to.'), { status: 400 })
  if (!billingAvailable()) throw Object.assign(new Error('BO has no billing configured, so every account is on the free plan.'), { status: 503 })

  const existing = await queryOne('select stripe_customer_id from subscriptions where user_id = $1', [user.id])
  const session = await stripe('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': priceIdFor(planId),
    'line_items[0][quantity]': '1',
    success_url: `${origin}/billing?checkout=done`,
    cancel_url: `${origin}/billing?checkout=cancelled`,
    client_reference_id: user.id,
    // Both, deliberately: client_reference_id survives into the session BO reads back, and the
    // subscription metadata survives into every later invoice event, which the session does not.
    'subscription_data[metadata][bo_user_id]': user.id,
    'subscription_data[metadata][bo_plan]': planId,
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: user.email }),
  })
  return { url: session.url, id: session.id }
}

/** Stripe's own page for changing a card, switching plan, or cancelling. BO does not rebuild any of it. */
export async function billingPortal(userId, origin) {
  const row = await queryOne('select stripe_customer_id from subscriptions where user_id = $1', [userId])
  if (!row?.stripe_customer_id) throw Object.assign(new Error('There is no subscription on this account yet.'), { status: 400 })
  const session = await stripe('billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${origin}/billing` })
  return { url: session.url }
}

/**
 * Checks that an incoming webhook really came from Stripe.
 *
 * This endpoint changes what an account is entitled to, and it is reachable by anyone who knows the
 * URL. Without this check, upgrading yourself to Business is one forged POST. The comparison is
 * constant-time and the timestamp is checked, so a captured request cannot be replayed later.
 */
export function verifyWebhook(rawBody, signatureHeader, toleranceSeconds = 300) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw Object.assign(new Error('BO has no Stripe webhook secret configured, so it cannot trust this request.'), { status: 503 })
  const parts = Object.fromEntries(String(signatureHeader ?? '').split(',').map(part => part.split('=', 2)))
  const timestamp = Number(parts.t)
  if (!timestamp || !parts.v1) throw Object.assign(new Error('That request is not signed.'), { status: 400 })
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) throw Object.assign(new Error('That request is too old.'), { status: 400 })

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const given = Buffer.from(String(parts.v1))
  const mine = Buffer.from(expected)
  if (given.length !== mine.length || !timingSafeEqual(given, mine)) throw Object.assign(new Error('That signature does not match.'), { status: 400 })
  return JSON.parse(rawBody)
}

/** The plan a Stripe object is for: its metadata first, then whichever price id BO configured. */
function planOf(subscription) {
  const fromMetadata = subscription?.metadata?.bo_plan
  if (PLANS[fromMetadata]) return fromMetadata
  const priceId = subscription?.items?.data?.[0]?.price?.id
  return Object.keys(PLANS).find(id => priceIdFor(id) && priceIdFor(id) === priceId) || null
}

async function upsert(userId, fields) {
  await query(
    `insert into subscriptions (user_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (user_id) do update set
       plan = excluded.plan,
       status = excluded.status,
       stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
       current_period_end = excluded.current_period_end,
       updated_at = now()`,
    [userId, fields.plan, fields.status, fields.customerId ?? null, fields.subscriptionId ?? null, fields.currentPeriodEnd ?? null],
  )
}

/** The account a Stripe event is about: whatever it names directly, else the customer BO already stored. */
async function userFor(object) {
  const named = object?.metadata?.bo_user_id || object?.client_reference_id
  if (named) return named
  const customer = typeof object?.customer === 'string' ? object.customer : object?.customer?.id
  if (!customer) return null
  const row = await queryOne('select user_id from subscriptions where stripe_customer_id = $1', [customer])
  return row?.user_id ?? null
}

const secondsToDate = seconds => (seconds ? new Date(seconds * 1000) : null)

/**
 * Applies one webhook, once.
 *
 * Stripe delivers at least once, not exactly once — a retry after a timeout is ordinary — so the event
 * id is recorded first and a duplicate is dropped without doing the work again.
 */
export async function applyWebhook(event) {
  const already = await queryOne('select id from stripe_events where id = $1', [event.id])
  if (already) return { applied: false, reason: 'duplicate' }
  await query('insert into stripe_events (id, type) values ($1, $2)', [event.id, event.type])

  const object = event.data?.object ?? {}
  const userId = await userFor(object)
  if (!userId) return { applied: false, reason: 'no account' }

  if (event.type === 'checkout.session.completed') {
    // The session says who paid and for what, but not when the period ends; the subscription events
    // that follow it do. Recording the customer here is what lets those be matched to this account.
    await upsert(userId, {
      plan: PLANS[object.metadata?.bo_plan] ? object.metadata.bo_plan : 'pro',
      status: 'active',
      customerId: typeof object.customer === 'string' ? object.customer : object.customer?.id,
      subscriptionId: typeof object.subscription === 'string' ? object.subscription : object.subscription?.id,
      currentPeriodEnd: null,
    })
    return { applied: true, userId }
  }

  if (event.type.startsWith('customer.subscription.')) {
    const deleted = event.type === 'customer.subscription.deleted'
    await upsert(userId, {
      plan: planOf(object) ?? 'pro',
      status: deleted ? 'canceled' : String(object.status ?? 'active'),
      customerId: typeof object.customer === 'string' ? object.customer : object.customer?.id,
      subscriptionId: object.id,
      // Kept even when cancelled: what was paid for this month stays paid for.
      currentPeriodEnd: secondsToDate(object.current_period_end ?? object.items?.data?.[0]?.current_period_end),
    })
    return { applied: true, userId }
  }

  if (event.type === 'invoice.payment_failed') {
    // Not a downgrade. Stripe retries a failed card for days, and taking the product away on the first
    // failure punishes an expired card as if it were a decision.
    await query('update subscriptions set status = $1, updated_at = now() where user_id = $2', ['past_due', userId])
    return { applied: true, userId }
  }

  return { applied: false, reason: 'ignored' }
}
