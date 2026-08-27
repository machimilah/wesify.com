import { entityLike, workspaceFacts, type WorkspaceFacts } from './completeness'
import type { ProcessCoverage } from './processCoverage'
import type { EntityDefinition, WorkspaceConfiguration } from './workspaceSchema'

/**
 * The workspace put under the events that actually happen to a company.
 *
 * A build can pass every structural check and still be useless on the first bad Tuesday. A supplier
 * rings to say the delivery is a week late: does anything in this workspace know, does it know which
 * orders that delays, does anybody own it, and does the customer's promised date change? If the
 * answer is a person remembering, the workspace is a filing cabinet.
 *
 * So twelve events are simulated against the built configuration before it is handed over, each
 * asked the same eight questions — detect, affected, impact, owner, recommend, act, record,
 * consequence. A scenario only runs where the company can actually experience it: a solo consultancy
 * has no equipment breakdown, and failing it for one would teach everybody to ignore the report.
 *
 * The simulation reads the configuration, never live records. It is asking whether the workspace has
 * the shape to answer the question at all — which is the only thing that can be known before anybody
 * has typed anything into it.
 */

const CURRENCY = 'currency'

export type ScenarioCheckId = 'detect' | 'affected' | 'impact' | 'owner' | 'recommend' | 'act' | 'record' | 'consequence'

export interface ScenarioCheck {
  id: ScenarioCheckId
  question: string
  ok: boolean
  because: string
}

export interface ScenarioResult {
  id: string
  label: string
  applies: boolean
  /** Why this company cannot experience the event, when it cannot. */
  because?: string
  checks: ScenarioCheck[]
  passed: boolean
}

interface ScenarioSpec {
  id: string
  label: string
  /** The record the event lands on. */
  entity: RegExp
  /** Capabilities or archetypes that mean this company can experience the event. */
  capabilityIds: string[]
  archetypes: string[]
  /** Whether the company's exposure to this event is financial or purely operational. */
  consequence: 'financial' | 'operational'
  /** The record that carries the consequence, where it is a different one. */
  consequenceEntity?: RegExp
}

