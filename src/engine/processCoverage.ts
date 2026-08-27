import {
  apqcProcesses,
  controlObjectives,
  isa95Processes,
  regulatoryDomains,
  scorProcesses,
  type ControlObjective,
  type FrameworkProcess,
  type ProcessClassification,
  type ProcessFrameworkId,
  type RegulatoryDomain,
} from '../data/processFrameworks'
import { detectArchetypes, reconcileArchetypes, type DetectedArchetype } from './archetypes'
import { saysSignal } from './shared'

/**
 * The completeness check that runs before Wesify decides what to build.
 *
 * Everything upstream of this reasons from what the operator said. That is the right way to choose
 * between two ways of doing a thing, and it is a poor way to notice that a whole thing is absent:
 * nobody lists what they forgot to mention. This module compares the reconstructed company against
 * published process frameworks — APQC as the master checklist, SCOR where goods move, ISA-95 where
 * they are made — and gives every process one of five verdicts, so a process that does not apply is
 * visibly ruled out rather than quietly never considered.
 *
 * Two failure modes it exists to prevent, in both directions:
 *
 * - A bakery with no way to buy flour, because the interview covered selling and ran out of
 *   questions. Required, uncovered, and the capability that would carry it is one line away.
 * - A homework tracker with a procurement module, because a checklist said businesses buy things.
 *   An archetype nobody's description supports never makes anything required, and a verdict of
 *   not-applicable carries the reason it was ruled out.
 *
 * The output is deliberately not a decision. It is evidence: gaps a build can close by selecting a
 * capability, and questions worth interrupting somebody for. What to do with them belongs to the
 * caller, because only the caller knows whether an operator is sitting there waiting.
 */

export type ProcessCriticality = 'critical' | 'high' | 'medium'

export interface ProcessVerdict {
  processId: string
  code: string
  name: string
  framework: ProcessFrameworkId
  category: string
  classification: ProcessClassification
  /** Why this verdict, in business words. Every verdict has one, including not-applicable. */
  because: string
  criticality: ProcessCriticality
  /** Selected capabilities that already carry this process. */
  coveredBy: string[]
  /** Capabilities that would carry it, and are not selected. */
  missingCapabilityIds: string[]
  purpose: string
  outsideSoftware?: string
}

export interface ProcessGap {
  processId: string
  name: string
  framework: ProcessFrameworkId
  criticality: ProcessCriticality
  because: string
  /** What Wesify would add to close it. Empty when the answer is a question rather than a capability. */
  capabilityIds: string[]
  /** What to ask, when nothing in the catalog can close the gap without knowing more. */
  question?: string
}

export interface ControlVerdict {
  id: string
  name: string
  component: ControlObjective['component']
  requires: ControlObjective['requires']
  applies: boolean
  satisfied: boolean
  because: string
  missingCapabilityIds: string[]
  why: string
}

/**
 * A regulatory subject, never a regulatory conclusion.
 *
 * Wesify does not know which country a sentence about food refers to, and a specific obligation
 * asserted at the wrong jurisdiction is worse than none: somebody will go and act on it. Every entry
 * therefore names the kind of authority to confirm with and always carries `verify`.
 */
export interface RegulatoryVerdict {
  id: string
  label: string
  evidence: string[]
  authorities: string[]
  obligations: string[]
  capabilityIds: string[]
  missingCapabilityIds: string[]
  verify: true
}

export interface ProcessCoverage {
  archetypes: DetectedArchetype[]
  /**
   * Whether anything says this is a company that buys, sells or employs.
   *
   * False for the workspaces Wesify also gets asked for — a coursework tracker, a club, a household —
   * and while it is false nothing is required of them, because a business checklist run over
   * something that is not a business produces a list of everything it does not have.
   */
  trading: boolean
  processes: ProcessVerdict[]
  controls: ControlVerdict[]
  regulatory: RegulatoryVerdict[]
  gaps: ProcessGap[]
  /** Share of required processes that something in the build actually carries. */
  coverage: number
}

export interface CoverageInput {
  /** Everything known about the company in its own words: description, answers, recorded state. */
  text: string
  capabilityIds: string[]
  /** Supplied where archetypes were detected earlier, so one company is classified once. */
  archetypes?: DetectedArchetype[]
}

/** Archetypes that mean goods physically move, which is what makes SCOR apply at all. */
const GOODS_ARCHETYPES = ['manufacturer', 'food-processor', 'distributor', 'wholesaler', 'retailer', 'ecommerce', 'importer', 'exporter', 'logistics', 'make-to-stock', 'make-to-order']
/** Archetypes that mean the company converts inputs into output, which is what makes ISA-95 apply. */
const PRODUCTION_ARCHETYPES = ['manufacturer', 'food-processor', 'make-to-order', 'make-to-stock']
const GOODS_CAPABILITIES = ['inventory.stock', 'inventory.warehouses', 'manufacturing.production', 'logistics.shipping', 'commerce.products', 'procurement.purchasing']

