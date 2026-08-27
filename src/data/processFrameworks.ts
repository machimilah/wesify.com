/**
 * The completeness frameworks Wesify checks a company against before it builds anything.
 *
 * Wesify's capability catalog answers "what could this company be given". It cannot answer "what did
 * nobody mention". An operator describing a bakery says nothing about how they pay their suppliers,
 * and a build assembled purely from what was said therefore ships a business with a way to sell and
 * no way to buy — not because Wesify decided against purchasing, but because the subject never came
 * up. A description is evidence; it is never a table of contents.
 *
 * So the reconstructed company is compared against published process frameworks rather than against
 * Wesify's own idea of a business:
 *
 * - **APQC Process Classification Framework, cross-industry** — the master checklist. Thirteen
 *   categories covering every major business function, used to classify each process as required,
 *   applicable, potentially applicable, not applicable or unknown for this specific company.
 * - **SCOR** — supply chain, where the company moves or sources goods.
 * - **ISA-95** — manufacturing operations, where the company converts inputs into output.
 * - **COSO** — internal control, authorization and segregation of duties, wherever money moves.
 *
 * Each entry carries the capabilities that would actually carry the process, so a gap is actionable
 * rather than an observation: either Wesify can select the capability, or the gap becomes a question.
 * An entry with no capabilities is a process the company genuinely has and Wesify deliberately does
 * not build software for — recorded so it is visibly a decision rather than an oversight.
 *
 * Nothing here is knowledge about one company. It is the map of what businesses of a given shape
 * must do, and it decides only which questions get asked and which gaps get shown.
 */

export type ProcessFrameworkId = 'apqc' | 'scor' | 'isa95'

/** The five verdicts every framework process receives. Nothing is ever silently absent. */
export type ProcessClassification = 'required' | 'applicable' | 'potentially-applicable' | 'not-applicable' | 'unknown'

export interface FrameworkProcess {
  id: string
  /** The framework's own reference, so a finding can be traced back to the published source. */
  code: string
  name: string
  framework: ProcessFrameworkId
  category: string
  /** Every company that trades does this, whatever it sells. */
  universal?: boolean
  /**
   * How much it costs to have missed this one.
   *
   * Authored per process rather than derived from its category, because the two do not correlate:
   * paying suppliers and filing tax sit in the same APQC category and only one of them stops the
   * company. Only `critical` gaps are ever put to the architect as something to repair — everything
   * else is reported and left to the operator, which is what keeps a completeness check from
   * rebuilding the module bloat this product exists to avoid.
   */
  criticality: 'critical' | 'high' | 'medium'
  /**
   * Carried by the workspace itself rather than by any capability.
   *
   * Records live in Wesify, every workspace has a reporting section, and workflows are how processes
   * are encoded here. These can never be gaps, and listing them as such taught everybody to skim
   * past a report that was mostly noise.
   */
  platform?: boolean
  /** Archetypes for which this process is not optional. */
  archetypes: string[]
  /** Words in an operator's own description that evidence the process. */
  signals: string[]
  /** The capabilities that carry this process in a built workspace. */
  capabilityIds: string[]
  /** What the process is for, in the words an operator would use. */
  purpose: string
  /**
   * A process the company really has, that Wesify does not put software around.
   *
   * Strategy, investor relations and public relations are done in meetings and documents, not in a
   * command center. Recorded so the classification stays honest — the process was considered and
   * ruled outside the product, which is different from never having been looked at.
   */
  outsideSoftware?: string
}

const process = (
  code: string,
  name: string,
  framework: ProcessFrameworkId,
  category: string,
  criticality: FrameworkProcess['criticality'],
  purpose: string,
  archetypes: string[],
  signals: string[],
  capabilityIds: string[],
  extra: Partial<FrameworkProcess> = {},
): FrameworkProcess => ({ id: `${framework}-${code}`, code, name, framework, category, criticality, purpose, archetypes, signals, capabilityIds, ...extra })

