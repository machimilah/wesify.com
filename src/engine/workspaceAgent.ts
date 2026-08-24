import { generateLocalStructuredJson } from './discoveryModel'
import { createCapabilityActivation, createCapabilityRemoval } from './capabilityActions'
import { capabilityCatalog } from './capabilityCatalog'
import type { BusinessRecord, WorkspaceAction, WorkspaceRecords } from './workspaceActions'
import type { EntityDefinition, FieldType, NavigationDefinition, ViewDefinition, WorkflowDefinition, WorkspaceConfiguration } from './workspaceSchema'
import { slug } from './shared'
import { agentAllows, selectBusinessAgent, type CompiledBusinessAgent } from './agentArchitecture'
import type { BusinessAgentPermission } from '../data/businessAgentCatalog'
import { evaluateActionControl } from './governanceArchitecture'

type AgentDecision = 'EXECUTE' | 'PREVIEW' | 'ANSWER' | 'CLARIFY'
type AgentActionKind = 'none' | 'create_record' | 'update_record' | 'delete_record' | 'add_field' | 'add_collection' | 'add_capability' | 'remove_capability' | 'create_workflow' | 'navigate' | 'query'

interface ModelWorkspaceAction {
  kind: AgentActionKind
  entityId: string
  recordId: string
  navigationId: string
  collectionName: string
  capabilityId: string
  values: Array<{ field: string; value: string }>
  field: { id: string; label: string; type: FieldType; required: boolean }
  workflow: { name: string; entityId: string; event: 'created' | 'updated'; conditionField: string; conditionEquals: string; message: string }
}

export interface WorkspaceAgentResponse {
  decision: AgentDecision
  message: string
  action: ModelWorkspaceAction
}

declare global {
  interface Window {
    __BO_WORKSPACE_AGENT_MOCK__?: (command: string, config: WorkspaceConfiguration, records: WorkspaceRecords) => Promise<WorkspaceAgentResponse>
  }
}

const fieldTypes: FieldType[] = ['text', 'long-text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'select', 'relation', 'file']
const actionKinds: AgentActionKind[] = ['none', 'create_record', 'update_record', 'delete_record', 'add_field', 'add_collection', 'add_capability', 'remove_capability', 'create_workflow', 'navigate', 'query']

const responseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['EXECUTE', 'PREVIEW', 'ANSWER', 'CLARIFY'] },
    message: { type: 'string', maxLength: 300 },
    action: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: actionKinds }, entityId: { type: 'string', maxLength: 60 }, recordId: { type: 'string', maxLength: 80 }, navigationId: { type: 'string', maxLength: 60 }, collectionName: { type: 'string', maxLength: 60 }, capabilityId: { type: 'string', maxLength: 80 },
        values: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { field: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 240 } }, required: ['field', 'value'] } },
        field: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', maxLength: 60 }, label: { type: 'string', maxLength: 80 }, type: { type: 'string', enum: fieldTypes }, required: { type: 'boolean' } }, required: ['id', 'label', 'type', 'required'] },
        workflow: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 120 }, entityId: { type: 'string', maxLength: 60 }, event: { type: 'string', enum: ['created', 'updated'] }, conditionField: { type: 'string', maxLength: 60 }, conditionEquals: { type: 'string', maxLength: 80 }, message: { type: 'string', maxLength: 180 } }, required: ['name', 'entityId', 'event', 'conditionField', 'conditionEquals', 'message'] },
      },
      required: ['kind', 'entityId', 'recordId', 'navigationId', 'collectionName', 'capabilityId', 'values', 'field', 'workflow'],
    },
  }, required: ['decision', 'message', 'action'],
}

const system = `You are Wesify, the operating agent inside a custom Business Command Center. Translate the user's request into one safe structured action using only the supplied workspace schema and records.
Act within the supplied actingAgent scope. Use only its accessible entities, permissions and tools. Respect every prohibited action and escalation rule. All agents read and write the same shared company state; never invent or maintain a private version of company information.
Use create_record, update_record, delete_record, add_field, add_collection, add_capability, remove_capability, create_workflow, navigate, or query. Never invent capability IDs, entity IDs, navigation IDs, record IDs, field IDs, or business data. Use IDs exactly as supplied. Put all field values in values.
EXECUTE non-destructive record creation/updates, navigation, and queries. PREVIEW deletion and every structural change. CLARIFY when required information is missing or a target is ambiguous. ANSWER only from supplied data and say when data is unavailable.
Prefer add_capability over add_collection whenever the request matches an available capability; a capability installs its complete dependency-aware operating package. remove_capability removes a complete active capability, but CLARIFY if another active capability depends on it. add_collection is only for a genuinely company-specific record type absent from the catalog. create_workflow creates an event-driven notification. query opens the relevant records and reports their count; do not calculate unsupported financial answers.
Return only schema-valid JSON. Do not expose chain-of-thought.`

