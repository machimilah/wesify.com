import { describe, expect, it } from 'vitest'
import { emptyArchitecture, emptyBusinessState, type ArchitectureContext } from './businessDiscovery'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import { architectureToBlueprint } from './businessDiscovery'

/**
 * The record shape comes from the architect, not from matching its name against a list.
 *
 * Wesify used to decide what was inside an entity by pattern-matching the noun: anything containing
 * "invoice" got a number field, anything containing "job" got a customer relation. That is why two
 * companies in the same trade received identical forms however differently they answered — the model
 * chose the label and hand-written rules chose the substance.
 *
 * The architect now returns the fields. Nothing here trusts it: this covers what Wesify does with a
 * relation pointing at nothing, a dropdown with no options, and a duplicate — because the failure
 * mode of generated schema is not a crash, it is a form somebody cannot fill in.
 */

const state = () => ({ ...emptyBusinessState(), companySummary: 'We run a plumbing service business.', industry: 'Plumbing' })

function workspace(architecture: Partial<ArchitectureContext>) {
  const full = { ...emptyArchitecture(), modules: ['field-service' as const], pages: ['Work orders'], ...architecture }
  return generateWorkspaceConfigurationFromDiscovery({}, architectureToBlueprint(full), state(), full)
}

describe('fields the architect asked for', () => {
  it('builds the record out of them rather than out of the entity name', () => {
    const config = workspace({
      entities: [{
        name: 'Callouts', module: 'field-service', purpose: 'Jobs at customer homes',
        fields: [
          { label: 'Reference', type: 'text', required: true },
          { label: 'Service address', type: 'text' },
          { label: 'Boiler make', type: 'text' },
          { label: 'Parts used', type: 'long-text' },
          { label: 'Paid on the day', type: 'boolean' },
        ],
      }],
    })
    const callouts = config.entities.find(entity => entity.id === 'callouts')!
    expect(callouts).toBeTruthy()
    for (const id of ['reference', 'service-address', 'boiler-make', 'paid-on-the-day']) {
      expect(callouts.fields.map(field => field.id), `missing ${id}`).toContain(id)
    }
    // The first required text field is what the record is called in every list and picker.
    expect(callouts.primaryField).toBe('reference')
    expect(callouts.fields.find(field => field.id === 'paid-on-the-day')?.type).toBe('boolean')
  })

  it('gives every record a status and somewhere to write, even when the architect forgot', () => {
    const config = workspace({
      entities: [{ name: 'Callouts', module: 'field-service', purpose: 'Jobs', fields: [
        { label: 'Reference', type: 'text', required: true }, { label: 'Address', type: 'text' }, { label: 'Fee', type: 'currency' },
      ] }],
    })
    const callouts = config.entities.find(entity => entity.id === 'callouts')!
    // Boards, filters and every workflow trigger in Wesify group by status.
    expect(callouts.fields.some(field => field.id === 'status')).toBe(true)
    expect(callouts.fields.some(field => field.type === 'long-text')).toBe(true)
  })

  it('drops a relation pointing at an entity that was never built', () => {
    const config = workspace({
      entities: [{ name: 'Callouts', module: 'field-service', purpose: 'Jobs', fields: [
        { label: 'Reference', type: 'text', required: true },
        { label: 'Address', type: 'text' },
        { label: 'Fee', type: 'currency' },
        { label: 'Drone operator', type: 'relation', relatedTo: 'Drones' },
      ] }],
    })
    const callouts = config.entities.find(entity => entity.id === 'callouts')!
    // A field that can never be filled in is worse than a missing one: it looks like a feature.
    expect(callouts.fields.some(field => field.id === 'drone-operator')).toBe(false)
  })

  it('resolves a relation named in the company own words, singular or plural', () => {
    const config = workspace({
      entities: [
        { name: 'Customers', module: 'customers', purpose: 'People we serve', fields: [{ label: 'Name', type: 'text', required: true }, { label: 'Phone', type: 'phone' }, { label: 'Address', type: 'text' }] },
        { name: 'Callouts', module: 'field-service', purpose: 'Jobs', fields: [
          { label: 'Reference', type: 'text', required: true },
          { label: 'Customer', type: 'relation', relatedTo: 'Customer' },
          { label: 'Fee', type: 'currency' },
        ] },
      ],
    })
    const callouts = config.entities.find(entity => entity.id === 'callouts')!
    expect(callouts.fields.find(field => field.id === 'customer')?.relationEntityId).toBe('customers')
  })

  it('turns a dropdown with nothing in it into a text field', () => {
    const config = workspace({
      entities: [{ name: 'Callouts', module: 'field-service', purpose: 'Jobs', fields: [
        { label: 'Reference', type: 'text', required: true },
        { label: 'Urgency', type: 'select', options: [] },
        { label: 'Priority', type: 'select', options: ['Today', 'This week', 'Whenever'] },
        { label: 'Fee', type: 'currency' },
      ] }],
    })
    const callouts = config.entities.find(entity => entity.id === 'callouts')!
    expect(callouts.fields.find(field => field.id === 'urgency')?.type).toBe('text')
    expect(callouts.fields.find(field => field.id === 'priority')?.options).toEqual(['Today', 'This week', 'Whenever'])
  })

  it('falls back to inference when the architect returned no fields at all', () => {
    // The in-browser model does not return fields, and a workspace built with no API key still has
    // to be built from something.
    const config = workspace({ entities: [{ name: 'Invoices', module: 'finance', purpose: 'Bills we send' }] })
    const invoices = config.entities.find(entity => entity.id === 'invoices')!
    expect(invoices.fields.length).toBeGreaterThan(3)
    expect(invoices.fields.some(field => field.type === 'currency')).toBe(true)
  })

  it('does not duplicate or weaken catalog fields when fallback inference matches an existing entity', () => {
    const config = workspace({ entities: [{ name: 'Work orders', module: 'field-service', purpose: 'Jobs at customer homes' }] })
    const workOrders = config.entities.find(entity => entity.id === 'work-orders')!
    const labels = workOrders.fields.map(field => `${field.type}:${field.label.toLowerCase()}`)

    expect(workOrders.fields.map(field => field.id)).not.toContain('name')
    expect(new Set(labels).size).toBe(labels.length)
    expect(workOrders.fields.find(field => field.id === 'status')?.options).toEqual(expect.arrayContaining(['Scheduled', 'Dispatched', 'In progress', 'Cancelled']))
  })

  it('does not let two companies in the same trade end up with the same record', () => {
    const plumber = workspace({
      entities: [{ name: 'Jobs', module: 'field-service', purpose: 'Visits', fields: [
        { label: 'Reference', type: 'text', required: true }, { label: 'Boiler make', type: 'text' }, { label: 'Gas safe number', type: 'text' }, { label: 'Fee', type: 'currency' },
      ] }],
    })
    const electrician = workspace({
      entities: [{ name: 'Jobs', module: 'field-service', purpose: 'Visits', fields: [
        { label: 'Reference', type: 'text', required: true }, { label: 'Consumer unit', type: 'text' }, { label: 'Certificate number', type: 'text' }, { label: 'Fee', type: 'currency' },
      ] }],
    })
    // Found by the name the company used, not by id: "Jobs" is recognised as the trade's existing
    // record type and merged onto it, which is correct — what matters is that the merge keeps the
    // fields this particular company asked for rather than flattening both to the same form.
    const fieldsOf = (config: ReturnType<typeof workspace>) => config.entities.find(entity => entity.pluralLabel === 'Jobs')!.fields.map(field => field.id)
    expect(fieldsOf(plumber)).toContain('gas-safe-number')
    expect(fieldsOf(electrician)).toContain('certificate-number')
    expect(fieldsOf(plumber).sort().join(',')).not.toBe(fieldsOf(electrician).sort().join(','))
  })
})
