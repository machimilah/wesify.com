import { describe, expect, it } from 'vitest'
import { resolveIndustry, taxonomySize } from './industryResolver'
import { subsectorArchetypes } from '../data/industryTaxonomy'
import { naicsSubsectors } from '../data/naics.generated'
import { industryCapabilityPacks, planCapabilities } from './capabilityCatalog'
import { researchBusiness } from './businessResearch'
import { emptyArchitecture, emptyBusinessState } from './businessDiscovery'

describe('industry taxonomy', () => {
  it('carries the full published taxonomy', () => {
    expect(taxonomySize.sectors).toBe(20)
    expect(taxonomySize.subsectors).toBe(96)
    expect(taxonomySize.titles).toBeGreaterThan(1500)
  })

  it('maps every subsector to a real operating base', () => {
    const packIds = new Set(industryCapabilityPacks.map(pack => pack.id))
    for (const subsector of naicsSubsectors) {
      const archetype = subsectorArchetypes[subsector.code]
      expect(archetype, `${subsector.code} ${subsector.title} has no archetype`).toBeTruthy()
      expect(packIds.has(archetype), `${subsector.code} maps to unknown pack ${archetype}`).toBe(true)
    }
  })

  it('has no archetype mapping for a code that is not a subsector', () => {
    const codes = new Set(naicsSubsectors.map(item => item.code))
    for (const code of Object.keys(subsectorArchetypes)) expect(codes.has(code), `${code} is not a NAICS subsector`).toBe(true)
  })
})

describe('industry resolver', () => {
  it.each([
    ['We run a nail salon in town.', 'personal-services'],
    ['I own a dairy farm with 200 cows.', 'agriculture'],
    ['We are a title abstract and settlement office.', 'professional-services'], // NAICS 541191
    ['We operate a quarry and crush aggregate.', 'extraction'],
    ['We run a funeral home.', 'personal-services'],
    ['We are a book publisher.', 'media'],
    ['We run a bowling centre.', 'events'],
    ['We are a temporary staffing agency.', 'facilities'],
  ])('classifies %j as %s', (description, archetype) => {
    const match = resolveIndustry(description)
    expect(match, `${description} did not resolve`).not.toBeNull()
    expect(match!.archetype).toBe(archetype)
    expect(match!.confidence).toBeGreaterThan(0.45)
    expect(match!.evidence.length).toBeGreaterThan(0)
  })

  it('refuses to classify on a single incidental word', () => {
    expect(resolveIndustry('We have products.')).toBeNull()
    expect(resolveIndustry('')).toBeNull()
  })

  it('reports where a match sits in the taxonomy', () => {
    const match = resolveIndustry('We run a veterinary clinic for pets.')
    expect(match).not.toBeNull()
    expect(match!.subsector).toHaveLength(3)
    expect(match!.sectorTitle.length).toBeGreaterThan(0)
    expect(match!.subsectorTitle.length).toBeGreaterThan(0)
  })
})

describe('taxonomy feeding the researcher', () => {
  it('gives a business with no hand-written signal a real archetype and base', () => {
    const description = 'We run a bowling centre and host league nights.'
    const research = researchBusiness({ text: description })
    expect(research.archetype?.id).toBe('events')
    expect(research.archetype?.evidence).toMatch(/classified as/)

    const state = { ...emptyBusinessState(), companySummary: description, industry: 'Bowling centre' }
    const plan = planCapabilities(state, emptyArchitecture())
    expect(plan.pack?.id).toBe('events')
    expect(plan.selected.map(item => item.id)).toEqual(expect.arrayContaining(['crm.contacts', 'work.scheduling']))
  })

  it('leaves hand-written signals in charge when they match', () => {
    const research = researchBusiness({ text: 'We run a marketing agency for technology companies.' })
    expect(research.archetype?.id).toBe('agency')
    expect(research.archetype?.evidence).not.toMatch(/classified as/)
  })
})
