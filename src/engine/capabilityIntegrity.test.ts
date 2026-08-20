import { describe, expect, it } from 'vitest'
import { capabilityById, capabilityCatalog } from './capabilityCatalog'
import { moduleIds } from './blueprint'

/**
 * Structural integrity of the whole capability catalog.
 *
 * The industry-pack test only reaches capabilities some pack selects. These checks cover every
 * definition, including ones only ever reached by a signal or by the AI naming them directly — which
 * is exactly where a broken relation or a metric pointing at a field that does not exist would hide.
 */

/** Entity ids a capability can legitimately reference: its own, plus everything it depends on. */
function reachableEntityIds(id: string, seen = new Set<string>()): Set<string> {
  const definition = capabilityById.get(id)
  if (!definition || seen.has(id)) return new Set()
  seen.add(id)
  const ids = new Set(definition.entities.map(entity => entity.id))
  for (const dependency of definition.dependencies) for (const entityId of reachableEntityIds(dependency, seen)) ids.add(entityId)
  return ids
}

describe('capability catalog integrity', () => {
  it('covers the ERP and CRM surface', () => {
    expect(capabilityCatalog.length).toBeGreaterThanOrEqual(120)
  })

  it('has unique capability, entity, page and metric ids', () => {
    const capabilityIdList = capabilityCatalog.map(item => item.id)
    expect(new Set(capabilityIdList).size, 'duplicate capability id').toBe(capabilityIdList.length)
    const pageIds = capabilityCatalog.flatMap(item => item.pages.map(page => page.id))
    expect(new Set(pageIds).size, `duplicate page id: ${pageIds.filter((id, index) => pageIds.indexOf(id) !== index).join(', ')}`).toBe(pageIds.length)
    const metricIds = capabilityCatalog.flatMap(item => (item.metrics ?? []).map(metric => metric.id))
    expect(new Set(metricIds).size, `duplicate metric id: ${metricIds.filter((id, index) => metricIds.indexOf(id) !== index).join(', ')}`).toBe(metricIds.length)
  })

  it('declares a valid module and at least one signal, entity and page', () => {
    for (const item of capabilityCatalog) {
      expect(moduleIds, `${item.id} has an unknown module`).toContain(item.module)
      expect(item.signals.length, `${item.id} has no signals`).toBeGreaterThan(0)
      expect(item.entities.length, `${item.id} has no entities`).toBeGreaterThan(0)
      expect(item.pages.length, `${item.id} has no pages`).toBeGreaterThan(0)
      expect(item.description.length, `${item.id} has no description`).toBeGreaterThan(10)
    }
  })

  it('resolves every dependency, with no cycles', () => {
    for (const item of capabilityCatalog) {
      for (const dependency of item.dependencies) {
        expect(capabilityById.has(dependency), `${item.id} depends on unknown ${dependency}`).toBe(true)
      }
      const walk = (id: string, path: string[]): void => {
        expect(path.includes(id), `dependency cycle: ${[...path, id].join(' -> ')}`).toBe(false)
        for (const next of capabilityById.get(id)?.dependencies ?? []) walk(next, [...path, id])
      }
      walk(item.id, [])
    }
  })

  it('points every relation at an entity the capability actually brings', () => {
    // Collected rather than asserted one at a time: a dangling relation is usually a class of
    // mistake, and seeing all of them at once is the difference between one fix and twenty runs.
    const dangling: string[] = []
    for (const item of capabilityCatalog) {
      const reachable = reachableEntityIds(item.id)
      for (const entity of item.entities) {
        for (const field of entity.fields) {
          if (field.type !== 'relation' || !field.relationEntityId) continue
          if (!reachable.has(field.relationEntityId)) dangling.push(`${item.id} :: ${entity.id}.${field.id} -> ${field.relationEntityId}`)
        }
      }
    }
    expect(dangling, `relations with no capability providing the target: ${dangling.join(' | ')}`).toEqual([])
  })

  it('points every page, metric and workflow at a field that exists', () => {
    for (const item of capabilityCatalog) {
      const entities = new Map(item.entities.map(entity => [entity.id, entity]))
      for (const page of item.pages) {
        expect(entities.has(page.entityId), `${item.id} page ${page.id} points at unknown entity ${page.entityId}`).toBe(true)
      }
      for (const metric of item.metrics ?? []) {
        const entity = entities.get(metric.entityId)
        expect(entity, `${item.id} metric ${metric.id} points at unknown entity ${metric.entityId}`).toBeTruthy()
        if (metric.field) {
          expect(entity!.fields.some(field => field.id === metric.field), `${item.id} metric ${metric.id} sums missing field ${metric.field}`).toBe(true)
        }
        if (metric.statusNotEquals) {
          const status = entity!.fields.find(field => field.id === 'status')
          expect(status?.options, `${item.id} metric ${metric.id} filters status on an entity without one`).toBeTruthy()
          expect(status!.options, `${item.id} metric ${metric.id} filters on status "${metric.statusNotEquals}", which is not an option`).toContain(metric.statusNotEquals)
        }
      }
      for (const workflow of item.workflows ?? []) {
        const entity = entities.get(workflow.entityId)
        expect(entity, `${item.id} workflow ${workflow.id} points at unknown entity ${workflow.entityId}`).toBeTruthy()
        if (workflow.field) {
          const field = entity!.fields.find(candidate => candidate.id === workflow.field)
          expect(field, `${item.id} workflow ${workflow.id} triggers on missing field ${workflow.field}`).toBeTruthy()
          if (workflow.equals && field?.options) {
            expect(field.options, `${item.id} workflow ${workflow.id} triggers on "${workflow.equals}", which is not an option`).toContain(workflow.equals)
          }
        }
      }
    }
  })

  it('uses signals specific enough not to fire on an unrelated business', () => {
    // A signal is substring-matched against everything the company said, so a bare common word would
    // attach a whole system to a business that never mentioned it.
    const tooCommon = new Set(['work', 'job', 'jobs', 'plan', 'report', 'account', 'accounts', 'thing', 'stuff', 'data', 'system'])
    const offenders: string[] = []
    for (const item of capabilityCatalog) {
      for (const signal of item.signals) {
        expect(signal.length, `${item.id} has an empty signal`).toBeGreaterThan(2)
        if (tooCommon.has(signal)) offenders.push(`${item.id} :: "${signal}"`)
      }
    }
    expect(offenders, `signals too generic to be evidence: ${offenders.join(' | ')}`).toEqual([])
  })
})
