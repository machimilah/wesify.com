import { industryCapabilityPacks, type IndustryCapabilityPack } from './capabilityCatalog'
import { resolveIndustry } from './industryResolver'
import { evaluateOperatingKnowledge, type BusinessGap, type KnowledgeRequirement } from './knowledgeEngine'
import { saysSignal } from './shared'

/**
 * BO's business researcher.
 *
 * The capability catalog knows which systems exist. This module decides which of them a specific
 * company actually needs, by reading the operating model out of what the company said instead of
 * matching keywords to feature names. Every conclusion carries the evidence it came from, its basis
 * (stated by the operator, inferred from the operating model, or a domain default), and the
 * capability decisions that depend on it. Unresolved dimensions become questions ranked by how many
 * software decisions they would settle, which is what makes the interview short and non-generic.
 */

/** How BO knows something: the operator said it, an external source said it, BO reasoned to it, or it is a domain default. */
export type ResearchBasis = 'stated' | 'researched' | 'inferred' | 'domain-default'

export interface DimensionReading {
  dimensionId: string
  dimensionLabel: string
  optionId: string
  label: string
  basis: ResearchBasis
  confidence: number
  evidence: string
  implies: string[]
  excludes: string[]
}

export interface ResearchFinding {
  id: string
  conclusion: string
  because: string
  implication: string
  basis: ResearchBasis
  confidence: number
  capabilityIds: string[]
}

export interface ResearchDecision {
  capabilityId: string
  reason: string
}

export interface BusinessResearch {
  archetype: { id: string; label: string; confidence: number; evidence: string } | null
  readings: DimensionReading[]
  findings: ResearchFinding[]
  include: ResearchDecision[]
  exclude: ResearchDecision[]
  knowledgeRequirements: KnowledgeRequirement[]
  gaps: BusinessGap[]
  coverage: number
}

export interface ResearchInput {
  /** Everything the company has said, in its own words. */
  text: string
  /** Questions BO has already put to the operator, so it never asks twice. */
  asked?: string[]
}

interface OptionSpec {
  id: string
  label: string
  answer: string
  match?: RegExp
  implies?: string[]
  excludes?: string[]
  conclusion: string
  implication: string
}

interface DimensionSpec {
  id: string
  label: string
  weight: number
  /**
   * BO refuses to architect while an essential dimension is unknown, because a wrong guess there
   * produces the wrong product. Non-essential dimensions only add or remove supporting systems, so
   * BO proceeds on a domain default and lets the operator add them later.
   */
  essential: boolean
  options: OptionSpec[]
}

const option = (
  id: string,
  label: string,
  answer: string,
  conclusion: string,
  implication: string,
  match: RegExp | undefined,
  implies: string[] = [],
  excludes: string[] = [],
): OptionSpec => ({ id, label, answer, conclusion, implication, match, implies, excludes })

/**
 * The operating-model dimensions. Each one exists because its answer changes which capabilities the
 * Command Center is built from — never because a questionnaire would traditionally ask it.
 */
