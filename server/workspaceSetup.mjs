import { query, queryOne } from './db.mjs'

/**
 * What an operator says about a workspace before it is built, and who they want in it.
 *
 * The onboarding dialog asks three things — a name, a logo, the colleagues who should be here — and
 * this is where the answers live once the browser that gave them is closed. Deliberately separate
 * from the discovery session: those are answers about the *business*, re-read by the architect every
 * time it thinks, while these are facts about the workspace itself that no model ever gets a vote on.
 *
 * Invites are the part that needs a table of its own. A membership points at a users row, and an
 * invited colleague has none until they sign in for the first time — so the address is held here and
 * redeemed into a real membership at that moment, by `redeemInvites`.
 */

/** Roles an invite may carry. `owner` is not among them: it is claimed by building, never granted. */
export const INVITE_ROLES = ['admin', 'manager', 'employee', 'accountant']

const cleanEmail = value => String(value ?? '').trim().toLowerCase().slice(0, 200)

/** The same rule the browser applies, applied again where it cannot be edited out. */
export function validInviteEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

/** The name and logo shown wherever this workspace appears, including on somebody else's device. */
export async function workspaceIdentity(workspaceId) {
  const row = await queryOne('select id, name, logo from workspaces where id = $1', [workspaceId])
  return row ? { id: row.id, name: row.name ?? '', logo: row.logo ?? '' } : null
}

/**
 * Records what the workspace is called and what it looks like.
 *
 * The logo is a data URL, capped here rather than trusted from the browser: it travels in every
 * account's workspace list, so an unbounded one would be paid for on every page load by everybody in
 * the workspace. The browser resizes before uploading; this is the floor under that.
 */
export const LOGO_LIMIT = 96_000

export async function saveWorkspaceIdentity(workspaceId, { name, logo }) {
  const values = []
  const sets = []
  if (name !== undefined) { values.push(String(name).trim().slice(0, 120)); sets.push(`name = $${values.length}`) }
  if (logo !== undefined) {
    const candidate = String(logo ?? '')
    if (candidate && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);/.test(candidate)) throw Object.assign(new Error('A logo must be an image.'), { status: 400 })
    if (candidate.length > LOGO_LIMIT) throw Object.assign(new Error('That logo is too large. Wesify holds logos up to about 70 KB.'), { status: 413 })
    values.push(candidate); sets.push(`logo = $${values.length}`)
  }
  if (!sets.length) return workspaceIdentity(workspaceId)
  values.push(workspaceId)
  await query(`update workspaces set ${sets.join(', ')} where id = $${values.length}`, values)
  return workspaceIdentity(workspaceId)
}

/** Everybody in this workspace: the members it already has, and the addresses still waiting. */
export async function workspaceTeam(workspaceId) {
  const members = await query(
    'select m.user_id, m.role, m.created_at, u.email from workspace_members m join users u on u.id = m.user_id where m.workspace_id = $1 order by m.created_at',
    [workspaceId],
  )
  const invites = await query(
    'select email, role, created_at, accepted_at from workspace_invites where workspace_id = $1 order by created_at',
    [workspaceId],
  )
  return {
    members: members.rows.map(row => ({ userId: row.user_id, email: row.email ?? '', role: row.role, joinedAt: row.created_at })),
    invites: invites.rows.filter(row => !row.accepted_at).map(row => ({ email: row.email, role: row.role, invitedAt: row.created_at })),
  }
}

/**
 * Asks somebody to join, by address.
 *
 * Re-inviting an address that is already waiting updates the role rather than failing: the operator's
 * intent is "this person should be a manager", and which of the two times they said it is not
 * something they should have to think about. An address that already belongs to a member is refused,
 * because the answer they want has already happened.
 */
export async function inviteToWorkspace(workspaceId, email, role, invitedBy) {
  const address = cleanEmail(email)
  if (!validInviteEmail(address)) throw Object.assign(new Error('That does not look like an email address.'), { status: 400 })
  const chosen = INVITE_ROLES.includes(role) ? role : 'employee'
  const already = await queryOne(
    'select 1 as found from workspace_members m join users u on u.id = m.user_id where m.workspace_id = $1 and lower(u.email) = $2',
    [workspaceId, address],
  )
  if (already) throw Object.assign(new Error('That person is already in this workspace.'), { status: 409 })
  await query(
    `insert into workspace_invites (workspace_id, email, role, invited_by) values ($1, $2, $3, $4)
     on conflict (workspace_id, email) do update set role = excluded.role, accepted_at = null, accepted_by = null`,
    [workspaceId, address, chosen, invitedBy ?? null],
  )
  return { email: address, role: chosen }
}

export async function revokeInvite(workspaceId, email) {
  await query('delete from workspace_invites where workspace_id = $1 and email = $2 and accepted_at is null', [workspaceId, cleanEmail(email)])
  return { revoked: true }
}