/**
 * Where one archetype rules a process out.
 *
 * Only fires when nothing contradicts it: no words in the description, no capability already
 * selected, and no archetype that would put the process back. An exclusion that overrides evidence
 * is how a company that sells software *and* hardware loses its warehouse.
 */
const exclusions: Array<{ archetype: string; processIds: string[]; unless: string[]; because: string }> = [
  {
    archetype: 'solo',
    processIds: ['apqc-7.2', 'apqc-7.3', 'apqc-7.5', 'apqc-7.7', 'apqc-9.5'],
    unless: ['multi-location'],
    because: 'One person runs this company, so staff administration and payroll would be overhead with nobody on the other end of it.',
  },
  {
    archetype: 'saas',
    processIds: ['apqc-4.1', 'apqc-4.3', 'apqc-4.4', 'apqc-4.5', 'scor-Source', 'scor-Transform', 'scor-Fulfill', 'scor-Plan', ...isa95Processes.map(item => item.id)],
    unless: GOODS_ARCHETYPES,
    because: 'The product is delivered digitally, so nothing here is produced, stocked or shipped.',
  },
  {
    archetype: 'professional-services',
    processIds: ['apqc-4.3', 'apqc-4.5', 'scor-Transform', ...isa95Processes.map(item => item.id)],
    unless: [...PRODUCTION_ARCHETYPES, 'distributor', 'retailer'],
    because: 'The company sells work rather than goods, so there is nothing to produce or warehouse.',
  },
]

/**
 * Whether this is a company that trades at all.
 *
 * The frameworks describe businesses. Somebody keeping track of their coursework, a household
 * running its own repairs, a club managing its fixtures — none of them buy, sell, invoice or employ,
 * and running an APQC checklist over one produces a shopping list of everything a business has and
 * they do not. Wesify has been here before: matching an industry pack on the word "school" gave a
 * student Clients, Invoices, Payments and a team directory, and it is the exact failure that makes
 * software feel like somebody else's.
 *
 * So nothing is required of a company until something says it trades. Silence here is not a gap.
 */
const COMMERCIAL_CAPABILITIES = ['crm.', 'sales.', 'finance.', 'commerce.', 'subscriptions.', 'procurement.', 'inventory.', 'accounting.', 'logistics.', 'manufacturing.']
// Plurals are matched by `saysSignal` itself, so each of these is written once, in the singular.
const TRADING_SIGNALS = ['customer', 'client', 'sell', 'sale', 'buy', 'invoice', 'price', 'order', 'supplier', 'revenue', 'paid', 'payment', 'charge', 'shop', 'contract', 'subscription', 'patient', 'guest', 'tenant', 'booking', 'staff', 'employee', 'we deliver', 'our business', 'our company']

const evidenceFor = (text: string, signals: string[]) => signals.filter(signal => saysSignal(text, signal))

function classify(item: FrameworkProcess, input: { text: string; selected: Set<string>; archetypeIds: Set<string>; frameworkActive: boolean; trading: boolean }): Omit<ProcessVerdict, 'processId' | 'code' | 'name' | 'framework' | 'category' | 'purpose' | 'outsideSoftware' | 'criticality'> {
  const coveredBy = item.capabilityIds.filter(id => input.selected.has(id))
  const missingCapabilityIds = item.capabilityIds.filter(id => !input.selected.has(id))
  const evidence = evidenceFor(input.text, item.signals)
  const archetypeMatches = item.archetypes.filter(id => input.archetypeIds.has(id))

  const exclusion = exclusions.find(rule => input.archetypeIds.has(rule.archetype)
    && rule.processIds.includes(item.id)
    && !rule.unless.some(id => input.archetypeIds.has(id))
    && !evidence.length
    && !coveredBy.length)
  if (exclusion) return { classification: 'not-applicable', because: exclusion.because, coveredBy, missingCapabilityIds }

  if (!input.frameworkActive) return {
    classification: 'not-applicable',
    because: item.framework === 'isa95'
      ? 'Nothing in this company converts inputs into output, so manufacturing operations do not apply.'
      : 'No goods move through this company, so the supply chain model does not apply.',
    coveredBy,
    missingCapabilityIds,
  }

  if (!input.trading && !coveredBy.length && !evidence.length) return {
    classification: 'unknown',
    because: 'Nothing said so far describes a company that buys, sells or employs, so nothing here is required of it yet.',
    coveredBy,
    missingCapabilityIds,
  }
  if (item.universal) return { classification: 'required', because: 'Every company that trades does this, whatever it sells.', coveredBy, missingCapabilityIds }
  if (archetypeMatches.length) return { classification: 'required', because: `This company operates as ${archetypeMatches.join(' and ')}, where this is part of running it.`, coveredBy, missingCapabilityIds }
  if (evidence.length >= 2) return { classification: 'required', because: `The company described this itself: ${evidence.slice(0, 3).join(', ')}.`, coveredBy, missingCapabilityIds }
  if (evidence.length === 1) return { classification: 'applicable', because: `Mentioned once, as "${evidence[0]}".`, coveredBy, missingCapabilityIds }
  if (coveredBy.length) return { classification: 'applicable', because: `Already carried by ${coveredBy.join(', ')}.`, coveredBy, missingCapabilityIds }
  if (item.outsideSoftware) return { classification: 'potentially-applicable', because: item.outsideSoftware, coveredBy, missingCapabilityIds }

  /**
   * Nothing said either way.
   *
   * Not "not applicable" — nobody ruled it out, and treating silence as a decision is exactly how a
   * company ends up without a way to pay its suppliers. Unknown is a verdict that can be resolved by
   * asking, and the gap list decides whether this one is worth asking about.
   */
  return { classification: 'unknown', because: 'Nothing in the conversation says whether this company does this.', coveredBy, missingCapabilityIds }
}

