import { query, queryOne } from './db.mjs'

/**
 * What an operator says about a workspace before it is built.
 *
 * The onboarding dialog asks for a name and a logo, and this is where the answers live once the
 * browser that gave them is closed. Deliberately separate from the discovery session: those are
 * answers about the *business*, re-read by the architect every time it thinks, while these are facts
 * about the workspace itself that no model ever gets a vote on.
 *
 * A workspace has one owner and no other members. There is nothing here to invite anybody with,
 * because there is nobody to invite: the account that built it is the only account that can open it.
 */

/** The name and logo shown wherever this workspace appears, including on the owner's other devices. */
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

/**
 * Empties a workspace and marks the id spent, for good.
 *
 * Everything is named one table at a time rather than left to `on delete cascade`, because the row
 * the cascades hang off is the one thing that is deliberately kept: `deleted_at` on it is what stops
 * the id being claimed all over again by the next request that mentions it. Several of these tables
 * never cascaded anyway — the interview, the profile and the builds all exist before a workspace
 * belongs to anybody, and rebuilds are metered per account rather than per workspace.
 *
 * The operating graph needs only its nodes deleting: every edge names two nodes in the same
 * workspace and cascades from either.
 *
 * Order matters only for readability; each statement stands alone, and a workspace that is already
 * empty deletes cleanly rather than failing.
 */
export async function deleteWorkspace(workspaceId) {
  await query('delete from records where workspace_id = $1', [workspaceId])
  await query('delete from discovery_sessions where workspace_id = $1', [workspaceId])
  await query('delete from business_dimensions where workspace_id = $1', [workspaceId])
  await query('delete from business_profile where workspace_id = $1', [workspaceId])
  await query('delete from workspace_settings where workspace_id = $1', [workspaceId])
  await query('delete from workspace_builds where workspace_id = $1', [workspaceId])
  await query('delete from operating_nodes where workspace_id = $1', [workspaceId])
  await query('delete from event_history where workspace_id = $1', [workspaceId])
  await query('delete from rebuilds where workspace_id = $1', [workspaceId])
  /**
   * The row outlives the workspace, holding nothing but the fact that this id is spent. Its name and
   * logo go with everything else: a tombstone is not a place to keep somebody's company name.
   *
   * `owner_id` is deliberately left alone. Nulling it would be tidier — nobody owns a workspace that
   * no longer exists — and deleting a workspace is not the place to discover a schema disagreement.
   * The column earns nothing either way: every listing already asks for `deleted_at is null`, so the
   * row is invisible whichever account it still names.
   */
  await query("update workspaces set deleted_at = now(), name = '', logo = '' where id = $1", [workspaceId])
  return { id: workspaceId, deleted: true }
}

/** Whether this id has already been used and thrown away. Claiming and access both ask. */
export async function workspaceDeleted(workspaceId) {
  const row = await queryOne('select deleted_at from workspaces where id = $1', [workspaceId])
  return Boolean(row?.deleted_at)
}
