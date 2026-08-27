import { describe, expect, it } from 'vitest'
import { archetypesFromLabels, detectArchetypes, mergeArchetypes, operatingArchetypes, reconcileArchetypes } from './archetypes'

/**
 * A company is more than one kind of business, and saying so is what stops whole operations going
 * missing. Everything downstream of this — which APQC processes are required, whether SCOR and
 * ISA-95 apply at all, which events the workspace is tested against — is keyed on these ids.
 */
describe('operating archetypes', () => {
  it('finds every operating model a description supports, not the closest single one', () => {
    const detected = detectArchetypes('We import green coffee in containers, roast it ourselves, sell wholesale to cafes by the case, and run one shop of our own.')
    const ids = detected.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining(['importer', 'wholesaler', 'retailer']))
    // Each one carries the words that put it there, so a conclusion can be shown with its evidence.
    for (const item of detected) expect(item.evidence.length + (item.basis === 'derived' ? 1 : 0)).toBeGreaterThan(0)
  })

  it('gives no archetype to something that is not a business', () => {
    expect(detectArchetypes('I want to keep track of my school work: assignments, classes and deadlines.')).toEqual([])
  })

  it('reads an archetype from a selected capability when nobody used the word', () => {
    const detected = detectArchetypes('We put the parts together and send them out.', ['manufacturing.production', 'manufacturing.bom'])
    const manufacturer = detected.find(item => item.id === 'manufacturer')
    expect(manufacturer).toBeTruthy()
    expect(manufacturer?.basis).toBe('derived')
  })

  it('is more certain about two words than about one', () => {
    const once = detectArchetypes('We do consulting.').find(item => item.id === 'professional-services')
    const twice = detectArchetypes('A consultancy doing advisory and consulting work, all billable.').find(item => item.id === 'professional-services')
    expect(twice!.confidence).toBeGreaterThan(once!.confidence)
  })

  it('does not let a stray word give a solo operator a second location', () => {
    const detected = detectArchetypes('Just me, I work alone, and I sometimes deliver to our stores.')
    expect(detected.map(item => item.id)).toContain('multi-location')
    expect(reconcileArchetypes(detected).map(item => item.id)).not.toContain('multi-location')
  })

  it('resolves the archetypes the architect names in the company own words', () => {
    const stated = archetypesFromLabels(['Manufacturer', 'sells to businesses', 'we import', 'something nobody has heard of'])
    expect(stated.map(item => item.id)).toEqual(['manufacturer', 'b2b', 'importer'])
    expect(stated.every(item => item.basis === 'stated')).toBe(true)
  })

  it('keeps what the architect concluded and adds what it did not think to name', () => {
    const merged = mergeArchetypes(archetypesFromLabels(['Manufacturer']), detectArchetypes('We manufacture and we also export to overseas customers.'))
    expect(merged.filter(item => item.id === 'manufacturer')).toHaveLength(1)
    expect(merged.map(item => item.id)).toContain('exporter')
  })

  it('describes what every archetype means for how the company runs', () => {
    for (const item of operatingArchetypes) {
      expect(item.meaning.length, item.id).toBeGreaterThan(20)
      expect(item.signals.length, item.id).toBeGreaterThan(0)
    }
  })
})
