import { audit, forgetWorkspaceAccess, tenant } from '../access.mjs'
import { databaseAvailable } from '../db.mjs'
import { body, send } from '../http.mjs'
import { removeWorkspaceFiles } from '../project-builder.mjs'
import { deleteWorkspace, saveWorkspaceIdentity, workspaceDeleted, workspaceIdentity } from '../workspaceSetup.mjs'

/**
 * The onboarding answers: what this Command Center is called and what it looks like.
 *
 * A surface of its own rather than two more branches in projects.mjs, because it is the one part of a
 * workspace that exists *before* the workspace is built — every route in projects.mjs starts by
 * fetching a manifest, and during onboarding there is not one yet.
 *
 * There is no team here. A workspace has one owner and no other members, so the only person who can
 * ever reach these routes is the person who owns what they are addressing.
 *
 * Without a database there is nothing to answer with: a name and a logo live in the browser that
 * built the workspace, exactly as they did before. That is said plainly with a 503 rather than
 * pretended, and the dialog carries on locally.
 */
export async function workspaceSetupRoutes(request, response, segments) {
  if (segments[1] !== 'projects' || !segments[2]) return false
  // Deleting the workspace is the one thing addressed at the workspace itself rather than at a part
  // of it, so it is matched on its own before the named sub-surface below.
  const deleting = request.method === 'DELETE' && segments.length === 3
  if (!deleting && segments[3] !== 'setup') return false

  const workspaceId = segments[2]

  // Deleting what is already deleted is not an error, and asking who is calling would make it one:
  // the ownership that authorized the first deletion went with it, so `tenant` would try to claim the
  // id and be refused by the tombstone. Answered before that, and idempotently.
  if (deleting && databaseAvailable() && await workspaceDeleted(workspaceId)) return send(response, 200, { id: workspaceId, deleted: true })

  // Deleting never claims: see `tenant`. Everything else here is about a workspace that exists.
  const caller = await tenant(request, workspaceId, { claim: !deleting })

  /**
   * Deleting is allowed without a database, unlike everything else here.
   *
   * The rest of this file is about rows — a name, a logo — and without a database there are none to
   * read. A workspace's *files* exist either way, and in the infrastructure-free mode they are the
   * whole workspace, so refusing here would leave the one mode where nothing else can clean up
   * unable to delete anything.
   */
  if (deleting) {
    if (String(caller?.role ?? 'owner') !== 'owner') return send(response, 403, { error: 'Only the workspace owner can delete this workspace.' })
    // Recorded before the folder it is written into is removed; an audit line about a deletion has
    // nowhere to live once the deletion has happened.
    await audit(workspaceId, 'workspace.deleted', request, {})
    if (databaseAvailable()) await deleteWorkspace(workspaceId)
    await removeWorkspaceFiles(workspaceId)
    await forgetWorkspaceAccess(workspaceId)
    return send(response, 200, { id: workspaceId, deleted: true })
  }

  if (!databaseAvailable()) return send(response, 503, { error: 'Wesify has no database configured, so a workspace has no name or logo to share yet.' })

  if (request.method === 'GET') return send(response, 200, (await workspaceIdentity(workspaceId)) ?? { id: workspaceId, name: '', logo: '' })

  if (request.method === 'PUT') {
    if (String(caller?.role ?? 'owner') !== 'owner') return send(response, 403, { error: 'Only the workspace owner can rename this workspace.' })
    const input = await body(request)
    const saved = await saveWorkspaceIdentity(workspaceId, { name: input.name, logo: input.logo })
    await audit(workspaceId, 'workspace.identity_saved', request, { named: Boolean(input.name), logo: Boolean(input.logo) })
    return send(response, 200, saved)
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
