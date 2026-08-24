import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyArchitecture } from './businessDiscovery'
import { applyIndustryVerdict, loadIndustryVerdict, type IndustryVerdict } from './industryClient'

const verdict = (overrides: Partial<IndustryVerdict> = {}): IndustryVerdict => ({
  subsector: '541',
  label: 'Professional services',
  companies: 5,
  include: [],
  exclude: [],
  sources: [],
  patterns: [],
  ...overrides,
})
afterEach(() => vi.restoreAllMocks())

describe('privacy-safe industry patterns', () => {
  it('turns a stable known platform pattern into capabilities', () => {
    const architecture = { ...emptyArchitecture(), capabilityIds: ['crm.contacts'] }
    const next = applyIndustryVerdict(architecture, verdict({
      patterns: [{ kind: 'kpi', patternId: 'days-to-collect', companies: 5, adoptionShare: 1, reason: 'adopted' }],
    }))

    expect(next.capabilityIds).toEqual(expect.arrayContaining(['crm.contacts', 'finance.invoicing', 'finance.payments']))
  })

  it('ignores unknown pattern ids and lets explicit exclusions win', () => {
    const architecture = { ...emptyArchitecture(), capabilityIds: ['crm.contacts'] }
    const next = applyIndustryVerdict(architecture, verdict({
      exclude: [{ capabilityId: 'finance.payments', basis: 'observed', reason: 'removed' }],
      patterns: [
        { kind: 'kpi', patternId: 'days-to-collect', companies: 5, adoptionShare: 1, reason: 'adopted' },
        { kind: 'process', patternId: 'company-private-free-text', companies: 5, adoptionShare: 1, reason: 'invalid' },
      ],
    }))

    expect(next.capabilityIds).toContain('finance.invoicing')
    expect(next.capabilityIds).not.toContain('finance.payments')
    expect(next.excludedCapabilityIds).toContain('finance.payments')
  })

  it('loads a pattern-only verdict so later companies can benefit from it', async () => {
    const response = verdict({ patterns: [{ kind: 'process', patternId: 'collections', companies: 5, adoptionShare: 0.8, reason: 'adopted' }] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }))

    await expect(loadIndustryVerdict('541')).resolves.toEqual(response)
  })
})