async function editableMember(workspaceId, userId, actorRole) {
  const member = await queryOne(
    'select m.user_id, m.role, u.email from workspace_members m join users u on u.id = m.user_id where m.workspace_id = $1 and m.user_id = $2',
    [workspaceId, String(userId ?? '').slice(0, 200)],
  )
  if (!member) throw Object.assign(new Error('That workspace member no longer exists.'), { status: 404 })
  if (member.role === 'owner') throw Object.assign(new Error('The workspace owner cannot be removed or reassigned.'), { status: 409 })
  if (actorRole !== 'owner' && member.role === 'admin') throw Object.assign(new Error('Only the workspace owner can change another administrator.'), { status: 403 })
  return member
}

/** Changes an existing member without ever allowing an owner to be created or displaced. */
export async function changeWorkspaceMemberRole(workspaceId, userId, role, actorRole) {
  const member = await editableMember(workspaceId, userId, actorRole)
  const chosen = INVITE_ROLES.includes(role) ? role : ''
  if (!chosen) throw Object.assign(new Error('Choose a valid workspace role.'), { status: 400 })
  if (actorRole !== 'owner' && chosen === 'admin') throw Object.assign(new Error('Only the workspace owner can appoint an administrator.'), { status: 403 })
  await query('update workspace_members set role = $3 where workspace_id = $1 and user_id = $2', [workspaceId, member.user_id, chosen])
  return { userId: member.user_id, email: member.email ?? '', role: chosen }
}

/** Removes a non-owner member. Their account and records remain intact. */
export async function removeWorkspaceMember(workspaceId, userId, actorRole) {
  const member = await editableMember(workspaceId, userId, actorRole)
  await query('delete from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, member.user_id])
  return { userId: member.user_id, email: member.email ?? '', removed: true }
}

/**
 * Turns every invite waiting on this person's address into a membership.
 *
 * Called when Wesify is asked who somebody is, which is the first thing the interface does after a
 * sign-in — so a colleague who accepts an invitation by simply signing up finds the workspace
 * already in their list, with no link to click and no token to carry. An address is proof enough
 * because Clerk verified it before it ever reached Wesify.
 *
 * Nothing here throws. A person whose invites cannot be redeemed still gets to use their own
 * account, and the invite is still waiting the next time they load the page.
 */
export async function redeemInvites(userId, email) {
  const address = cleanEmail(email)
  if (!address) return []
  try {
    const pending = await query('select workspace_id, role from workspace_invites where email = $1 and accepted_at is null', [address])
    const redeemed = []
    for (const invite of pending.rows) {
      await query(
        'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3) on conflict (workspace_id, user_id) do nothing',
        [invite.workspace_id, userId, invite.role],
      )
      await query('update workspace_invites set accepted_at = now(), accepted_by = $3 where workspace_id = $1 and email = $2', [invite.workspace_id, address, userId])
      redeemed.push(invite.workspace_id)
    }
    return redeemed
  } catch {
    return []
  }
}

/**
 * Empties a workspace and marks the id spent, for good.
 *
 * Everything is named one table at a time rather than left to `on delete cascade`, because the row
 * the cascades hang off is the one thing that is deliberately kept: `deleted_at` on it is what stops
 * the id being claimed all over again by the next request that mentions it. Migration 010 tells the
 * whole story. Two of these tables never cascaded anyway — discovery sessions and builds exist
 * before a workspace belongs to anybody, and rebuilds are metered per account.
 *
 * Order matters only for readability; each statement stands alone, and a workspace that is already
 * empty deletes cleanly rather than failing.
 */
export async function deleteWorkspace(workspaceId) {
  await query('delete from records where workspace_id = $1', [workspaceId])
  await query('delete from workspace_members where workspace_id = $1', [workspaceId])
  await query('delete from workspace_invites where workspace_id = $1', [workspaceId])
  await query('delete from discovery_sessions where workspace_id = $1', [workspaceId])
  await query('delete from workspace_builds where workspace_id = $1', [workspaceId])
  await query('delete from rebuilds where workspace_id = $1', [workspaceId])
  /**
   * The row outlives the workspace, holding nothing but the fact that this id is spent. Its name and
   * logo go with everything else: a tombstone is not a place to keep somebody's company name.
   *
   * `owner_id` is deliberately left alone. Nulling it would be tidier — nobody owns a workspace that
   * no longer exists — and it cost every deletion a 500 on a database whose `owner_id` was still
   * `not null` (migration 011 explains how one came to be). Deleting a workspace is not the place to
   * discover a schema disagreement, and the column earns nothing: the account list already asks for
   * `deleted_at is null`, so the row is invisible either way.
   */
  await query("update workspaces set deleted_at = now(), name = '', logo = '' where id = $1", [workspaceId])
  return { id: workspaceId, deleted: true }
}

/** Whether this id has already been used and thrown away. Claiming and access both ask. */
export async function workspaceDeleted(workspaceId) {
  const row = await queryOne('select deleted_at from workspaces where id = $1', [workspaceId])
  return Boolean(row?.deleted_at)
}
