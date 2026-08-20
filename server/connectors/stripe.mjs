/**
 * Stripe, read-only.
 *
 * BO's first real connector, and the shape every later one copies. It reads; it does not write. That
 * is a deliberate first step rather than a limitation to apologise for: a company's payment history
 * is not something to practise on, and a connector that can only read cannot damage anything while
 * the mapping is still being learned.
 *
 * No SDK. Stripe's REST API is a handful of GETs, and a dependency that ships a whole client for four
 * endpoints is a dependency to keep updated forever.
 */

const API = process.env.BO_STRIPE_API_URL || 'https://api.stripe.com/v1'
const PAGE = 100

/** A restricted key is read-scoped by construction. A live secret key is not, so BO refuses it. */
export function checkKey(apiKey) {
  const key = String(apiKey ?? '').trim()
  if (!/^(rk|sk)_(test|live)_[A-Za-z0-9]{8,}$/.test(key)) {
    throw Object.assign(new Error('That does not look like a Stripe API key. BO expects a restricted key beginning rk_test_ or rk_live_.'), { status: 400 })
  }
  if (key.startsWith('sk_live_')) {
    throw Object.assign(new Error('BO will not store a live secret key. Create a restricted key with read-only permissions in Stripe and use that instead.'), { status: 400 })
  }
  return key
}

async function get(apiKey, resource, params = {}) {
  const query = new URLSearchParams({ limit: String(PAGE), ...params })
  const response = await fetch(`${API}/${resource}?${query}`, {
    headers: { authorization: `Bearer ${apiKey}`, 'stripe-version': '2025-03-31.basil' },
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 401) throw Object.assign(new Error('Stripe rejected the key. Check it is correct and still active.'), { status: 401 })
  if (response.status === 403) throw Object.assign(new Error('The key is missing a read permission Stripe needs for this data.'), { status: 403 })
  if (response.status === 429) throw Object.assign(new Error('Stripe is rate limiting BO. Try the sync again shortly.'), { status: 429 })
  if (!response.ok) throw Object.assign(new Error(`Stripe returned ${response.status}.`), { status: 502 })
  const payload = await response.json()
  return Array.isArray(payload.data) ? payload.data : []
}

/** Confirms the key works before BO stores it, and names the account so the operator sees what they connected. */
export async function verify(apiKey) {
  const response = await fetch(`${API}/customers?limit=1`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 401) throw Object.assign(new Error('Stripe rejected the key. Check it is correct and still active.'), { status: 401 })
  if (!response.ok) throw Object.assign(new Error(`Stripe returned ${response.status} when BO tested the key.`), { status: 502 })
  return { livemode: apiKey.includes('_live_') }
}

const money = amount => (Number(amount ?? 0) / 100)
const day = seconds => (seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : '')

const subscriptionStatus = {
  trialing: 'Trial', active: 'Active', past_due: 'Past due', unpaid: 'Past due',
  paused: 'Paused', canceled: 'Cancelled', incomplete: 'Trial', incomplete_expired: 'Cancelled',
}
const cadence = interval => (interval === 'year' ? 'Yearly' : interval === 'week' || interval === 'day' ? 'Monthly' : interval === 'month' ? 'Monthly' : 'Quarterly')

/**
 * Everything Stripe holds that BO has a place for, in BO's own field names.
 *
 * The mapping is deliberately lossy. BO shows what an operator needs to see on one screen; the full
 * object stays in Stripe, which is where it belongs and where they will go to work on it.
 */
export async function pull(apiKey) {
  const [customers, subscriptions, charges] = await Promise.all([
    get(apiKey, 'customers'),
    get(apiKey, 'subscriptions', { status: 'all' }),
    get(apiKey, 'charges'),
  ])

  const customerName = new Map(customers.map(item => [item.id, item.name || item.email || item.id]))

  return {
    customers: customers.map(item => ({
      externalId: item.id,
      values: {
        name: item.name || item.email || item.id,
        email: item.email ?? '',
        phone: item.phone ?? '',
      },
      remoteUpdatedAt: item.created ? new Date(item.created * 1000).toISOString() : '',
    })),
    subscriptions: subscriptions.map(item => {
      const price = item.items?.data?.[0]?.price
      return {
        externalId: item.id,
        values: {
          name: price?.nickname || customerName.get(item.customer) || item.id,
          customer: customerName.get(item.customer) ?? '',
          status: subscriptionStatus[item.status] ?? 'Active',
          amount: money(price?.unit_amount),
          cadence: cadence(price?.recurring?.interval),
          renewalDate: day(item.current_period_end),
        },
        remoteUpdatedAt: item.created ? new Date(item.created * 1000).toISOString() : '',
      }
    }),
    payments: charges.map(item => ({
      externalId: item.id,
      values: {
        reference: item.receipt_number || item.id,
        amount: money(item.amount),
        method: 'Card',
        status: item.refunded ? 'Refunded' : item.status === 'succeeded' ? 'Completed' : item.status === 'failed' ? 'Failed' : 'Pending',
        date: day(item.created),
      },
      remoteUpdatedAt: item.created ? new Date(item.created * 1000).toISOString() : '',
    })),
  }
}
