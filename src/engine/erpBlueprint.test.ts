import { describe, expect, it } from 'vitest'
import { erpBlueprint, type ErpIntrospection, type ErpModel } from './erpBlueprint'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import { architectureToBlueprint } from './businessDiscovery'

/**
 * Reading a company out of its own ERP, and refusing to read one that is not there.
 *
 * This is the claim the repositioning rests on: an introspected ERP is better evidence than an
 * interview. An operator asked "do you manufacture?" says yes because they remember buying the
 * module; the record count says otherwise and cannot be talked round. Every assertion below is
 * either that claim or one of the ways a careless mapping would quietly betray it — a second
 * Suppliers table, a dropdown pointing at nothing, a custom field silently dropped.
 */

const field = (name: string, label: string, type: string, extra: Partial<ErpModel['fields'][number]> = {}) => ({
  name, label, type, required: false, relation: '', selection: [], custom: name.startsWith('x_'), ...extra,
})

const introspection = (models: ErpModel[], modules = [{ name: 'purchase', label: 'Purchase' }]): ErpIntrospection => ({
  provider: 'odoo',
  at: '2026-08-27T09:00:00.000Z',
  company: { name: 'Panaderia Uno', country: 'Spain', currency: 'EUR' },
  modules,
  models,
  roles: [{ name: 'Purchase / Manager' }],
})

const purchaseOrders: ErpModel = {
  model: 'purchase.order', label: 'Purchase Order', count: 42, custom: false,
  fields: [
    field('name', 'Order Reference', 'char', { required: true }),
    field('partner_id', 'Vendor', 'many2one', { relation: 'res.partner' }),
    field('state', 'Status', 'selection', { selection: [{ value: 'draft', label: 'RFQ' }, { value: 'purchase', label: 'Ordered' }, { value: 'done', label: 'Received' }] }),
    field('amount_total', 'Total', 'monetary'),
    field('x_studio_pallet_code', 'Pallet code', 'char'),
  ],
}

const production: ErpModel = {
  model: 'mrp.production', label: 'Production Order', count: 0, custom: false,
  fields: [field('name', 'Reference', 'char'), field('state', 'Status', 'selection', { selection: [{ value: 'done', label: 'Done' }] })],
}

