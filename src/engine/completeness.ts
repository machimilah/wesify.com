import type { ProcessCoverage } from './processCoverage'
import type { EntityDefinition, WorkspaceConfiguration } from './workspaceSchema'

/**
 * The last thing asked before a workspace is built: can this company actually be run in it?
 *
 * The capability planner answers "was this selected". These tests answer a different and harder
 * question — whether the flows a business is made of arrive somewhere. Money comes in and money goes
 * out; something is promised and something is delivered; work fails and somebody is told. A build can
 * satisfy every selected capability and still leave a flow that starts and never ends: invoices with
 * no way to record that one was paid, stock that moves with no record of who moved it, a delivery
 * date that nothing watches.
 *
 * Sixteen tests, one per flow. Each returns covered, a gap with the capability that would close it,
 * or not-applicable with the reason this company does not have that flow at all — because a homework
 * tracker failing the supplier test is not a defect, and saying so is the difference between a check
 * that can be trusted and one everybody learns to ignore.
 */

export type CompletenessStatus = 'covered' | 'gap' | 'not-applicable'

export interface CompletenessResult {
  id: string
  /** The question this test asks, in the words an operator would use. */
  question: string
  status: CompletenessStatus
  because: string
  /** What would close it. Empty where the answer is a question rather than a capability. */
  capabilityIds: string[]
  criticality: 'critical' | 'high'
}

const CURRENCY = 'currency'

export interface WorkspaceFacts {
  capabilities: Set<string>
  entities: EntityDefinition[]
  roleCount: number
  hasWorkflows: boolean
  metricCount: number
  kpiCount: number
}

export function workspaceFacts(config: WorkspaceConfiguration): WorkspaceFacts {
  return {
    capabilities: new Set([...(config.capabilities ?? []), ...config.entities.map(item => item.capabilityId ?? '').filter(Boolean)]),
    entities: config.entities,
    roleCount: config.roles.length,
    hasWorkflows: (config.workflows ?? []).length > 0,
    metricCount: config.metrics.length,
    kpiCount: (config.kpis ?? []).length,
  }
}

/** A record type whose id, label or plural says it is this kind of thing. */
export const entityLike = (facts: WorkspaceFacts, pattern: RegExp) =>
  facts.entities.find(item => pattern.test(item.id) || pattern.test(item.label.toLowerCase()) || pattern.test(item.pluralLabel.toLowerCase()))

const hasField = (entity: EntityDefinition | undefined, predicate: (field: EntityDefinition['fields'][number]) => boolean) =>
  Boolean(entity?.fields.some(predicate))

const anyCapability = (facts: WorkspaceFacts, ids: string[]) => ids.some(id => facts.capabilities.has(id))

/** Whether a framework verdict says this company genuinely does not do something. */
const ruledOut = (coverage: ProcessCoverage, processIds: string[]) =>
  processIds.every(id => coverage.processes.find(item => item.processId === id)?.classification === 'not-applicable')

const requiredHere = (coverage: ProcessCoverage, processIds: string[]) =>
  processIds.some(id => {
    const verdict = coverage.processes.find(item => item.processId === id)?.classification
    return verdict === 'required' || verdict === 'applicable'
  })

const covered = (id: string, question: string, because: string, criticality: CompletenessResult['criticality'] = 'critical'): CompletenessResult =>
  ({ id, question, status: 'covered', because, capabilityIds: [], criticality })
const gap = (id: string, question: string, because: string, capabilityIds: string[], criticality: CompletenessResult['criticality'] = 'critical'): CompletenessResult =>
  ({ id, question, status: 'gap', because, capabilityIds, criticality })
const notApplicable = (id: string, question: string, because: string): CompletenessResult =>
  ({ id, question, status: 'not-applicable', because, capabilityIds: [], criticality: 'high' })