const STRATEGY = '1.0 Develop Vision and Strategy'
const PRODUCTS = '2.0 Develop and Manage Products and Services'
const MARKET = '3.0 Market and Sell Products and Services'
const PHYSICAL = '4.0 Deliver Physical Products'
const SERVICES = '5.0 Deliver Services'
const CUSTOMER_SERVICE = '6.0 Manage Customer Service'
const HUMAN = '7.0 Develop and Manage Human Capital'
const TECHNOLOGY = '8.0 Manage Information Technology'
const FINANCIAL = '9.0 Manage Financial Resources'
const ASSETS = '10.0 Acquire, Construct and Manage Assets'
const RISK = '11.0 Manage Enterprise Risk, Compliance, Remediation and Resiliency'
const EXTERNAL = '12.0 Manage External Relationships'
const CAPABILITIES = '13.0 Develop and Manage Business Capabilities'

/**
 * APQC cross-industry process groups, at level two.
 *
 * Level three would be a questionnaire; level one is too coarse to point at a missing capability.
 * The groups here are the ones whose absence changes what a company can actually do.
 */
export const apqcProcesses: FrameworkProcess[] = [
  process('1.2', 'Develop business strategy', 'apqc', STRATEGY, 'medium', 'Deciding what the company is trying to become.', [], ['strategy', 'business plan', 'growth plan'], [], { outsideSoftware: 'Strategy is decided by the people running the company, not inside their operating software.' }),
  process('1.3', 'Manage strategic initiatives', 'apqc', STRATEGY, 'medium', 'Turning a decision about the company into work somebody owns.', [], ['strategic initiative', 'transformation'], ['work.projects'], { outsideSoftware: 'Tracked only where the company already runs work as projects.' }),

  process('2.1', 'Govern and manage product and service development', 'apqc', PRODUCTS, 'high', 'Deciding what the company offers and keeping the offer current.', ['manufacturer', 'saas', 'food-processor'], ['new product', 'product development', 'recipe development', 'roadmap'], ['commerce.products']),
  process('2.3', 'Define product and service specifications', 'apqc', PRODUCTS, 'high', 'Writing down exactly what is being made or delivered.', ['manufacturer', 'food-processor', 'construction'], ['specification', 'recipe', 'formula', 'bill of materials', 'drawing'], ['manufacturing.bom', 'commerce.products']),

  process('3.1', 'Understand markets, customers and capabilities', 'apqc', MARKET, 'medium', 'Knowing who buys and why.', [], ['market research', 'customer segment', 'competitor'], ['analytics.reporting'], { outsideSoftware: 'Market understanding lives with the operator, not in a table.' }),
  process('3.4', 'Develop and manage marketing plans', 'apqc', MARKET, 'high', 'How the company becomes known to the people who buy.', ['b2c', 'ecommerce', 'retailer', 'agency'], ['marketing', 'campaign', 'advertising', 'social media', 'newsletter'], ['marketing.campaigns', 'marketing.email', 'marketing.attribution']),
  process('3.5', 'Develop and manage sales plans', 'apqc', MARKET, 'critical', 'How an interested party becomes a customer with an order.', [], ['sales', 'lead', 'quote', 'proposal', 'order', 'enquiry', 'booking'], ['crm.contacts', 'crm.pipeline', 'sales.quotes', 'sales.orders'], { universal: true }),
  process('3.5.2', 'Manage customers and accounts', 'apqc', MARKET, 'critical', 'Knowing who the customers are and what has happened with each of them.', [], ['customer', 'client', 'account', 'patient', 'member', 'guest'], ['crm.contacts'], { universal: true }),

  process('4.1', 'Plan for and align supply chain resources', 'apqc', PHYSICAL, 'high', 'Deciding what must be bought or made before it is needed.', ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'food-processor'], ['forecast', 'demand planning', 'reorder', 'lead time', 'stock level'], ['planning.demand', 'planning.operations', 'inventory.stock']),
  process('4.2', 'Procure materials and services', 'apqc', PHYSICAL, 'critical', 'Buying in what the company needs to deliver, from somebody who can supply it.', ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'construction', 'food-processor', 'field-service'], ['supplier', 'purchase', 'buy', 'vendor', 'material', 'ingredient', 'wholesale'], ['procurement.suppliers', 'procurement.purchasing', 'procurement.requisitions']),
  process('4.3', 'Produce and manufacture product', 'apqc', PHYSICAL, 'critical', 'Converting bought inputs into the thing that gets sold.', ['manufacturer', 'food-processor'], ['manufacture', 'production', 'batch', 'assembly', 'workshop', 'bake', 'brew'], ['manufacturing.production', 'manufacturing.bom', 'quality.inspections']),
  process('4.4', 'Deliver product to customer', 'apqc', PHYSICAL, 'critical', 'Getting the goods to whoever bought them.', ['distributor', 'wholesaler', 'ecommerce', 'manufacturer', 'importer', 'exporter', 'logistics'], ['ship', 'deliver', 'courier', 'dispatch', 'freight', 'pallet', 'parcel'], ['logistics.shipping', 'inventory.picking', 'logistics.transport']),
  process('4.5', 'Manage logistics and warehousing', 'apqc', PHYSICAL, 'high', 'Holding stock somewhere known, and knowing what is in it.', ['distributor', 'wholesaler', 'retailer', 'manufacturer', 'logistics', 'food-processor'], ['warehouse', 'stock room', 'storage', 'depot', 'cold store'], ['inventory.warehouses', 'inventory.stock', 'inventory.bins', 'inventory.cycle-counts']),

  process('5.2', 'Manage service delivery resources', 'apqc', SERVICES, 'high', 'Having the right people and time available for the work that has been sold.', ['professional-services', 'agency', 'field-service', 'healthcare', 'hospitality', 'education', 'project-based'], ['schedule', 'roster', 'appointment', 'booking', 'capacity', 'assign', 'crew', 'technician'], ['work.scheduling', 'work.resources', 'people.directory']),
  process('5.3', 'Deliver service to customer', 'apqc', SERVICES, 'critical', 'Doing the work that was promised and knowing it is done.', ['professional-services', 'agency', 'field-service', 'healthcare', 'hospitality', 'education', 'project-based', 'construction'], ['job', 'visit', 'project', 'case', 'session', 'treatment', 'engagement', 'callout'], ['work.projects', 'work.tasks', 'service.field-work']),

  process('6.2', 'Plan and manage customer service operations', 'apqc', CUSTOMER_SERVICE, 'high', 'What happens when a customer has a problem, a question or a complaint.', ['saas', 'subscription', 'ecommerce', 'retailer', 'b2c'], ['support', 'complaint', 'ticket', 'helpdesk', 'aftercare', 'warranty', 'return'], ['support.tickets', 'commerce.returns', 'service.warranty', 'support.sla']),
  process('6.3', 'Measure and evaluate customer service operations', 'apqc', CUSTOMER_SERVICE, 'medium', 'Knowing whether customers are actually being served well.', ['saas', 'subscription'], ['satisfaction', 'nps', 'churn', 'retention'], ['support.csat', 'subscriptions.success']),

  process('7.2', 'Recruit, source and select employees', 'apqc', HUMAN, 'medium', 'Finding and hiring the people the work needs.', [], ['hiring', 'recruit', 'vacancy', 'applicant'], ['people.recruiting'], { outsideSoftware: 'Only where the company hires often enough for it to be an operation rather than an event.' }),
  process('7.3', 'Manage employee onboarding, development and training', 'apqc', HUMAN, 'high', 'Getting people ready to do the work, and keeping them qualified for it.', ['healthcare', 'food-processor', 'construction', 'regulated'], ['training', 'certification', 'induction', 'onboarding', 'licence', 'qualified'], ['people.onboarding', 'people.training']),
  process('7.5', 'Reward and retain employees', 'apqc', HUMAN, 'high', 'Paying people correctly and on time.', [], ['payroll', 'wages', 'salary', 'commission', 'bonus'], ['people.payroll', 'sales.commissions']),
  process('7.7', 'Manage employee information and analytics', 'apqc', HUMAN, 'high', 'Knowing who works here, on what terms, and when they are available.', [], ['staff', 'employee', 'team', 'shift', 'attendance', 'holiday', 'leave'], ['people.directory', 'people.attendance', 'people.time-off']),

  process('8.5', 'Manage information and data', 'apqc', TECHNOLOGY, 'medium', 'Keeping the company records somewhere they can be found, trusted and kept.', [], ['spreadsheet', 'system', 'records', 'files', 'documents'], ['documents.repository', 'documents.retention'], { platform: true }),

  process('9.1', 'Perform planning and management accounting', 'apqc', FINANCIAL, 'high', 'Knowing what things cost and whether the company can afford what it plans.', ['manufacturer', 'construction', 'project-based', 'food-processor'], ['budget', 'cost', 'margin', 'profitability', 'job costing'], ['finance.budgets', 'finance.costcenters', 'work.wip', 'inventory.valuation']),
  process('9.2', 'Perform revenue accounting', 'apqc', FINANCIAL, 'critical', 'Turning delivered work into an invoice and an invoice into money received.', [], ['invoice', 'bill', 'payment', 'deposit', 'charge'], ['finance.invoicing', 'finance.payments', 'finance.revenue-recognition'], { universal: true }),
  process('9.3', 'Perform general accounting and reporting', 'apqc', FINANCIAL, 'high', 'Every transaction ending up in the books, and the books adding up.', [], ['accounts', 'bookkeeping', 'ledger', 'accountant', 'year end'], ['accounting.ledger', 'finance.bank-reconciliation']),
  process('9.5', 'Process payroll', 'apqc', FINANCIAL, 'high', 'Paying employees what they are owed, with the deductions the law requires.', [], ['payroll', 'wages', 'salaries'], ['people.payroll']),
  process('9.6', 'Process accounts payable and expense reimbursements', 'apqc', FINANCIAL, 'critical', 'Paying suppliers and staff expenses, once, on time, and only when approved.', ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'construction', 'food-processor', 'importer'], ['supplier invoice', 'expense', 'reimburse', 'bills'], ['finance.accounts-payable', 'finance.expenses', 'people.expenses']),
  process('9.7', 'Manage treasury operations', 'apqc', FINANCIAL, 'high', 'Knowing what cash is coming, what is going, and whether it is enough.', [], ['cash flow', 'cash', 'bank', 'runway', 'overdraft'], ['finance.cashflow', 'finance.bank-reconciliation']),
  process('9.8', 'Manage internal controls', 'apqc', FINANCIAL, 'high', 'Making sure the person who spends money is not the only person who approves it.', [], ['approval', 'authorise', 'sign off', 'controls', 'audit'], ['compliance.controls', 'documents.approvals']),
  process('9.9', 'Manage taxes', 'apqc', FINANCIAL, 'high', 'Charging, recording and filing whatever the tax authority requires.', [], ['vat', 'tax', 'sales tax', 'gst', 'iva', 'duty'], ['finance.tax']),

  process('10.1', 'Plan and acquire assets', 'apqc', ASSETS, 'high', 'Buying the machines, vehicles and property the work depends on.', ['manufacturer', 'field-service', 'logistics', 'construction', 'food-processor', 'property'], ['machine', 'vehicle', 'van', 'equipment', 'premises', 'plant'], ['maintenance.assets', 'finance.fixed-assets', 'logistics.fleet']),
  process('10.3', 'Maintain productive assets', 'apqc', ASSETS, 'high', 'Keeping the things the work depends on working.', ['manufacturer', 'field-service', 'logistics', 'food-processor', 'property', 'hospitality'], ['maintenance', 'service interval', 'breakdown', 'repair', 'calibration'], ['maintenance.assets', 'service.assets']),

  process('11.1', 'Manage enterprise risk', 'apqc', RISK, 'high', 'Knowing what could stop the company, and who is watching it.', ['regulated', 'healthcare', 'food-processor', 'construction', 'importer', 'exporter'], ['risk', 'insurance', 'liability', 'single supplier', 'contingency'], ['compliance.risk']),
  process('11.2', 'Manage compliance', 'apqc', RISK, 'critical', 'Doing what the law, a licence or a customer contract obliges, and being able to prove it.', ['regulated', 'healthcare', 'food-processor', 'construction', 'importer', 'exporter', 'education'], ['licence', 'license', 'inspection', 'certification', 'regulation', 'audit', 'haccp', 'permit', 'traceability'], ['compliance.controls', 'compliance.audits', 'compliance.safety', 'inventory.traceability', 'documents.retention']),
  process('11.4', 'Manage business resiliency', 'apqc', RISK, 'medium', 'What the company does when its normal way of working stops.', ['manufacturer', 'logistics', 'healthcare'], ['backup supplier', 'continuity', 'disaster', 'downtime'], ['compliance.risk'], { outsideSoftware: 'Continuity planning is a document before it is a record type.' }),

  process('12.2', 'Manage government and industry relationships', 'apqc', EXTERNAL, 'high', 'Whatever must be filed with, reported to, or renewed with an authority.', ['regulated', 'healthcare', 'food-processor', 'importer', 'exporter', 'construction'], ['authority', 'regulator', 'ministry', 'customs', 'inspectorate', 'filing'], ['compliance.audits', 'documents.repository']),
  process('12.4', 'Manage legal and ethical issues', 'apqc', EXTERNAL, 'high', 'Contracts the company is bound by, and the obligations inside them.', ['b2b', 'construction', 'project-based', 'saas'], ['contract', 'terms', 'agreement', 'sla', 'penalty', 'liability'], ['sales.contracts', 'procurement.contracts', 'documents.esign']),

  process('13.1', 'Manage business processes', 'apqc', CAPABILITIES, 'medium', 'The company having one way of doing a thing rather than one per person.', [], ['process', 'procedure', 'checklist', 'standard'], ['work.tasks'], { platform: true, outsideSoftware: 'Wesify encodes processes as workflows rather than as a process register.' }),
  process('13.3', 'Manage enterprise quality', 'apqc', CAPABILITIES, 'high', 'Deciding whether what was produced is good enough to hand over.', ['manufacturer', 'food-processor', 'construction', 'healthcare'], ['quality', 'inspection', 'reject', 'defect', 'test', 'sample', 'tolerance'], ['quality.inspections', 'quality.scrap']),
  process('13.6', 'Measure and benchmark', 'apqc', CAPABILITIES, 'medium', 'Management being able to see what is actually happening.', [], ['report', 'kpi', 'dashboard', 'measure', 'track'], ['analytics.reporting', 'analytics.dashboards'], { platform: true }),
]

