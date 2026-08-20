import { readLocalDiscoverySession, writeLocalDiscoverySession, type DiscoverySession } from './businessDiscovery'
import { workspaceAccessHeaders } from './workspaceAccess'

const headers = (workspaceId: string) => ({ 'content-type': 'application/json', ...workspaceAccessHeaders(workspaceId) })

export async function loadDiscoverySession(workspaceId: string) {
  const local = readLocalDiscoverySession(workspaceId)
  try {
    const response = await fetch(`/api/discovery/sessions/${workspaceId}`, { headers: headers(workspaceId) })
    if (!response.ok) return local
    const remote = await response.json() as DiscoverySession | null
    if (!remote) return local
    if (!local || Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)) {
      writeLocalDiscoverySession(remote)
      return remote
    }
  } catch { /* Local persistence keeps discovery usable when the project service is offline. */ }
  return local
}

export async function saveDiscoverySession(session: DiscoverySession) {
  writeLocalDiscoverySession(session)
  try {
    await fetch(`/api/discovery/sessions/${session.workspaceId}`, {
      method: 'PUT',
      headers: headers(session.workspaceId),
      body: JSON.stringify(session),
    })
  } catch { /* The next session update will retry; the local copy is already durable for this browser. */ }
}