function recordContext(config: WorkspaceConfiguration, records: WorkspaceRecords, agent?: CompiledBusinessAgent) {
  return config.entities.filter(entity => !agent || agent.accessibleEntityIds.includes(entity.id)).flatMap(entity => (records[entity.id] ?? []).slice(0, 12).map(record => ({ entityId: entity.id, id: record.id, label: String(record[entity.primaryField] ?? ''), status: record.status, amount: record.amount, dueDate: record.dueDate }))).slice(0, 60)
}

function parseValue(value: string, type: FieldType) {
  if (type === 'number' || type === 'currency') return Number(value) || 0
  if (type === 'boolean') return /^(true|yes|1|on)$/i.test(value)
  return value
}


function toWorkspaceAction(result: WorkspaceAgentResponse, config: WorkspaceConfiguration, agent?: CompiledBusinessAgent): WorkspaceAction | undefined {
  const candidate = result.action
  if (!actionKinds.includes(candidate.kind) || candidate.kind === 'none') return undefined
  if (agent && !agentAllows(agent, candidate.kind)) return undefined
  const entity = config.entities.find(item => item.id === candidate.entityId)
  if (candidate.kind === 'navigate') return config.navigation.some(item => item.id === candidate.navigationId) ? { type: 'navigate', navigationId: candidate.navigationId } : undefined
  if (candidate.kind === 'query') return entity ? { type: 'query_business_data', entityId: entity.id } : undefined
  if (candidate.kind === 'add_capability' && candidate.capabilityId) return createCapabilityActivation(config, candidate.capabilityId)
  if (candidate.kind === 'remove_capability' && candidate.capabilityId) return createCapabilityRemoval(config, candidate.capabilityId)
  if (candidate.kind === 'create_record' && entity) {
    const values = Object.fromEntries(candidate.values.filter(item => entity.fields.some(field => field.id === item.field)).map(item => {
      const definition = entity.fields.find(field => field.id === item.field)!
      return [item.field, parseValue(item.value, definition.type)]
    }))
    return { type: 'create_record', entityId: entity.id, values }
  }
  if (candidate.kind === 'update_record' && entity && candidate.recordId) {
    const values = Object.fromEntries(candidate.values.filter(item => entity.fields.some(field => field.id === item.field)).map(item => {
      const definition = entity.fields.find(field => field.id === item.field)!
      return [item.field, parseValue(item.value, definition.type)]
    }))
    return { type: 'update_record', entityId: entity.id, recordId: candidate.recordId, values }
  }
  if (candidate.kind === 'delete_record' && entity && candidate.recordId) return { type: 'delete_record', entityId: entity.id, recordId: candidate.recordId }
  if (candidate.kind === 'add_field' && entity && candidate.field.id && fieldTypes.includes(candidate.field.type)) return { type: 'add_field', entityId: entity.id, field: { id: slug(candidate.field.id), label: candidate.field.label, type: candidate.field.type, required: candidate.field.required } }
  if (candidate.kind === 'create_workflow') {
    const workflowEntity = config.entities.find(item => item.id === candidate.workflow.entityId)
    if (!workflowEntity) return undefined
    const workflow: WorkflowDefinition = { id: crypto.randomUUID(), name: candidate.workflow.name, enabled: true, trigger: { entityId: workflowEntity.id, event: candidate.workflow.event, ...(candidate.workflow.conditionField ? { field: candidate.workflow.conditionField, equals: candidate.workflow.conditionEquals } : {}) }, action: { type: 'notify', message: candidate.workflow.message } }
    return { type: 'create_workflow', workflow }
  }
  if (candidate.kind === 'add_collection' && candidate.collectionName) {
    const id = slug(candidate.collectionName)
    if (!id || config.entities.some(item => item.id === id)) return undefined
    const label = candidate.collectionName.replace(/s$/i, '')
    const newEntity: EntityDefinition = { id, label, pluralLabel: candidate.collectionName, module: id, primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Active', 'Paused', 'Complete'] }, { id: 'notes', label: 'Notes', type: 'long-text' }] }
    const view: ViewDefinition = { id: `${id}-table`, label: newEntity.pluralLabel, entityId: id, type: 'table', columns: ['name', 'status', 'notes'] }
    const navigation: NavigationDefinition = { id, label: newEntity.pluralLabel, kind: 'entity', viewId: view.id, module: id }
    return { type: 'activate_module', module: id, entities: [newEntity], views: [view], navigation: [navigation] }
  }
  return undefined
}

function validate(value: unknown): WorkspaceAgentResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid workspace-agent response.')
  const response = value as Partial<WorkspaceAgentResponse>
  if (!['EXECUTE', 'PREVIEW', 'ANSWER', 'CLARIFY'].includes(String(response.decision)) || typeof response.message !== 'string' || !response.action || !actionKinds.includes(response.action.kind)) throw new Error('Invalid workspace-agent response.')
  return response as WorkspaceAgentResponse
}

