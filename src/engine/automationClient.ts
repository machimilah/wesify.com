import { apiUrl } from './apiBase'
import { workspaceAccessHeaders } from './workspaceAccess'

export type ConnectorType = 'make-webhook' | 'n8n-webhook' | 'generic-webhook'
export interface AutomationConnector { id: string; name: string; type: ConnectorType; endpointHost: string; status: 'connected' | 'error'; createdAt: string }
export type WorkflowFieldValue = string | number | boolean
export type ManagedAutomationAction =
  | { type: 'webhook'; connectorId: string }
  | { type: 'notification' | 'approval'; message: string }
  | { type: 'create-record' | 'update-record'; entityId: string; fields: Record<string, WorkflowFieldValue> }
export type WorkflowConditionOperator = 'equals' | 'not-equals' | 'contains' | 'greater-than' | 'less-than' | 'is-empty' | 'is-not-empty'
export interface WorkflowPosition { x: number; y: number }
export type WorkflowScheduleCadence = 'hourly' | 'daily' | 'weekly'
export interface WorkflowSchedule { cadence: WorkflowScheduleCadence; time: string; timezone: string; weekday?: number }
export type WorkflowNode =
  | { id: string; type: 'trigger'; position: WorkflowPosition; config: { entityId: string; event: string; schedule?: WorkflowSchedule } }
  | { id: string; type: 'condition'; position: WorkflowPosition; config: { field: string; operator: WorkflowConditionOperator; value: string } }
  | { id: string; type: 'action'; position: WorkflowPosition; config: ManagedAutomationAction }
export interface WorkflowEdge { id: string; source: string; target: string; sourceHandle?: 'true' | 'false' }
export interface WorkflowGraph { version: 1; nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export interface ManagedAutomation { id: string; planKey?: string; origin?: 'generated' | 'manual' | 'ai'; name: string; summary?: string; rationale?: string; model?: string; risk?: 'low' | 'medium' | 'high'; humanControl?: 'none' | 'exception' | 'approval-required'; reviewStatus?: 'draft' | 'approved'; steps?: string[]; enabled: boolean; trigger: { event: 'created' | 'updated' | 'scheduled' | string; entityId: string; field?: string; equals?: string; schedule?: WorkflowSchedule }; action: ManagedAutomationAction; graph?: WorkflowGraph; draftGraph?: WorkflowGraph; version?: number; publishedAt?: string; hasUnpublishedChanges?: boolean; createdAt: string; updatedAt: string }
export interface AutomationApproval { id: string; runId?: string; nodeId?: string; automationId: string; automationName: string; message: string; entityId: string; recordId: string; status: 'pending' | 'approved' | 'rejected'; requestedAt: string; decidedAt?: string; comment?: string }
export interface AutomationNodeRun { nodeId: string; nodeType: WorkflowNode['type']; status: 'success' | 'failed' | 'waiting' | 'skipped'; output?: { summary?: string; result?: boolean; responseStatus?: number; attempts?: number; recordId?: string }; error?: string; startedAt: string; finishedAt: string }
export interface AutomationRun { id: string; automationId: string; automationName: string; workflowVersion?: number; status: 'success' | 'failed' | 'simulated' | 'waiting' | 'cancelled'; event: string; entityId: string; recordId: string; responseStatus?: number; error?: string; retryOf?: string; attempt?: number; nodeRuns?: AutomationNodeRun[]; startedAt: string; finishedAt: string }
export interface AutomationWorkspace { connectors: AutomationConnector[]; automations: ManagedAutomation[]; approvals: AutomationApproval[]; runs: AutomationRun[] }
export interface AutomationPlanRequest { instruction: string; automationId?: string; currentGraph?: WorkflowGraph }
export interface AutomationPlanResult { automation: ManagedAutomation; model: string; source: 'ai' | 'rules'; safeguards: string[] }

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

export function deleteAutomationConnector(workspaceId: string, connectorId: string) {
  return request<{ removed: true }>(workspaceId, apiUrl(`/api/projects/${workspaceId}/connectors/${connectorId}`), { method: 'DELETE' })
}

export function createManagedAutomation(workspaceId: string, input: { name: string; graph: WorkflowGraph } | { name: string; entityId: string; event: 'created' | 'updated'; connectorId: string }) {
  return request<ManagedAutomation>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations`), { method: 'POST', body: JSON.stringify(input) })
}

export function updateManagedAutomation(workspaceId: string, automationId: string, input: { name?: string; draftGraph?: WorkflowGraph; publish?: boolean; enabled?: boolean }) {
  return request<ManagedAutomation>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/${automationId}`), { method: 'PATCH', body: JSON.stringify(input) })
}

export function setManagedAutomationEnabled(workspaceId: string, automationId: string, enabled: boolean) {
  return updateManagedAutomation(workspaceId, automationId, { enabled })
}

export function deleteManagedAutomation(workspaceId: string, automationId: string) {
  return request<{ ok: true }>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/${automationId}`), { method: 'DELETE' })
}

export function testManagedAutomation(workspaceId: string, automationId: string, sendLive = false) {
  return request<AutomationRun>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/${automationId}/test`), { method: 'POST', body: JSON.stringify({ dryRun: !sendLive }) })
}

export function planManagedAutomation(workspaceId: string, input: AutomationPlanRequest) {
  return request<AutomationPlanResult>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/plan`), { method: 'POST', body: JSON.stringify(input) })
}

export function retryAutomationRun(workspaceId: string, runId: string, mode: 'current' | 'original' = 'current') {
  return request<AutomationRun>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/runs/${runId}/retry`), { method: 'POST', body: JSON.stringify({ mode }) })
}

export function respondToAutomationApproval(workspaceId: string, approvalId: string, decision: 'approved' | 'rejected', comment = '') {
  return request<AutomationApproval>(workspaceId, apiUrl(`/api/projects/${workspaceId}/automations/approvals/${approvalId}`), { method: 'PATCH', body: JSON.stringify({ decision, comment }) })
}