/** SCOR digital standard, at its top level. Applies wherever goods or materials move. */
export const scorProcesses: FrameworkProcess[] = [
  process('Orchestrate', 'Orchestrate', 'scor', 'SCOR', 'medium', 'One place that knows what the whole chain is doing, rather than each step knowing only itself.', ['manufacturer', 'distributor', 'importer', 'exporter', 'logistics'], ['coordinate', 'end to end', 'orchestrate'], ['planning.operations', 'analytics.dashboards']),
  process('Plan', 'Plan', 'scor', 'SCOR', 'high', 'Deciding what to buy, make and move before demand arrives.', ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'food-processor'], ['forecast', 'plan', 'demand', 'reorder point', 'safety stock'], ['planning.demand', 'planning.operations', 'manufacturing.mrp']),
  process('Order', 'Order', 'scor', 'SCOR', 'high', 'Taking a customer commitment and promising a date the company can keep.', ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'ecommerce'], ['order', 'confirm', 'lead time', 'promise date'], ['sales.orders', 'sales.quotes']),
  process('Source', 'Source', 'scor', 'SCOR', 'critical', 'Buying materials and getting them received against what was ordered.', ['manufacturer', 'distributor', 'wholesaler', 'retailer', 'food-processor', 'construction'], ['supplier', 'purchase order', 'goods in', 'receive', 'delivery note'], ['procurement.suppliers', 'procurement.purchasing', 'logistics.receiving']),
  process('Transform', 'Transform', 'scor', 'SCOR', 'critical', 'Converting what was sourced into what was sold.', ['manufacturer', 'food-processor'], ['produce', 'manufacture', 'assemble', 'batch', 'bake'], ['manufacturing.production', 'manufacturing.bom', 'manufacturing.routing']),
  process('Fulfill', 'Fulfill', 'scor', 'SCOR', 'critical', 'Picking, packing, shipping and proving the customer got it.', ['manufacturer', 'distributor', 'wholesaler', 'ecommerce', 'logistics', 'exporter'], ['ship', 'pick', 'pack', 'dispatch', 'proof of delivery'], ['inventory.picking', 'logistics.shipping', 'logistics.transport']),
  process('Return', 'Return', 'scor', 'SCOR', 'high', 'What happens to goods that come back, and what the customer is owed for them.', ['ecommerce', 'retailer', 'distributor', 'manufacturer', 'wholesaler'], ['return', 'refund', 'credit note', 'rma', 'faulty', 'recall'], ['commerce.returns', 'service.rma', 'service.warranty']),
]

