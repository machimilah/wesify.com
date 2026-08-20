const accessKey = (workspaceId: string) => `bo-workspace:${workspaceId}:access-token`

export function workspaceAccessToken(workspaceId: string) {
  const existing = localStorage.getItem(accessKey(workspaceId))
  if (existing) return existing
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  localStorage.setItem(accessKey(workspaceId), token)
  return token
}

export function workspaceAccessHeaders(workspaceId: string) {
  return { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': workspaceAccessToken(workspaceId) }
}
