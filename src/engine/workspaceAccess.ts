import { sessionHeaders } from './authClient'

/**
 * What identifies the caller of a workspace request.
 *
 * Two things travel, because BO runs in two modes. The session token is what the server uses when it
 * has accounts: a workspace belongs to an account and a stranger is refused. The self-issued token is
 * what the prototype used before accounts existed, and it still works when no database is configured.
 * The server decides which it trusts; sending both means the interface does not have to know.
 */
const accessKey = (workspaceId: string) => `bo-workspace:${workspaceId}:access-token`

export function workspaceAccessToken(workspaceId: string) {
  const existing = localStorage.getItem(accessKey(workspaceId))
  if (existing) return existing
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  localStorage.setItem(accessKey(workspaceId), token)
  return token
}

export function workspaceAccessHeaders(workspaceId: string): Record<string, string> {
  return { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': workspaceAccessToken(workspaceId), ...sessionHeaders() }
}
