import { apiUrl } from './apiBase'
import { accountsEnabled } from './authClient'
import { workspaceAccessHeaders } from './workspaceAccess'
import type { TeamInvite, WorkspaceSetup } from './workspaceSetup'

/**
 * Onboarding's answers, sent to the server that can share them.
 *
 * The browser keeps its own copy either way — a name and a logo are useful to the person who typed
 * them whether or not Wesify has a database behind it — so every failure here is survivable and none of
 * it blocks a build. The exception is an invitation: nobody else can be let in by a value in one
 * browser's storage, so a refused invite is reported rather than swallowed, and the dialog says so.
 */

export interface WorkspaceTeamMember {
  userId: string
  email: string
  role: string
  joinedAt: string
}

export interface WorkspaceTeam {
  members: WorkspaceTeamMember[]
  invites: Array<{ email: string; role: string; invitedAt: string }>
}

const headers = async (workspaceId: string) => ({ 'content-type': 'application/json', ...(await workspaceAccessHeaders(workspaceId)) })

async function failureMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null
  return payload?.error ?? fallback
}

/**
 * What this workspace is called and what it looks like, for everybody rather than one browser.
 *
 * Not attempted at all where the deployment has no accounts: there is no workspace row to name, the
 * server would answer 503, and a failed request in the console of a prototype that is working
 * exactly as intended is noise somebody has to learn to ignore.
 */
export async function publishWorkspaceIdentity(workspaceId: string, setup: Pick<WorkspaceSetup, 'name' | 'logo'>) {
  if (!(await accountsEnabled())) return false
  try {
    const response = await fetch(apiUrl(`/api/projects/${workspaceId}/setup`), {
      method: 'PUT',
      headers: await headers(workspaceId),
      body: JSON.stringify({ name: setup.name, logo: setup.logo }),
    })
    return response.ok
  } catch {
    // No server, or no database behind it. The local copy is already saved.
    return false
  }
}

export async function loadWorkspaceTeam(workspaceId: string): Promise<WorkspaceTeam | null> {
  if (!(await accountsEnabled())) return null
  try {
    const response = await fetch(apiUrl(`/api/projects/${workspaceId}/members`), { headers: await headers(workspaceId) })
    if (!response.ok) return null
    return await response.json() as WorkspaceTeam
  } catch {
    return null
  }
}

/**
 * Sends every invitation, and says which ones did not go.
 *
 * One request each rather than a batch, so a single bad address or a plan limit reached halfway
 * through does not discard the invitations that were fine. What comes back is the list to show:
 * silence would leave an operator believing four colleagues were invited when the plan allowed none.
 */
export async function sendInvites(workspaceId: string, invites: TeamInvite[]) {
  const sent: string[] = []
  const failed: Array<{ email: string; message: string }> = []
  // Said rather than swallowed: on a deployment with no accounts there is nobody an invitation could
  // reach, and quietly dropping them would be a promise Wesify cannot keep.
  if (!(await accountsEnabled())) return { sent, failed: invites.map(invite => ({ email: invite.email, message: 'This Wesify has no accounts configured, so it cannot invite anybody yet.' })) }
  for (const invite of invites) {
    try {
      const response = await fetch(apiUrl(`/api/projects/${workspaceId}/members`), {
        method: 'POST',
        headers: await headers(workspaceId),
        body: JSON.stringify({ email: invite.email, role: invite.role }),
      })
      if (response.ok) sent.push(invite.email)
      else failed.push({ email: invite.email, message: await failureMessage(response, 'Wesify could not send that invitation.') })
    } catch {
      failed.push({ email: invite.email, message: 'Wesify could not reach the server to send that invitation.' })
    }
  }
  return { sent, failed }
}

export async function revokeInvite(workspaceId: string, email: string) {
  if (!(await accountsEnabled())) return false
  try {
    const response = await fetch(apiUrl(`/api/projects/${workspaceId}/members/${encodeURIComponent(email)}`), {
      method: 'DELETE',
      headers: await headers(workspaceId),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Deletes the workspace itself: its records, its members, its invitations, and every version Wesify
 * built of it.
 *
 * Attempted whether or not the deployment has accounts, unlike the calls above. A workspace built in
 * a browser against a server with no database still has files on that server, and the local copies
 * this browser holds are not the whole of it — so the request goes out either way, and only a
 * refusal by the server stops the removal.
 */
export async function deleteWorkspace(workspaceId: string) {
  let response: Response
  try {
    response = await fetch(apiUrl(`/api/projects/${workspaceId}`), {
      method: 'DELETE',
      headers: await headers(workspaceId),
    })
  } catch {
    // No server answered at all. A workspace built here without one is this browser's alone, so the
    // deletion still stands — `reached` is what lets the interface say the rest of the truth.
    return { id: workspaceId, deleted: true as const, reached: false }
  }
  if (!response.ok) throw new Error(await failureMessage(response, 'Wesify could not delete that workspace.'))
  return { ...(await response.json() as { id: string; deleted: true }), reached: true }
}

async function manageMember(workspaceId: string, userId: string, method: 'PATCH' | 'DELETE', payload?: { role: string }) {
  if (!(await accountsEnabled())) throw new Error('Team management requires authenticated accounts.')
  const response = await fetch(apiUrl(`/api/projects/${workspaceId}/members/user/${encodeURIComponent(userId)}`), {
    method,
    headers: await headers(workspaceId),
    body: payload ? JSON.stringify(payload) : undefined,
  })
  if (!response.ok) throw new Error(await failureMessage(response, 'Wesify could not update that workspace member.'))
  return response.json()
}

export function changeWorkspaceMemberRole(workspaceId: string, userId: string, role: string) {
  return manageMember(workspaceId, userId, 'PATCH', { role })
}

export function removeWorkspaceMember(workspaceId: string, userId: string) {
  return manageMember(workspaceId, userId, 'DELETE')
}
