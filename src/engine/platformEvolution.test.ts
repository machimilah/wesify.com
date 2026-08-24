import { describe, expect, it } from 'vitest'
import {
  capabilityGaps,
  deliveryRoadmap,
  implementationArchitecture,
  platformPatternIdCatalog,
  reusablePlatformPatterns,
  sourceMappings,
  type SourceDisposition,
} from '../data/platformEvolution'

describe('platform evolution registry', () => {
  it('classifies every source concept with every supported disposition represented', () => {
    const dispositions: SourceDisposition[] = ['use-directly', 'generalize', 'adapt', 'industry-module', 'jurisdiction-module', 'do-not-use', 'future']
    expect(new Set(sourceMappings.map(item => item.id)).size).toBe(sourceMappings.length)
    expect(new Set(sourceMappings.map(item => item.disposition))).toEqual(new Set(dispositions))
    expect(sourceMappings.every(item => item.implementationRefs.length > 0 && item.userCapability && item.rationale)).toBe(true)
  })

  it('keeps Dominican payroll outside executable platform behavior', () => {
    const payroll = sourceMappings.find(item => item.id === 'local-payroll')
    expect(payroll?.disposition).toBe('jurisdiction-module')
    expect(payroll?.platformPrimitive).toMatch(/connector contract only/i)
    expect(capabilityGaps.flatMap(item => item.capabilityIds)).not.toContain('people.payroll')
  })

  it('tracks the requested modern capability areas and honest delivery horizons', () => {
    const ids = capabilityGaps.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining([
      'saas', 'ecommerce', 'professional-services', 'subscriptions', 'marketing',
      'product-management', 'software-development', 'cybersecurity', 'legal-ops',
      'knowledge-management', 'data-governance', 'api-integration', 'ai-governance',
      'agent-permissions', 'agent-evaluation', 'human-in-loop', 'multi-company',
      'international', 'localization',
    ]))
    expect(capabilityGaps.find(item => item.id === 'multi-company')).toEqual(expect.objectContaining({ status: 'planned', horizon: 'long-term' }))
  })

  it('exposes only reusable platform ids in the compounding registry', () => {
    expect(reusablePlatformPatterns.length).toBeGreaterThan(30)
    expect(reusablePlatformPatterns.every(item => Object.keys(item).sort().join(',') === 'capabilityIds,id,kind')).toBe(true)
    expect(reusablePlatformPatterns.every(item => /^[a-z][a-z0-9-]+$/.test(item.id))).toBe(true)
    expect(JSON.stringify(reusablePlatformPatterns)).not.toMatch(/workspace|companyId|conversation|recordValue|token/i)
    expect(reusablePlatformPatterns.every(item => platformPatternIdCatalog[item.kind].includes(item.id))).toBe(true)
    for (const kind of ['process', 'kpi', 'schema', 'automation', 'diagnostic'] as const) {
      expect(new Set(platformPatternIdCatalog[kind])).toEqual(new Set(reusablePlatformPatterns.filter(item => item.kind === kind).map(item => item.id)))
    }
  })

  it('covers the implementation layers and staged product outcomes', () => {
    expect(implementationArchitecture.map(item => item.id)).toEqual(expect.arrayContaining([
      'frontend', 'backend', 'database', 'business-model', 'events', 'workflow', 'automation',
      'agents-llm', 'memory-retrieval', 'graph', 'permissions-auth', 'audit-versioning',
      'apis-connectors', 'realtime', 'observability-security',
    ]))
    expect(new Set(deliveryRoadmap.map(item => item.horizon))).toEqual(new Set(['mvp', 'next', 'long-term']))
    expect(deliveryRoadmap.every(item => item.artifacts.length > 0 && item.exitCriteria.length > 0)).toBe(true)
  })
})
