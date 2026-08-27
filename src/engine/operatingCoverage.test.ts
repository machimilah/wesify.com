import { describe, expect, it } from 'vitest'
import { emptyArchitecture, emptyBusinessState, type ArchitectureContext, type BusinessState } from './businessDiscovery'
import { coverageForProposal, coverageRepairInstruction } from './operatingCoverage'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import type { AIBlueprint } from './blueprint'

/**
 * What the build is checked against before anybody is handed it.
 *
 * These are the two failures the check exists for, run end to end through the real compiler. A
 * bakery whose interview covered selling and never reached buying comes out with a workspace that
 * cannot buy flour, and that has to be found before the build rather than by the operator. A student
 * tracking coursework comes out with exactly what they asked for, and a completeness check that
 * tried to sell them procurement would be the older, worse failure wearing a framework's clothes.
 */

const blueprint = (modules: AIBlueprint['modules']): AIBlueprint => ({ modules, startView: modules[0] ?? 'overview', moduleConfig: { pipelineStages: [], processSteps: [], billingCadence: '', inventoryStages: [], supportStages: [] } })

const bakeryState: BusinessState = {
  ...emptyBusinessState(),
  companySummary: 'We are a bakery. We bake bread and pastries every morning and sell them to cafes and to people at the counter.',
  industry: 'Bakery',
  productsOrServices: ['Bread', 'Pastries'],
  customers: ['Cafes', 'Walk in customers'],
  operations: ['Mix', 'Bake', 'Deliver in the morning'],
  resources: ['Flour supplier', 'Ovens'],
}

const bakeryArchitecture: ArchitectureContext = {
  ...emptyArchitecture(),
  title: 'Bakery',
  modules: ['commerce', 'customers'],
  startView: 'commerce',
  capabilityIds: ['commerce.products', 'sales.orders', 'crm.contacts'],
  pages: ['Products', 'Orders', 'Customers'],
  entities: [{ name: 'Orders', module: 'commerce', purpose: 'What a cafe ordered' }],
  processStages: ['Ordered', 'Baked', 'Delivered'],
}

const courseworkState: BusinessState = {
  ...emptyBusinessState(),
  companySummary: 'I want to keep track of my school work: assignments, classes and deadlines.',
  industry: 'Education',
  productsOrServices: ['Coursework and assignments'],
  operations: ['Get the assignment', 'Work on it', 'Hand it in', 'Graded'],
}

const courseworkArchitecture: ArchitectureContext = {
  ...emptyArchitecture(),
  title: 'School work',
  modules: ['projects'],
  startView: 'projects',
  capabilityIds: ['work.tasks'],
  pages: ['Assignments', 'Classes'],
  entities: [
    { name: 'Assignments', module: 'projects', purpose: 'School work to hand in', fields: [{ label: 'Title', type: 'text', required: true }, { label: 'Class', type: 'relation', relatedTo: 'Classes' }, { label: 'Due date', type: 'date' }] },
    { name: 'Classes', module: 'projects', purpose: 'Courses being taken', fields: [{ label: 'Class', type: 'text', required: true }, { label: 'Teacher', type: 'text' }, { label: 'Room', type: 'text' }] },
  ],
}

const build = (state: BusinessState, architecture: ArchitectureContext, modules: AIBlueprint['modules']) =>
  generateWorkspaceConfigurationFromDiscovery({}, blueprint(modules), state, architecture)

