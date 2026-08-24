import { describe, expect, it } from 'vitest'
import { generateKpiDefinitions } from './kpiEngine'
import type { EntityDefinition } from './workspaceSchema'

const productionOrders: EntityDefinition = {
  id: 'production-orders', label: 'Production order', pluralLabel: 'Production', module: 'manufacturing', primaryField: 'number', capabilityId: 'manufacturing.production',
  fields: [
    { id: 'number', label: 'Production order', type: 'text', required: true },
    { id: 'status', label: 'Status', type: 'select', options: ['Planned', 'Complete'] },
    { id: 'quantity', label: 'Quantity', type: 'number' },
    { id: 'startDate', label: 'Start date', type: 'date' },
    { id: 'dueDate', label: 'Due date', type: 'date' },
  ],
}

describe('KPI generation engine', () => {
  it('builds a complete KPI specification from selected capabilities and real fields', () => {
    const kpis = generateKpiDefinitions({ capabilityIds: ['manufacturing.production'], entities: [productionOrders], metrics: [], goals: ['Improve production output'] })
    const effectiveness = kpis.find(item => item.id === 'production-effectiveness')
    expect(effectiveness).toEqual(expect.objectContaining({ owner: 'manager', frequency: 'weekly', trend: 'increase', associatedProcess: 'production-planning' }))
    expect(effectiveness?.formula).toContain('* 100')
    expect(effectiveness?.requiredData).toEqual(expect.arrayContaining(['production-orders.quantity', 'production-orders.startDate']))
    expect(effectiveness?.target).toContain('baseline')
    expect(effectiveness?.historicalValues).toEqual([])
    expect(effectiveness?.possibleAIActions.length).toBeGreaterThan(1)
  })

  it('does not generate manufacturing KPIs for a consultancy', () => {
    const kpis = generateKpiDefinitions({ capabilityIds: ['crm.contacts', 'work.projects'], entities: [], metrics: [], goals: ['Deliver client projects on time'] })
    expect(kpis.map(item => item.id)).toContain('project-delivery')
    expect(kpis.map(item => item.id)).not.toEqual(expect.arrayContaining(['production-effectiveness', 'quality-conformance', 'waste-rate', 'asset-availability']))
  })
})
