import { apiUrl } from './apiBase'
import { workspaceAccessHeaders } from './workspaceAccess'

/**
 * Talking to the connected-app endpoints.
 *
 * Nothing here ever receives a credential back — the server does not return one. What the interface
 * knows is that a connection exists, when it last synced, and what came in.
 */

export interface ConnectedApp {
  providerId: string
  mode: 'read' | 'read-write'
  account: string
  connectedAt: string
  lastSyncAt: string
  lastSyncCounts: Record<string, { added: number; updated: number; missing: number }> | null
  lastError: string
  hasCredential: boolean
}

async function readOrThrow(response: Response) {
  if (response.ok) return response.json()
  const detail = await response.json().catch(() => ({}))
  throw new Error(detail.error || `Wesify could not reach the connected app (${response.status}).`)
}

export async function loadConnectedApps(workspaceId: string): Promise<ConnectedApp[]> {
  try {
    const response = await fetch(apiUrl(`/api/connections/${workspaceId}`), { headers: workspaceAccessHeaders(workspaceId) })
    return response.ok ? await response.json() : []
  } catch {
    return []
  }
}

export async function connectStripe(workspaceId: string, apiKey: string): Promise<ConnectedApp> {
  return readOrThrow(await fetch(apiUrl(`/api/connections/${workspaceId}/stripe`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...workspaceAccessHeaders(workspaceId) },
    body: JSON.stringify({ apiKey }),
  }))
}

export async function syncConnectedApp(workspaceId: string, providerId: string) {
  return readOrThrow(await fetch(apiUrl(`/api/connections/${workspaceId}/${providerId}/sync`), {
    method: 'POST',
    headers: workspaceAccessHeaders(workspaceId),
  })) as Promise<{ connection: ConnectedApp; counts: Record<string, { added: number; updated: number; missing: number }> }>
}

export async function disconnectApp(workspaceId: string, providerId: string) {
  return readOrThrow(await fetch(apiUrl(`/api/connections/${workspaceId}/${providerId}`), {
    method: 'DELETE',
    headers: workspaceAccessHeaders(workspaceId),
  }))
}

/** "12 added · 4 updated" — what actually changed, in one line. */
export function syncSummary(counts: ConnectedApp['lastSyncCounts']) {
  if (!counts) return ''
  const total = Object.values(counts).reduce((sum, item) => ({ added: sum.added + item.added, updated: sum.updated + item.updated, missing: sum.missing + item.missing }), { added: 0, updated: 0, missing: 0 })
  return [
    total.added ? `${total.added} added` : '',
    total.updated ? `${total.updated} updated` : '',
    total.missing ? `${total.missing} no longer there` : '',
  ].filter(Boolean).join(' · ') || 'nothing changed'
}