describe('the completeness check on a built workspace', () => {
  it('reports the operations a bakery cannot run in the workspace it was given', () => {
    const coverage = build(bakeryState, bakeryArchitecture, ['commerce']).coverage!
    expect(coverage.ready).toBe(false)
    const blocking = coverage.blocking.map(item => item.id)
    expect(blocking).toEqual(expect.arrayContaining(['apqc-4.2', 'apqc-9.2']))
    expect(coverage.blocking.find(item => item.id === 'apqc-4.2')?.capabilityIds).toContain('procurement.purchasing')
    // A bakery is a food business whatever it says about hygiene, and that is a subject to confirm,
    // never a rule to assert.
    expect(coverage.verify.map(item => item.id)).toContain('food')
    expect(coverage.verify[0].authorities.length).toBeGreaterThan(0)
  })

  it('holds a build to at most a handful of things at a time', () => {
    const coverage = build(bakeryState, bakeryArchitecture, ['commerce']).coverage!
    expect(coverage.blocking.length).toBeLessThanOrEqual(8)
    expect(coverage.questions.length).toBeLessThanOrEqual(4)
  })

  it('asks a coursework tracker for nothing and sells it nothing', () => {
    const config = build(courseworkState, courseworkArchitecture, ['projects'])
    const coverage = config.coverage!
    expect(coverage.processes.trading).toBe(false)
    expect(coverage.questions).toEqual([])
    expect(coverage.blocking.flatMap(item => item.capabilityIds)).toEqual([])
    expect(coverage.ready).toBe(true)
    for (const id of ['revenue', 'costs', 'supplier', 'inventory', 'compliance']) {
      expect(coverage.completeness.find(item => item.id === id)?.status, id).toBe('not-applicable')
    }
    // The build itself is unchanged by any of this: the check reports, it never adds.
    expect(config.navigation.filter(item => item.kind === 'entity').map(item => item.label)).toEqual(['Assignments', 'Classes'])
  })

  it('gives every completeness test a verdict with a reason', () => {
    const coverage = build(bakeryState, bakeryArchitecture, ['commerce']).coverage!
    expect(coverage.completeness).toHaveLength(16)
    for (const test of coverage.completeness) {
      expect(['covered', 'gap', 'not-applicable'], test.id).toContain(test.status)
      expect(test.because.length, test.id).toBeGreaterThan(10)
    }
  })

  it('runs the events a company can have and skips the ones it cannot', () => {
    const coverage = build(bakeryState, bakeryArchitecture, ['commerce']).coverage!
    const byId = new Map(coverage.scenarios.map(item => [item.id, item]))
    expect(byId.get('customs-delay')?.applies).toBe(false)
    expect(byId.get('new-order')?.applies).toBe(true)
    for (const scenario of coverage.scenarios.filter(item => item.applies)) {
      expect(scenario.checks.map(item => item.id), scenario.id).toContain('detect')
      for (const check of scenario.checks) expect(check.because.length, `${scenario.id}/${check.id}`).toBeGreaterThan(5)
    }
  })

  it('is satisfied by a build that carries what the company actually does', () => {
    const complete: ArchitectureContext = {
      ...bakeryArchitecture,
      capabilityIds: [
        'commerce.products', 'sales.orders', 'crm.contacts', 'commerce.pos',
        'procurement.suppliers', 'procurement.purchasing', 'inventory.stock',
        'manufacturing.production', 'quality.inspections', 'inventory.traceability',
        'finance.invoicing', 'finance.payments', 'finance.accounts-payable', 'people.directory', 'logistics.shipping',
      ],
      pages: ['Products', 'Orders', 'Customers', 'Suppliers', 'Purchasing', 'Stock', 'Production', 'Quality', 'Invoices', 'Team', 'Deliveries'],
    }
    const coverage = build(bakeryState, complete, ['commerce']).coverage!
    expect(coverage.blocking.filter(item => item.capabilityIds.length)).toEqual([])
    expect(coverage.ready).toBe(true)
    expect(coverage.coverage).toBeGreaterThan(0.5)
  })
})

describe('what the architect is told to fix', () => {
  it('names the missing process, the evidence and the capabilities, and decides nothing', () => {
    const instruction = coverageRepairInstruction(coverageForProposal({
      text: bakeryState.companySummary,
      capabilityIds: bakeryArchitecture.capabilityIds,
    }))
    expect(instruction).toMatch(/APQC/)
    expect(instruction).toMatch(/procurement\.suppliers/)
    expect(instruction).toMatch(/excludedCapabilityIds/)
    // The model chooses. An instruction that ordered capabilities in would rebuild the module bloat
    // the whole product exists to avoid.
    expect(instruction).toMatch(/where the conversation supports/)
  })

  it('says nothing at all when the proposal already carries the company', () => {
    expect(coverageRepairInstruction(coverageForProposal({ text: courseworkState.companySummary, capabilityIds: ['work.tasks'] }))).toBe('')
  })
})

describe('the operating model the architect returns', () => {
  it('names records with the states this company actually uses', () => {
    const architecture: ArchitectureContext = {
      ...bakeryArchitecture,
      lifecycles: [{ entity: 'Orders', states: ['Taken', 'Proving', 'In the oven', 'Out for delivery', 'Delivered'] }],
    }
    const config = build(bakeryState, architecture, ['commerce'])
    const orders = config.entities.find(entity => entity.id === 'orders')!
    expect(orders.fields.find(field => field.id === 'status')?.options).toEqual(['Taken', 'Proving', 'In the oven', 'Out for delivery', 'Delivered'])
  })

  it('turns what goes wrong into something that fires when it does', () => {
    const architecture: ArchitectureContext = {
      ...bakeryArchitecture,
      lifecycles: [{ entity: 'Orders', states: ['Taken', 'Proving', 'Delivered', 'Missed'] }],
      processes: [{
        name: 'Morning delivery',
        trigger: 'A cafe orders the day before',
        entity: 'Orders',
        steps: ['Take the order', 'Bake it', 'Load the van'],
        owner: 'Baker',
        exceptions: ['An order is Missed and the cafe has nothing to sell'],
      }],
    }
    const config = build(bakeryState, architecture, ['commerce'])
    const alert = config.workflows.find(item => item.name.startsWith('An order is Missed'))!
    expect(alert).toBeTruthy()
    expect(alert.trigger.entityId).toBe('orders')
    expect(alert.trigger.equals).toBe('Missed')
  })

  it('keeps an assumption about money as a question rather than a fact', () => {
    const architecture: ArchitectureContext = {
      ...bakeryArchitecture,
      unknowns: [
        { topic: 'When the cafes actually pay', why: 'It decides whether the workspace has to chase anybody.', impact: 'money', assumption: 'Paid within thirty days' },
        { topic: 'Which oven is the newer one', why: 'Nothing depends on it.', impact: 'operations' },
      ],
    }
    const coverage = build(bakeryState, architecture, ['commerce']).coverage!
    expect(coverage.questions[0].text).toBe('When the cafes actually pay')
    expect(coverage.questions[0].because).toMatch(/assumed: Paid within thirty days/)
    expect(JSON.stringify(coverage.questions)).not.toMatch(/newer one/)
  })
})
