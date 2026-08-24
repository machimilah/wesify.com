import { kpiPatterns, type KpiPattern } from '../data/operatingKnowledge'
import { capabilityById } from './capabilityCatalog'
import type { EntityDefinition, MetricDefinition, WorkspaceConfiguration, WorkspaceRoleId } from './workspaceSchema'

export type KpiLevel = 'company' | 'business-unit' | 'department' | 'team' | 'process' | 'project' | 'employee' | 'customer' | 'supplier' | 'product'
export type KpiFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly'

export interface GeneratedKpiDefinition {
  id: string
  name: string
  businessPurpose: string
  formula: string
  requiredData: string[]
  dataSources: Array<{ entityId: string; fields: string[] }>
  frequency: KpiFrequency
  owner: WorkspaceRoleId
  target: string
  warningThreshold: string
  criticalThreshold: string
  trend: 'increase' | 'decrease' | 'stable' | 'baseline-required'
  historicalValues: Array<{ period: string; value: number }>
  levels: KpiLevel[]
  associatedProcess?: string
  associatedGoal?: string
  possibleAIActions: string[]
  sourcePatternId?: string
}

interface GenerateKpisInput {
  capabilityIds: string[]
  entities: EntityDefinition[]
  metrics: MetricDefinition[]
  goals: string[]
}

function ownerFor(pattern: KpiPattern): WorkspaceRoleId {
  if (pattern.capabilityIds.some(id => /^(finance|accounting)\./.test(id))) return 'accountant'
  if (pattern.capabilityIds.some(id => /^people\./.test(id))) return 'admin'
  if (pattern.capabilityIds.some(id => /^(work|service|procurement|inventory|logistics|manufacturing|quality|maintenance)\./.test(id))) return 'manager'
  return 'owner'
}

function frequencyFor(pattern: KpiPattern): KpiFrequency {
  if (pattern.operation === 'trend' || /margin|revenue|turnover|close/.test(pattern.id)) return 'monthly'
  if (/cash|stockout|quality|availability|delivery|commitment|production|effectiveness/.test(pattern.id)) return 'weekly'
  return 'monthly'
}

function levelsFor(pattern: KpiPattern): KpiLevel[] {
  if (pattern.capabilityIds.some(id => /^procurement\./.test(id))) return ['company', 'process', 'supplier']
  if (pattern.capabilityIds.some(id => /^people\./.test(id))) return ['company', 'department', 'team', 'employee']
  if (pattern.capabilityIds.some(id => /^work\./.test(id))) return ['company', 'process', 'project', 'team']
  if (pattern.capabilityIds.some(id => /^(commerce|crm|support)\./.test(id))) return ['company', 'process', 'customer', 'product']
  if (pattern.capabilityIds.some(id => /^(manufacturing|quality|maintenance|inventory|logistics)\./.test(id))) return ['company', 'department', 'process', 'product']
  return ['company', 'process']
}

function formulaFor(pattern: KpiPattern) {
  if (pattern.operation === 'ratio') return 'Qualifying records / total relevant records * 100'
  if (pattern.operation === 'duration') return 'Average completion date - start date for completed records'
  if (pattern.operation === 'variance') return 'Actual value - approved plan value'
  if (pattern.operation === 'trend') return 'Current period value compared with previous period value'
  if (pattern.operation === 'sum') return 'Sum of the measured value for the review period'
  return 'Count of qualifying records in the review period'
}

function trendFor(pattern: KpiPattern): GeneratedKpiDefinition['trend'] {
  if (/complaint|stockout|duration|waste|turnover|days-to-collect/.test(pattern.id)) return 'decrease'
  if (/reliability|accuracy|delivery|conformance|effectiveness|availability|completion|margin/.test(pattern.id)) return 'increase'
  return 'baseline-required'
}

function thresholdText(pattern: KpiPattern) {
  const desired = trendFor(pattern)
  return {
    target: 'Set with the owner after a reliable baseline exists',
    warningThreshold: desired === 'decrease' ? 'Above the agreed warning limit' : desired === 'increase' ? 'Below the agreed warning limit' : 'Outside the agreed operating range',
    criticalThreshold: 'Material threshold breach or two consecutive warning periods',
  }
}

