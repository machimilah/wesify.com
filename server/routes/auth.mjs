import { authenticate, beginPasswordReset, completePasswordReset, createSession, destroyAllSessions, destroySession, registerUser, sessionUser, workspacesFor } from '../auth.mjs'
import { databaseAvailable } from '../db.mjs'
import { bearer, body, originOf, requestIdOf, send } from '../http.mjs'
import { callerOf, rateLimit } from '../limits.mjs'
import { sendPasswordReset } from '../mail.mjs'
import { captureError } from '../observability.mjs'

/**
 * Accounts: /api/auth/...
 *
 * Sign-up and sign-in are rate limited by caller, because a login form is the one endpoint an
 * attacker is happy to call ten thousand times. The session token is returned once, here, and never
 * again — the server keeps only its hash.
 */
export async function authRoutes(request, response, segments) {
  if (segments[1] !== 'auth') return false
  if (!databaseAvailable()) return send(response, 503, { error: 'BO has no database configured, so it has no accounts yet. Set DATABASE_URL to your Supabase connection string.' })

  const throttle = (bucket, max) => {
    const window = rateLimit(`${bucket}:${callerOf(request)}`, { max, windowMs: 60_000 })
    return window.ok ? null : `Too many attempts. Try again in ${window.retryAfterSeconds} seconds.`
  }

  if (request.method === 'GET' && segments[2] === 'me') {
    const user = await sessionUser(bearer(request))
    if (!user) return send(response, 401, { error: 'Not signed in.' })
    return send(response, 200, { user, workspaces: await workspacesFor(user.id) })
  }

  if (request.method === 'POST' && (segments[2] === 'register' || segments[2] === 'login')) {
    const refusal = throttle('auth', Number(process.env.BO_AUTH_RATE_LIMIT || 10))
    if (refusal) return send(response, 429, { error: refusal })
    const input = await body(request)
    const user = segments[2] === 'register'
      ? await registerUser(input.email, input.password)
      : await authenticate(input.email, input.password)
    const session = await createSession(user.id)
    return send(response, 200, { user, token: session.token, expiresAt: session.expiresAt })
  }

  /**
   * Forgotten passwords: /api/auth/forgot, then /api/auth/reset.
   *
   * `forgot` answers the same thing whether or not the address has an account, and takes no shortcut
   * when it does not: an endpoint that responds differently for a known address is how a list of
   * BO's customers gets built. The link is mailed and never returned here, so asking is not a way to
   * be handed someone else's account.
   */
  if (request.method === 'POST' && segments[2] === 'forgot') {
    // Tighter than sign-in: this one sends mail, so an unthrottled caller can also use BO to spray
    // messages at addresses that never asked for them.
    const refusal = throttle('forgot', Number(process.env.BO_RESET_RATE_LIMIT || 5))
    if (refusal) return send(response, 429, { error: refusal })
    const input = await body(request)
    const issued = await beginPasswordReset(input.email)
    if (issued) {
      const link = `${originOf(request)}/reset?token=${encodeURIComponent(issued.token)}`
      // Reported rather than only logged, and answered generically either way: a mail provider that
      // is refusing messages means nobody can get back into their account, while every caller still
      // sees the same cheerful "a reset link is on its way". A provider being down must also not
      // become a way to learn which addresses exist.
      try { await sendPasswordReset(issued.user.email, link) } catch (error) {
        void captureError(error, { requestId: requestIdOf(response), path: '/api/auth/forgot', failed: 'password-reset-email' })
      }
    }
    return send(response, 200, { sent: true, message: 'If that email has an account, a reset link is on its way.' })
  }

  if (request.method === 'POST' && segments[2] === 'reset') {
    const refusal = throttle('reset', Number(process.env.BO_RESET_RATE_LIMIT || 5))
    if (refusal) return send(response, 429, { error: refusal })
    const input = await body(request)
    const user = await completePasswordReset(input.token, input.password)
    // Signed in on the spot. The reset already proved they hold the address, and the alternative is
    // a sign-in form asking for the password they typed ten seconds ago.
    const session = await createSession(user.id)
    return send(response, 200, { user, token: session.token, expiresAt: session.expiresAt })
  }

  if (request.method === 'POST' && segments[2] === 'logout') {
    await destroySession(bearer(request))
    return send(response, 200, { signedOut: true })
  }

  if (request.method === 'POST' && segments[2] === 'logout-everywhere') {
    const user = await sessionUser(bearer(request))
    if (!user) return send(response, 401, { error: 'Not signed in.' })
    await destroyAllSessions(user.id)
    return send(response, 200, { signedOut: true })
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
