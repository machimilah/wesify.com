import { describe, expect, it } from 'vitest'
import { operatingKnowledgeSource } from '../data/operatingKnowledge'
import type { AIBlueprint } from './blueprint'
import { selectBusinessAgent } from './agentArchitecture'
import { traverseBusinessGraph } from './businessGraph'
import { eventsForEntityMutation } from './eventArchitecture'
import { refreshWorkspaceIntelligence } from './operatingArchitecture'
import { generateWorkspaceConfiguration } from './workspaceSchema'

const blueprint: AIBlueprint = {
  modules: ['sales', 'customers', 'projects', 'finance', 'team', 'inventory'],
  startView: 'projects',
  moduleConfig: {
    pipelineStages: ['Lead', 'Proposal', 'Won'],
    processSteps: ['Plan', 'Deliver', 'Invoice'],
    billingCadence: 'Monthly',
    inventoryStages: ['Available', 'Low stock'],
    supportStages: [],
  },
}

function configuredWorkspace() {
  const base = generateWorkspaceConfiguration({ companyName: 'Northstar', companyDescription: 'Project consultancy with clients, invoices and a small team' }, blueprint)
  return refreshWorkspaceIntelligence({
    ...base,
    capabilities: ['crm.contacts', 'crm.pipeline', 'work.projects', 'work.tasks', 'finance.invoicing', 'people.directory'],
  })
}

describe('compiled operating architecture', () => {
  it('installs only relevant specialists on one shared company state', () => {
    const config = configuredWorkspace()
    const ids = config.agents?.map(agent => agent.id) ?? []
    expect(ids).toEqual(expect.arrayContaining(['executive', 'sales', 'project', 'finance', 'people', 'analytics']))
    expect(ids).not.toContain('manufacturing')
    expect(new Set(config.agents?.map(agent => agent.memory.reference))).toHaveLength(1)
    expect(config.agents?.every(agent => agent.memory.privateOperationalState === false)).toBe(true)
    expect(selectBusinessAgent('Show me the overdue invoices', config)?.id).toBe('finance')
  })

  it('keeps jurisdiction-specific payroll outside agent authority', () => {
    const config = configuredWorkspace()
    expect(config.agents?.find(agent => agent.id === 'people')?.prohibitedActions.join(' ')).toMatch(/Dominican.*payroll/i)
    expect(config.agents?.find(agent => agent.id === 'finance')?.prohibitedActions.join(' ')).toMatch(/jurisdiction-specific payroll/i)
  })

  it('builds traversable relationships across records, events, KPIs and agents', () => {
    const config = configuredWorkspace()
    const graph = config.businessGraph!
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'entity:invoices', to: 'entity:customers', storage: 'relational' }),
      expect.objectContaining({ from: 'entity:invoices', to: 'event:invoice.created', storage: 'event' }),
    ]))
    const reachable = traverseBusinessGraph(graph, 'entity:invoices', { direction: 'both', maxDepth: 2 }).map(item => item.node?.id)
    expect(reachable).toEqual(expect.arrayContaining(['entity:customers', 'event:invoice.created', 'agent:finance']))
    expect(graph.storageArchitecture.vector).toMatch(/never become the source of truth/i)
  })

  it('compiles scoped lifecycle and operating events with executable routes', () => {
    const config = configuredWorkspace()
    const created = eventsForEntityMutation(config.eventArchitecture, 'invoices', 'created')
    expect(created).toEqual([expect.objectContaining({ type: 'invoice.created', audit: true, lifecycle: 'created' })])
    expect(created[0].canTrigger).toEqual(expect.arrayContaining(['audit-log', 'agent', 'calculation']))
    const route = config.eventArchitecture?.routes.find(item => item.eventType === 'invoice.created')
    expect(route?.targets.find(target => target.kind === 'agent')?.ids).toContain('finance')
    expect(config.eventArchitecture?.delivery).toEqual(expect.objectContaining({ mode: 'at-least-once', idempotencyKey: 'eventId', deadLetter: true }))
  })

  it('adds industry events only when their capabilities are active', () => {
    const config = configuredWorkspace()
    expect(config.eventArchitecture?.definitions.some(event => event.type === 'asset.failed')).toBe(false)
    const withMaintenance = refreshWorkspaceIntelligence({ ...config, capabilities: [...(config.capabilities ?? []), 'maintenance.assets'] })
    expect(withMaintenance.eventArchitecture?.definitions.some(event => event.type === 'asset.failed')).toBe(true)
    expect(withMaintenance.agents?.map(agent => agent.id)).toContain('operations')
    expect(withMaintenance.agents?.map(agent => agent.id)).toContain('risk')
  })

  it('publishes coordination counts into the generated business model when present', () => {
    const config = configuredWorkspace()
    const businessModel = {
      version: 2 as const,
      compatibility: { workspaceConfigurationVersion: 1 as const, origin: 'adapted-v1' as const },
      profile: { companyName: 'Northstar', industry: 'Consulting', summary: '', businessModel: [], revenueModel: [] },
      capabilities: [],
      operatingModel: { processIds: [], masterDataEntityIds: [], eventTypes: [] },
      knowledge: { source: operatingKnowledgeSource, requirementIds: [], gaps: [], exclusions: [] },
      governance: { approvalPatternIds: [], jurisdictionalCapabilityIds: [] },
      intelligence: { metricIds: [], generatedKpiIds: [], kpiPatternIds: [], workflowIds: [] },
      presentation: { pageIds: [], navigationIds: [] },
      coordination: { agentIds: [], sharedCompanyState: '', graphNodeCount: 0, graphEdgeCount: 0, eventTypes: [] },
    }
    const refreshed = refreshWorkspaceIntelligence({ ...config, businessModel })
    expect(refreshed.businessModel?.coordination.agentIds).toEqual(refreshed.agents?.map(agent => agent.id))
    expect(refreshed.businessModel?.coordination.graphNodeCount).toBe(refreshed.businessGraph?.nodes.length)
    expect(refreshed.businessModel?.coordination.eventTypes).toContain('invoice.created')
  })
})