export function runCompletenessTests(config: WorkspaceConfiguration, coverage: ProcessCoverage): CompletenessResult[] {
  const facts = workspaceFacts(config)
  const archetypes = new Set(coverage.archetypes.map(item => item.id))
  const results: CompletenessResult[] = []

  /**
   * A workspace for something that is not a business is not an incomplete business.
   *
   * Wesify is asked for coursework trackers, club fixtures and household jobs as well as companies,
   * and the commercial half of this check has nothing to say about them. Reporting that a homework
   * tracker cannot invoice anybody would be true, useless, and the first step back towards handing
   * a student a workspace full of Clients and Payments.
   */
  const trading = coverage.trading

  // Revenue — how money enters. A company with no way to record what it is owed is not being run.
  const revenueEntity = entityLike(facts, /invoice|sale|order|payment|booking|subscription|takings/)
  const revenueMoney = hasField(revenueEntity, field => field.type === CURRENCY)
  results.push(anyCapability(facts, ['finance.invoicing', 'commerce.pos', 'subscriptions.billing', 'finance.payments']) || revenueMoney
    ? covered('revenue', 'How money enters the company', revenueEntity ? `${revenueEntity.pluralLabel} carry what a customer owes.` : 'A billing capability is part of the build.')
    : trading
      ? gap('revenue', 'How money enters the company', 'Nothing in the build records what a customer owes or has paid.', ['finance.invoicing', 'finance.payments'])
      : notApplicable('revenue', 'How money enters the company', 'Nothing describes this as a workspace where money changes hands.'))

  // Costs — how money leaves. Only where the company actually buys or pays for anything.
  const costEntity = entityLike(facts, /expense|purchase|bill|payable|cost|supplier invoice/)
  results.push(anyCapability(facts, ['finance.expenses', 'finance.accounts-payable', 'procurement.purchasing', 'people.expenses']) || Boolean(costEntity)
    ? covered('costs', 'How money leaves the company', costEntity ? `${costEntity.pluralLabel} record what the company spends.` : 'A spending capability is part of the build.')
    : trading && requiredHere(coverage, ['apqc-9.6', 'apqc-4.2'])
      ? gap('costs', 'How money leaves the company', 'The company spends money and nothing in the build records it leaving.', ['finance.expenses', 'finance.accounts-payable'])
      : notApplicable('costs', 'How money leaves the company', trading ? 'Nothing says this company buys anything in to deliver what it sells.' : 'Nothing describes this as a workspace where money changes hands.'))

  // Customer — who is served, and whether their history survives the transaction.
  const customerEntity = entityLike(facts, /customer|client|account|patient|member|guest|tenant|student/)
  results.push(customerEntity
    ? covered('customer', 'Who the customers are', `${customerEntity.pluralLabel} hold who is served and what has happened with them.`)
    : trading
      ? gap('customer', 'Who the customers are', 'Nothing in the build holds the people or organizations this company serves.', ['crm.contacts'])
      : notApplicable('customer', 'Who the customers are', 'Nothing describes anybody this workspace is run on behalf of.'))

  // Supplier — who the company depends on, where it depends on anybody.
  const supplierEntity = entityLike(facts, /supplier|vendor|manufacturer|subcontractor/)
  results.push(supplierEntity || anyCapability(facts, ['procurement.suppliers'])
    ? covered('supplier', 'Who the company buys from', supplierEntity ? `${supplierEntity.pluralLabel} hold who supplies the company.` : 'Supplier records are part of the build.')
    : trading && requiredHere(coverage, ['apqc-4.2', 'scor-Source'])
      ? gap('supplier', 'Who the company buys from', 'The company depends on suppliers and nothing in the build knows who they are.', ['procurement.suppliers'])
      : notApplicable('supplier', 'Who the company buys from', 'Nothing is bought in to deliver what this company sells.'))

  // Delivery — the promise reaching the customer. Every company has one of these, whatever it is called.
  const deliveryEntity = entityLike(facts, /project|job|order|shipment|delivery|visit|appointment|case|task|assignment|work/)
  results.push(deliveryEntity
    ? covered('delivery', 'How the promise reaches the customer', `${deliveryEntity.pluralLabel} carry the work from committed to done.`)
    : trading
      ? gap('delivery', 'How the promise reaches the customer', 'Nothing in the build represents the work that was sold.', ['work.projects', 'sales.orders'])
      : notApplicable('delivery', 'How the promise reaches the customer', 'Nothing is promised to anybody outside this workspace.'))

  // Resources — who does the work, unless the answer is nobody but the operator.
  results.push(archetypes.has('solo') && !anyCapability(facts, ['people.directory'])
    ? notApplicable('resources', 'Who does the work', 'One person runs this company, so a directory of people would have one row in it.')
    : anyCapability(facts, ['people.directory', 'work.resources']) || Boolean(entityLike(facts, /employee|team|staff|crew|technician|practitioner/))
      ? covered('resources', 'Who does the work', 'The build knows who is available to do the work.')
      : trading
        ? gap('resources', 'Who does the work', 'Work is assigned to people and nothing in the build knows who they are.', ['people.directory'])
        : notApplicable('resources', 'Who does the work', 'Nobody but the person whose workspace this is does the work in it.'))

  // Capacity — what limits output. Only where something is scheduled or produced.
  const scheduled = anyCapability(facts, ['work.scheduling', 'work.resources', 'manufacturing.production', 'planning.operations'])
  results.push(scheduled
    ? covered('capacity', 'What limits how much can be done', 'Scheduling or production capacity is part of the build.', 'high')
    : requiredHere(coverage, ['apqc-5.2', 'isa95-Production-Scheduling'])
      ? gap('capacity', 'What limits how much can be done', 'The company commits to dates and nothing in the build shows whether it has the capacity.', ['work.scheduling'], 'high')
      : notApplicable('capacity', 'What limits how much can be done', 'Nothing in this company is scheduled against a limited resource.'))

  // Inventory — what must be available and where.
  const stockEntity = entityLike(facts, /stock|product|material|part|item|ingredient/)
  results.push(anyCapability(facts, ['inventory.stock', 'inventory.warehouses']) || hasField(stockEntity, field => field.id === 'stock' || field.id === 'quantity')
    ? covered('inventory', 'What has to be in stock', 'Stock levels are held in the build.', 'high')
    : requiredHere(coverage, ['apqc-4.5', 'apqc-4.1', 'scor-Source'])
      ? gap('inventory', 'What has to be in stock', 'Goods move through this company and nothing records how much is on hand.', ['inventory.stock'], 'high')
      : notApplicable('inventory', 'What has to be in stock', 'This company holds no stock.'))

  // Quality — whether output is fit to hand over.
  results.push(anyCapability(facts, ['quality.inspections', 'quality.scrap'])
    ? covered('quality', 'How acceptable work is verified', 'A quality check is part of the build.', 'high')
    : requiredHere(coverage, ['apqc-13.3', 'isa95-Quality'])
      ? gap('quality', 'How acceptable work is verified', 'Output is checked before it is handed over and nothing in the build records the result.', ['quality.inspections'], 'high')
      : notApplicable('quality', 'How acceptable work is verified', 'Nothing in this company requires a formal check before handover.'))

  // Compliance — what the company is obliged to do, and can be asked to prove.
  results.push(anyCapability(facts, ['compliance.controls', 'compliance.audits', 'compliance.safety', 'inventory.traceability', 'documents.retention'])
    ? covered('compliance', 'What the company must be able to prove', 'Compliance records are part of the build.')
    : coverage.regulatory.length
      ? gap('compliance', 'What the company must be able to prove', `Regulated activity was detected (${coverage.regulatory.map(item => item.label).join(', ')}) and nothing in the build holds the evidence.`, coverage.regulatory.flatMap(item => item.missingCapabilityIds).slice(0, 3))
      : notApplicable('compliance', 'What the company must be able to prove', 'Nothing said about this company points at a regulated activity.'))

  // People — who is allowed to do what. A workspace with one authority has no controls at all.
  results.push(!trading || archetypes.has('solo')
    ? notApplicable('people', 'Who is allowed to do what', 'One person uses this workspace, so there is no authority to separate.')
    : facts.roleCount >= 2
      ? covered('people', 'Who is allowed to do what', `${facts.roleCount} roles carry different permissions.`, 'high')
      : gap('people', 'Who is allowed to do what', 'Everybody in the workspace holds the same authority, so no approval means anything.', [], 'high'))

  // Finance — transactions becoming financial records rather than stopping at operations.
  const money = facts.entities.some(item => item.fields.some(field => field.type === CURRENCY))
  results.push(!trading
    ? notApplicable('finance', 'How transactions become financial records', 'Nothing in this workspace is a financial transaction.')
    : money && (anyCapability(facts, ['accounting.ledger', 'finance.invoicing', 'finance.payments']) || facts.metricCount > 0)
    ? covered('finance', 'How transactions become financial records', 'Money on records reaches metrics and accounts.')
    : money
      ? gap('finance', 'How transactions become financial records', 'Records carry amounts and nothing turns them into a financial picture.', ['finance.invoicing', 'analytics.reporting'])
      : notApplicable('finance', 'How transactions become financial records', 'No record in this workspace carries an amount.'))

  // Exceptions — what happens when the normal path fails.
  results.push(facts.hasWorkflows
    ? covered('exceptions', 'What happens when something goes wrong', `${(config.workflows ?? []).length} workflows fire when a record goes off the normal path.`)
    : gap('exceptions', 'What happens when something goes wrong', 'Nothing in the build reacts when work is late, stock is low or an invoice is overdue.', [], 'critical'))

  // Management — whether anybody can see what is happening.
  results.push(facts.metricCount + facts.kpiCount > 0
    ? covered('management', 'How management sees what is happening', `${facts.metricCount + facts.kpiCount} measures are reported.`, 'high')
    : gap('management', 'How management sees what is happening', 'The workspace holds records and reports nothing.', ['analytics.reporting'], 'high'))

  // Risk — whether the things that could stop the company are watched by anything.
  // Only gaps something could actually be done about: an unanswered question is not an unwatched risk.
  const risky = coverage.gaps.filter(item => item.criticality === 'critical' && item.capabilityIds.length)
  results.push(anyCapability(facts, ['compliance.risk', 'finance.credit', 'finance.cashflow', 'procurement.performance']) || !risky.length
    ? covered('risk', 'What could stop the company', risky.length ? 'Risk to cash, credit or supply is watched in the build.' : 'No critical operating gap was left open.', 'high')
    : gap('risk', 'What could stop the company', `${risky.length} critical processes have nothing carrying them: ${risky.slice(0, 3).map(item => item.name).join(', ')}.`, [], 'high'))

  // Evidence — records that prove an activity happened.
  const documents = anyCapability(facts, ['documents.repository', 'documents.retention', 'documents.approvals'])
  const files = facts.entities.some(item => item.fields.some(field => field.type === 'file'))
  results.push(documents || files
    ? covered('evidence', 'What proves an activity happened', documents ? 'Documents are stored in the build.' : 'Records carry the files that evidence them.', 'high')
    : coverage.regulatory.length
      ? gap('evidence', 'What proves an activity happened', 'Regulated activity was detected and no record in the build can hold a document.', ['documents.repository'], 'high')
      : notApplicable('evidence', 'What proves an activity happened', 'Nothing in this company has to be evidenced to anybody.'))

  return results
}

/** The tests that failed, worst first — what a build should be repaired against. */
export const completenessGaps = (results: CompletenessResult[]) =>
  results.filter(item => item.status === 'gap').sort((left, right) => (left.criticality === right.criticality ? 0 : left.criticality === 'critical' ? -1 : 1))