const scenarios: ScenarioSpec[] = [
  { id: 'new-order', label: 'A new customer order arrives', entity: /order|project|job|booking|appointment|case|quote/, capabilityIds: ['sales.orders', 'work.projects', 'work.scheduling', 'crm.pipeline', 'sales.quotes'], archetypes: [], consequence: 'financial', consequenceEntity: /invoice|payment|order/ },
  { id: 'supplier-delay', label: 'A supplier delivers late', entity: /purchase|supplier|order|material|stock/, capabilityIds: ['procurement.purchasing', 'procurement.suppliers'], archetypes: ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'construction', 'food-processor'], consequence: 'operational', consequenceEntity: /order|project|job|production/ },
  { id: 'inventory-shortage', label: 'Stock runs out before the work does', entity: /stock|product|material|part|item|ingredient/, capabilityIds: ['inventory.stock', 'inventory.warehouses'], archetypes: [], consequence: 'operational', consequenceEntity: /order|production|job|project/ },
  { id: 'production-failure', label: 'A production run stops', entity: /production|batch|run|work order/, capabilityIds: ['manufacturing.production'], archetypes: ['manufacturer', 'food-processor'], consequence: 'operational', consequenceEntity: /order|shipment|delivery/ },
  { id: 'quality-rejection', label: 'Output fails its quality check', entity: /quality|inspection|check|test|batch/, capabilityIds: ['quality.inspections', 'quality.scrap'], archetypes: ['manufacturer', 'food-processor', 'construction', 'healthcare'], consequence: 'financial', consequenceEntity: /scrap|batch|production|cost/ },
  { id: 'customer-return', label: 'A customer sends something back', entity: /return|rma|refund|credit/, capabilityIds: ['commerce.returns', 'service.rma', 'service.warranty'], archetypes: ['ecommerce', 'retailer', 'distributor', 'wholesaler', 'manufacturer'], consequence: 'financial', consequenceEntity: /invoice|credit|payment|refund/ },
  { id: 'customs-delay', label: 'A shipment is held at the border', entity: /shipment|customs|declaration|container|delivery/, capabilityIds: ['logistics.customs', 'logistics.shipping'], archetypes: ['importer', 'exporter'], consequence: 'operational', consequenceEntity: /order|stock|production/ },
  { id: 'late-payment', label: 'An invoice goes past due', entity: /invoice|payment|collection/, capabilityIds: ['finance.invoicing', 'finance.payments', 'finance.dunning'], archetypes: [], consequence: 'financial', consequenceEntity: /invoice|collection|customer/ },
  { id: 'employee-absence', label: 'Somebody who was booked to work is not there', entity: /employee|team|staff|shift|attendance|crew/, capabilityIds: ['people.directory', 'people.attendance', 'people.time-off', 'work.scheduling'], archetypes: [], consequence: 'operational', consequenceEntity: /job|visit|appointment|project|task|shift/ },
  { id: 'equipment-breakdown', label: 'Equipment the work depends on breaks', entity: /asset|equipment|machine|vehicle|maintenance/, capabilityIds: ['maintenance.assets', 'logistics.fleet', 'service.assets'], archetypes: ['manufacturer', 'field-service', 'logistics', 'food-processor'], consequence: 'operational', consequenceEntity: /production|job|visit|delivery|project/ },
  { id: 'demand-spike', label: 'Demand jumps beyond the plan', entity: /order|booking|demand|forecast|project/, capabilityIds: ['sales.orders', 'planning.demand', 'work.scheduling'], archetypes: [], consequence: 'operational', consequenceEntity: /stock|production|schedule|resource|capacity/ },
  { id: 'customer-cancellation', label: 'A customer cancels', entity: /order|project|booking|contract|subscription|appointment/, capabilityIds: ['sales.orders', 'sales.contracts', 'subscriptions.billing', 'work.scheduling'], archetypes: [], consequence: 'financial', consequenceEntity: /invoice|payment|contract|subscription/ },
]

const relationTargets = (entity: EntityDefinition) => entity.fields.filter(field => field.type === 'relation' && field.relationEntityId).map(field => field.relationEntityId as string)

const ownerField = (entity: EntityDefinition) => entity.fields.find(field =>
  /assignee|owner|responsible|technician|manager|assigned/.test(field.id) || /assign|owner|responsible/.test(field.label.toLowerCase()))

const check = (id: ScenarioCheckId, question: string, ok: boolean, because: string): ScenarioCheck => ({ id, question, ok, because })

