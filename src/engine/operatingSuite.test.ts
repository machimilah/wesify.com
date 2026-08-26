import { describe, expect, it } from 'vitest'
import {
  activeOperatingFlows,
  activeSuiteDomains,
  businessSuiteDomains,
  connectOperationalEntities,
  recordTransitions,
} from './operatingSuite'
import type { EntityDefinition, WorkspaceConfiguration } from './workspaceSchema'

const baseRoles: WorkspaceConfiguration['roles'] = [
  { id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'financial', 'people', 'admin'] },
]

function entity(id: string, label: string, module: string, fields: EntityDefinition['fields'] = []): EntityDefinition {
  return { id, label, pluralLabel: `${label}s`, module, primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, ...fields] }
}

function workspace(entities: EntityDefinition[]): WorkspaceConfiguration {
  const views = entities.map(item => ({ id: `${item.id}-table`, label: item.pluralLabel, entityId: item.id, type: 'table' as const }))
  return {
    version: 1,
    id: 'workspace',
    profile: { companyName: 'Northstar', description: '', archetype: 'custom', industry: '', businessModel: '', revenueModel: '', teamStructure: '', customers: '', productsAndServices: '', operatingProcesses: [], suppliers: '', locations: '', goals: [], terminology: {} },
    modules: [...new Set(entities.map(item => item.module))],
    capabilities: ['crm.contacts', 'sales.quotes', 'sales.orders', 'finance.invoicing', 'finance.payments'],
    entities,
    views,
    navigation: [
      { id: 'home', label: 'Home', kind: 'home' },
      ...views.map(view => ({ id: view.entityId, label: view.label, kind: 'entity' as const, viewId: view.id, module: entities.find(item => item.id === view.entityId)?.module })),
      { id: 'analytics', label: 'Reporting', kind: 'analytics' },
      { id: 'links', label: 'Automations', kind: 'links' },
      { id: 'control', label: 'Access & control', kind: 'control' },
      { id: 'settings', label: 'Settings', kind: 'settings' },
    ],
    metrics: [],
    workflows: [],
    roles: baseRoles,
  }
}

describe('business suite model', () => {
  it('covers every operating domain in the reposition', () => {
    expect(businessSuiteDomains.map(item => item.id)).toEqual([
      'crm', 'sales', 'invoicing', 'inventory', 'employees', 'projects', 'accounting', 'operations', 'automation', 'permissions', 'reporting',
    ])
  })

  it('keeps platform controls active without forcing irrelevant record modules', () => {
    const config = workspace([entity('customers', 'Customer', 'customers')])
    const domains = activeSuiteDomains(config)
    expect(domains.find(item => item.id === 'crm')?.active).toBe(true)
    expect(domains.find(item => item.id === 'inventory')?.active).toBe(false)
    expect(domains.filter(item => ['automation', 'permissions', 'reporting'].includes(item.id)).every(item => item.active)).toBe(true)
  })
})

describe('operational transaction spine', () => {
  it('links documents only when the upstream record type exists', () => {
    const linked = connectOperationalEntities([
      entity('opportunities', 'Opportunity', 'sales'),
      entity('quotes', 'Quote', 'sales'),
      entity('orders', 'Order', 'sales'),
      entity('invoices', 'Invoice', 'finance'),
      entity('payments', 'Payment', 'finance'),
    ])
    expect(linked.find(item => item.id === 'quotes')?.fields).toContainEqual(expect.objectContaining({ id: 'opportunity', type: 'relation', relationEntityId: 'opportunities' }))
    expect(linked.find(item => item.id === 'orders')?.fields).toContainEqual(expect.objectContaining({ id: 'quote', relationEntityId: 'quotes' }))
    expect(linked.find(item => item.id === 'invoices')?.fields).toContainEqual(expect.objectContaining({ id: 'order', relationEntityId: 'orders' }))
    expect(linked.find(item => item.id === 'invoices')?.fields.some(item => item.id === 'project')).toBe(false)
    expect(linked.find(item => item.id === 'payments')?.fields).toContainEqual(expect.objectContaining({ id: 'invoice', relationEntityId: 'invoices' }))
  })

  it('shows one connected flow with counts backed by real records', () => {
    const entities = connectOperationalEntities([
      entity('opportunities', 'Opportunity', 'sales'),
      entity('quotes', 'Quote', 'sales'),
      entity('orders', 'Order', 'sales'),
      entity('invoices', 'Invoice', 'finance'),
      entity('payments', 'Payment', 'finance'),
    ])
    const config = workspace(entities)
    const flows = activeOperatingFlows(config, {
      opportunities: [{ id: 'lead-1', name: 'ACME', createdAt: '1', updatedAt: '1' }],
      invoices: [{ id: 'inv-1', name: 'INV-1', createdAt: '1', updatedAt: '1' }, { id: 'inv-2', name: 'INV-2', createdAt: '1', updatedAt: '1' }],
    })
    const leadToCash = flows.find(item => item.id === 'lead-to-cash')
    expect(leadToCash?.stages.map(item => item.label)).toEqual(['Lead', 'Quote', 'Order', 'Invoice', 'Collect'])
    expect(leadToCash?.stages.find(item => item.label === 'Invoice')?.count).toBe(2)
  })

  it('opens the next document with lineage and shared values, but no invented number', () => {
    const entities = connectOperationalEntities([
      entity('customers', 'Customer', 'customers'),
      entity('quotes', 'Quote', 'sales', [{ id: 'customer', label: 'Customer', type: 'relation', relationEntityId: 'customers' }, { id: 'amount', label: 'Amount', type: 'currency' }]),
      { ...entity('orders', 'Order', 'sales', [{ id: 'customer', label: 'Customer', type: 'relation', relationEntityId: 'customers' }, { id: 'amount', label: 'Amount', type: 'currency' }]), primaryField: 'number', fields: [{ id: 'number', label: 'Order number', type: 'text', required: true }, { id: 'customer', label: 'Customer', type: 'relation', relationEntityId: 'customers' }, { id: 'amount', label: 'Amount', type: 'currency' }] },
    ])
    const config = workspace(entities)
    const source = entities.find(item => item.id === 'quotes')!
    const transition = recordTransitions(config, source, { id: 'quote-1', name: 'Q-1', customer: 'customer-1', amount: 4200, createdAt: '1', updatedAt: '1' }).find(item => item.entity.id === 'orders')!
    expect(transition.values).toMatchObject({ quote: 'quote-1', customer: 'customer-1', amount: 4200 })
    expect(transition.values.number).toBeUndefined()
  })
})
