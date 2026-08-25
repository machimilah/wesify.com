import { apiUrl } from './apiBase'
import { workspaceAccessHeaders } from './workspaceAccess'

export type ConnectorType = 'make-webhook' | 'generic-webhook'
export interface AutomationConnector { id: string; name: string; type: ConnectorType; endpointHost: string; status: 'connected' | 'error'; createdAt: string }
export interface ManagedAutomation { id: string; name: string; enabled: boolean; trigger: { event: 'created' | 'updated'; entityId: string }; action: { type: 'webhook'; connectorId: string }; createdAt: string; updatedAt: string }
export interface AutomationRun { id: string; automationId: string; automationName: string; status: 'success' | 'failed' | 'simulated'; event: string; entityId: string; recordId: string; responseStatus?: number; error?: string; startedAt: string; finishedAt: string }
export interface AutomationWorkspace { connectors: AutomationConnector[]; automations: ManagedAutomation[]; runs: AutomationRun[] }

async function request<T>(workspaceId: string, path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { ...(await workspaceAccessHeaders(workspaceId)), 'x-bo-role': 'owner', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? 'Automation service is unavailable.')
  return payload as T
}

export function loadAutomationWorkspace(workspaceId: string) {
  return request<AutomationWorkspace>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations`))
}

export function createAutomationConnector(workspaceId: string, input: { name: string; type: ConnectorType; endpointUrl: string }) {
  return request<AutomationConnector>(workspaceId, apiUrl(`/api/projects/${workspaceId}/connectors`), { method: 'POST', body: JSON.stringify(input) })
}

export function createManagedAutomation(workspaceId: string, input: { name: string; entityId: string; event: 'created' | 'updated'; connectorId: string }) {
  return request<ManagedAutomation>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations`), { method: 'POST', body: JSON.stringify(input) })
}

export function setManagedAutomationEnabled(workspaceId: string, automationId: string, enabled: boolean) {
  return request<ManagedAutomation>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/${automationId}`), { method: 'PATCH', body: JSON.stringify({ enabled }) })
}

export function testManagedAutomation(workspaceId: string, automationId: string, sendLive = false) {
  return request<AutomationRun>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/${automationId}/test`), { method: 'POST', body: JSON.stringify({ dryRun: !sendLive }) })
}
