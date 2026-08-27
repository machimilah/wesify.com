import { apiUrl } from './apiBase'
import { capabilityCatalogPrompt } from './capabilityCatalog'
import { workspaceAccessHeaders } from './workspaceAccess'
import type { CompiledBusinessAgent } from './agentArchitecture'
import type { BusinessRecord, WorkspaceRecords } from './workspaceActions'
import type { WorkspaceConfiguration } from './workspaceSchema'

/**
 * The workspace agent, asked of the server.
 *
 * The browser model stays as the fallback — a workspace with no key configured must still answer —
 * but it is the fallback now rather than the only path. Everything about how this behaves when it
 * fails is copied from the interview client, for the same reason: an agent that stops working
 * because a key expired should degrade, not break.
 */

export type AgentMode = 'command' | 'build'

export interface AgentPlanField {
  label: string
  type: string
  required?: boolean
  options?: string[]
  relatedTo?: string
}

export interface AgentPlan {
  label: string
  module: string
  capabilityIds: string[]
  entities: Array<{ name: string; purpose: string; fields: AgentPlanField[]; states?: string[] }>
  entityUpdates: Array<{ entityId: string; fields: AgentPlanField[] }>
  workflows: Array<{ name: string; entity: string; event: 'created' | 'updated'; conditionField?: string; conditionEquals?: string; message: string }>
  metrics: Array<{ label: string; entity: string; operation: 'count' | 'sum'; field?: string; statusNotEquals?: string }>
}

export interface AgentTurn {
  decision: string
  message: string
  question?: string
  mode: AgentMode
  model: string
  action?: Record<string, unknown>
  plan?: AgentPlan
}

let availability: Promise<boolean> | null = null

/** Cached for the session: the answer cannot change without a server restart. */
export function serverAgentAvailable(): Promise<boolean> {
  availability ??= fetch(apiUrl('/api/agent/status'))
    .then(response => response.ok ? response.json() : { available: false })
    .then(status => status.available === true)
    .catch(() => false)
  return availability
}

let lastIssue = ''
/** Why the last server turn was not used, so a silent fallback is never indistinguishable from broken. */
export function lastAgentIssue() { return lastIssue }

let lastModel = ''
export function lastAgentModel() { return lastModel }

/**
 * What the agent is allowed to see.
 *
 * Field ids and labels rather than values, and a sample of records rather than the table: this is
 * sent to a model, so the least that will do the job is what goes. The catalog goes with it in
 * build mode only, because it is twenty thousand characters and a command against existing records
 * has no use for it.
 */
export function agentContext(config: WorkspaceConfiguration, records: WorkspaceRecords, options: { mode: AgentMode; agent?: CompiledBusinessAgent }) {
  const accessible = config.entities.filter(entity => !options.agent || options.agent.accessibleEntityIds.includes(entity.id))
  const accessibleIds = new Set(accessible.map(entity => entity.id))
  const sample = (entity: { id: string; primaryField: string }) => (records[entity.id] ?? []).slice(0, 12).map((record: BusinessRecord) => ({
    entityId: entity.id,
    id: record.id,
    label: String(record[entity.primaryField] ?? ''),
    status: record.status,
    amount: record.amount,
    dueDate: record.dueDate,
  }))
  return {
    company: { name: config.profile.companyName, industry: config.profile.industry, description: config.profile.description },
    actingAgent: options.agent ? { label: options.agent.label, permissions: options.agent.permissions } : null,
    modules: config.modules,
    activeCapabilities: config.capabilities ?? [],
    catalog: options.mode === 'build' ? capabilityCatalogPrompt() : '',
    entities: accessible.map(entity => ({
      id: entity.id,
      label: entity.label,
      pluralLabel: entity.pluralLabel,
      primaryField: entity.primaryField,
      fields: entity.fields.map(field => ({ id: field.id, label: field.label, type: field.type, options: field.options, relationEntityId: field.relationEntityId })),
    })),
    navigation: config.navigation.filter(item => !item.viewId || accessible.some(entity => config.views.some(view => view.id === item.viewId && view.entityId === entity.id))).map(item => ({ id: item.id, label: item.label, kind: item.kind })),
    workflows: config.workflows.filter(workflow => accessibleIds.has(workflow.trigger.entityId)).map(item => ({ id: item.id, name: item.name, trigger: { entityId: item.trigger.entityId } })),
    records: accessible.flatMap(sample).slice(0, 80),
  }
}

/** One turn. Returns null when the server could not answer, so the caller can fall back. */
export async function requestAgentTurn(workspaceId: string, command: string, mode: AgentMode, context: ReturnType<typeof agentContext>): Promise<AgentTurn | null> {
  lastIssue = ''
  if (!await serverAgentAvailable()) {
    lastIssue = 'No model is configured on the server, so Wesify used its in-browser model. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY and restart it.'
    return null
  }
  try {
    const response = await fetch(apiUrl(`/api/agent/${workspaceId}/turn`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await workspaceAccessHeaders(workspaceId)) },
      body: JSON.stringify({ command, mode, context }),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      lastIssue = String(detail.error || `The workspace agent returned ${response.status}.`)
      return null
    }
    const turn = await response.json() as AgentTurn
    lastModel = String(turn.model ?? '')
    return turn
  } catch (error) {
    lastIssue = error instanceof Error ? error.message : 'Wesify could not reach the workspace agent.'
    return null
  }
}
