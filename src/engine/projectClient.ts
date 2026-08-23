import type { WorkspaceAction, WorkspaceRecords } from './workspaceActions'
import type { WorkspaceConfiguration } from './workspaceSchema'
import { workspaceAccessHeaders } from './workspaceAccess'

export interface GeneratedProjectManifest {
  workspaceId: string
  companyType: string
  version: number
  previousVersion: number | null
  changeDescription: string
  buildStatus: 'GENERATING' | 'TESTING' | 'REPAIRING' | 'PREVIEW_READY' | 'HEALTHY' | 'FAILED'
  pages: WorkspaceConfiguration['navigation']
  entities: WorkspaceConfiguration['entities']
  relationships: Array<{ from: string; field: string; to: string }>
  workflows: WorkspaceConfiguration['workflows']
  metrics: WorkspaceConfiguration['metrics']
  actionRegistry: Array<{ id: string; entityId: string; operation: string }>
  specializedComponents: Array<{ id: string; kind: 'metric' | 'breakdown' | 'timeline'; label: string; entityId: string }>
  generatedFiles: string[]
  lastBuild: string
  specification: WorkspaceConfiguration
}

export interface GeneratedRuntime {
  workspaceId: string
  version: number
  widgets: GeneratedProjectManifest['specializedComponents']
  entities: Array<{ id: string; primaryField: string }>
  projectCost: (records: WorkspaceRecords, projectId: string) => number
  mostExpensiveProject: (records: WorkspaceRecords) => { project: Record<string, unknown>; cost: number } | null
  selfTest: () => boolean
}

export interface WorkspaceNotification {
  id: string
  message: string
  entityId: string
  recordId: string
  createdAt: string
  read: boolean
}

export interface WorkspaceAuditEvent {
  id: string
  event: string
  role: string
  at: string
  detail: Record<string, string | number | boolean>
}

function workspaceRole(workspaceId: string) {
  try { return JSON.parse(localStorage.getItem(`bo-workspace:${workspaceId}:role`) ?? '"owner"') as string }
  catch { return 'owner' }
}

const headers = (workspaceId: string, json = false) => ({ ...workspaceAccessHeaders(workspaceId), 'x-bo-role': workspaceRole(workspaceId), ...(json ? { 'content-type': 'application/json' } : {}) })

async function request<T>(workspaceId: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...headers(workspaceId, Boolean(init.body)), ...init.headers } })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'BO project service is unavailable.' }))
    throw new Error(error.error ?? 'BO project service is unavailable.')
  }
  return response.json() as Promise<T>
}

export async function ensureGeneratedProject(config: WorkspaceConfiguration) {
  return request<GeneratedProjectManifest>(config.id, '/api/builds', { method: 'POST', body: JSON.stringify({ workspaceId: config.id, specification: config, changeDescription: 'Initial Command Center' }) })
}

export function buildGeneratedChange(config: WorkspaceConfiguration, action: WorkspaceAction, description: string) {
  return request<GeneratedProjectManifest>(config.id, `/api/projects/${config.id}/changes`, { method: 'POST', body: JSON.stringify({ specification: config, changeDescription: description, changeType: action.type }) })
}

export function promoteGeneratedChange(workspaceId: string, version: number) {
  return request<GeneratedProjectManifest>(workspaceId, `/api/projects/${workspaceId}/promote`, { method: 'POST', body: JSON.stringify({ version }) })
}

export function loadGeneratedRecords(workspaceId: string) {
  return request<WorkspaceRecords>(workspaceId, `/api/projects/${workspaceId}/records`)
}

export function loadWorkspaceNotifications(workspaceId: string) {
  return request<WorkspaceNotification[]>(workspaceId, `/api/projects/${workspaceId}/notifications`)
}

export function markWorkspaceNotificationRead(workspaceId: string, notificationId: string) {
  return request<WorkspaceNotification>(workspaceId, `/api/projects/${workspaceId}/notifications/${notificationId}`, { method: 'PATCH', body: JSON.stringify({ read: true }) })
}

export function loadWorkspaceAudit(workspaceId: string) {
  return request<WorkspaceAuditEvent[]>(workspaceId, `/api/projects/${workspaceId}/audit`)
}

/**
 * Downloads everything the workspace holds, as one file.
 *
 * BO tells people their records stay theirs even if they stop paying. This is what makes that a
 * fact rather than a reassurance — and it is fetched rather than linked because the request needs
 * the workspace headers, which a plain anchor cannot send.
 */
export async function exportWorkspace(workspaceId: string) {
  const payload = await request<Record<string, unknown>>(workspaceId, `/api/projects/${workspaceId}/export`)
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `bo-${workspaceId}-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next tick rather than immediately: some browsers have not started reading the
  // blob by the time click() returns, and revoking early gives the person an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return payload
}

export async function executeGeneratedRecordAction(workspaceId: string, action: WorkspaceAction) {
  if (action.type === 'create_record') return request<Record<string, unknown>>(workspaceId, `/api/projects/${workspaceId}/records/${action.entityId}`, { method: 'POST', body: JSON.stringify(action.values) })
  if (action.type === 'update_record') return request<Record<string, unknown>>(workspaceId, `/api/projects/${workspaceId}/records/${action.entityId}/${action.recordId}`, { method: 'PATCH', body: JSON.stringify(action.values) })
  if (action.type === 'delete_record') return request<{ deleted: boolean }>(workspaceId, `/api/projects/${workspaceId}/records/${action.entityId}/${action.recordId}`, { method: 'DELETE' })
  throw new Error('This is a project change, not a record action.')
}

export function queryGeneratedProject<T>(workspaceId: string, query: string) {
  return request<T>(workspaceId, `/api/projects/${workspaceId}/query`, { method: 'POST', body: JSON.stringify({ query }) })
}

export async function loadGeneratedRuntime(manifest: GeneratedProjectManifest): Promise<GeneratedRuntime> {
  const response = await fetch(`/api/projects/${manifest.workspaceId}/runtime.mjs?version=${manifest.version}`, { headers: headers(manifest.workspaceId) })
  if (!response.ok) throw new Error('BO could not mount the generated workspace runtime.')
  const source = await response.text()
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try { return await import(/* @vite-ignore */ url) as GeneratedRuntime } finally { URL.revokeObjectURL(url) }
}

export function listGeneratedVersions(workspaceId: string) {
  return request<Array<{ version: number; changeDescription: string; createdAt: string; status: string }>>(workspaceId, `/api/projects/${workspaceId}/versions`)
}

export function rollbackGeneratedProject(workspaceId: string, version: number) {
  return request<GeneratedProjectManifest>(workspaceId, `/api/projects/${workspaceId}/rollback`, { method: 'POST', body: JSON.stringify({ version }) })
}