export const researchDimensions: DimensionSpec[] = [
  {
    id: 'offering',
    label: 'What the company sells',
    weight: 5,
    essential: true,
    options: [
      option('services', 'Services', 'Services', 'This company sells work performed for clients', 'Wesify is connecting clients, the work they buy, and the invoices that follow it.', /\b(agency|agencies|consultanc|consulting|advisory|professional services|law firm|accounting firm|architect|studio|freelance|marketing services|creative services|service business|we do the work)\w*/, ['crm.contacts', 'work.projects', 'finance.invoicing']),
      option('physical-products', 'Physical products', 'Physical products', 'This company moves physical goods', 'Wesify is connecting products, stock levels, and what leaves the building.', /\b(physical (product|goods)|sell goods|retail|shop|store|warehouse|distribut\w*|wholesal\w*|manufactur\w*|factory|produce goods|parts|merchandise)s?\b/, ['commerce.products', 'inventory.stock']),
      option('software', 'Software or digital products', 'Software or digital products', 'This company sells a digital product rather than physical delivery', 'Wesify is connecting accounts, subscriptions, and support instead of stock and shipping.', /\b(saas|software as a service|software platform|web app|mobile app|digital product|online course|digital only)s?\b/, ['commerce.products', 'support.tickets'], ['inventory.stock', 'logistics.shipping', 'manufacturing.production']),
      option('mixed', 'A mix', 'A mix of both', 'This company sells both work and things', 'Wesify is connecting the service side and the product side to the same client records.', undefined, ['crm.contacts', 'commerce.products']),
    ],
  },
  {
    id: 'revenue',
    label: 'How money enters',
    weight: 4.5,
    essential: true,
    options: [
      option('recurring', 'Recurring', 'Monthly retainer or subscription', 'This company delivers recurring client work', 'Wesify is connecting clients, recurring agreements, renewals, and the invoices they generate.', /\b(retainers?|subscriptions?|recurring|monthly fees?|monthly plans?|memberships?|per month|annual (fee|plan)s?|renewals?)s?\b/, ['subscriptions.billing', 'finance.invoicing', 'crm.contacts']),
      option('per-project', 'Per project or milestone', 'Per project or milestone', 'Revenue is committed per piece of work rather than continuously', 'Wesify is connecting quotes, the work they become, and staged billing against it.', /\b(per project|fixed fee|project fee|milestone|progress billing|staged (payment|invoice)|per job|quote|estimate|bid)s?\b/, ['sales.quotes', 'work.projects', 'finance.invoicing']),
      option('on-completion', 'On completion', 'When the work is finished', 'Money arrives only after delivery, so unbilled finished work is a real risk', 'Wesify is connecting completed work directly to invoicing and outstanding balances.', /\b(on completion|after the (job|work)|once (the )?(work|job) is (done|finished)|invoice after|when we finish)s?\b/, ['finance.invoicing', 'finance.payments']),
      option('upfront', 'Upfront', 'Before the work starts', 'Cash is collected before delivery', 'Wesify is connecting payments and deposits ahead of the work they release.', /\b(upfront|up front|in advance|prepaid|pre-paid|deposit|pay before)s?\b/, ['finance.payments', 'finance.invoicing']),
      option('point-of-sale', 'At the point of sale', 'At checkout', 'Payment and delivery happen in the same moment', 'Wesify is connecting sales sessions, takings, and stock consumed at the counter.', /\b(checkout|point of sale|\bpos\b|at the till|cash register|in[- ]store purchase|table service|per cover)s?\b/, ['commerce.pos', 'finance.payments']),
    ],
  },
  {
    id: 'delivery',
    label: 'How work reaches the customer',
    weight: 4,
    essential: true,
    options: [
      option('on-site', 'At the customer location', 'We travel to the customer', 'Work happens at customer locations, so scheduling and dispatch are operational, not administrative', 'Wesify is connecting work orders, the people assigned to them, and the assets they service.', /\b(on ?site|customer site|customer'?s? (home|premises|location)|visit|call ?out|field service|technician|engineer visits|install\w*|repair\w* at)s?\b/, ['work.scheduling', 'service.field-work', 'people.directory']),
      option('appointment', 'At our own location by appointment', 'Customers book time with us', 'Capacity is booked time, so the calendar is the operating system of the business', 'Wesify is connecting bookings, the people delivering them, and what each one bills.', /\b(appointment|booking|book a (slot|time)|reservation|clinic|salon|consultation slot|session|class)s?\b/, ['work.scheduling']),
      option('project', 'As a managed project', 'We run projects or campaigns', 'Work is delivered as managed engagements with their own scope and deadlines', 'Wesify is connecting projects, the tasks inside them, team capacity, and cost against budget.', /\b(project|campaign|engagement|deliverable|sprint|scope of work|brief)s?\b/, ['work.projects', 'work.tasks']),
      option('shipped', 'Shipped to the customer', 'We ship goods out', 'Fulfilment is physical, so the operation ends at a delivered shipment', 'Wesify is connecting orders, stock, and shipments with their delivery status.', /\b(ship\w*|courier|dispatch|freight|tracking number|delivery van|deliver goods|post it out)s?\b/, ['sales.orders', 'logistics.shipping', 'inventory.stock']),
      option('produced', 'Made in-house first', 'We make it ourselves', 'The company converts inputs into output, so production capacity governs delivery', 'Wesify is connecting production orders, materials, and quality checks before anything ships.', /\b(manufactur\w*|production line|assembl\w*|fabricat\w*|we (make|build|produce)|workshop|factory floor)s?\b/, ['manufacturing.production', 'inventory.stock']),
    ],
  },
  {
    id: 'customer',
    label: 'Who is served',
    weight: 3.5,
    essential: false,
    options: [
      option('business', 'Other businesses', 'Other businesses', 'Customers are organizations, so accounts outlive individual contacts', 'Wesify is connecting company accounts, their contacts, and the agreements between them.', /\b(b2b|businesses|companies|corporate|enterprise|other firms|technology companies|smes?|agencies as clients)s?\b/, ['crm.contacts', 'sales.contracts']),
      option('consumer', 'Consumers', 'Consumers', 'Customers are individuals, so volume and repeat contact matter more than account hierarchy', 'Wesify is connecting individual customer records to their history and payments.', /\b(b2c|consumers?|general public|homeowners?|individuals|private clients|patients|guests|residents|students)s?\b/, ['crm.contacts']),
      option('mixed', 'Both', 'Both businesses and consumers', 'The company serves organizations and individuals through the same operation', 'Wesify is keeping one client record type that works for both.', undefined, ['crm.contacts']),
    ],
  },
  {
    id: 'workforce',
    label: 'Who does the work',
    weight: 3,
    essential: true,
    options: [
      option('solo', 'Solo operator', 'Just me', 'One person runs the operation, so people administration would be pure overhead', 'Wesify is leaving out staffing, leave, and payroll administration entirely.', /\b(solo|just me|only me|i work alone|one[- ]person|sole (trader|operator)|no employees|no team)s?\b/, [], ['people.time-off', 'people.attendance', 'people.payroll', 'people.recruiting', 'work.resources']),
      option('internal-team', 'Internal team', 'A small internal team', 'A fixed internal team carries the work, so assignment and capacity are the real constraint', 'Wesify is connecting the team directory to assigned work and workload.', /\b(internal team|our team|employees|staff|small team|team of \d+|\d+ (people|employees|staff))s?\b/, ['people.directory']),
      option('contractors', 'Employees and contractors', 'Employees and contractors', 'Delivery capacity is partly external, so who is engaged and on what terms must be tracked', 'Wesify is connecting internal people, contractors, and what each is committed to.', /\b(contractor|freelancer|subcontract\w*|outsourc\w*|external partner|associates)s?\b/, ['people.directory', 'procurement.suppliers']),
      option('shifts', 'Shift or crew based', 'Shifts or crews', 'Labour is scheduled in shifts, so the rota is an operating document', 'Wesify is connecting shifts, attendance, and the work each covers.', /\b(shifts?|rota|roster|crew|on call|night staff|opening hours cover)s?\b/, ['people.directory', 'people.attendance']),
    ],
  },
  {
    id: 'supply',
    label: 'What the company buys to deliver',
    weight: 2.5,
    essential: false,
    options: [
      option('materials', 'Materials or stock', 'Yes, materials or stock', 'Delivery depends on purchased inputs, so shortages stop the work', 'Wesify is connecting suppliers, purchase orders, and stock against the work that consumes it.', /\b(materials?|raw material|parts|components|ingredients?|supplier|vendor|purchase order|buy stock|source (goods|parts))s?\b/, ['procurement.suppliers', 'procurement.purchasing', 'inventory.stock']),
      option('subcontracted', 'Subcontracted work', 'Yes, subcontractors', 'Part of delivery is bought in, so external commitments carry cost and risk', 'Wesify is connecting subcontractors to the work and cost they are attached to.', /\b(subcontract\w*|outsourc\w*|third[- ]party (installer|team)|partner delivers)s?\b/, ['procurement.suppliers']),
      option('nothing', 'Nothing is purchased to deliver', 'No, nothing is purchased to deliver', 'Delivery consumes no purchased inputs, so procurement and stock would be dead weight', 'Wesify is leaving out purchasing, stock, and shipping.', /\b(no (materials|stock|inventory)|nothing physical|digital(ly)? only|services? only|we don'?t (buy|hold) (stock|materials))s?\b/, [], ['inventory.stock', 'inventory.warehouses', 'procurement.purchasing', 'logistics.shipping']),
    ],
  },
  {
    id: 'control',
    label: 'What gates the work',
    weight: 2,
    essential: false,
    options: [
      option('approvals', 'Internal approvals', 'Yes, things need approving internally', 'Work waits on decisions, so approvals are a queue that can be measured', 'Wesify is connecting approval requests to the records they hold up.', /\b(approv\w*|sign[- ]?off|authoris\w*|authoriz\w*|needs? my ok|manager (approves|signs))s?\b/, ['documents.approvals']),
      option('contracts', 'Signed agreements', 'Yes, signed agreements', 'Commitments are contractual, so terms, dates, and signatures are operational data', 'Wesify is connecting contracts, their dates, and the signatures that activate them.', /\b(contract|agreement|signature|e[- ]?sign|nda|terms are signed|msa)s?\b/, ['sales.contracts', 'documents.repository']),
      option('regulated', 'Regulatory obligations', 'Yes, regulatory requirements', 'The work carries external obligations, so evidence must be retained, not just produced', 'Wesify is connecting controls, their owners, and the evidence each one needs.', /\b(gdpr|hipaa|iso ?\d*|soc ?2|regulat\w*|licen[cs]\w*|inspection|statutory|audit requirement|certification)s?\b/, ['compliance.controls', 'documents.repository']),
      option('none', 'Nothing formal', 'No, nothing formal', 'Nothing external gates delivery, so governance surfaces would sit unused', 'Wesify is leaving approvals and compliance out of the first version.', undefined, []),
    ],
  },
]

/**
 * What BO assumes about an operating model before the operator has said it. These are provisional:
 * they let the preview build, they never count as answers, and they never select a capability.
 */
const archetypeDefaults: Record<string, Record<string, string>> = {
  agency: { offering: 'services', delivery: 'project', customer: 'business', workforce: 'internal-team' },
  'professional-services': { offering: 'services', delivery: 'project', customer: 'business', workforce: 'internal-team' },
  saas: { offering: 'software', revenue: 'recurring', customer: 'business', supply: 'nothing' },
  manufacturing: { offering: 'physical-products', delivery: 'produced', customer: 'business', supply: 'materials', workforce: 'internal-team' },
  retail: { offering: 'physical-products', delivery: 'shipped', customer: 'consumer', supply: 'materials' },
  'field-service': { offering: 'services', delivery: 'on-site', customer: 'mixed', workforce: 'shifts', supply: 'materials' },
  construction: { offering: 'services', delivery: 'project', revenue: 'per-project', customer: 'business', supply: 'materials', workforce: 'contractors' },
  healthcare: { offering: 'services', delivery: 'appointment', customer: 'consumer', control: 'regulated' },
  property: { offering: 'services', revenue: 'recurring', customer: 'consumer', control: 'contracts' },
  hospitality: { offering: 'physical-products', revenue: 'point-of-sale', customer: 'consumer', workforce: 'shifts', supply: 'materials' },
  logistics: { offering: 'services', delivery: 'shipped', customer: 'business', workforce: 'shifts' },
  education: { offering: 'services', delivery: 'appointment', customer: 'consumer' },
  nonprofit: { offering: 'services', delivery: 'project', customer: 'mixed' },
  wholesale: { offering: 'physical-products', delivery: 'shipped', customer: 'business', supply: 'materials' },
  rental: { offering: 'physical-products', delivery: 'appointment', revenue: 'recurring', supply: 'materials' },
}

const sentences = (text: string) => text.split(/(?<=[.!?;\n])\s+|\s+·\s+/).map(item => item.trim()).filter(item => item.length > 2)

function quoteFor(statements: string[], match: RegExp, fallback: string) {
  const found = statements.find(statement => match.test(statement))
  if (!found) return fallback
  return found.length > 160 ? `${found.slice(0, 157)}…` : found
}

function detectArchetype(text: string): { pack: IndustryCapabilityPack; score: number; signal: string } | null {
  let best: { pack: IndustryCapabilityPack; score: number; signal: string } | null = null
  for (const pack of industryCapabilityPacks) {
    for (const signal of pack.signals) {
      if (!saysSignal(text, signal)) continue
      const score = signal.split(' ').length + 1
      if (!best || score > best.score) best = { pack, score, signal }
    }
  }
  return best
}

function readDimension(dimension: DimensionSpec, text: string, statements: string[], archetypeId: string | null): DimensionReading | null {
  for (const candidate of dimension.options) {
    if (!candidate.match?.test(text)) continue
    return {
      dimensionId: dimension.id,
      dimensionLabel: dimension.label,
      optionId: candidate.id,
      label: candidate.label,
      basis: 'stated',
      confidence: 0.9,
      evidence: quoteFor(statements, candidate.match, candidate.label),
      implies: candidate.implies ?? [],
      excludes: candidate.excludes ?? [],
    }
  }
  const fallbackId = archetypeId ? archetypeDefaults[archetypeId]?.[dimension.id] : undefined
  const fallback = dimension.options.find(candidate => candidate.id === fallbackId)
  if (!fallback) return null
  return {
    dimensionId: dimension.id,
    dimensionLabel: dimension.label,
    optionId: fallback.id,
    label: fallback.label,
    basis: 'domain-default',
    confidence: 0.45,
    evidence: 'Typical for this kind of business; not yet confirmed.',
    implies: [],
    excludes: [],
  }
}

const optionOf = (dimension: DimensionSpec, optionId: string) => dimension.options.find(candidate => candidate.id === optionId)

export function researchBusiness({ text }: ResearchInput): BusinessResearch {
  const normalized = text.toLowerCase()
  const statements = sentences(text)
  const detected = detectArchetype(normalized)
  // Signals are precise but only cover businesses someone wrote a signal for. The taxonomy covers
  // every business there is, so it catches what the signal lists miss.
  const taxonomy = detected ? null : resolveIndustry(text)
  const archetypeId = detected?.pack.id ?? taxonomy?.archetype ?? null
  const readings = researchDimensions
    .map(dimension => readDimension(dimension, normalized, statements, archetypeId))
    .filter(Boolean) as DimensionReading[]
  const resolved = readings.filter(reading => reading.basis !== 'domain-default')

  const include = new Map<string, string>()
  const exclude = new Map<string, string>()
  for (const reading of resolved) {
    for (const capabilityId of reading.implies) if (!include.has(capabilityId)) include.set(capabilityId, `${reading.dimensionLabel}: ${reading.label.toLowerCase()} — “${reading.evidence}”`)
    for (const capabilityId of reading.excludes) if (!exclude.has(capabilityId)) exclude.set(capabilityId, `${reading.dimensionLabel}: ${reading.label.toLowerCase()} — “${reading.evidence}”`)
  }
  for (const capabilityId of exclude.keys()) include.delete(capabilityId)

  const operatingKnowledge = evaluateOperatingKnowledge(normalized, [...include.keys()])

  const findings: ResearchFinding[] = resolved.map(reading => {
    const definition = optionOf(researchDimensions.find(item => item.id === reading.dimensionId)!, reading.optionId)!
    return {
      id: `${reading.dimensionId}:${reading.optionId}`,
      conclusion: definition.conclusion,
      because: reading.evidence,
      implication: definition.implication,
      basis: reading.basis,
      confidence: reading.confidence,
      capabilityIds: [...(definition.implies ?? [])],
    }
  })

  const totalWeight = researchDimensions.reduce((total, dimension) => total + dimension.weight, 0)
  const resolvedWeight = resolved.reduce((total, reading) => total + (researchDimensions.find(item => item.id === reading.dimensionId)?.weight ?? 0), 0)

  return {
    archetype: detected
      ? { id: detected.pack.id, label: detected.pack.label, confidence: Math.min(0.95, 0.55 + detected.score * 0.1), evidence: detected.signal }
      : taxonomy
        ? { id: taxonomy.archetype, label: taxonomy.subsectorTitle, confidence: taxonomy.confidence, evidence: `classified as ${taxonomy.title} (${taxonomy.sectorTitle})` }
        : null,
    readings,
    findings,
    include: [...include.entries()].map(([capabilityId, reason]) => ({ capabilityId, reason })),
    exclude: [...exclude.entries()].map(([capabilityId, reason]) => ({ capabilityId, reason })),
    knowledgeRequirements: operatingKnowledge.requirements,
    gaps: operatingKnowledge.gaps,
    coverage: Number((resolvedWeight / totalWeight).toFixed(2)),
  }
}


