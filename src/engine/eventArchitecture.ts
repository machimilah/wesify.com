import { automationPatterns, processPatterns } from '../data/operatingKnowledge'
import { capabilityById } from './capabilityCatalog'
import type { CompiledBusinessAgent } from './agentArchitecture'
import type { WorkspaceConfiguration } from './workspaceSchema'

export type EventTriggerKind = 'automation' | 'agent' | 'notification' | 'state-change' | 'calculation' | 'integration' | 'approval-request' | 'audit-log'

export interface BusinessEventDefinition {
  type: string
  label: string
  domain: string
  sourceEntityIds: string[]
  capabilityIds: string[]
  payloadFields: string[]
  severity: 'informational' | 'important' | 'critical'
  audit: true
  canTrigger: EventTriggerKind[]
  lifecycle?: 'created' | 'updated' | 'deleted'
}

export interface EventRoute {
  eventType: string
  targets: Array<{ kind: EventTriggerKind; ids: string[] }>
}

export interface EventArchitecture {
  version: 1
  definitions: BusinessEventDefinition[]
  routes: EventRoute[]
  delivery: { mode: 'at-least-once'; idempotencyKey: string; orderingKey: string; deadLetter: true }
}

const subjectAliases: Record<string, string> = {
  customers: 'customer', opportunities: 'lead', quotes: 'quotation', orders: 'order', invoices: 'invoice', payments: 'payment',
  suppliers: 'supplier', employees: 'employee', tasks: 'task', projects: 'project', complaints: 'complaint', machines: 'machine',
}

function eventSubject(entityId: string) {
  return subjectAliases[entityId] ?? entityId.replace(/ies$/, 'y').replace(/s$/, '')
}

function title(type: string) {
  return type.split('.').map(part => part.replace(/-/g, ' ')).join(' ')
}

function severity(type: string): BusinessEventDefinition['severity'] {
  if (/failed|breach|critical|threshold_exceeded|nonconformance|blocked|overdue|shortage/.test(type)) return 'critical'
  if (/exception|delayed|complaint|low|departed|rejected|cancelled/.test(type)) return 'important'
  return 'informational'
}

function capabilityEntityIds(capabilityIds: string[], config: WorkspaceConfiguration) {
  const ids = new Set(capabilityIds.flatMap(id => capabilityById.get(id)?.entities.map(entity => entity.id) ?? []))
  return config.entities.filter(entity => ids.has(entity.id) || (entity.capabilityId ? capabilityIds.includes(entity.capabilityId) : false)).map(entity => entity.id)
}

function triggersFor(type: string, sourceEntityIds: string[], capabilityIds: string[], config: WorkspaceConfiguration, agents: CompiledBusinessAgent[]) {
  const output = new Set<EventTriggerKind>(['audit-log'])
  if (/created|updated|completed|received|approved|closed|released|failed/.test(type)) output.add('state-change')
  if (severity(type) !== 'informational') output.add('notification')
  if ((config.kpis ?? []).some(kpi => kpi.dataSources.some(source => sourceEntityIds.includes(source.entityId)))) output.add('calculation')
  if (config.workflows.some(workflow => sourceEntityIds.includes(workflow.trigger.entityId))) output.add('automation')
  if (automationPatterns.some(pattern => pattern.capabilityIds.some(id => capabilityIds.includes(id)))) output.add('automation')
  if (agents.some(agent => agent.accessibleEntityIds.some(id => sourceEntityIds.includes(id)) || agent.capabilityIds.some(id => capabilityIds.includes(id)))) output.add('agent')
  if (config.connections?.length) output.add('integration')
  if (/requested|proposed|awaiting|threshold/.test(type) && automationPatterns.some(pattern => pattern.humanControl === 'approval-required' && pattern.capabilityIds.some(id => capabilityIds.includes(id)))) output.add('approval-request')
  return [...output]
}

function routeFor(definition: BusinessEventDefinition, config: WorkspaceConfiguration, agents: CompiledBusinessAgent[]): EventRoute {
  const targets: EventRoute['targets'] = definition.canTrigger.map(kind => {
    if (kind === 'agent') return { kind, ids: agents.filter(agent => agent.accessibleEntityIds.some(id => definition.sourceEntityIds.includes(id)) || agent.capabilityIds.some(id => definition.capabilityIds.includes(id))).map(agent => agent.id) }
    if (kind === 'automation') return { kind, ids: config.workflows.filter(workflow => definition.sourceEntityIds.includes(workflow.trigger.entityId)).map(workflow => workflow.id) }
    if (kind === 'calculation') return { kind, ids: (config.kpis ?? []).filter(kpi => kpi.dataSources.some(source => definition.sourceEntityIds.includes(source.entityId))).map(kpi => kpi.id) }
    if (kind === 'integration') return { kind, ids: (config.connections ?? []).map(connection => `${connection.providerId}:${connection.capabilityId}`) }
    if (kind === 'approval-request') return { kind, ids: ['owner', 'admin', 'manager'] }
    return { kind, ids: [] }
  })
  return { eventType: definition.type, targets }
}

export function compileEventArchitecture(config: WorkspaceConfiguration, agents: CompiledBusinessAgent[]): EventArchitecture {
  const active = new Set(config.capabilities ?? [])
  const definitions = new Map<string, BusinessEventDefinition>()

  for (const entity of config.entities) for (const lifecycle of ['created', 'updated', 'deleted'] as const) {
    const type = `${eventSubject(entity.id)}.${lifecycle}`
    const capabilityIds = entity.capabilityId ? [entity.capabilityId] : []
    definitions.set(type, {
      type, label: title(type), domain: entity.module, sourceEntityIds: [entity.id], capabilityIds,
      payloadFields: ['eventId', 'workspaceId', 'entityId', 'recordId', 'occurredAt', 'actor', 'changes'],
      severity: 'informational', audit: true, lifecycle,
      canTrigger: triggersFor(type, [entity.id], capabilityIds, config, agents),
    })
  }

  for (const process of processPatterns.filter(item => item.capabilityIds.some(id => active.has(id)))) {
    const capabilityIds = process.capabilityIds.filter(id => active.has(id))
    const sourceEntityIds = capabilityEntityIds(capabilityIds, config)
    for (const type of process.events) if (!definitions.has(type)) definitions.set(type, {
      type, label: title(type), domain: process.id, sourceEntityIds, capabilityIds,
      payloadFields: ['eventId', 'workspaceId', 'entityId', 'recordId', 'occurredAt', 'actor', 'changes', 'correlationId'],
      severity: severity(type), audit: true,
      canTrigger: triggersFor(type, sourceEntityIds, capabilityIds, config, agents),
    })
  }

  const values = [...definitions.values()]
  return {
    version: 1,
    definitions: values,
    routes: values.map(definition => routeFor(definition, config, agents)),
    delivery: { mode: 'at-least-once', idempotencyKey: 'eventId', orderingKey: 'workspaceId:entityId', deadLetter: true },
  }
}

export function eventsForEntityMutation(architecture: EventArchitecture | undefined, entityId: string, lifecycle: 'created' | 'updated' | 'deleted') {
  return architecture?.definitions.filter(definition => definition.lifecycle === lifecycle && definition.sourceEntityIds.includes(entityId)) ?? []
}
