import { describe, expect, it } from 'vitest'
import { emptyArchitecture, emptyBusinessState, type ArchitectureContext, type BusinessState } from './businessDiscovery'
import { planCapabilities } from './capabilityCatalog'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import type { AIBlueprint } from './blueprint'

/**
 * The workspace is the one that was described, not the one its industry usually gets.
 *
 * Wesify used to build the architecture and then add an industry pack on top of it, plus every
 * capability whose name happened to appear in the transcript. Somebody describing a way to keep
 * track of their school work got Clients, Invoices, Payments, Courses, Enrollments, Documents and a
 * team directory, because the word "school" matched the education pack and the pack was added
 * wholesale. That is a template wearing the interview's clothes, and it is the failure that makes
 * every other business suite feel like somebody else's software.
 *
 * These two builds are deliberately opposite: neither of them needs what the other one needs, and
 * both come out of the same compiler.
 */

const blueprint = (modules: AIBlueprint['modules']): AIBlueprint => ({ modules, startView: modules[0] ?? 'overview', moduleConfig: { pipelineStages: [], processSteps: [], billingCadence: '', inventoryStages: [], supportStages: [] } })

const tabsOf = (labels: Array<{ kind: string; label: string }>) => labels.filter(item => item.kind === 'entity').map(item => item.label)

const schoolState: BusinessState = {
  ...emptyBusinessState(),
  companySummary: 'I want to keep track of my school work: assignments, classes and deadlines.',
  industry: 'Education',
  productsOrServices: ['Coursework and assignments'],
  customers: ['Just me, a student'],
  operations: ['Get the assignment', 'Work on it', 'Hand it in', 'Graded'],
  knownEntities: ['Assignment', 'Class'],
  goals: ['Never miss a deadline'],
}

const schoolArchitecture: ArchitectureContext = {
  ...emptyArchitecture(),
  title: 'School work',
  modules: ['projects'],
  startView: 'projects',
  capabilityIds: ['work.tasks'],
  pages: ['Assignments', 'Classes'],
  entities: [
    { name: 'Assignments', module: 'projects', purpose: 'School work to hand in', fields: [{ label: 'Title', type: 'text', required: true }, { label: 'Class', type: 'relation', relatedTo: 'Classes' }, { label: 'Due date', type: 'date' }, { label: 'Grade', type: 'text' }] },
    { name: 'Classes', module: 'projects', purpose: 'Courses being taken', fields: [{ label: 'Class', type: 'text', required: true }, { label: 'Teacher', type: 'text' }, { label: 'Room', type: 'text' }] },
  ],
  processStages: ['Not started', 'In progress', 'Handed in', 'Graded'],
  metrics: ['Assignments due this week'],
}

const shopState: BusinessState = {
  ...emptyBusinessState(),
  companySummary: 'We run an online shop selling ceramics we make ourselves and ship to customers.',
  industry: 'Retail',
  productsOrServices: ['Handmade ceramics'],
  customers: ['Consumers online'],
  operations: ['Order received', 'Pack', 'Ship'],
  resources: ['Clay suppliers', 'A kiln'],
}

const shopArchitecture: ArchitectureContext = {
  ...emptyArchitecture(),
  title: 'Ceramics shop',
  modules: ['commerce', 'inventory', 'logistics', 'customers'],
  startView: 'commerce',
  capabilityIds: ['commerce.products', 'sales.orders', 'inventory.stock', 'logistics.shipping', 'crm.contacts'],
  pages: ['Products', 'Orders', 'Inventory', 'Shipping', 'Customers'],
  entities: [{ name: 'Orders', module: 'commerce', purpose: 'What a customer bought' }],
  processStages: ['New', 'Packed', 'Shipped'],
}

describe('a workspace built for the business that was described', () => {
  it('gives a school-work tracker the sections it asked for and none of its industry base', () => {
    const plan = planCapabilities(schoolState, schoolArchitecture)
    // The pack is still recognised — it is simply no longer allowed to install itself.
    expect(plan.pack?.id).toBe('education')
    expect(plan.selected.map(item => item.id)).not.toContain('vertical.education')
    expect(plan.selected.map(item => item.id)).not.toContain('finance.invoicing')

    const config = generateWorkspaceConfigurationFromDiscovery({}, blueprint(['projects']), schoolState, schoolArchitecture)
    expect(tabsOf(config.navigation)).toEqual(['Assignments', 'Classes'])
    for (const unwanted of ['Inventory', 'Products', 'Reports', 'Clients', 'Invoices', 'Payments', 'Team', 'Courses', 'Enrollments']) {
      expect(tabsOf(config.navigation), unwanted).not.toContain(unwanted)
    }
    // Nothing in the sidebar means nothing in the domain headings above it either.
    expect(config.modules).toEqual(['projects'])
    expect(config.capabilities).not.toContain('crm.contacts')
  })

  it('builds the record the architect described rather than the catalog record it resembles', () => {
    const config = generateWorkspaceConfigurationFromDiscovery({}, blueprint(['projects']), schoolState, schoolArchitecture)
    const assignments = config.entities.find(entity => entity.pluralLabel === 'Assignments')!
    expect(assignments).toBeTruthy()
    for (const id of ['title', 'due-date', 'grade', 'status']) expect(assignments.fields.map(field => field.id), `missing ${id}`).toContain(id)
    // A task in the catalog belongs to a project and has an assignee. An assignment has neither, and
    // an empty dropdown onto a page this workspace does not have is worse than no field at all.
    expect(assignments.fields.map(field => field.id)).not.toContain('project')
    expect(assignments.fields.map(field => field.id)).not.toContain('assignee')
  })

  it('leaves no field pointing at a record with nowhere to open it', () => {
    const builds: Array<[BusinessState, ArchitectureContext, AIBlueprint['modules']]> = [[schoolState, schoolArchitecture, ['projects']], [shopState, shopArchitecture, ['commerce']]]
    for (const [state, architecture, modules] of builds) {
      const config = generateWorkspaceConfigurationFromDiscovery({}, blueprint(modules), state, architecture)
      const reachable = new Set(config.navigation.map(item => config.views.find(view => view.id === item.viewId)?.entityId).filter(Boolean))
      for (const entity of config.entities.filter(item => reachable.has(item.id))) {
        for (const field of entity.fields.filter(item => item.type === 'relation')) {
          expect(reachable.has(field.relationEntityId ?? ''), `${entity.id}.${field.id} → ${field.relationEntityId}`).toBe(true)
        }
      }
    }
  })

  it('still builds stock, products and shipping for a company that actually sells things', () => {
    const config = generateWorkspaceConfigurationFromDiscovery({}, blueprint(['commerce']), shopState, shopArchitecture)
    expect(tabsOf(config.navigation)).toEqual(expect.arrayContaining(['Products', 'Orders', 'Inventory', 'Shipping']))
    expect(config.entities.map(entity => entity.id)).toEqual(expect.arrayContaining(['products', 'orders', 'stock-items', 'shipments', 'customers']))
    expect(config.modules).toEqual(expect.arrayContaining(['commerce', 'inventory', 'logistics']))
  })

  it('falls back to the industry base only when there is no architecture to respect', () => {
    const plan = planCapabilities(schoolState, emptyArchitecture())
    expect(plan.selected.map(item => item.id)).toEqual(expect.arrayContaining(['vertical.education', 'crm.contacts']))
  })
})
