import {
  automationPatterns,
  capabilityKnowledgeOverrides,
  gapRules,
  kpiPatterns,
  knowledgeRequirementSpecs,
  masterDataTemplates,
  processPatterns,
  type CapabilityKnowledge,
  type GapRule,
  type KnowledgeRequirementSpec,
  type MasterFieldHint,
} from '../data/operatingKnowledge'
import { saysSignal } from './shared'

export interface KnowledgeRequirement extends KnowledgeRequirementSpec {
  evidence: string[]
  informationNeeded: string[]
  decisionImpact: string[]
  rank: number
}

export type GapClassification = 'required' | 'recommended' | 'future'

export interface GapRecommendations {
  capabilityIds: string[]
  processIds: string[]
  automationPatternIds: string[]
  kpiPatternIds: string[]
  controlIds: string[]
  roleIds: string[]
  dataTemplateIds: string[]
}

export interface BusinessGap {
  id: string
  title: string
  rationale: string
  layer: GapRule['layer']
  severity: GapRule['severity']
  classification: GapClassification
  confidence: number
  capabilityIds: string[]
  evidence: string[]
  recommendations: GapRecommendations
}

export interface OperatingKnowledgeEvaluation {
  requirements: KnowledgeRequirement[]
  gaps: BusinessGap[]
  recommendedCapabilityIds: string[]
}

type KnowledgeField = MasterFieldHint & { relationEntityId?: string }

