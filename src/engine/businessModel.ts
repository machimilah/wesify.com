import {
  automationPatterns,
  excludedOperatingKnowledge,
  kpiPatterns,
  operatingKnowledgeSource,
  processPatterns,
  type KnowledgeLayer,
} from '../data/operatingKnowledge'
import type { ArchitectureContext, BusinessState } from './businessDiscovery'
import type { BusinessResearch } from './businessResearch'
import { capabilityKnowledgeFor } from './knowledgeEngine'
import type { WorkspaceConfiguration } from './workspaceSchema'

export interface BusinessModelV2 {
  version: 2
  compatibility: { workspaceConfigurationVersion: 1; origin: 'discovery' | 'adapted-v1' }
  profile: {
    companyName: string
    industry: string
    summary: string
    businessModel: string[]
    revenueModel: string[]
  }
  capabilities: Array<{
    id: string
    reason: string
    layer: KnowledgeLayer
    source: string
    processIds: string[]
    executable: boolean
  }>
  operatingModel: {
    processIds: string[]
    masterDataEntityIds: string[]
    eventTypes: string[]
  }
  knowledge: {
    source: typeof operatingKnowledgeSource
    requirementIds: string[]
    gaps: Array<{
      id: string
      severity: 'important' | 'watch'
      classification: 'required' | 'recommended' | 'future'
      confidence: number
      capabilityIds: string[]
      recommendations: BusinessResearch['gaps'][number]['recommendations']
    }>
    exclusions: Array<{ id: string; sourceArea: string; reason: string; executable: false }>
  }
  governance: {
    approvalPatternIds: string[]
    jurisdictionalCapabilityIds: string[]
  }
  intelligence: {
    metricIds: string[]
    generatedKpiIds: string[]
    kpiPatternIds: string[]
    workflowIds: string[]
  }
  presentation: {
    pageIds: string[]
    navigationIds: string[]
  }
  coordination: {
    agentIds: string[]
    sharedCompanyState: string
    graphNodeCount: number
    graphEdgeCount: number
    eventTypes: string[]
  }
}

interface CreateBusinessModelInput {
  config: WorkspaceConfiguration
  state: BusinessState
  architecture: ArchitectureContext
  research: BusinessResearch
}

function capabilityModels(config: WorkspaceConfiguration) {
  return (config.capabilities ?? []).map(id => {
    const knowledge = capabilityKnowledgeFor(id)
    return {
      id,
      reason: config.capabilityPlan?.reasons[id] ?? 'Included in the generated workspace',
      layer: knowledge.layer,
      source: knowledge.source,
      processIds: knowledge.processIds,
      executable: knowledge.executable,
    }
  })
}

function operatingKnowledgeFor(config: WorkspaceConfiguration) {
  const capabilities = new Set(config.capabilities ?? [])
  const processes = processPatterns.filter(item => item.capabilityIds.some(id => capabilities.has(id)))
  return {
    processIds: processes.map(item => item.id),
    eventTypes: [...new Set(processes.flatMap(item => item.events))],
    kpiPatternIds: kpiPatterns.filter(item => item.capabilityIds.some(id => capabilities.has(id))).map(item => item.id),
    approvalPatternIds: automationPatterns
      .filter(item => item.humanControl === 'approval-required' && item.capabilityIds.some(id => capabilities.has(id)))
      .map(item => item.id),
  }
}

