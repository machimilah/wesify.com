import { sessionUser, workspacesFor } from '../auth.mjs'
import { redeemInvites } from '../workspaceSetup.mjs'
import { clerkConfigured } from '../clerk.mjs'
import { databaseAvailable } from '../db.mjs'
import { bearer, send } from '../http.mjs'

/**
 * Accounts: /api/auth/me, and nothing else.
 *
 * There used to be six routes here — register, login, logout, logout-everywhere, forgot, reset — and
 * Clerk answers all of them in the browser now, against its own servers. What the server still has to
 * say is the one thing Clerk cannot: which workspaces this person has in Wesify.
 *
 * Both switches are checked, because they fail differently. No database means there is nowhere to put
 * a workspace; no Clerk keys means there is no way to tell who is asking. Either way Wesify has no
 * accounts, and says so rather than pretending.
 */
export async function authRoutes(request, response, segments) {
  if (segments[1] !== 'auth') return false
  if (!databaseAvailable()) return send(response, 503, { error: 'Wesify has no database configured, so it has no accounts yet. Set DATABASE_URL to your Supabase connection string.' })
  if (!clerkConfigured()) return send(response, 503, { error: 'Wesify has no sign-in configured. Set CLERK_SECRET_KEY to the secret key of your Clerk instance.' })

  if (request.method === 'GET' && segments[2] === 'me') {
    const user = await sessionUser(bearer(request))
    if (!user) return send(response, 401, { error: 'Not signed in.' })
    // An invitation is accepted by signing in, and this is the first thing every signed-in page asks
    // — so a colleague who was invited by address finds the workspace already in the list below,
    // with no link to click. Redeeming is idempotent and never throws; see workspaceSetup.mjs.
    await redeemInvites(user.id, user.email)
    return send(response, 200, { user, workspaces: await workspacesFor(user.id) })
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