/** ISA-95 manufacturing operations management. Only where the company converts inputs into output. */
export const isa95Processes: FrameworkProcess[] = [
  process('Production-Scheduling', 'Production scheduling', 'isa95', 'ISA-95', 'high', 'Deciding what gets made when, on what, and by whom.', ['manufacturer', 'food-processor'], ['production schedule', 'run', 'line', 'shift plan'], ['manufacturing.production', 'planning.operations']),
  process('Production-Execution', 'Production execution', 'isa95', 'ISA-95', 'high', 'Recording what was actually made rather than what was planned.', ['manufacturer', 'food-processor'], ['batch', 'output', 'yield', 'produced'], ['manufacturing.production']),
  process('Material-Management', 'Material and lot management', 'isa95', 'ISA-95', 'critical', 'Knowing which materials went into which output, by lot.', ['manufacturer', 'food-processor'], ['lot', 'batch number', 'expiry', 'traceability', 'raw material'], ['inventory.traceability', 'inventory.stock', 'manufacturing.bom']),
  process('Equipment', 'Equipment and capacity', 'isa95', 'ISA-95', 'high', 'Which machines exist, what they can do, and whether they are free.', ['manufacturer', 'food-processor'], ['machine', 'equipment', 'capacity', 'line', 'oven', 'mixer'], ['maintenance.assets', 'work.resources']),
  process('Quality', 'Quality operations', 'isa95', 'ISA-95', 'critical', 'Testing output and deciding whether it may be released.', ['manufacturer', 'food-processor'], ['quality', 'test', 'sample', 'release', 'reject', 'hold'], ['quality.inspections', 'quality.scrap']),
  process('Maintenance', 'Maintenance operations', 'isa95', 'ISA-95', 'high', 'Keeping production equipment available.', ['manufacturer', 'food-processor'], ['maintenance', 'breakdown', 'service interval', 'spare part'], ['maintenance.assets']),
  process('Performance', 'Production performance', 'isa95', 'ISA-95', 'medium', 'Whether production is keeping up, and where it is losing time or material.', ['manufacturer', 'food-processor'], ['downtime', 'waste', 'scrap', 'efficiency'], ['quality.scrap', 'analytics.reporting']),
]

