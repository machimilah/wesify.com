import { apiUrl } from './apiBase'
import { accountsEnabled } from './authClient'
import { workspaceAccessHeaders } from './workspaceAccess'
import type { WorkspaceSetup } from './workspaceSetup'

/**
 * Onboarding's answers, sent to the server that can share them.
 *
 * The browser keeps its own copy either way — a name and a logo are useful to the person who typed
 * them whether or not Wesify has a database behind it — so every failure here is survivable and none
 * of it blocks a build.
 */

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

/**
 * Deletes the workspace itself: its records, its interview, and every version Wesify built of it.
 *
 * Attempted whether or not the deployment has accounts, unlike the call above. A workspace built in
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