function runScenario(spec: ScenarioSpec, config: WorkspaceConfiguration, facts: WorkspaceFacts, coverage: ProcessCoverage): ScenarioResult {
  const archetypes = new Set(coverage.archetypes.map(item => item.id))
  const relevant = spec.capabilityIds.some(id => facts.capabilities.has(id)) || spec.archetypes.some(id => archetypes.has(id))
  const entity = entityLike(facts, spec.entity)

  if (!relevant && !entity) return {
    id: spec.id,
    label: spec.label,
    applies: false,
    because: 'Nothing this company does exposes it to this event.',
    checks: [],
    passed: true,
  }

  if (!entity) return {
    id: spec.id,
    label: spec.label,
    applies: true,
    checks: [check('detect', 'Can the workspace tell this happened?', false, 'No record in the workspace represents the thing this event happens to.')],
    passed: false,
  }

  const statusField = entity.fields.find(field => field.id === 'status' || field.type === 'select')
  const dateField = entity.fields.find(field => field.type === 'date')
  const numberField = entity.fields.find(field => field.type === 'number' || field.type === CURRENCY)
  const related = relationTargets(entity)
  const referencedBy = facts.entities.filter(item => item.id !== entity.id && relationTargets(item).includes(entity.id))
  const measured = config.metrics.some(item => item.entityId === entity.id)
    || (config.kpis ?? []).some(item => (item as { entityId?: string }).entityId === entity.id)
    || config.metrics.some(item => related.includes(item.entityId))
  const owner = ownerField(entity)
  const workflows = (config.workflows ?? []).filter(item => item.trigger.entityId === entity.id)
  const agents = (config.agents ?? []).filter(item => (item as { entityIds?: string[] }).entityIds?.includes(entity.id) ?? false)
  const consequenceEntity = spec.consequenceEntity ? entityLike(facts, spec.consequenceEntity) : undefined
  const carriesMoney = entity.fields.some(field => field.type === CURRENCY) || Boolean(consequenceEntity?.fields.some(field => field.type === CURRENCY))

  const checks: ScenarioCheck[] = [
    check('detect', 'Can the workspace tell this happened?', Boolean(statusField || dateField || numberField),
      statusField ? `${entity.label} carries a status that can say so.` : dateField ? `${entity.label} carries a date that can go past.` : numberField ? `${entity.label} carries a number that can fall.` : `${entity.label} has no field this event would change.`),
    check('affected', 'Does it know what else this affects?', related.length > 0 || referencedBy.length > 0,
      related.length || referencedBy.length ? `${entity.label} is connected to ${[...new Set([...related, ...referencedBy.map(item => item.id)])].slice(0, 3).join(', ')}.` : `${entity.label} is connected to nothing, so the knock-on cannot be followed.`),
    check('impact', 'Does the impact reach a number management watches?', measured,
      measured ? 'A reported measure moves when this record does.' : 'Nothing reported changes when this happens.'),
    check('owner', 'Is there somebody responsible?', Boolean(owner) || facts.roleCount >= 2,
      owner ? `${entity.label} names who is responsible.` : facts.roleCount >= 2 ? 'The workspace separates roles, so it can be escalated to one.' : 'Nobody in particular owns this record.'),
    check('recommend', 'Can the workspace say what to do about it?', workflows.length > 0 || agents.length > 0,
      workflows.length ? `${workflows.length} workflows react to ${entity.pluralLabel}.` : agents.length ? 'An agent watches this record.' : `Nothing reacts to a change on ${entity.pluralLabel}.`),
    check('act', 'Can it act or escalate rather than only display?', workflows.length > 0 || agents.length > 0,
      workflows.length || agents.length ? 'A workflow or agent can carry the action.' : 'The only available response is a person noticing.'),
    check('record', 'Does the event leave a record?', Boolean(statusField) || Boolean(consequenceEntity),
      statusField ? 'The status change is the record.' : consequenceEntity ? `${consequenceEntity.pluralLabel} record what happened.` : 'The event would leave no trace.'),
    check('consequence', spec.consequence === 'financial' ? 'Does the money follow?' : 'Does the operational plan follow?',
      spec.consequence === 'financial' ? carriesMoney : Boolean(consequenceEntity),
      spec.consequence === 'financial'
        ? carriesMoney ? 'The amount at stake is on a record.' : 'The event costs money and no record carries the amount.'
        : consequenceEntity ? `${consequenceEntity.pluralLabel} carry the operational consequence.` : 'Nothing downstream changes when this happens.'),
  ]

  return { id: spec.id, label: spec.label, applies: true, checks, passed: checks.every(item => item.ok) }
}

export function simulateBusinessEvents(config: WorkspaceConfiguration, coverage: ProcessCoverage): ScenarioResult[] {
  const facts = workspaceFacts(config)
  return scenarios.map(spec => runScenario(spec, config, facts, coverage))
}

/** What the simulation could not answer, as the shortest list somebody could act on. */
export function scenarioFailures(results: ScenarioResult[]) {
  return results.filter(item => item.applies && !item.passed).map(item => ({
    id: item.id,
    label: item.label,
    missing: item.checks.filter(check => !check.ok).map(check => ({ id: check.id, because: check.because })),
  }))
}
