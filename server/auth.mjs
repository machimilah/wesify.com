import { query, queryOne } from './db.mjs'
import { clerkUser } from './clerk.mjs'

/**
 * Who owns what.
 *
 * This file used to be Wesify's user management as well — scrypt, session tokens, reset links. Clerk
 * holds the credential now (see clerk.mjs), and what is left here is the half that was always Wesify's
 * own: which account a workspace belongs to, who may act on it, and what a person has.
 *
 * The seam between the two is `sessionUser`. Everything in the server asks it "who is this request",
 * and it is the only line that knows the answer comes from Clerk.
 */

/** The account behind a request's bearer token, or null. */
export const sessionUser = token => clerkUser(token)

/**
 * Attaches a workspace to an account, the first time anybody signed in touches it.
 *
 * A workspace exists before it belongs to anyone — the interview that produces it starts before Wesify
 * has asked for a sign-in, deliberately. Claiming is what turns that into somebody's, and it refuses
 * a workspace that already has a different owner, so it can never be used to take one over.
 */
export async function claimWorkspace(workspaceId, userId, name = '') {
  const existing = await queryOne('select id, owner_id, deleted_at from workspaces where id = $1', [workspaceId])
  if (existing) {
    // A deleted workspace is not an unowned one. Without this the id would be handed straight back
    // to whoever mentioned it next, and the workspace somebody deleted would return from the dead —
    // empty, but in their list.
    if (existing.deleted_at) throw Object.assign(new Error('That workspace was deleted.'), { status: 410 })
    if (existing.owner_id !== userId) throw Object.assign(new Error('That workspace belongs to someone else.'), { status: 403 })
    return existing
  }
  await query('insert into workspaces (id, owner_id, name) values ($1, $2, $3)', [workspaceId, userId, String(name).slice(0, 120)])
  return { id: workspaceId, owner_id: userId }
}

/** The account a workspace belongs to, or null where no account has ever claimed it. */
export async function workspaceOwner(workspaceId) {
  const row = await queryOne('select owner_id from workspaces where id = $1', [workspaceId])
  return row?.owner_id ?? null
}

/**
 * Whether this person may act on this workspace at all, and as what.
 *
 * One owner, and nobody else. This used to consult a membership table, which meant every access
 * decision was a join that had to be remembered — and a workspace could accumulate people through a
 * path that was never quite visible from the row itself. Ownership is now a column on the workspace,
 * so the question has exactly one answer and no way to be asked incorrectly.
 *
 * The shape of the return is unchanged — `{ role }` or null — because that is what every caller
 * already checks, and the role is always 'owner' for the same reason there is only ever one.
 */
export async function membership(workspaceId, userId) {
  if (!userId) return null
  const row = await queryOne('select owner_id from workspaces where id = $1 and deleted_at is null', [workspaceId])
  return row && row.owner_id === userId ? { role: 'owner' } : null
}

export async function workspacesFor(userId) {
  const result = await query(
    "select id, name, logo, 'owner' as role, created_at from workspaces where owner_id = $1 and deleted_at is null order by created_at desc",
    [userId],
  )
  return result.rows
}