describe('rebuilding a company from its ERP', () => {
  it('takes what the ERP is used for and leaves what it merely has installed', () => {
    const built = erpBlueprint(introspection([purchaseOrders, production], [{ name: 'purchase', label: 'Purchase' }, { name: 'mrp', label: 'Manufacturing' }]))

    expect(built.architecture.capabilityIds).toContain('procurement.purchasing')
    // Manufacturing is installed and has never been used. This is the whole claim.
    expect(built.architecture.capabilityIds).not.toContain('manufacturing.production')
    expect(built.architecture.entities.map(entity => entity.name)).toEqual(['Purchase orders'])
    expect(built.architecture.archetypes).not.toContain('manufacturer')
  })

  it('says out loud what was bought and never used', () => {
    const built = erpBlueprint(introspection([purchaseOrders, production]))
    const unused = built.businessState.facts.find(fact => fact.topic === 'Installed but unused')
    expect(unused?.value).toContain('mrp.production')
  })

  it('carries across the fields somebody paid to add', () => {
    const built = erpBlueprint(introspection([purchaseOrders]))
    const entity = built.architecture.entities[0]
    expect(entity.fields?.map(item => item.label)).toContain('Pallet code')
    expect(built.custom[0].fields.map(item => item.name)).toEqual(['x_studio_pallet_code'])
    // And it must reach the import too, or the rebuilt column would sit empty for ever.
    expect(built.mapping[0].fields.map(item => item.from)).toContain('x_studio_pallet_code')
  })

  it('uses the states the company actually uses, in its own words', () => {
    const built = erpBlueprint(introspection([purchaseOrders]))
    expect(built.architecture.lifecycles).toEqual([{ entity: 'Purchase orders', states: ['RFQ', 'Ordered', 'Received'] }])
    expect(built.architecture.entities[0].fields?.find(item => item.label === 'Status')?.options).toEqual(['RFQ', 'Ordered', 'Received'])
  })

  it('demotes a dropdown the ERP gave no options for', () => {
    const thin: ErpModel = { ...purchaseOrders, fields: [field('name', 'Order Reference', 'char'), field('state', 'Status', 'selection')] }
    const built = erpBlueprint(introspection([thin]))
    const status = built.architecture.entities[0].fields?.find(item => item.label === 'Status')
    expect(status?.type).toBe('text')
    expect(built.architecture.lifecycles).toEqual([])
  })

  it('traces every conclusion back to a number from their system', () => {
    const built = erpBlueprint(introspection([purchaseOrders]))
    const fact = built.businessState.facts.find(item => item.topic === 'Purchase orders')!
    expect(fact.value).toContain('42 records')
    expect(fact.basis).toBe('research')
    expect(fact.evidence).toMatch(/own Odoo/)
  })

  it('builds nothing at all from an ERP nobody has used', () => {
    const built = erpBlueprint(introspection([production]))
    expect(built.architecture.entities).toEqual([])
    expect(built.architecture.capabilityIds).toEqual([])
    expect(built.mapping).toEqual([])
  })

  it('never claims a capability the catalog does not have', () => {
    const built = erpBlueprint(introspection([purchaseOrders, { ...production, count: 5 }]))
    for (const capabilityId of built.architecture.capabilityIds) expect(capabilityId).toMatch(/^[a-z][a-z0-9-]*\.[a-z0-9-]+$/)
  })

  /**
   * The end of the road: an ERP-derived architecture must survive the same compile an
   * interview-derived one does, and come out the other side with the completeness check run over it.
   */
  it('compiles into a workspace, and the completeness check names what the ERP does not cover', () => {
    const built = erpBlueprint(introspection([purchaseOrders, { ...production, count: 12 }], [{ name: 'purchase', label: 'Purchase' }, { name: 'mrp', label: 'Manufacturing' }]))
    const config = generateWorkspaceConfigurationFromDiscovery({}, architectureToBlueprint(built.architecture), built.businessState, built.architecture)

    expect(config.entities.some(entity => entity.id === 'purchase-orders')).toBe(true)
    expect(config.navigation.filter(item => item.kind === 'entity').length).toBeGreaterThan(0)

    // A company that manufactures and purchases, with no quality control anywhere in its ERP.
    expect(config.coverage?.archetypes.map(item => item.id)).toContain('manufacturer')
    const missing = config.coverage!.blocking.flatMap(item => item.capabilityIds)
    expect(missing.length).toBeGreaterThan(0)
    expect(config.coverage!.blocking.every(item => item.because.length > 10)).toBe(true)
  })
})

describe('an ERP that does not look like the textbook one', () => {
  const customModel: ErpModel = {
    model: 'x_batch_log', label: 'Batch Log', count: 3, custom: true,
    fields: [
      field('x_name', 'Batch', 'char', { required: true }),
      field('x_oven', 'Oven', 'selection', { selection: [{ value: 'a', label: 'Deck oven' }, { value: 'b', label: 'Rack oven' }] }),
      field('create_uid', 'Created by', 'many2one'),
    ],
  }

  it('rebuilds a record type Wesify has never heard of', () => {
    const built = erpBlueprint(introspection([customModel]))
    const entity = built.architecture.entities[0]
    expect(entity.name).toBe('Batch Log')
    expect(entity.module).toBe('processes')
    expect(entity.fields?.map(item => item.label)).toEqual(['Batch', 'Oven'])
    // Odoo's own bookkeeping columns are not business fields.
    expect(entity.fields?.map(item => item.label)).not.toContain('Created by')
    expect(built.mapping[0]).toEqual({
      model: 'x_batch_log',
      entityId: 'batch-log',
      fields: [{ from: 'x_name', to: 'batch', kind: 'text' }, { from: 'x_oven', to: 'oven', kind: 'select' }],
    })
  })

  it('counts one record as one record', () => {
    const built = erpBlueprint(introspection([{ ...customModel, count: 1 }]))
    expect(built.businessState.facts[0].value).toBe('1 record in x_batch_log')
  })

  it('manages without a company name or a country', () => {
    const bare = { ...introspection([purchaseOrders]), company: { name: '', country: '', currency: '' } }
    const built = erpBlueprint(bare)
    expect(built.architecture.title).toBe('Command Center')
    expect(built.businessState.companySummary).toMatch(/^This company runs on Odoo/)
    expect(built.businessState.locations).toEqual([])
  })

  it('skips a record type with nothing on it worth keeping', () => {
    const noise: ErpModel = { model: 'x_empty', label: 'Empty', count: 4, custom: true, fields: [field('create_date', 'Created', 'datetime')] }
    expect(erpBlueprint(introspection([noise])).architecture.entities).toEqual([])
  })
})
