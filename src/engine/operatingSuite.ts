import { processPatterns } from '../data/operatingKnowledge'
import type { BusinessRecord, WorkspaceRecords } from './workspaceActions'
import type { EntityDefinition, FieldDefinition, WorkspaceConfiguration } from './workspaceSchema'

export type BusinessSuiteDomainId =
  | 'crm'
  | 'sales'
  | 'invoicing'
  | 'inventory'
  | 'employees'
  | 'projects'
  | 'accounting'
  | 'operations'
  | 'automation'
  | 'permissions'
  | 'reporting'

export interface BusinessSuiteDomain {
  id: BusinessSuiteDomainId
  label: string
  promise: string
  modules: string[]
  capabilityPrefixes: string[]
  platform?: boolean
}

/**
 * The category Wesify competes in, expressed independently of any one workspace.
 *
 * A company activates only the domains its operating model needs. Platform domains remain present
 * because automation, authorization and reporting are controls around every business application,
 * not optional record types that should be inferred from a keyword.
 */
export const businessSuiteDomains: BusinessSuiteDomain[] = [
  { id: 'crm', label: 'CRM', promise: 'Relationships, activity and pipeline context', modules: ['customers'], capabilityPrefixes: ['crm.'] },
  { id: 'sales', label: 'Sales', promise: 'Quotes, orders, contracts and recurring revenue', modules: ['sales', 'commerce', 'subscriptions'], capabilityPrefixes: ['sales.', 'commerce.', 'subscriptions.'] },
  { id: 'invoicing', label: 'Invoicing', promise: 'Receivables, collections and incoming payments', modules: ['finance'], capabilityPrefixes: ['finance.invoicing', 'finance.payments', 'finance.dunning', 'finance.credit'] },
  { id: 'inventory', label: 'Inventory', promise: 'Products, purchasing, stock, production and delivery', modules: ['inventory', 'procurement', 'logistics', 'manufacturing', 'quality', 'maintenance'], capabilityPrefixes: ['inventory.', 'procurement.', 'logistics.', 'manufacturing.', 'quality.', 'maintenance.'] },
  { id: 'employees', label: 'Employees', promise: 'People, availability, leave, hiring and payroll inputs', modules: ['team', 'hr', 'payroll'], capabilityPrefixes: ['people.'] },
  { id: 'projects', label: 'Projects', promise: 'Delivery, tasks, time, capacity and field work', modules: ['projects', 'scheduling', 'field-service'], capabilityPrefixes: ['work.', 'service.'] },
  { id: 'accounting', label: 'Accounting', promise: 'Ledger, payables, reconciliation, assets and close', modules: ['accounting'], capabilityPrefixes: ['accounting.', 'finance.accounts-', 'finance.bank-', 'finance.fixed-', 'finance.cost', 'finance.revenue-', 'finance.tax'] },
  { id: 'operations', label: 'Operations', promise: 'End-to-end processes, handoffs and exceptions', modules: ['processes', 'quality', 'maintenance', 'manufacturing', 'logistics'], capabilityPrefixes: ['planning.', 'vertical.'] },
  { id: 'automation', label: 'Automation', promise: 'Events, approvals, integrations and recoverable runs', modules: [], capabilityPrefixes: [], platform: true },
  { id: 'permissions', label: 'Permissions', promise: 'Roles, scoped access, approvals and audit history', modules: ['documents', 'compliance'], capabilityPrefixes: ['documents.', 'compliance.'], platform: true },
  { id: 'reporting', label: 'Reporting', promise: 'Live KPIs, operational reports and financial visibility', modules: ['analytics'], capabilityPrefixes: ['analytics.'], platform: true },
]

export function activeSuiteDomains(config: WorkspaceConfiguration) {
  const capabilities = config.capabilities ?? []
  return businessSuiteDomains.map(domain => ({
    ...domain,
    active: Boolean(domain.platform)
      || domain.modules.some(module => config.modules.includes(module))
      || domain.capabilityPrefixes.some(prefix => capabilities.some(id => id.startsWith(prefix))),
  }))
}