/**
 * COSO internal control, expressed as things a built workspace must be able to do.
 *
 * These are not capabilities to select. They are checks against what was built: a workspace where
 * money leaves the company and nothing anywhere requires an approval has a control gap whatever
 * capabilities it holds.
 */
export interface ControlObjective {
  id: string
  name: string
  component: 'control-environment' | 'risk-assessment' | 'control-activities' | 'information' | 'monitoring'
  /** What the workspace must contain for this control to exist at all. */
  requires: 'approval' | 'segregation' | 'audit-trail' | 'reconciliation' | 'authorization-limit'
  /** The control only matters where the company does one of these. */
  appliesWhen: string[]
  capabilityIds: string[]
  why: string
}

export const controlObjectives: ControlObjective[] = [
  { id: 'spend-approval', name: 'Money leaving the company is approved by somebody other than the person spending it', component: 'control-activities', requires: 'approval', appliesWhen: ['procurement.purchasing', 'finance.accounts-payable', 'finance.expenses', 'people.expenses', 'procurement.requisitions'], capabilityIds: ['documents.approvals', 'compliance.controls'], why: 'An unapproved payment is the most common way a small company loses money it never notices leaving.' },
  { id: 'credit-authorization', name: 'Selling on credit is a decision somebody makes, not a default', component: 'risk-assessment', requires: 'authorization-limit', appliesWhen: ['finance.invoicing', 'sales.orders', 'sales.contracts'], capabilityIds: ['finance.credit'], why: 'A customer who cannot pay is cheaper to refuse than to chase.' },
  { id: 'cash-reconciliation', name: 'What the books say arrived is checked against what the bank says arrived', component: 'monitoring', requires: 'reconciliation', appliesWhen: ['finance.payments', 'accounting.ledger', 'commerce.pos'], capabilityIds: ['finance.bank-reconciliation'], why: 'Unreconciled cash is the difference between believing you were paid and having been paid.' },
  { id: 'inventory-evidence', name: 'Stock movements leave a record of who moved what and when', component: 'information', requires: 'audit-trail', appliesWhen: ['inventory.stock', 'inventory.warehouses', 'manufacturing.production'], capabilityIds: ['inventory.cycle-counts', 'inventory.traceability'], why: 'Stock that moves without a record cannot be counted, costed, or recalled.' },
  { id: 'duty-separation', name: 'The workspace can tell roles apart, so not everybody can do everything', component: 'control-environment', requires: 'segregation', appliesWhen: ['finance.invoicing', 'finance.payments', 'people.payroll', 'accounting.ledger'], capabilityIds: [], why: 'Segregation of duties is meaningless if every person in the workspace holds every permission.' },
  { id: 'compliance-evidence', name: 'Whatever the company must prove to an inspector is stored where it can be produced', component: 'information', requires: 'audit-trail', appliesWhen: ['compliance.controls', 'compliance.audits', 'compliance.safety', 'quality.inspections', 'inventory.traceability'], capabilityIds: ['documents.repository', 'documents.retention'], why: 'A control that happened and cannot be evidenced did not happen, as far as an audit is concerned.' },
]