/**
 * The plain-language question that would resolve an unknown worth interrupting somebody for.
 *
 * Hand-written or nothing. A question generated from a framework's own wording — "does this company
 * need to handle manage internal controls?" — is unanswerable by the person being asked, and asking
 * it costs the same attention as a good one.
 */
function questionFor(item: FrameworkProcess): string | undefined {
  const questions: Record<string, string> = {
    'apqc-4.2': 'Who do you buy from, and how do you keep track of what you have ordered?',
    'apqc-9.6': 'How do supplier bills get paid, and who says yes before they are?',
    'apqc-9.7': 'Do you need to see what cash is coming in and going out?',
    'apqc-9.9': 'Do you charge tax on what you sell?',
    'apqc-11.2': 'Is there anything you have to prove to an inspector or an authority?',
    'apqc-13.3': 'Is there a check before the work is handed over to the customer?',
    'apqc-10.3': 'Is there equipment or a vehicle that stops the work if it breaks?',
    'apqc-7.7': 'Who works with you, and does the software need to know who does what?',
    'scor-Return': 'What happens when something comes back?',
    'scor-Plan': 'How far ahead do you decide what to buy or make?',
  }
  return questions[item.id]
}

/** Whether the frameworks beyond APQC apply to this company at all. */
function activeFrameworks(archetypeIds: Set<string>, selected: Set<string>, text: string) {
  const goods = GOODS_ARCHETYPES.some(id => archetypeIds.has(id)) || GOODS_CAPABILITIES.some(id => selected.has(id))
  const production = PRODUCTION_ARCHETYPES.some(id => archetypeIds.has(id)) || selected.has('manufacturing.production') || evidenceFor(text, ['we make', 'we produce', 'production', 'batch']).length > 0
  return { scor: goods, isa95: production }
}

function controlVerdicts(selected: Set<string>, roleCount: number): ControlVerdict[] {
  return controlObjectives.map(objective => {
    const applies = objective.appliesWhen.some(id => selected.has(id))
    const missingCapabilityIds = objective.capabilityIds.filter(id => !selected.has(id))
    // Segregation is the one control no capability can supply: it exists when the workspace can tell
    // one person's authority from another's, which is a question about roles rather than features.
    const satisfied = objective.requires === 'segregation' ? roleCount >= 2 : objective.capabilityIds.length > 0 && missingCapabilityIds.length < objective.capabilityIds.length
    return {
      id: objective.id,
      name: objective.name,
      component: objective.component,
      requires: objective.requires,
      applies,
      satisfied: applies ? satisfied : true,
      because: !applies
        ? 'Nothing this company does puts this control at stake.'
        : satisfied ? 'The build carries this control.' : 'The company does the thing this control protects, and nothing in the build performs it.',
      missingCapabilityIds,
      why: objective.why,
    }
  })
}

function regulatoryVerdicts(text: string, selected: Set<string>): RegulatoryVerdict[] {
  return regulatoryDomains.flatMap<RegulatoryVerdict>((domain: RegulatoryDomain) => {
    const evidence = evidenceFor(text, domain.signals)
    if (!evidence.length) return []
    return [{
      id: domain.id,
      label: domain.label,
      evidence,
      authorities: domain.authorities,
      obligations: domain.obligations,
      capabilityIds: domain.capabilityIds,
      missingCapabilityIds: domain.capabilityIds.filter(id => !selected.has(id)),
      verify: true,
    }]
  })
}

