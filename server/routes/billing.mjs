import { sessionUser, workspacesFor } from '../auth.mjs'
import { applyWebhook, billingPortal, billingStateFor, rebuildsThisMonth, startCheckout, verifyWebhook } from '../billing.mjs'
import { databaseAvailable } from '../db.mjs'
import { bearer, body, originOf, rawBody, send } from '../http.mjs'

/**
 * Billing: /api/billing/...
 *
 * Checkout happens on Stripe's own hosted page. A card number that never reaches Wesify is one Wesify can
 * never leak, and it keeps PCI scope off a product with no business carrying it.
 */
export async function billingRoutes(request, response, segments) {
  if (segments[1] !== 'billing') return false

  // The webhook comes from Stripe, not from a browser: it carries a signature instead of a session,
  // and it must be read as raw text because a re-serialised body would no longer match that
  // signature. It is handled before anything asks for an account, because it has none.
  if (request.method === 'POST' && segments[2] === 'webhook') {
    const raw = await rawBody(request)
    const event = verifyWebhook(raw, request.headers['stripe-signature'])
    const outcome = await applyWebhook(event)
    // 200 even for an event Wesify ignores or has already seen. Anything else asks Stripe to retry
    // something that will never succeed, and eventually to disable the endpoint.
    return send(response, 200, { received: true, ...outcome })
  }

  if (!databaseAvailable()) return send(response, 200, await billingStateFor(null))
  const user = await sessionUser(bearer(request))
  if (!user) return send(response, 401, { error: 'Not signed in.' })

  if (request.method === 'GET' && (!segments[2] || segments[2] === 'state')) {
    const state = await billingStateFor(user.id)
    return send(response, 200, { ...state, rebuildsUsedThisMonth: await rebuildsThisMonth(user.id), workspaces: (await workspacesFor(user.id)).length })
  }

  if (request.method === 'POST' && segments[2] === 'checkout') {
    const input = await body(request)
    return send(response, 200, await startCheckout(user, String(input.plan ?? ''), originOf(request)))
  }

  if (request.method === 'POST' && segments[2] === 'portal') {
    return send(response, 200, await billingPortal(user.id, originOf(request)))
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
