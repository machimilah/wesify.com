import { describe, expect, it } from 'vitest'
import type { AIBlueprint } from './blueprint'
import { compileGovernanceArchitecture, evaluateActionControl } from './governanceArchitecture'
import { planWorkspaceMutation } from './mutationArchitecture'
import { executeWorkspaceAction, type WorkspaceAction } from './workspaceActions'
import { generateWorkspaceConfiguration } from './workspaceSchema'

const blueprint: AIBlueprint = {
  modules: ['customers', 'projects', 'finance', 'team'],
  startView: 'projects',
  moduleConfig: { pipelineStages: [], processSteps: ['Plan', 'Deliver'], billingCadence: 'Monthly', inventoryStages: [], supportStages: [] },
}

const config = generateWorkspaceConfiguration({ companyName: 'Control Co', companyDescription: 'A project consultancy with clients, invoices and employees' }, blueprint)

describe('generated interface architecture', () => {
  it('compiles every visible page from the company model with connected operating artifacts', () => {
    expect(config.interfaceArchitecture?.pages.map(page => page.id)).toEqual(config.navigation.map(item => item.id))
    const invoicePage = config.interfaceArchitecture?.pages.find(page => page.entityId === 'invoices')
    expect(invoicePage?.roleIds).toEqual(expect.arrayContaining(['owner', 'admin', 'accountant']))
    expect(invoicePage?.roleIds).not.toContain('employee')
    expect(invoicePage?.kpiIds.length).toBeGreaterThan(0)
    const controlPage = config.interfaceArchitecture?.pages.find(page => page.id === 'control')
    expect(controlPage?.roleIds).toEqual(['owner', 'admin'])
    expect(config.interfaceArchitecture?.propagation).toEqual(expect.arrayContaining(['data-model', 'views', 'permissions', 'workflows', 'kpis', 'agents', 'events']))
  })

  it('regenerates navigation, events and interface pages when a capability-like module is added', () => {
    const action: WorkspaceAction = {
      type: 'activate_module', module: 'warehouses',
      entities: [{ id: 'warehouses', label: 'Warehouse', pluralLabel: 'Warehouses', module: 'warehouses', primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }],
      views: [{ id: 'warehouses-table', label: 'Warehouses', entityId: 'warehouses', type: 'table', columns: ['name'] }],
      navigation: [{ id: 'warehouses', label: 'Warehouses', kind: 'entity', viewId: 'warehouses-table', module: 'warehouses' }],
      metrics: [{ id: 'warehouse-count', label: 'Warehouses', entityId: 'warehouses', operation: 'count', roles: ['owner', 'admin'], format: 'number' }],
      workflows: [{ id: 'warehouse-created', name: 'Warehouse created', enabled: true, trigger: { entityId: 'warehouses', event: 'created' }, action: { type: 'notify', message: 'Warehouse created.' } }],
    }
    const next = executeWorkspaceAction(config, {}, action).config
    const page = next.interfaceArchitecture?.pages.find(item => item.id === 'warehouses')
    expect(page).toEqual(expect.objectContaining({ entityId: 'warehouses', metricIds: ['warehouse-count'], workflowIds: ['warehouse-created'] }))
    expect(next.eventArchitecture?.definitions.map(event => event.type)).toContain('warehouse.created')
  })
})

