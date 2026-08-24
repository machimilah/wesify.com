import { describe, expect, it } from 'vitest'
import { researchBusiness } from './businessResearch'
import { emptyArchitecture, emptyBusinessState } from './businessDiscovery'
import { planCapabilities } from './capabilityCatalog'

describe('business researcher', () => {
  it('reads the operating model out of one sentence and cites the evidence for each conclusion', () => {
    const research = researchBusiness({ text: 'I run a marketing agency managing recurring campaigns for technology companies.' })
    expect(research.archetype?.id).toBe('agency')
    const byDimension = Object.fromEntries(research.readings.map(reading => [reading.dimensionId, reading]))
    expect(byDimension.offering.optionId).toBe('services')
    expect(byDimension.revenue.optionId).toBe('recurring')
    expect(byDimension.customer.optionId).toBe('business')
    for (const finding of research.findings) {
      expect(finding.because.length).toBeGreaterThan(0)
      expect(finding.implication).toMatch(/BO is /)
    }
    expect(research.include.map(item => item.capabilityId)).toEqual(expect.arrayContaining(['subscriptions.billing', 'crm.contacts', 'finance.invoicing']))
  })

  it('never counts a domain default as an answer', () => {
    const research = researchBusiness({ text: 'We are a construction company.' })
    const supply = research.readings.find(reading => reading.dimensionId === 'supply')
    expect(supply?.basis).toBe('domain-default')
    expect(research.include.map(item => item.capabilityId)).not.toContain('procurement.purchasing')
  })

  /**
   * The researcher reads; it does not ask.
   *
   * It used to also carry a written question per dimension, and those were what the operator met
   * whenever a model was unreachable — "What does your company sell or deliver?", put to someone who
   * had just said what they sell. Every question now comes from a model that read the conversation,
   * so the strings are gone rather than merely unused: a bank that still exists is a bank something
   * eventually asks from again.
   */
  it('carries no written questions of its own', () => {
    const research = researchBusiness({ text: 'We install and repair heating systems.' }) as unknown as Record<string, unknown>
    expect(research.questions).toBeUndefined()
    expect(JSON.stringify(research)).not.toMatch(/\?/)
  })

  it('turns a stated exclusion into a hard exclusion the planner respects', () => {
    const research = researchBusiness({ text: 'We are a solo consultancy. Services only, we do not hold stock.' })
    const excluded = research.exclude.map(item => item.capabilityId)
    expect(excluded).toEqual(expect.arrayContaining(['inventory.stock', 'people.payroll', 'people.recruiting']))
    expect(research.include.map(item => item.capabilityId)).not.toContain('inventory.stock')

    const state = { ...emptyBusinessState(), companySummary: 'We are a solo consultancy. Services only, we do not hold stock.', industry: 'Consulting' }
    const plan = planCapabilities(state, emptyArchitecture())
    const ids = plan.selected.map(item => item.id)
    expect(ids).not.toEqual(expect.arrayContaining(['inventory.stock', 'people.payroll', 'people.recruiting', 'people.time-off']))
    expect(ids).toEqual(expect.arrayContaining(['crm.contacts', 'finance.invoicing']))
  })

  it('reaches a different operating model for a field-service company than for an agency', () => {
    const field = researchBusiness({ text: 'We are a plumbing company. Technicians visit customer homes, we buy parts from suppliers and invoice when the job is done.' })
    const agency = researchBusiness({ text: 'We are a design agency running monthly retainer campaigns for other businesses.' })
    const fieldIds = field.include.map(item => item.capabilityId)
    const agencyIds = agency.include.map(item => item.capabilityId)
    expect(fieldIds).toEqual(expect.arrayContaining(['service.field-work', 'work.scheduling', 'procurement.purchasing']))
    expect(agencyIds).toEqual(expect.arrayContaining(['subscriptions.billing']))
    expect(agencyIds).not.toEqual(expect.arrayContaining(['service.field-work', 'procurement.purchasing']))
    expect(field.coverage).toBeGreaterThan(agency.coverage - 1)
  })

  it('reports how much of the operating model is actually resolved', () => {
    const thin = researchBusiness({ text: 'I run a business.' })
    const rich = researchBusiness({ text: 'We are a manufacturer. We produce pumps in our factory, buy raw materials from suppliers, ship goods to other businesses, invoice per project, and run shift crews. Contracts are signed before production.' })
    expect(thin.coverage).toBeLessThan(rich.coverage)
    expect(rich.coverage).toBeGreaterThan(0.6)
  })

  it('reports gap candidates without silently selecting their capabilities', () => {
    const research = researchBusiness({ text: 'We want a KPI dashboard for management.' })
    expect(research.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'operational-reporting', classification: 'future' })]))
    expect(research.include.map(item => item.capabilityId)).not.toContain('analytics.reporting')
  })
})