export async function askWorkspaceAgent(command: string, config: WorkspaceConfiguration, records: WorkspaceRecords, onActivity?: (label: string) => void) {
  const actingAgent = selectBusinessAgent(command, config)
  const authorizingAgent = config.agents?.length ? actingAgent : undefined
  if (window.__BO_WORKSPACE_AGENT_MOCK__) {
    const response = await window.__BO_WORKSPACE_AGENT_MOCK__(command, config, records)
    const allowed = !authorizingAgent || response.action.kind === 'none' || agentAllows(authorizingAgent, response.action.kind)
    const guarded = allowed ? response : { ...response, decision: 'CLARIFY' as const, message: `${actingAgent?.label ?? 'Wesify'} cannot perform that action within its current scope.` }
    const action = toWorkspaceAction(guarded, config, authorizingAgent)
    const control = action ? evaluateActionControl(config, action, { agentApprovalRequired: authorizingAgent?.approvalRequired.includes(response.action.kind as BusinessAgentPermission) }) : undefined
    const controlled = control?.requiresApproval ? { ...guarded, decision: 'PREVIEW' as const } : guarded
    return { response: controlled, action, agent: actingAgent, control }
  }
  const accessibleEntities = config.entities.filter(entity => !actingAgent || actingAgent.accessibleEntityIds.includes(entity.id))
  const context = {
    command,
    actingAgent,
    workspace: { company: config.profile, sharedState: actingAgent?.memory.reference, activeCapabilities: config.capabilities ?? [], availableCapabilities: capabilityCatalog.map(item => ({ id: item.id, label: item.label, description: item.description, dependencies: item.dependencies })), entities: accessibleEntities.map(entity => ({ id: entity.id, label: entity.label, primaryField: entity.primaryField, fields: entity.fields.map(field => ({ id: field.id, label: field.label, type: field.type, options: field.options })) })), navigation: config.navigation.filter(item => !item.viewId || accessibleEntities.some(entity => config.views.some(view => view.id === item.viewId && view.entityId === entity.id))).map(item => ({ id: item.id, label: item.label, kind: item.kind })), workflows: config.workflows.filter(workflow => accessibleEntities.some(entity => entity.id === workflow.trigger.entityId)), governance: config.governanceArchitecture },
    records: recordContext(config, records, actingAgent),
  }
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      onActivity?.(attempt ? 'Checking the command' : 'Wesify is working')
      const raw = await generateLocalStructuredJson<unknown>({ messages: [{ role: 'system', content: system }, { role: 'user', content: `Use this live workspace context. JSON only.\n${JSON.stringify(context)}` }], schema: responseSchema, maxTokens: 520, temperature: 0.1, onActivity })
      const response = validate(raw)
      if (authorizingAgent && response.action.kind !== 'none' && !agentAllows(authorizingAgent, response.action.kind)) return { response: { ...response, decision: 'CLARIFY', message: `${actingAgent?.label ?? 'Wesify'} cannot perform that action within its current scope.` }, action: undefined, agent: actingAgent }
      const action = toWorkspaceAction(response, config, authorizingAgent)
      const agentApprovalRequired = authorizingAgent?.approvalRequired.includes(response.action.kind as BusinessAgentPermission)
      const control = action ? evaluateActionControl(config, action, { agentApprovalRequired }) : undefined
      const guarded = control?.requiresApproval ? { ...response, decision: 'PREVIEW' as const } : response
      return { response: guarded, action, agent: actingAgent, control }
    } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('Wesify could not understand that command.')
}
