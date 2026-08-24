import { businessAgentCatalog, type BusinessAgentPermission, type BusinessAgentTemplate } from '../data/businessAgentCatalog'
import { capabilityById } from './capabilityCatalog'
import { saysSignal } from './shared'
import type { WorkspaceConfiguration } from './workspaceSchema'

export interface CompiledBusinessAgent {
  id: string
  label: string
  scope: string
  permissions: BusinessAgentPermission[]
  accessibleEntityIds: string[]
  tools: string[]
  memory: { strategy: 'shared-company-state'; reference: string; privateOperationalState: false }
  goals: string[]
  kpiIds: string[]
  actions: string[]
  approvalRequired: BusinessAgentPermission[]
  prohibitedActions: string[]
  escalationRules: string[]
  capabilityIds: string[]
}

function matchingCapabilities(template: BusinessAgentTemplate, capabilityIds: string[]) {
  return capabilityIds.filter(id => template.capabilityPrefixes.some(prefix => id.startsWith(prefix)) || template.capabilityIds?.includes(id))
}

function shouldCompile(template: BusinessAgentTemplate, config: WorkspaceConfiguration, matched: string[]) {
  if (template.id === 'executive') return true
  if (template.id === 'analytics') return matched.length > 0 || Boolean(config.kpis?.length)
  if (template.id === 'data') return matched.length > 0 || Boolean(config.connections?.length)
  if (template.id === 'risk') return matched.length > 0 || Boolean(config.businessModel?.knowledge.gaps.some(gap => gap.classification === 'required'))
  return matched.length > 0
}

export function compileBusinessAgents(config: WorkspaceConfiguration): CompiledBusinessAgent[] {
  const capabilityIds = config.capabilities ?? []
  return businessAgentCatalog.flatMap(template => {
    const matched = matchingCapabilities(template, capabilityIds)
    if (!shouldCompile(template, config, matched)) return []
    const catalogEntityIds = new Set(matched.flatMap(id => capabilityById.get(id)?.entities.map(entity => entity.id) ?? []))
    const accessibleEntityIds = template.id === 'executive' || template.id === 'analytics' || template.id === 'risk' || template.id === 'data'
      ? config.entities.map(entity => entity.id)
      : config.entities.filter(entity => catalogEntityIds.has(entity.id) || (entity.capabilityId ? matched.includes(entity.capabilityId) : false)).map(entity => entity.id)
    const kpiIds = (config.kpis ?? []).filter(kpi => template.id === 'executive' || template.id === 'analytics'
      || kpi.dataSources.some(source => accessibleEntityIds.includes(source.entityId))).map(kpi => kpi.id)
    return [{
      id: template.id,
      label: template.label,
      scope: template.scope,
      permissions: template.permissions,
      accessibleEntityIds,
      tools: template.tools,
      memory: { strategy: 'shared-company-state', reference: `workspace:${config.id}:company-state`, privateOperationalState: false },
      goals: template.goals,
      kpiIds,
      actions: template.actions,
      approvalRequired: template.approvalRequired,
      prohibitedActions: template.prohibitedActions,
      escalationRules: template.escalationRules,
      capabilityIds: matched,
    }]
  })
}

export function selectBusinessAgent(command: string, config: WorkspaceConfiguration) {
  const agents = config.agents?.length ? config.agents : compileBusinessAgents(config)
  const scored = agents.map(agent => {
    const template = businessAgentCatalog.find(item => item.id === agent.id)
    const signalScore = template?.commandSignals.reduce((score, signal) => score + (saysSignal(command, signal) ? signal.split(' ').length + 1 : 0), 0) ?? 0
    const entityScore = config.entities.filter(entity => agent.accessibleEntityIds.includes(entity.id) && (saysSignal(command, entity.label) || saysSignal(command, entity.pluralLabel))).length * 4
    return { agent, score: signalScore + entityScore }
  }).sort((left, right) => right.score - left.score)
  return scored[0]?.score ? scored[0].agent : agents.find(agent => agent.id === 'executive') ?? agents[0]
}

export function agentAllows(agent: CompiledBusinessAgent | undefined, action: BusinessAgentPermission) {
  return Boolean(agent?.permissions.includes(action))
}
