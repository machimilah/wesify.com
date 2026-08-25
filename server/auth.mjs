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
  const existing = await queryOne('select id, owner_id from workspaces where id = $1', [workspaceId])
  if (existing) {
    if (existing.owner_id !== userId) throw Object.assign(new Error('That workspace belongs to someone else.'), { status: 403 })
    return existing
  }
  await query('insert into workspaces (id, owner_id, name) values ($1, $2, $3)', [workspaceId, userId, String(name).slice(0, 120)])
  await query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [workspaceId, userId, 'owner'])
  return { id: workspaceId, owner_id: userId }
}

/** Whether this person may act on this workspace at all, and as what. */
export async function membership(workspaceId, userId) {
  return queryOne('select role from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, userId])
}

export async function workspacesFor(userId) {
  const result = await query(
    'select w.id, w.name, m.role, w.created_at from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.created_at desc',
    [userId],
  )
  return result.rows
}