export function createBusinessModelV2({ config, state, architecture, research }: CreateBusinessModelInput): BusinessModelV2 {
  const operating = operatingKnowledgeFor(config)
  const capabilityModelsValue = capabilityModels(config)
  return {
    version: 2,
    compatibility: { workspaceConfigurationVersion: 1, origin: 'discovery' },
    profile: {
      companyName: config.profile.companyName,
      industry: state.industry || config.profile.industry,
      summary: state.companySummary || config.profile.description,
      businessModel: state.businessModel,
      revenueModel: state.revenueModel,
    },
    capabilities: capabilityModelsValue,
    operatingModel: {
      processIds: operating.processIds,
      masterDataEntityIds: config.entities.map(item => item.id),
      eventTypes: operating.eventTypes,
    },
    knowledge: {
      source: operatingKnowledgeSource,
      requirementIds: research.knowledgeRequirements.map(item => item.id),
      gaps: research.gaps.map(item => ({ id: item.id, severity: item.severity, classification: item.classification, confidence: item.confidence, capabilityIds: item.capabilityIds, recommendations: item.recommendations })),
      exclusions: excludedOperatingKnowledge.map(item => ({ ...item })),
    },
    governance: {
      approvalPatternIds: operating.approvalPatternIds,
      jurisdictionalCapabilityIds: capabilityModelsValue.filter(item => item.layer === 'jurisdiction').map(item => item.id),
    },
    intelligence: {
      metricIds: config.metrics.map(item => item.id),
      generatedKpiIds: (config.kpis ?? []).map(item => item.id),
      kpiPatternIds: operating.kpiPatternIds,
      workflowIds: config.workflows.map(item => item.id),
    },
    presentation: {
      pageIds: architecture.pages,
      navigationIds: config.navigation.map(item => item.id),
    },
    coordination: {
      agentIds: (config.agents ?? []).map(item => item.id),
      sharedCompanyState: `workspace:${config.id}:company-state`,
      graphNodeCount: config.businessGraph?.nodes.length ?? 0,
      graphEdgeCount: config.businessGraph?.edges.length ?? 0,
      eventTypes: config.eventArchitecture?.definitions.map(item => item.type) ?? [],
    },
  }
}

/** Builds the v2 intelligence view for a saved configuration without mutating that configuration. */
export function adaptWorkspaceConfigurationV1(config: WorkspaceConfiguration): BusinessModelV2 {
  const operating = operatingKnowledgeFor(config)
  const capabilityModelsValue = capabilityModels(config)
  return {
    version: 2,
    compatibility: { workspaceConfigurationVersion: 1, origin: 'adapted-v1' },
    profile: {
      companyName: config.profile.companyName,
      industry: config.profile.industry,
      summary: config.profile.description,
      businessModel: config.profile.businessModel ? [config.profile.businessModel] : [],
      revenueModel: config.profile.revenueModel ? [config.profile.revenueModel] : [],
    },
    capabilities: capabilityModelsValue,
    operatingModel: {
      processIds: operating.processIds,
      masterDataEntityIds: config.entities.map(item => item.id),
      eventTypes: operating.eventTypes,
    },
    knowledge: {
      source: operatingKnowledgeSource,
      requirementIds: [],
      gaps: [],
      exclusions: excludedOperatingKnowledge.map(item => ({ ...item })),
    },
    governance: {
      approvalPatternIds: operating.approvalPatternIds,
      jurisdictionalCapabilityIds: capabilityModelsValue.filter(item => item.layer === 'jurisdiction').map(item => item.id),
    },
    intelligence: {
      metricIds: config.metrics.map(item => item.id),
      generatedKpiIds: (config.kpis ?? []).map(item => item.id),
      kpiPatternIds: operating.kpiPatternIds,
      workflowIds: config.workflows.map(item => item.id),
    },
    presentation: {
      pageIds: config.navigation.filter(item => item.kind === 'entity').map(item => item.id),
      navigationIds: config.navigation.map(item => item.id),
    },
    coordination: {
      agentIds: (config.agents ?? []).map(item => item.id),
      sharedCompanyState: `workspace:${config.id}:company-state`,
      graphNodeCount: config.businessGraph?.nodes.length ?? 0,
      graphEdgeCount: config.businessGraph?.edges.length ?? 0,
      eventTypes: config.eventArchitecture?.definitions.map(item => item.type) ?? [],
    },
  }
}
