import { describe, expect, it } from 'vitest'
import { planToWorkspaceAction } from './workspaceAgentPlan'
import type { AgentPlan } from './workspaceAgentClient'
import type { WorkspaceConfiguration } from './workspaceSchema'

/**
 * The gate between a model designing a change and a workspace receiving one.
 *
 * The agent describes what to build in the company's own words. Everything past this point is real:
 * record types people will type into, fields on forms they will open, a page in their sidebar. So
 * nothing the model says is taken on trust — a relation pointing at a record type nobody built is a
 * dropdown that can never be filled, a second Suppliers table is worse than no Suppliers table, and
 * a sum with nothing to add up reports zero forever.
 */

const config = {
  version: 1,
  id: 'ws-plan',
  profile: { companyName: 'Bakery', industry: 'Bakery', description: 'We bake bread.' },
  capabilities: ['commerce.products'],
  modules: ['commerce'],
  entities: [
    { id: 'products', label: 'Product', pluralLabel: 'Products', module: 'commerce', primaryField: 'name', capabilityId: 'commerce.products', fields: [{ id: 'name', label: 'Product', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Active', 'Discontinued'] }] },
  ],
  views: [{ id: 'products-table', label: 'Products', entityId: 'products', type: 'table', columns: ['name'] }],
  navigation: [
    { id: 'home', label: 'Home', kind: 'home' },
    { id: 'commerce', label: 'Products', kind: 'entity', viewId: 'products-table', module: 'commerce' },
    { id: 'settings', label: 'Settings', kind: 'settings' },
  ],
  metrics: [],
  workflows: [],
  roles: [{ id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'admin'] }],
} as unknown as WorkspaceConfiguration

const plan = (overrides: Partial<AgentPlan>): AgentPlan => ({
  label: 'Supplier management', module: 'procurement', capabilityIds: [], entities: [], entityUpdates: [], workflows: [], metrics: [],
  ...overrides,
})

describe('compiling a plan into a workspace change', () => {
  it('builds the record type, its page and the states this company uses', () => {
    const action = planToWorkspaceAction(plan({
      entities: [{
        name: 'Suppliers', purpose: 'Who we buy flour from',
        fields: [{ label: 'Supplier', type: 'text', required: true }, { label: 'Lead time days', type: 'number' }],
        states: ['Active', 'On hold', 'Stopped'],
      }],
    }), config)!

    expect(action.type).toBe('activate_module')
    if (action.type !== 'activate_module') return
    const suppliers = action.entities.find(entity => entity.id === 'suppliers')!
    expect(suppliers.pluralLabel).toBe('Suppliers')
    expect(suppliers.label).toBe('Supplier')
    expect(suppliers.primaryField).toBe('supplier')
    expect(suppliers.fields.find(field => field.id === 'status')?.options).toEqual(['Active', 'On hold', 'Stopped'])
    // Somewhere to put what did not fit a field, the same as every record Wesify builds.
    expect(suppliers.fields.map(field => field.id)).toContain('notes')
    expect(action.navigation.map(item => item.label)).toContain('Suppliers')
    expect(action.views.find(view => view.entityId === 'suppliers')?.type).toBe('kanban')
  })

  it('connects new records to each other and to what the workspace already has', () => {
    const action = planToWorkspaceAction(plan({
      entities: [
        { name: 'Suppliers', purpose: 'Who we buy from', fields: [{ label: 'Supplier', type: 'text', required: true }] },
        {
          name: 'Purchase orders', purpose: 'What we ordered',
          fields: [
            { label: 'Reference', type: 'text', required: true },
            { label: 'Supplier', type: 'relation', relatedTo: 'Suppliers' },
            { label: 'Product', type: 'relation', relatedTo: 'Products' },
            { label: 'Ordered from', type: 'relation', relatedTo: 'Warehouses' },
          ],
        },
      ],
    }), config)!
    if (action.type !== 'activate_module') throw new Error('expected a module change')

    const orders = action.entities.find(entity => entity.id === 'purchase-orders')!
    expect(orders.fields.find(field => field.id === 'supplier')?.relationEntityId).toBe('suppliers')
    // Points at a record type the workspace already has, resolved by its plural label.
    expect(orders.fields.find(field => field.id === 'product')?.relationEntityId).toBe('products')
    // Points at nothing at all, so it is not built: an empty dropdown is worse than a missing field.
    expect(orders.fields.map(field => field.id)).not.toContain('ordered-from')
  })

  it('extends a record type the workspace already has instead of building a second one', () => {
    const action = planToWorkspaceAction(plan({
      entities: [{ name: 'Products', purpose: 'What we sell', fields: [{ label: 'Shelf life days', type: 'number' }, { label: 'Product', type: 'text' }] }],
    }), config)!
    if (action.type !== 'activate_module') throw new Error('expected a module change')

    expect(action.entities).toEqual([])
    expect(action.entityUpdates).toEqual([{ entityId: 'products', fields: [{ id: 'shelf-life-days', label: 'Shelf life days', type: 'number' }] }])
  })

  it('prefers a catalog capability over inventing record types', () => {
    const action = planToWorkspaceAction(plan({ capabilityIds: ['procurement.suppliers'] }), config)!
    if (action.type !== 'activate_module') throw new Error('expected a module change')

    expect(action.capabilityIds).toContain('procurement.suppliers')
    expect(action.entities.map(entity => entity.id)).toContain('suppliers')
    expect(action.navigation.length).toBeGreaterThan(0)
  })

  it('drops an alert or a number that could never work', () => {
    const action = planToWorkspaceAction(plan({
      entities: [{ name: 'Deliveries', purpose: 'What arrived', fields: [{ label: 'Reference', type: 'text', required: true }], states: ['Expected', 'Late', 'Arrived'] }],
      workflows: [
        { name: 'Delivery is late', entity: 'Deliveries', event: 'updated', conditionField: 'Status', conditionEquals: 'Late', message: 'A delivery is late.' },
        { name: 'Ghost alert', entity: 'Nothing here', event: 'updated', message: 'Nobody will see this.' },
      ],
      metrics: [
        { label: 'Late deliveries', entity: 'Deliveries', operation: 'count', statusNotEquals: 'Arrived' },
        { label: 'Money owed', entity: 'Deliveries', operation: 'sum' },
      ],
    }), config)!
    if (action.type !== 'activate_module') throw new Error('expected a module change')

    expect(action.workflows?.map(item => item.name)).toEqual(['Delivery is late'])
    expect(action.workflows?.[0].trigger).toEqual({ entityId: 'deliveries', event: 'updated', field: 'status', equals: 'Late' })
    // A sum with no amount anywhere on the record would report zero for ever.
    expect(action.metrics?.map(item => item.label)).toEqual(['Late deliveries'])
    expect(action.metrics?.[0].filter).toEqual({ field: 'status', notEquals: 'Arrived' })
  })

  it('returns nothing when the plan would change nothing', () => {
    expect(planToWorkspaceAction(plan({}), config)).toBeUndefined()
    expect(planToWorkspaceAction(plan({ entities: [{ name: '', purpose: '', fields: [] }] }), config)).toBeUndefined()
    expect(planToWorkspaceAction(plan({ capabilityIds: ['commerce.products'] }), config)).toBeUndefined()
  })

  it('never takes a section id the workspace is already using', () => {
    const action = planToWorkspaceAction(plan({
      module: 'commerce',
      entities: [{ name: 'Recipes', purpose: 'How each product is made', fields: [{ label: 'Recipe', type: 'text', required: true }] }],
    }), config)!
    if (action.type !== 'activate_module') throw new Error('expected a module change')

    expect(action.navigation.map(item => item.id)).not.toContain('commerce')
    expect(action.navigation.map(item => item.id)).toEqual(['recipes'])
  })
})