export function classifyProcessCoverage(input: CoverageInput): ProcessCoverage {
  const selected = new Set(input.capabilityIds)
  const archetypes = reconcileArchetypes(input.archetypes ?? detectArchetypes(input.text, input.capabilityIds))
  /**
   * One word is a hint; two is a conclusion.
   *
   * Everything detected is reported, but only archetypes the description says twice — or that a
   * selected capability proves outright — are allowed to make a process *required*. A bakery whose
   * customers are cafés matches "cafe" once and is not a hospitality business, and one loose word
   * should never be what puts a whole operating model into somebody's workspace.
   */
  const archetypeIds = new Set(archetypes.filter(item => item.confidence >= 0.7 || item.basis === 'derived').map(item => item.id))
  const active = activeFrameworks(archetypeIds, selected, input.text)
  const trading = evidenceFor(input.text, TRADING_SIGNALS).length > 0
    || archetypes.some(item => item.kind !== 'structural' && item.confidence >= 0.7)
    || COMMERCIAL_CAPABILITIES.some(prefix => input.capabilityIds.some(id => id.startsWith(prefix)))

  const all = [...apqcProcesses, ...scorProcesses, ...isa95Processes]
  const processes: ProcessVerdict[] = all.map(item => {
    const frameworkActive = item.framework === 'apqc' ? true : item.framework === 'scor' ? active.scor : active.isa95
    const verdict = classify(item, { text: input.text, selected, archetypeIds, frameworkActive, trading })
    return {
      processId: item.id,
      code: item.code,
      name: item.name,
      framework: item.framework,
      category: item.category,
      purpose: item.purpose,
      criticality: item.criticality,
      ...(item.outsideSoftware ? { outsideSoftware: item.outsideSoftware } : {}),
      ...verdict,
    }
  })

  const byId = new Map(all.map(item => [item.id, item]))
  /**
   * One gap per missing thing, rather than one per framework that noticed it.
   *
   * Buying materials is APQC 4.2 and SCOR Source; making something is 4.3, SCOR Transform and two
   * ISA-95 activities. They resolve to the same capabilities, so a bakery with no purchasing showed
   * up as five problems with one fix. APQC is the master checklist, so its gap is the one that
   * stands and anything whose remedy it already contains falls in behind it.
   */
  const claimed = new Set<string>()
  const gaps: ProcessGap[] = []
  for (const item of processes) {
    const definition = byId.get(item.processId)
    if (!definition || definition.outsideSoftware || definition.platform) continue
    if (item.coveredBy.length) continue
    // Nothing is asked of a workspace that is not a business. "Who do you buy from" is a fine
    // question for a bakery and an absurd one for somebody tracking their coursework.
    const question = trading && item.classification === 'unknown' && definition.criticality !== 'medium' ? questionFor(definition) : undefined
    if (item.classification !== 'required' && !question) continue
    const capabilityIds = item.classification === 'required' ? item.missingCapabilityIds : []
    // APQC is the master checklist and runs first, so a SCOR or ISA-95 gap that overlaps one already
    // recorded is the same missing thing seen from a second framework.
    const overlaps = item.framework === 'apqc' ? capabilityIds.every(id => claimed.has(id)) : capabilityIds.some(id => claimed.has(id))
    if (capabilityIds.length && overlaps) continue
    for (const id of capabilityIds) claimed.add(id)
    gaps.push({
      processId: item.processId,
      name: item.name,
      framework: item.framework,
      criticality: item.criticality,
      because: item.because,
      capabilityIds,
      ...(question ? { question } : {}),
    })
  }

  const required = processes.filter(item => item.classification === 'required' && !byId.get(item.processId)?.outsideSoftware)
  const covered = required.filter(item => item.coveredBy.length)
  const rank = { critical: 0, high: 1, medium: 2 } as const

  return {
    archetypes,
    trading,
    processes,
    controls: controlVerdicts(selected, 0),
    regulatory: regulatoryVerdicts(input.text, selected),
    gaps: gaps.sort((left, right) => rank[left.criticality] - rank[right.criticality]),
    coverage: required.length ? Number((covered.length / required.length).toFixed(2)) : 1,
  }
}

/**
 * Coverage recomputed against a built workspace, where roles are known.
 *
 * Segregation of duties cannot be judged from a capability list — it is a fact about how many
 * distinct authorities the workspace actually has — so the control pass is redone once the build
 * exists. Everything else is unchanged.
 */
export function withRoleAwareControls(coverage: ProcessCoverage, capabilityIds: string[], roleCount: number): ProcessCoverage {
  return { ...coverage, controls: controlVerdicts(new Set(capabilityIds), roleCount) }
}