export function suiteDomainForModule(module: string): BusinessSuiteDomainId {
  return businessSuiteDomains.find(domain => domain.modules.includes(module))?.id ?? 'operations'
}

export function suiteDomainLabel(id: BusinessSuiteDomainId) {
  return businessSuiteDomains.find(domain => domain.id === id)?.label ?? 'Operations'
}

interface RelationshipRule {
  entityId: string
  field: FieldDefinition
  relationCandidates: string[]
  replaceExisting?: boolean
}

const relationshipRules: RelationshipRule[] = [
  { entityId: 'quotes', field: { id: 'opportunity', label: 'Opportunity', type: 'relation' }, relationCandidates: ['opportunities'] },
  { entityId: 'orders', field: { id: 'quote', label: 'Source quote', type: 'relation' }, relationCandidates: ['quotes'] },
  { entityId: 'contracts', field: { id: 'opportunity', label: 'Opportunity', type: 'relation' }, relationCandidates: ['opportunities'] },
  { entityId: 'projects', field: { id: 'order', label: 'Sales order', type: 'relation' }, relationCandidates: ['orders'] },
  { entityId: 'projects', field: { id: 'contract', label: 'Contract', type: 'relation' }, relationCandidates: ['contracts'] },
  { entityId: 'tasks', field: { id: 'project', label: 'Project', type: 'relation' }, relationCandidates: ['projects'], replaceExisting: true },
  { entityId: 'time-entries', field: { id: 'task', label: 'Task', type: 'relation' }, relationCandidates: ['tasks'] },
  { entityId: 'shipments', field: { id: 'order', label: 'Sales order', type: 'relation' }, relationCandidates: ['orders'], replaceExisting: true },
  { entityId: 'invoices', field: { id: 'order', label: 'Sales order', type: 'relation' }, relationCandidates: ['orders'] },
  { entityId: 'invoices', field: { id: 'project', label: 'Project', type: 'relation' }, relationCandidates: ['projects'] },
  { entityId: 'invoices', field: { id: 'contract', label: 'Contract', type: 'relation' }, relationCandidates: ['contracts'] },
  { entityId: 'invoices', field: { id: 'workOrder', label: 'Work order', type: 'relation' }, relationCandidates: ['work-orders'] },
  { entityId: 'payments', field: { id: 'invoice', label: 'Invoice', type: 'relation' }, relationCandidates: ['invoices'], replaceExisting: true },
  { entityId: 'collection-cases', field: { id: 'invoice', label: 'Invoice', type: 'relation' }, relationCandidates: ['invoices'] },
  { entityId: 'purchase-orders', field: { id: 'requisition', label: 'Requisition', type: 'relation' }, relationCandidates: ['requisitions'] },
  { entityId: 'goods-receipts', field: { id: 'purchaseOrder', label: 'Purchase order', type: 'relation' }, relationCandidates: ['purchase-orders'] },
  { entityId: 'supplier-invoices', field: { id: 'purchaseOrder', label: 'Purchase order', type: 'relation' }, relationCandidates: ['purchase-orders'] },
  { entityId: 'stock-movements', field: { id: 'receipt', label: 'Goods receipt', type: 'relation' }, relationCandidates: ['goods-receipts'] },
  { entityId: 'stock-movements', field: { id: 'shipment', label: 'Shipment', type: 'relation' }, relationCandidates: ['shipments'] },
  { entityId: 'quality-checks', field: { id: 'productionOrder', label: 'Production order', type: 'relation' }, relationCandidates: ['production-orders'] },
  { entityId: 'expenses', field: { id: 'project', label: 'Project', type: 'relation' }, relationCandidates: ['projects'] },
  { entityId: 'expenses', field: { id: 'employee', label: 'Team member', type: 'relation' }, relationCandidates: ['employees'] },
  { entityId: 'journal-entries', field: { id: 'account', label: 'Account', type: 'relation' }, relationCandidates: ['accounts'], replaceExisting: true },
  { entityId: 'journal-entries', field: { id: 'invoice', label: 'Source invoice', type: 'relation' }, relationCandidates: ['invoices'] },
  { entityId: 'employees', field: { id: 'candidate', label: 'Candidate', type: 'relation' }, relationCandidates: ['candidates'] },
  { entityId: 'onboarding-cases', field: { id: 'employee', label: 'Team member', type: 'relation' }, relationCandidates: ['employees'] },
]

