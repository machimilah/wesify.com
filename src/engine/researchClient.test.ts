import { describe, expect, it } from 'vitest'
import { applyFrontierArchitecture, mergeFrontierResearch, type FrontierResearch } from './researchClient'
import { researchBusiness } from './businessResearch'
import { emptyArchitecture } from './businessDiscovery'

const frontier: FrontierResearch = {
  model: 'claude-opus-5',
  brief: 'Full research brief.',
  archetype: { id: 'field-service', label: 'Field service', confidence: 0.9 },
  summary: 'Dispatch-led plumbing operation billing on completion.',
  findings: [
    { conclusion: 'Technicians are dispatched to customer sites', because: 'Trade association guidance on dispatch operations', implication: 'Wesify is connecting work orders, technicians, and the assets they service.', basis: 'researched', confidence: 0.85, sourceUrl: 'https://example.org/field-service', capabilityIds: ['service.field-work', 'work.scheduling'] },
    { conclusion: 'Parts are bought per job rather than stocked', because: 'You said parts are ordered when a job is booked', implication: 'Wesify is connecting suppliers and purchase orders to the work that consumes them.', basis: 'stated', confidence: 0.95, sourceUrl: '', capabilityIds: ['procurement.purchasing'] },
  ],
  capabilityIds: ['service.field-work', 'work.scheduling', 'procurement.purchasing'],
  excludedCapabilityIds: ['manufacturing.production'],
  openQuestion: { text: 'Do technicians carry stock in their vans?', reason: 'Decides van inventory.', suggestedAnswers: ['Yes', 'No'] },
  sources: [{ title: 'Field service operations', url: 'https://example.org/field-service' }],
}

describe('frontier research client', () => {
  it('is a no-op when the frontier tier is unavailable', () => {
    const local = researchBusiness({ text: 'We are a plumbing company.' })
    expect(mergeFrontierResearch(local, null)).toBe(local)
    const architecture = emptyArchitecture()
    expect(applyFrontierArchitecture(architecture, null)).toBe(architecture)
  })

  it('puts researched conclusions ahead of local ones without crediting where it read them', () => {
    const local = researchBusiness({ text: 'We are a plumbing company. Technicians visit customer homes and we invoice when the job is done.' })
    const merged = mergeFrontierResearch(local, frontier)
    expect(merged.findings[0].conclusion).toBe('Technicians are dispatched to customer sites')
    expect(merged.findings[0].basis).toBe('researched')
    // The conclusion travels; the address it was read at does not. A citation invites an audit and
    // tells anyone looking over the operator's shoulder how the workspace was arrived at.
    expect(merged.findings[0].because).not.toMatch(/https?:/)
    expect(merged.findings.length).toBeGreaterThan(frontier.findings.length)
    expect(merged.archetype?.label).toBe('Field service')
  })

  it('lets researched exclusions override researched inclusions', () => {
    const local = researchBusiness({ text: 'We manufacture and install pumps.' })
    const merged = mergeFrontierResearch(local, { ...frontier, capabilityIds: [...frontier.capabilityIds, 'manufacturing.production'] })
    expect(merged.include.map(item => item.capabilityId)).not.toContain('manufacturing.production')
    expect(merged.exclude.map(item => item.capabilityId)).toContain('manufacturing.production')
  })

  it('merges researched capability decisions into the architecture Wesify compiles', () => {
    const architecture = { ...emptyArchitecture(), capabilityIds: ['crm.contacts', 'manufacturing.production'], excludedCapabilityIds: ['people.payroll'] }
    const applied = applyFrontierArchitecture(architecture, frontier)
    expect(applied.capabilityIds).toEqual(expect.arrayContaining(['crm.contacts', 'service.field-work', 'work.scheduling', 'procurement.purchasing']))
    expect(applied.capabilityIds).not.toContain('manufacturing.production')
    expect(applied.excludedCapabilityIds).toEqual(expect.arrayContaining(['people.payroll', 'manufacturing.production']))
    expect(applied.explanation).toBe(frontier.summary)
  })
})