describe('dependency-aware conversational mutations', () => {
  it('enumerates every proposed artifact before a structural addition is approved', () => {
    const action: WorkspaceAction = {
      type: 'activate_module', module: 'sites', capabilityId: 'custom.sites', capabilityIds: ['custom.base', 'custom.sites'],
      entities: [{ id: 'sites', label: 'Site', pluralLabel: 'Sites', module: 'sites', primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'customer', label: 'Customer', type: 'relation', relationEntityId: 'customers' }] }],
      views: [{ id: 'sites-table', label: 'Sites', entityId: 'sites', type: 'table' }],
      navigation: [{ id: 'sites', label: 'Sites', kind: 'entity', viewId: 'sites-table', module: 'sites' }],
      metrics: [{ id: 'site-count', label: 'Sites', entityId: 'sites', operation: 'count', roles: ['owner'], format: 'number' }],
      workflows: [{ id: 'site-created', name: 'Site created', enabled: true, trigger: { entityId: 'sites', event: 'created' }, action: { type: 'notify', message: 'Site created.' } }],
    }
    const plan = planWorkspaceMutation(config, action)
    expect(plan.structural).toBe(true)
    expect(plan.affected).toEqual(expect.objectContaining({ entityIds: ['sites'], viewIds: ['sites-table'], navigationIds: ['sites'], metricIds: ['site-count'], workflowIds: ['site-created'] }))
    expect(plan.affected.relationshipIds).toHaveLength(1)
    expect(plan.dependencyChanges.map(item => item.capabilityId)).toEqual(['custom.base', 'custom.sites'])
    expect(plan.steps.at(-1)).toMatch(/approval/i)
  })

  it('retains data and reports downstream artifacts when a capability is removed', () => {
    const entity = config.entities.find(item => item.id === 'invoices')!
    const plan = planWorkspaceMutation(config, { type: 'deactivate_capability', capabilityId: 'finance.invoicing', entityIds: [entity.id], metricIds: config.metrics.filter(item => item.entityId === entity.id).map(item => item.id), workflowIds: [] })
    expect(plan.retainsExistingData).toBe(true)
    expect(plan.reversible).toBe(true)
    expect(plan.affected.eventTypes).toContain('invoice.created')
    expect(plan.warnings.join(' ')).toMatch(/data remains retained/i)
  })
})

describe('logic boundaries and autonomy', () => {
  it('defines all six autonomy levels and explicit deterministic, AI, agentic and human boundaries', () => {
    const architecture = compileGovernanceArchitecture()
    expect(architecture.levels.map(item => item.level)).toEqual([0, 1, 2, 3, 4, 5])
    expect(architecture.boundaries.map(item => item.logicClass)).toEqual(['deterministic', 'ai-assisted', 'agentic', 'human-controlled'])
    expect(architecture.humanControl).toEqual({ payments: true, employmentDecisions: true, contractAcceptance: true, legalDecisions: true })
  })

  it('executes ordinary records within limits but requires approval in sensitive domains', () => {
    expect(evaluateActionControl(config, { type: 'create_record', entityId: 'customers', values: { name: 'ACME' } }, { roleId: 'owner' })).toEqual(expect.objectContaining({ level: 4, canExecuteDirectly: true, requiresApproval: false }))
    expect(evaluateActionControl(config, { type: 'create_record', entityId: 'invoices', values: { number: 'INV-1' } }, { roleId: 'owner' })).toEqual(expect.objectContaining({ level: 3, canExecuteDirectly: false, requiresApproval: true }))
    expect(evaluateActionControl(config, { type: 'delete_record', entityId: 'customers', recordId: 'one' }, { roleId: 'owner' })).toEqual(expect.objectContaining({ logicClass: 'human-controlled', level: 3, requiresApproval: true }))
  })

  it('blocks roles without authority and never lets an agent bypass its approval rule', () => {
    const fieldAction: WorkspaceAction = { type: 'add_field', entityId: 'customers', field: { id: 'tier', label: 'Tier', type: 'text' } }
    expect(evaluateActionControl(config, fieldAction, { roleId: 'employee' }).disposition).toBe('blocked')
    expect(evaluateActionControl(config, fieldAction, { roleId: 'owner' }).disposition).toBe('approval-required')
    expect(evaluateActionControl(config, { type: 'update_record', entityId: 'customers', recordId: 'one', values: { name: 'New' } }, { roleId: 'owner', agentApprovalRequired: true })).toEqual(expect.objectContaining({ level: 3, requiresApproval: true }))
  })
})