/** Adds transaction lineage only when both sides of the relationship are installed. */
export function connectOperationalEntities(entities: EntityDefinition[]): EntityDefinition[] {
  const entityIds = new Set(entities.map(entity => entity.id))
  return entities.map(entity => {
    const applicable = relationshipRules.filter(rule => rule.entityId === entity.id)
    if (!applicable.length) return entity
    let fields = entity.fields
    for (const rule of applicable) {
      const relationEntityId = rule.relationCandidates.find(entityIds.has.bind(entityIds))
      if (!relationEntityId) continue
      const field: FieldDefinition = { ...rule.field, relationEntityId }
      const existing = fields.findIndex(item => item.id === field.id)
      if (existing < 0) fields = [...fields, field]
      else if (rule.replaceExisting && (fields[existing].type !== 'relation' || fields[existing].relationEntityId !== relationEntityId)) {
        fields = fields.map((item, index) => index === existing ? { ...item, ...field } : item)
      }
    }
    return fields === entity.fields ? entity : { ...entity, fields }
  })
}

interface FlowStageDefinition {
  label: string
  entityIds: string[]
}

interface FlowDefinition {
  id: string
  label: string
  stages: FlowStageDefinition[]
}

const flowDefinitions: FlowDefinition[] = [
  { id: 'lead-to-cash', label: 'Lead to cash', stages: [
    { label: 'Lead', entityIds: ['opportunities'] },
    { label: 'Quote', entityIds: ['quotes'] },
    { label: 'Order', entityIds: ['orders', 'contracts'] },
    { label: 'Deliver', entityIds: ['shipments', 'work-orders', 'projects'] },
    { label: 'Invoice', entityIds: ['invoices'] },
    { label: 'Collect', entityIds: ['payments', 'collection-cases'] },
  ] },
  { id: 'project-to-cash', label: 'Project to cash', stages: [
    { label: 'Project', entityIds: ['projects'] },
    { label: 'Plan', entityIds: ['tasks', 'allocations', 'milestones'] },
    { label: 'Track', entityIds: ['time-entries', 'wip-entries'] },
    { label: 'Invoice', entityIds: ['invoices', 'progress-claims'] },
    { label: 'Collect', entityIds: ['payments', 'collection-cases'] },
  ] },
  { id: 'procure-to-pay', label: 'Procure to pay', stages: [
    { label: 'Request', entityIds: ['requisitions', 'supplier-quotes'] },
    { label: 'Order', entityIds: ['purchase-orders'] },
    { label: 'Receive', entityIds: ['goods-receipts', 'stock-movements'] },
    { label: 'Bill', entityIds: ['supplier-invoices'] },
    { label: 'Pay', entityIds: ['payments'] },
  ] },
  { id: 'inventory-to-delivery', label: 'Inventory to delivery', stages: [
    { label: 'Plan', entityIds: ['demand-forecasts', 'material-plans'] },
    { label: 'Stock', entityIds: ['stock-items', 'lots'] },
    { label: 'Pick', entityIds: ['pick-lists'] },
    { label: 'Ship', entityIds: ['shipments', 'transport-loads'] },
    { label: 'Deliver', entityIds: ['store-orders', 'orders'] },
  ] },
  { id: 'hire-to-ready', label: 'Hire to ready', stages: [
    { label: 'Candidate', entityIds: ['candidates'] },
    { label: 'Onboard', entityIds: ['onboarding-cases'] },
    { label: 'Employee', entityIds: ['employees'] },
    { label: 'Schedule', entityIds: ['shifts', 'allocations'] },
    { label: 'Develop', entityIds: ['performance-reviews', 'certifications'] },
  ] },
  { id: 'record-to-report', label: 'Record to report', stages: [
    { label: 'Source', entityIds: ['invoices', 'supplier-invoices', 'expenses'] },
    { label: 'Post', entityIds: ['journal-entries'] },
    { label: 'Reconcile', entityIds: ['bank-lines'] },
    { label: 'Close', entityIds: ['accounts', 'cost-centers'] },
    { label: 'Report', entityIds: ['reports', 'dashboards'] },
  ] },
]

