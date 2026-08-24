import { describe, expect, it } from 'vitest'
import type { AIBlueprint } from './blueprint'
import { adaptWorkspaceConfigurationV1 } from './businessModel'
import { emptyArchitecture, emptyBusinessState } from './businessDiscovery'
import { generateWorkspaceConfigurationFromDiscovery, isWorkspaceConfiguration, type WorkspaceConfiguration } from './workspaceSchema'

const legacyConfig: WorkspaceConfiguration = {
  version: 1,
  id: 'legacy-workspace',
  profile: {
    companyName: 'Legacy Co', description: 'Existing workspace', archetype: 'custom', industry: 'Consulting',
    businessModel: 'Projects', revenueModel: 'Milestones', teamStructure: 'Solo', customers: 'Businesses',
    productsAndServices: 'Consulting', operatingProcesses: ['Deliver projects'], suppliers: '', locations: '', goals: [], terminology: {},
  },
  modules: ['customers'], capabilities: ['crm.contacts'],
  entities: [], views: [], navigation: [{ id: 'home', label: 'Home', kind: 'home' }], metrics: [], workflows: [], roles: [],
}

describe('Business Model v2', () => {
  it('adapts a legacy workspace without mutating or invalidating version 1', () => {
    expect(isWorkspaceConfiguration(legacyConfig)).toBe(true)
    const model = adaptWorkspaceConfigurationV1(legacyConfig)
    expect(legacyConfig.businessModel).toBeUndefined()
    expect(model).toEqual(expect.objectContaining({ version: 2, compatibility: { workspaceConfigurationVersion: 1, origin: 'adapted-v1' } }))
    expect(model.capabilities[0]).toEqual(expect.objectContaining({ id: 'crm.contacts', layer: 'universal' }))
    expect(model.knowledge.exclusions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'do-payroll-and-labor-calculations' })]))
  })

  it('adds the v2 intelligence model to newly discovered workspaces', () => {
    const state = {
      ...emptyBusinessState(),
      companySummary: 'We manufacture pumps in batches and inspect every production run.',
      industry: 'Manufacturing',
      businessModel: ['Physical products'],
      productsOrServices: ['Pumps'],
      operations: ['Batch production', 'Quality inspection'],
    }
    const architecture = {
      ...emptyArchitecture(),
      title: 'Pump Command Center',
      modules: ['customers', 'inventory', 'processes', 'finance'] as AIBlueprint['modules'],
      capabilityIds: ['crm.contacts', 'commerce.products', 'inventory.stock', 'manufacturing.production', 'quality.inspections'],
      pages: ['Products', 'Production', 'Quality'],
      entities: [{ name: 'Products', module: 'inventory' as const, purpose: 'Pump catalog and specifications' }],
    }
    const blueprint: AIBlueprint = { modules: architecture.modules, startView: 'processes', moduleConfig: { pipelineStages: [], processSteps: [], billingCadence: '', inventoryStages: [], supportStages: [] } }
    const config = generateWorkspaceConfigurationFromDiscovery({}, blueprint, state, architecture)
    expect(config.version).toBe(1)
    expect(config.businessModel).toEqual(expect.objectContaining({ version: 2, compatibility: { workspaceConfigurationVersion: 1, origin: 'discovery' } }))
    expect(config.businessModel?.operatingModel.processIds).toEqual(expect.arrayContaining(['production', 'quality-control']))
    expect(config.kpis?.map(item => item.id)).toEqual(expect.arrayContaining(['production-effectiveness', 'quality-conformance', 'waste-rate']))
    expect(config.businessModel?.intelligence.generatedKpiIds).toEqual(config.kpis?.map(item => item.id))
    expect(config.businessModel?.knowledge.exclusions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'do-payroll-and-labor-calculations', executable: false })]))
  })
})
