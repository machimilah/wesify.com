import { audit, forgetWorkspaceAccess, tenant } from '../access.mjs'
import { requireTeamMembers } from '../billing.mjs'
import { databaseAvailable } from '../db.mjs'
import { body, send } from '../http.mjs'
import { removeWorkspaceFiles } from '../project-builder.mjs'
import { changeWorkspaceMemberRole, deleteWorkspace, inviteToWorkspace, removeWorkspaceMember, revokeInvite, saveWorkspaceIdentity, workspaceDeleted, workspaceIdentity, workspaceTeam } from '../workspaceSetup.mjs'

/**
 * The onboarding answers: what this Command Center is called, what it looks like, and who is in it.
 *
 * A surface of its own rather than three more branches in projects.mjs, because it is the one part
 * of a workspace that exists *before* the workspace is built — every route in projects.mjs starts by
 * fetching a manifest, and during onboarding there is not one yet.
 *
 * Without a database there is nothing here to answer with: names and logos live in the browser that
 * built the workspace, exactly as they did before, and an invitation has nowhere to wait. That is
 * said plainly with a 503 rather than pretended, and the dialog carries on locally.
 */
export async function workspaceSetupRoutes(request, response, segments) {
  if (segments[1] !== 'projects' || !segments[2]) return false
  // Deleting the workspace is the one thing addressed at the workspace itself rather than at a part
  // of it, so it is matched on its own before the two named sub-surfaces below.
  const deleting = request.method === 'DELETE' && segments.length === 3
  if (!deleting && !['setup', 'members'].includes(segments[3])) return false

  const workspaceId = segments[2]

  // Deleting what is already deleted is not an error, and asking who is calling would make it one:
  // the membership that authorized the first deletion went with it, so `tenant` would try to claim
  // the id and be refused by the tombstone. Answered before that, and idempotently.
  if (deleting && databaseAvailable() && await workspaceDeleted(workspaceId)) return send(response, 200, { id: workspaceId, deleted: true })

  // Deleting never claims: see `tenant`. Everything else here is about a workspace that exists.
  const caller = await tenant(request, workspaceId, { claim: !deleting })

  /**
   * Deleting is allowed without a database, unlike everything else here.
   *
   * The rest of this file is about rows — a name, a logo, a membership — and without a database
   * there are none to read. A workspace's *files* exist either way, and in the infrastructure-free
   * mode they are the whole workspace, so refusing here would leave the one mode where nothing else
   * can clean up unable to delete anything.
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

  if (!databaseAvailable()) return send(response, 503, { error: 'Wesify has no database configured, so a workspace has no name, logo or team to share yet.' })
  const mayAdminister = ['owner', 'admin'].includes(String(caller?.role ?? 'owner'))

  if (segments[3] === 'setup') {
    if (request.method === 'GET') return send(response, 200, { ...(await workspaceIdentity(workspaceId)) ?? { id: workspaceId, name: '', logo: '' }, ...(await workspaceTeam(workspaceId)) })
    if (request.method === 'PUT') {
      if (!mayAdminister) return send(response, 403, { error: 'Only an owner or admin can rename this workspace.' })
      const input = await body(request)
      const saved = await saveWorkspaceIdentity(workspaceId, { name: input.name, logo: input.logo })
      await audit(workspaceId, 'workspace.identity_saved', request, { named: Boolean(input.name), logo: Boolean(input.logo) })
      return send(response, 200, saved)
    }
    return send(response, 405, { error: 'Method not allowed.' })
  }

  if (request.method === 'GET') return send(response, 200, await workspaceTeam(workspaceId))

  if (segments[4] === 'user' && segments[5]) {
    if (!mayAdminister) return send(response, 403, { error: 'Only an owner or admin can manage workspace members.' })
    const userId = decodeURIComponent(segments[5])
    if (request.method === 'PATCH') {
      const input = await body(request)
      const member = await changeWorkspaceMemberRole(workspaceId, userId, input.role, caller.role)
      await audit(workspaceId, 'workspace.member_role_changed', request, { userId: member.userId, role: member.role })
      return send(response, 200, member)
    }
    if (request.method === 'DELETE') {
      const member = await removeWorkspaceMember(workspaceId, userId, caller.role)
      await audit(workspaceId, 'workspace.member_removed', request, { userId: member.userId })
      return send(response, 200, member)
    }
    return send(response, 405, { error: 'Method not allowed.' })
  }

  if (request.method === 'POST') {
    if (!mayAdminister) return send(response, 403, { error: 'Only an owner or admin can invite somebody.' })
    const input = await body(request)
    if (caller.role !== 'owner' && input.role === 'admin') return send(response, 403, { error: 'Only the workspace owner can appoint an administrator.' })
    // The plan is weighed before the invitation is recorded, so nothing is half-done by a refusal.
    if (caller?.user) await requireTeamMembers(caller.user.id)
    const invite = await inviteToWorkspace(workspaceId, input.email, input.role, caller?.user?.id)
    await audit(workspaceId, 'workspace.invited', request, { role: invite.role })
    return send(response, 201, invite)
  }

  if (request.method === 'DELETE' && segments[4]) {
    if (!mayAdminister) return send(response, 403, { error: 'Only an owner or admin can withdraw an invitation.' })
    const email = decodeURIComponent(segments[4])
    await revokeInvite(workspaceId, email)
    await audit(workspaceId, 'workspace.invite_revoked', request, {})
    return send(response, 200, { revoked: true })
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