export interface ActiveOperatingFlowStage {
  label: string
  entityId: string
  entityLabel: string
  count: number
  navigationId?: string
}

export interface ActiveOperatingFlow {
  id: string
  label: string
  stages: ActiveOperatingFlowStage[]
}

function navigationForEntity(config: WorkspaceConfiguration, entityId: string) {
  const viewIds = config.views.filter(view => view.entityId === entityId).map(view => view.id)
  return config.navigation.find(item => item.viewId && viewIds.includes(item.viewId))?.id
}

export function activeOperatingFlows(config: WorkspaceConfiguration, records: WorkspaceRecords): ActiveOperatingFlow[] {
  return flowDefinitions.flatMap(flow => {
    const stages = flow.stages.flatMap(stage => {
      const entity = stage.entityIds.map(id => config.entities.find(candidate => candidate.id === id)).find(Boolean)
      return entity ? [{
        label: stage.label,
        entityId: entity.id,
        entityLabel: entity.pluralLabel,
        count: records[entity.id]?.length ?? 0,
        navigationId: navigationForEntity(config, entity.id),
      }] : []
    })
    return stages.length >= 3 ? [{ id: flow.id, label: flow.label, stages }] : []
  })
}

const transitionTargets: Record<string, string[]> = {
  opportunities: ['quotes'],
  quotes: ['orders', 'contracts', 'projects'],
  orders: ['shipments', 'projects', 'invoices'],
  contracts: ['projects', 'subscriptions', 'invoices'],
  projects: ['tasks', 'time-entries', 'invoices'],
  'work-orders': ['invoices'],
  invoices: ['payments', 'collection-cases'],
  requisitions: ['purchase-orders'],
  'purchase-orders': ['goods-receipts', 'supplier-invoices'],
  'goods-receipts': ['stock-movements'],
  candidates: ['employees', 'onboarding-cases'],
  employees: ['onboarding-cases'],
  'production-orders': ['quality-checks', 'stock-movements'],
}

export interface RecordTransition {
  entity: EntityDefinition
  label: string
  values: Record<string, string | number | boolean>
}

function copySharedValue(source: EntityDefinition, target: EntityDefinition, record: BusinessRecord, values: Record<string, string | number | boolean>, targetFieldId: string, sourceFieldIds: string[]) {
  if (!target.fields.some(field => field.id === targetFieldId)) return
  const sourceField = sourceFieldIds.find(id => source.fields.some(field => field.id === id) && record[id] !== undefined)
  if (sourceField) values[targetFieldId] = record[sourceField]
}

/** Prefills the next business document without creating it or inventing a document number. */
export function recordTransitions(config: WorkspaceConfiguration, source: EntityDefinition, record: BusinessRecord): RecordTransition[] {
  return (transitionTargets[source.id] ?? []).flatMap(targetId => {
    const entity = config.entities.find(candidate => candidate.id === targetId)
    if (!entity) return []
    const values: Record<string, string | number | boolean> = {}
    for (const field of entity.fields.filter(candidate => candidate.type === 'relation' && candidate.relationEntityId === source.id)) values[field.id] = record.id
    copySharedValue(source, entity, record, values, 'customer', ['customer'])
    copySharedValue(source, entity, record, values, 'supplier', ['supplier'])
    copySharedValue(source, entity, record, values, 'project', ['project'])
    copySharedValue(source, entity, record, values, 'employee', ['employee', 'assignee'])
    copySharedValue(source, entity, record, values, 'amount', ['amount', 'value', 'budget', 'balance'])
    const status = entity.fields.find(field => field.id === 'status')?.options?.[0]
    if (status) values.status = status
    return [{ entity, label: `Create ${entity.label.toLowerCase()}`, values }]
  })
}

export function activeProcessCount(config: WorkspaceConfiguration) {
  const active = new Set(config.capabilities ?? [])
  return processPatterns.filter(pattern => pattern.capabilityIds.some(active.has.bind(active))).length
}