function sourceEntities(pattern: KpiPattern, entities: EntityDefinition[]) {
  const ids = new Set(pattern.capabilityIds.flatMap(id => capabilityById.get(id)?.entities.map(entity => entity.id) ?? []))
  return entities.filter(entity => ids.has(entity.id) || (entity.capabilityId ? pattern.capabilityIds.includes(entity.capabilityId) : false)).map(entity => {
    const useful = entity.fields.filter(field => ['number', 'currency', 'date', 'select', 'boolean'].includes(field.type)).map(field => field.id)
    return { entityId: entity.id, fields: useful.length ? useful : [entity.primaryField] }
  })
}

function associatedGoal(pattern: KpiPattern, goals: string[]) {
  const words = new Set(`${pattern.name} ${pattern.purpose}`.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 4))
  return goals.find(goal => goal.toLowerCase().split(/[^a-z0-9]+/).some(word => words.has(word)))
}

function actionsFor(pattern: KpiPattern) {
  const actions = ['Explain the change using the underlying records', 'Notify the metric owner when a threshold is breached']
  if (pattern.operation === 'trend' || pattern.operation === 'variance') actions.push('Forecast the next review period from recent history')
  if (pattern.operation === 'ratio' || pattern.operation === 'duration') actions.push('Identify the records contributing most to the result')
  return actions
}

function fromPattern(pattern: KpiPattern, input: GenerateKpisInput): GeneratedKpiDefinition {
  const sources = sourceEntities(pattern, input.entities)
  const thresholds = thresholdText(pattern)
  const knowledge = pattern.capabilityIds.flatMap(id => capabilityById.get(id)?.knowledge?.processIds ?? [])
  return {
    id: pattern.id,
    name: pattern.name,
    businessPurpose: pattern.purpose,
    formula: formulaFor(pattern),
    requiredData: sources.flatMap(source => source.fields.map(field => `${source.entityId}.${field}`)),
    dataSources: sources,
    frequency: frequencyFor(pattern),
    owner: ownerFor(pattern),
    ...thresholds,
    trend: trendFor(pattern),
    historicalValues: [],
    levels: levelsFor(pattern),
    associatedProcess: knowledge[0],
    associatedGoal: associatedGoal(pattern, input.goals),
    possibleAIActions: actionsFor(pattern),
    sourcePatternId: pattern.id,
  }
}

function fromMetric(metric: MetricDefinition, entities: EntityDefinition[]): GeneratedKpiDefinition {
  const entity = entities.find(item => item.id === metric.entityId)
  const fields = [metric.field, metric.filter?.field].filter(Boolean) as string[]
  return {
    id: metric.id,
    name: metric.label,
    businessPurpose: `Monitor ${metric.label.toLowerCase()} from live workspace records.`,
    formula: metric.operation === 'sum' ? `Sum ${metric.entityId}.${metric.field ?? 'value'}` : `Count ${metric.entityId} records${metric.filter ? ' matching the configured filter' : ''}`,
    requiredData: fields.map(field => `${metric.entityId}.${field}`),
    dataSources: [{ entityId: metric.entityId, fields: fields.length ? fields : [entity?.primaryField ?? 'id'] }],
    frequency: 'weekly',
    owner: metric.roles.includes('manager') ? 'manager' : metric.roles[0] ?? 'owner',
    target: 'Set with the owner after a reliable baseline exists',
    warningThreshold: 'Outside the agreed operating range',
    criticalThreshold: 'Material threshold breach or two consecutive warning periods',
    trend: 'baseline-required',
    historicalValues: [],
    levels: ['company', 'process'],
    possibleAIActions: ['Explain the change using the underlying records', 'Notify the metric owner when a threshold is breached'],
  }
}

export function generateKpiDefinitions(input: GenerateKpisInput): GeneratedKpiDefinition[] {
  const selected = new Set(input.capabilityIds)
  const generated = kpiPatterns
    .filter(pattern => pattern.capabilityIds.every(id => selected.has(id)))
    .map(pattern => fromPattern(pattern, input))
  const ids = new Set(generated.map(item => item.id))
  for (const metric of input.metrics) if (!ids.has(metric.id)) generated.push(fromMetric(metric, input.entities))
  return generated
}

export function refreshWorkspaceKpis(config: WorkspaceConfiguration): WorkspaceConfiguration {
  const kpis = generateKpiDefinitions({ capabilityIds: config.capabilities ?? [], entities: config.entities, metrics: config.metrics, goals: config.profile.goals })
  return {
    ...config,
    kpis,
    businessModel: config.businessModel ? {
      ...config.businessModel,
      intelligence: { ...config.businessModel.intelligence, generatedKpiIds: kpis.map(item => item.id) },
    } : undefined,
  }
}
