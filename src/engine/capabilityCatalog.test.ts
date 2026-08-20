import { describe, expect, it } from 'vitest'
import { emptyArchitecture, emptyBusinessState, type ArchitectureContext } from './businessDiscovery'
import { capabilityById, industryCapabilityPacks, planCapabilities } from './capabilityCatalog'
import { createCapabilityActivation, createCapabilityRemoval } from './capabilityActions'
import { executeWorkspaceAction } from './workspaceActions'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import type { AIBlueprint } from './blueprint'

const blueprint: AIBlueprint = { modules: ['processes'], startView: 'processes', moduleConfig: { pipelineStages: [], processSteps: [], billingCadence: '', inventoryStages: [], supportStages: [] } }

describe('universal capability planner', () => {
  it('keeps every supported industry base valid and dependency-complete', () => {
    for (const pack of industryCapabilityPacks) {
      const state = { ...emptyBusinessState(), companySummary: `We operate a ${pack.signals[0]} business.`, industry: pack.signals[0] }
      const plan = planCapabilities(state, emptyArchitecture())
      const selected = new Set(plan.selected.map(item => item.id))
      expect(plan.pack?.id, pack.id).toBe(pack.id)
      for (const id of pack.capabilities) expect(capabilityById.has(id), `${pack.id}: ${id}`).toBe(true)
      for (const definition of plan.selected) for (const dependency of definition.dependencies) expect(selected.has(dependency), `${pack.id}: ${definition.id} requires ${dependency}`).toBe(true)
    }
  })

  it('selects a dependency-complete manufacturing operating base without unrelated HR or support tabs', () => {
    const state = { ...emptyBusinessState(), companySummary: 'We manufacture industrial pumps in our factory and ship customer orders.', industry: 'Industrial manufacturing', productsOrServices: ['Physical pumps'], operations: ['Production', 'Quality inspection', 'Shipping'], resources: ['Raw materials', 'Machines', 'Suppliers'] }
    const architecture: ArchitectureContext = { ...emptyArchitecture(), title: 'Factory Command Center', modules: ['manufacturing', 'inventory', 'procurement', 'quality', 'maintenance', 'logistics', 'finance'], startView: 'manufacturing', capabilityIds: ['manufacturing.production', 'quality.inspections', 'maintenance.assets', 'logistics.shipping'], pages: ['Dashboard', 'Production', 'Quality', 'Maintenance', 'Inventory', 'Purchasing', 'Shipping'], entities: [{ name: 'Production Orders', module: 'manufacturing', purpose: 'Plan factory work' }], metrics: ['Open production orders'] }
    const plan = planCapabilities(state, architecture)
    expect(plan.pack?.id).toBe('manufacturing')
    expect(plan.selected.map(item => item.id)).toEqual(expect.arrayContaining(['manufacturing.bom', 'manufacturing.production', 'inventory.stock', 'procurement.purchasing', 'quality.inspections', 'maintenance.assets', 'logistics.shipping']))
    expect(plan.selected.map(item => item.id)).not.toEqual(expect.arrayContaining(['people.recruiting', 'people.payroll', 'support.tickets']))
    const config = generateWorkspaceConfigurationFromDiscovery({ companyDescription: state.companySummary }, blueprint, state, architecture)
    expect(config.entities.map(item => item.id)).toEqual(expect.arrayContaining(['production-orders', 'bills-of-material', 'stock-items', 'purchase-orders', 'quality-checks', 'equipment', 'shipments']))
    expect(config.navigation.map(item => item.label)).toEqual(expect.arrayContaining(['Production', 'Quality', 'Maintenance', 'Inventory', 'Purchasing', 'Shipping']))
    expect(config.navigation.map(item => item.label)).not.toContain('Recruiting')
  })

  it('keeps physical operations out of a digital-only solo SaaS company', () => {
    const state = { ...emptyBusinessState(), companySummary: 'Solo founder selling digital-only B2B SaaS subscriptions with no inventory or employees.', industry: 'SaaS', revenueModel: ['Monthly subscriptions'], team: ['Solo founder'] }
    const plan = planCapabilities(state, { ...emptyArchitecture(), capabilityIds: ['subscriptions.billing', 'subscriptions.success', 'support.tickets'] })
    const ids = plan.selected.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining(['subscriptions.billing', 'subscriptions.success', 'support.tickets', 'finance.invoicing']))
    expect(ids).not.toEqual(expect.arrayContaining(['inventory.stock', 'manufacturing.production', 'people.time-off', 'people.payroll']))
  })

  it('installs and removes complete capabilities with dependencies through safe workspace actions', () => {
    const state = { ...emptyBusinessState(), companySummary: 'Independent consultant', industry: 'Consulting' }
    const base = generateWorkspaceConfigurationFromDiscovery({ companyDescription: state.companySummary }, blueprint, state, { ...emptyArchitecture(), title: 'Consulting', modules: ['customers'], startView: 'customers', capabilityIds: ['crm.contacts'], pages: ['Dashboard', 'Clients'], entities: [{ name: 'Clients', module: 'customers', purpose: 'Client records' }] })
    const activation = createCapabilityActivation(base, 'subscriptions.billing')
    expect(activation?.type).toBe('activate_module')
    const evolved = executeWorkspaceAction(base, {}, activation!).config
    expect(evolved.capabilities).toEqual(expect.arrayContaining(['subscriptions.billing', 'finance.invoicing']))
    expect(evolved.entities.map(item => item.id)).toEqual(expect.arrayContaining(['subscriptions', 'invoices']))
    const removal = createCapabilityRemoval(evolved, 'subscriptions.billing')
    expect(removal?.type).toBe('deactivate_capability')
    const reduced = executeWorkspaceAction(evolved, {}, removal!).config
    expect(reduced.capabilities).not.toContain('subscriptions.billing')
    expect(reduced.entities.map(item => item.id)).not.toContain('subscriptions')
    expect(reduced.entities.map(item => item.id)).toContain('invoices')
  })
})
