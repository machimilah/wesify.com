import { describe, expect, it } from 'vitest'
import { generateWorkspaceConfiguration, generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import { classifyWorkspaceIntent, executeWorkspaceAction, interpretWorkspaceCommand } from './workspaceActions'
import type { AIBlueprint } from './blueprint'
import type { ArchitectureContext, BusinessState } from './businessDiscovery'

const agency: AIBlueprint = {
  modules: ['sales', 'customers', 'projects', 'processes', 'finance', 'team'],
  startView: 'projects',
  moduleConfig: { pipelineStages: ['Lead', 'Proposal', 'Won'], processSteps: ['Brief', 'Deliver'], billingCadence: 'Monthly', inventoryStages: [], supportStages: [] },
}

describe('schema-driven workspace', () => {
  it('generates navigation, related entities, views, metrics, roles and business memory', () => {
    const config = generateWorkspaceConfiguration({ companyDescription: 'Digital marketing agency', companyName: 'Northstar', chargeModel: 'Subscription' }, agency)
    expect(config.profile.companyName).toBe('Northstar')
    expect(config.entities.map(entity => entity.id)).toEqual(expect.arrayContaining(['customers', 'opportunities', 'projects', 'tasks', 'invoices', 'expenses', 'employees']))
    expect(config.navigation.map(item => item.id)).toEqual(expect.arrayContaining(['home', 'today', 'sales', 'customers', 'projects', 'finance', 'team', 'analytics', 'links']))
    expect(config.metrics.length).toBeGreaterThan(3)
    expect(config.roles.map(role => role.id)).toEqual(['owner', 'admin', 'manager', 'employee', 'accountant'])
  })

  it('interprets and executes structured record actions', () => {
    const config = generateWorkspaceConfiguration({ companyDescription: 'Digital marketing agency', companyName: 'Northstar' }, agency)
    const interpreted = interpretWorkspaceCommand('Create a new client called ACME', config)
    expect(interpreted.action?.type).toBe('create_record')
    const result = executeWorkspaceAction(config, {}, interpreted.action!)
    expect(result.records.customers[0].name).toBe('ACME')
  })

  it('previews structural field changes', () => {
    const config = generateWorkspaceConfiguration({ companyDescription: 'Digital marketing agency' }, agency)
    const interpreted = interpretWorkspaceCommand('Track account tier for clients', config)
    expect(interpreted.needsPreview).toBe(true)
    expect(interpreted.action?.type).toBe('add_field')
  })

  it('creates workflow actions from business language', () => {
    const config = generateWorkspaceConfiguration({ companyDescription: 'Digital marketing agency' }, agency)
    const interpreted = interpretWorkspaceCommand('Whenever an invoice becomes overdue remind me', config)
    expect(interpreted.needsPreview).toBe(true)
    expect(interpreted.action?.type).toBe('create_workflow')
  })

  it('separates operating commands from software changes', () => {
    expect(classifyWorkspaceIntent('Create a new client called ACME')).toBe('BUSINESS_ACTION')
    expect(classifyWorkspaceIntent('Add equipment management')).toBe('WORKSPACE_CHANGE')
    expect(classifyWorkspaceIntent('Remind me when maintenance is due')).toBe('WORKFLOW_CHANGE')
    expect(classifyWorkspaceIntent('Which project costs the most?')).toBe('BUSINESS_QUERY')
  })

  it('proposes a custom module from business language', () => {
    const config = generateWorkspaceConfiguration({ companyDescription: 'Boat rental business' }, agency)
    const interpreted = interpretWorkspaceCommand('I want to keep track of our boats', config)
    expect(interpreted.needsPreview).toBe(true)
    expect(interpreted.action?.type).toBe('activate_module')
  })

  it('generates a visibly different field-service workspace', () => {
    const fieldService: AIBlueprint = { modules: ['customers', 'projects', 'processes', 'finance', 'team', 'inventory', 'support'], startView: 'processes', moduleConfig: { pipelineStages: [], processSteps: ['Schedule', 'Dispatch', 'Service', 'Invoice'], billingCadence: 'Recurring', inventoryStages: ['Available', 'Assigned', 'Used'], supportStages: ['New', 'Scheduled', 'Resolved'] } }
    const config = generateWorkspaceConfiguration({ companyDescription: 'We run a landscaping company and maintain gardens', companyName: 'Greenworks' }, fieldService)
    expect(config.profile.archetype).toBe('field-service')
    expect(config.entities.map(entity => entity.id)).toEqual(expect.arrayContaining(['vehicles', 'equipment', 'products', 'suppliers']))
    expect(config.navigation.map(item => item.label)).toEqual(expect.arrayContaining(['Vehicles', 'Equipment', 'Products', 'Suppliers']))
    expect(config.entities.map(entity => entity.id)).not.toContain('opportunities')
  })

  it('compiles the required construction base and equipment evolution', () => {
    const construction: AIBlueprint = { modules: ['sales', 'customers', 'projects', 'processes', 'finance', 'team', 'inventory'], startView: 'projects', moduleConfig: { pipelineStages: ['Bid', 'Awarded'], processSteps: ['Plan', 'Build', 'Inspect', 'Handover'], billingCadence: 'Milestones', inventoryStages: ['Ordered', 'On site', 'Used'], supportStages: [] } }
    const config = generateWorkspaceConfiguration({ companyDescription: 'Small construction company with seven employees, suppliers, materials, and milestone invoices', companyName: 'BuildCo' }, construction)
    expect(config.profile.archetype).toBe('construction')
    expect(config.entities.map(entity => entity.id)).toEqual(expect.arrayContaining(['customers', 'projects', 'employees', 'suppliers', 'products', 'project-costs', 'invoices', 'expenses', 'tasks']))
    expect(config.entities.find(entity => entity.id === 'products')?.pluralLabel).toBe('Materials')
    const equipment = interpretWorkspaceCommand('Add a section for our equipment because we bought machinery', config)
    expect(equipment.action?.type).toBe('activate_module')
    const evolved = executeWorkspaceAction(config, {}, equipment.action!).config
    expect(evolved.entities.map(entity => entity.id)).toEqual(expect.arrayContaining(['equipment', 'equipment-assignments', 'maintenance']))
    expect(evolved.kpis?.map(item => item.id)).toContain('equipment-costs')
    expect(evolved.entities.find(entity => entity.id === 'project-costs')?.fields.map(field => field.id)).toContain('equipment')
    const workflow = interpretWorkspaceCommand('Remind me when equipment requires maintenance', evolved)
    expect(workflow.action?.type).toBe('create_workflow')
  })

  it('faithfully compiles AI entities, schedule, metrics and workflows without generic filler records', () => {
    const businessState: BusinessState = { companySummary: 'Commercial cleaning company', industry: 'Commercial cleaning', facts: [], businessModel: ['Recurring services'], productsOrServices: ['Cleaning'], customers: ['Offices'], revenueModel: ['Monthly'], team: ['Five cleaners'], operations: ['Recurring visits'], resources: ['Supplies'], locations: ['Madrid'], currentTools: [], painPoints: [], goals: [], knownEntities: ['Clients', 'Contracts', 'Cleaning Visits', 'Team', 'Supplies', 'Invoices'], knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [] }
    const architecture: ArchitectureContext = { title: 'Cleaning Command Center', summary: '', explanation: '', modules: ['sales', 'customers', 'projects', 'finance', 'team', 'inventory'], startView: 'projects', capabilities: [], capabilityIds: ['crm.contacts', 'sales.contracts', 'work.scheduling', 'people.directory', 'inventory.stock', 'finance.invoicing'], excludedCapabilityIds: [], pages: ['Dashboard', 'Clients', 'Contracts', 'Cleaning Visits', 'Schedule', 'Team', 'Supplies', 'Invoices'], entities: [{ name: 'Clients', module: 'customers', purpose: 'Client records' }, { name: 'Contracts', module: 'projects', purpose: 'Recurring service agreements' }, { name: 'Cleaning Visits', module: 'projects', purpose: 'Schedule work and assign cleaners' }, { name: 'Team', module: 'team', purpose: 'Cleaner availability' }, { name: 'Supplies', module: 'inventory', purpose: 'Stock consumables' }, { name: 'Invoices', module: 'finance', purpose: 'Monthly billing' }], workflows: ['Completed cleaning visit notification', 'Paid invoice notification'], metrics: ['Active contracts', 'Outstanding invoices'], processStages: ['Planned', 'Assigned', 'Completed'], pipelineStages: ['Lead', 'Won'], billingCadence: 'Monthly' }
    const config = generateWorkspaceConfigurationFromDiscovery({ companyDescription: 'Cleaning company' }, agency, businessState, architecture)
    expect(config.capabilities).toEqual(expect.arrayContaining(['crm.contacts', 'sales.contracts', 'work.scheduling', 'people.directory', 'inventory.stock', 'finance.invoicing']))
    expect(config.entities.map(entity => entity.id)).toEqual(expect.arrayContaining(['customers', 'contracts', 'appointments', 'employees', 'stock-items', 'invoices']))
    expect(config.entities.find(item => item.id === 'appointments')?.pluralLabel).toBe('Cleaning Visits')
    expect(config.views).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'appointments-calendar', type: 'calendar' })]))
    expect(config.navigation.map(item => item.label)).toEqual(expect.arrayContaining(['Cleaning Visits', 'Invoices']))
    expect(config.entities.find(item => item.id === 'appointments')?.fields.map(item => item.id)).toEqual(expect.arrayContaining(['customer', 'assignee', 'dueDate']))
    expect(config.metrics.map(item => item.label)).toEqual(expect.arrayContaining(['Active contracts', 'Outstanding invoices']))
    expect(config.workflows.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * A company can genuinely have an analytics module, and the shell already owns an analytics
   * section. Both were built with the id 'analytics', so React rendered two sections with the same
   * key — warning that one may be silently dropped — and a link to that section was ambiguous.
   */
  it('never builds two navigation sections with the same id', () => {
    const config = generateWorkspaceConfiguration(
      { companyDescription: 'We run a data agency with dashboards and reporting for clients.' },
      { modules: ['customers', 'analytics', 'finance'], startView: 'overview', moduleConfig: { pipelineStages: [], processSteps: [], billingCadence: '', inventoryStages: [], supportStages: [] } },
    )
    const ids = config.navigation.map(item => item.id)
    expect(ids).toEqual([...new Set(ids)])
    // The shell keeps its own section rather than losing it to the module.
    expect(config.navigation.find(item => item.id === 'analytics')?.kind).toBe('analytics')
  })
})