interface KnowledgeEntity {
  id: string
  label: string
  pluralLabel: string
  fields: KnowledgeField[]
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const informationByDomain: Record<string, string[]> = {
  operations: ['Main stages', 'Handoffs', 'Completion conditions', 'Common exceptions'],
  finance: ['Charging point', 'Invoice timing', 'Payment timing', 'Overdue handling'],
  organization: ['Work owner', 'Approval owner', 'Restricted information', 'Decision limits'],
  supply: ['Critical suppliers', 'Lead times', 'Single-source dependencies', 'Switching constraints'],
  inventory: ['Stock locations', 'Identification method', 'Replenishment trigger', 'Traceability needs'],
  planning: ['Scheduling unit', 'Capacity constraint', 'Priority rule', 'Commitment dates'],
  quality: ['Failure conditions', 'Detection point', 'Disposition owner', 'Required evidence'],
  assets: ['Critical assets', 'Failure impact', 'Maintenance trigger', 'Release authority'],
  management: ['Business outcomes', 'Metric owner', 'Targets', 'Review frequency'],
  data: ['Current systems', 'Authoritative source', 'Required integrations', 'Migration constraints'],
}

const priorityScore = { critical: 300, high: 200, medium: 100 } as const

function evidenceFor(text: string, signals: string[]) {
  return signals.filter(signal => saysSignal(text, signal))
}

function capabilityApplies(capabilityIds: string[], activeCapabilityIds: string[]) {
  const active = new Set(activeCapabilityIds)
  return capabilityIds.some(id => active.has(id))
}

/**
 * Resolves only knowledge supported by the conversation or already-selected capabilities. Empty
 * applicability signals identify universal discovery objectives, not automatic software features.
 */
export function evaluateOperatingKnowledge(text: string, activeCapabilityIds: string[] = []): OperatingKnowledgeEvaluation {
  const requirements = knowledgeRequirementSpecs.flatMap(spec => {
    const evidence = evidenceFor(text, spec.appliesWhen)
    const applicable = spec.appliesWhen.length === 0 || evidence.length > 0 || capabilityApplies(spec.capabilityIds, activeCapabilityIds)
    if (!applicable || evidenceFor(text, spec.resolvedBy).length > 0) return []
    const rank = priorityScore[spec.priority] + (capabilityApplies(spec.capabilityIds, activeCapabilityIds) ? 30 : 0) + evidence.length * 10
    return [{ ...spec, evidence, informationNeeded: informationByDomain[spec.domain] ?? [], decisionImpact: spec.capabilityIds, rank }]
  }).sort((left, right) => right.rank - left.rank)

  const gaps = gapRules.flatMap(rule => {
    const evidence = evidenceFor(text, rule.appliesWhen)
    if (!evidence.length) return []
    const missingCapabilityIds = rule.recommendCapabilityIds.filter(id => !activeCapabilityIds.includes(id))
    const relatedProcesses = processPatterns.filter(item => item.capabilityIds.some(id => rule.recommendCapabilityIds.includes(id)))
    const relatedAutomations = automationPatterns.filter(item => item.capabilityIds.some(id => rule.recommendCapabilityIds.includes(id)))
    const relatedKpis = kpiPatterns.filter(item => item.capabilityIds.some(id => rule.recommendCapabilityIds.includes(id)))
    const relatedData = masterDataTemplates.filter(item => item.capabilityIds.some(id => rule.recommendCapabilityIds.includes(id)))
    const classification: GapClassification = rule.severity === 'watch' ? 'future' : evidence.length > 1 ? 'required' : 'recommended'
    const approvalControls = relatedAutomations.filter(item => item.humanControl === 'approval-required').map(item => item.id)
    const roleIds = [
      ...(rule.recommendCapabilityIds.some(id => /^(finance|accounting)\./.test(id)) ? ['finance-owner'] : []),
      ...(rule.recommendCapabilityIds.some(id => /^(quality|maintenance|inventory|procurement|logistics)\./.test(id)) ? ['operations-owner'] : []),
      ...(approvalControls.length ? ['approver'] : []),
    ]
    return [{
      id: rule.id,
      title: rule.title,
      rationale: rule.rationale,
      layer: rule.layer,
      severity: rule.severity,
      classification,
      confidence: Number(Math.min(0.95, 0.62 + evidence.length * 0.1).toFixed(2)),
      capabilityIds: missingCapabilityIds,
      evidence,
      recommendations: {
        capabilityIds: missingCapabilityIds,
        processIds: relatedProcesses.map(item => item.id),
        automationPatternIds: relatedAutomations.map(item => item.id),
        kpiPatternIds: relatedKpis.map(item => item.id),
        controlIds: approvalControls,
        roleIds: [...new Set(roleIds)],
        dataTemplateIds: relatedData.map(item => item.id),
      },
    }]
  })

  return {
    requirements,
    gaps,
    recommendedCapabilityIds: [...new Set(gaps.filter(gap => gap.classification !== 'future').flatMap(gap => gap.capabilityIds))],
  }
}

export function knowledgeRequirementsFor(text: string, activeCapabilityIds: string[] = []) {
  return evaluateOperatingKnowledge(text, activeCapabilityIds).requirements.slice(0, 8).map(({ id, domain, objective, priority, informationNeeded, decisionImpact, rank }) => ({ id, domain, objective, priority, informationNeeded, decisionImpact, rank }))
}

function inferredLayer(capabilityId: string): CapabilityKnowledge['layer'] {
  if (capabilityId === 'finance.tax' || capabilityId === 'people.payroll') return 'jurisdiction'
  if (/^(manufacturing|quality|maintenance)\./.test(capabilityId) || capabilityId === 'inventory.traceability') return 'industry'
  if (/^(commerce|subscriptions|work|service|procurement|inventory|logistics)\./.test(capabilityId)) return 'business-model'
  return 'universal'
}

export function capabilityKnowledgeFor(capabilityId: string): CapabilityKnowledge {
  const processes = processPatterns.filter(item => item.capabilityIds.includes(capabilityId))
  const requirements = knowledgeRequirementSpecs.filter(item => item.capabilityIds.includes(capabilityId))
  const override = capabilityKnowledgeOverrides[capabilityId]
  const source = processes.length ? 'ios-pyme-generalized' : 'platform'
  return {
    layer: inferredLayer(capabilityId),
    source,
    knowledgeRequirementIds: requirements.map(item => item.id),
    processIds: processes.map(item => item.id),
    eventTypes: [...new Set(processes.flatMap(item => item.events))],
    risks: processes.map(item => item.purpose),
    executable: true,
    ...override,
  }
}

function entityMatches(entity: KnowledgeEntity, names: string[]) {
  const identity = normalize(`${entity.id} ${entity.label} ${entity.pluralLabel}`)
  return names.some(name => {
    const normalizedName = normalize(name)
    return identity === normalizedName || identity.split(' ').includes(normalizedName) || identity.includes(`${normalizedName} `)
  })
}

function fieldFromHint(hint: MasterFieldHint): KnowledgeField {
  return { ...hint, evidenceSignals: undefined }
}

/** Adds document-derived master-data hints without replacing fields generated by Wesify. */
export function enrichEntityFieldsFromKnowledge<T extends KnowledgeEntity>(entities: T[], text: string, activeCapabilityIds: string[]): T[] {
  return entities.map(entity => {
    const template = masterDataTemplates.find(candidate =>
      entityMatches(entity, candidate.names)
      && (capabilityApplies(candidate.capabilityIds, activeCapabilityIds) || evidenceFor(text, candidate.names).length > 0),
    )
    if (!template) return entity

    const fields = [...entity.fields]
    const append = (hint: MasterFieldHint) => {
      if (!fields.some(field => field.id === hint.id)) fields.push(fieldFromHint(hint))
    }
    template.coreFields.forEach(append)
    template.optionalFields
      .filter(hint => !hint.evidenceSignals?.length || evidenceFor(text, hint.evidenceSignals).length > 0)
      .forEach(append)
    return { ...entity, fields } as T
  })
}