/**
 * Where regulation is likely to govern this company, and who to check with.
 *
 * Deliberately not a list of rules. Wesify does not know which jurisdiction a sentence about food
 * refers to, and inventing a specific obligation is worse than naming none: an operator told they
 * need a certificate they do not need will go and try to get it. Every entry therefore names the
 * kind of authority and the kind of record, and is always classified as requiring verification.
 */
export interface RegulatoryDomain {
  id: string
  label: string
  signals: string[]
  /** The kind of body that governs this, named generically where the jurisdiction is unknown. */
  authorities: string[]
  /** What such regimes commonly oblige, as subjects to confirm rather than as facts. */
  obligations: string[]
  capabilityIds: string[]
}

export const regulatoryDomains: RegulatoryDomain[] = [
  { id: 'food', label: 'Food and beverage production or handling', signals: ['food', 'bakery', 'kitchen', 'restaurant', 'brewery', 'dairy', 'meat', 'produce', 'catering', 'ingredient', 'recipe', 'cold chain'], authorities: ['the national food safety authority', 'the local health or sanitary inspectorate', 'FDA or USDA where the company operates in the United States'], obligations: ['food handling registration or licence', 'hazard analysis and critical control point records', 'lot traceability one step forward and one step back', 'allergen declaration', 'temperature and cleaning logs', 'a product recall procedure'], capabilityIds: ['compliance.safety', 'inventory.traceability', 'quality.inspections', 'documents.retention'] },
  { id: 'health', label: 'Health or care services', signals: ['clinic', 'patient', 'medical', 'dental', 'therapy', 'nursing', 'pharmacy', 'diagnosis', 'treatment'], authorities: ['the health regulator or ministry of health', 'the professional licensing body', 'the data protection authority, for patient data'], obligations: ['practitioner licensing and registration', 'patient record confidentiality and retention', 'consent records', 'clinical incident reporting'], capabilityIds: ['vertical.healthcare', 'vertical.clinical', 'documents.retention', 'compliance.controls'] },
  { id: 'cross-border', label: 'Goods crossing a border', signals: ['import', 'export', 'customs', 'container', 'overseas supplier', 'duty', 'incoterm', 'freight forwarder', 'port'], authorities: ['the customs authority of each country involved', 'the tax authority, for import VAT or duty'], obligations: ['customs declarations and commodity codes', 'certificates of origin', 'commercial invoice and packing list', 'import duty and tax accounting', 'record retention for customs audit'], capabilityIds: ['logistics.customs', 'logistics.shipping', 'finance.tax', 'documents.retention'] },
  { id: 'employment', label: 'Employing people', signals: ['employee', 'staff', 'payroll', 'wages', 'contract of employment', 'shift', 'holiday', 'overtime'], authorities: ['the labour regulator or inspectorate', 'the tax authority, for payroll withholding', 'the social security institution'], obligations: ['employment contracts on file', 'working time and attendance records', 'payroll withholding and filing', 'workplace safety obligations'], capabilityIds: ['people.directory', 'people.payroll', 'people.attendance', 'compliance.safety'] },
  { id: 'personal-data', label: 'Holding personal data about customers', signals: ['customer data', 'personal data', 'gdpr', 'privacy', 'marketing list', 'consent'], authorities: ['the data protection authority of the jurisdictions the customers live in'], obligations: ['a lawful basis for holding and using personal data', 'retention limits and deletion', 'consent for marketing contact', 'breach notification'], capabilityIds: ['documents.retention', 'compliance.controls'] },
  { id: 'card-payments', label: 'Taking card payments', signals: ['card payment', 'credit card', 'checkout', 'stripe', 'terminal', 'point of sale'], authorities: ['the acquiring bank or payment processor', 'the card scheme rules, which bind by contract rather than by statute'], obligations: ['not storing card numbers in the workspace', 'reconciliation of settlements against sales', 'chargeback handling'], capabilityIds: ['finance.payments', 'finance.bank-reconciliation'] },
  { id: 'construction-safety', label: 'Construction and site work', signals: ['site', 'construction', 'building work', 'scaffold', 'excavation'], authorities: ['the workplace safety regulator', 'the local building control or permitting authority'], obligations: ['building permits and approvals', 'site safety method statements and risk assessments', 'subcontractor insurance and qualification evidence', 'incident reporting'], capabilityIds: ['compliance.safety', 'vertical.permits', 'work.subcontractors', 'vertical.construction-controls'] },
  { id: 'licensed-trade', label: 'A licensed or registered activity', signals: ['licence', 'license', 'permit', 'registered', 'accredited', 'certified', 'inspection', 'alcohol', 'firearms', 'childcare', 'transport operator'], authorities: ['the licensing authority for the activity and jurisdiction'], obligations: ['holding a current licence for the activity', 'renewal dates and conditions', 'evidence produced at inspection'], capabilityIds: ['compliance.audits', 'compliance.controls', 'documents.retention'] },
]
