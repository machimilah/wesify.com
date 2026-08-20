/**
 * What BO is willing to spend, and how fast anyone may ask.
 *
 * Two endpoints call a frontier model, and one of them cannot require a workspace token because it is
 * the call that creates the workspace. Without a limit, the address of a BO deployment is enough to
 * spend its owner's model budget in a loop. This is the cheap protection that has to exist before the
 * real one — accounts — is built.
 *
 * In memory, so it resets on restart and does not span processes. That is honest for a single-process
 * deployment and must be replaced along with the JSON storage, not before it.
 */

const windows = new Map()

/**
 * A sliding window per caller.
 *
 * Returns how long to wait when the caller is over, so the response can say so instead of failing
 * blankly. Old windows are dropped as they are touched, which keeps the map the size of the callers
 * currently active rather than every caller ever seen.
 */
export function rateLimit(key, { max, windowMs }) {
  const now = Date.now()
  const hits = (windows.get(key) ?? []).filter(at => now - at < windowMs)
  if (hits.length >= max) {
    windows.set(key, hits)
    return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - hits[0])) / 1000) }
  }
  hits.push(now)
  windows.set(key, hits)
  return { ok: true, retryAfterSeconds: 0 }
}

/** Best-effort caller identity. Behind a proxy the first forwarded address is the real one. */
export function callerOf(request) {
  const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return forwarded || request.socket?.remoteAddress || 'unknown'
}

const budget = { day: '', used: 0 }

/**
 * A whole-deployment ceiling on model calls per day.
 *
 * Rate limiting alone only slows one caller down; a thousand callers at one request each still costs
 * real money. This is the number the owner can afford to lose in a day, and it fails closed.
 */
export function spendModelCall(cost = 1) {
  const limit = Number(process.env.BO_DAILY_MODEL_CALLS || 500)
  const today = new Date().toISOString().slice(0, 10)
  if (budget.day !== today) { budget.day = today; budget.used = 0 }
  if (budget.used + cost > limit) {
    return { ok: false, used: budget.used, limit }
  }
  budget.used += cost
  return { ok: true, used: budget.used, limit }
}

export function modelSpendToday() {
  const limit = Number(process.env.BO_DAILY_MODEL_CALLS || 500)
  return { used: budget.day === new Date().toISOString().slice(0, 10) ? budget.used : 0, limit }
}

/** Test seam: the limits are process-global, so a suite has to be able to start from nothing. */
export function resetLimits() {
  windows.clear()
  budget.day = ''
  budget.used = 0
}
