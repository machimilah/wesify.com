import { describe, expect, it } from 'vitest'
import { classifyWorkspaceIntent, executeWorkspaceAction, interpretWorkspaceCommand, type WorkspaceRecords } from './workspaceActions'
import { emptyArchitecture, emptyBusinessState, architectureToBlueprint } from './businessDiscovery'
import { resilientArchitecture } from './discoveryModel'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'

/**
 * This is the code that changes an operator's data.
 *
 * The assistant hands it whatever a model decided, and it edits records and the workspace structure
 * with no round trip. Everything else in Wesify can be wrong and cost someone a page they did not want;
 * being wrong here costs them their work. It had no tests at all.
 */

const summary = 'We run a plumbing service business. Technicians visit customer homes, we buy parts from suppliers, and customers pay on completion.'
function workspace() {
  const state = { ...emptyBusinessState(), companySummary: summary, industry: summary }
  const architecture = resilientArchitecture(state, emptyArchitecture())
  return generateWorkspaceConfigurationFromDiscovery({ companyDescription: summary }, architectureToBlueprint(architecture), state, architecture)
}

const config = workspace()
const firstEntity = config.entities[0]
const other = config.entities[1]

describe('changing records', () => {
  it('creates a record with an id and timestamps the workspace can sort by', () => {
    const result = executeWorkspaceAction(config, {}, { type: 'create_record', entityId: firstEntity.id, values: { name: 'ACME' } })
    const [record] = result.records[firstEntity.id]
    expect(record.id).toBeTruthy()
    expect(record.createdAt).toBeTruthy()
    expect(record.updatedAt).toBeTruthy()
    expect(record.name).toBe('ACME')
  })

  it('never lets supplied values overwrite the record identity', () => {
    // The values come from a model. If it emits an id or a createdAt, taking them would let one
    // request rewrite the identity of a record that already exists.
    const result = executeWorkspaceAction(config, {}, { type: 'create_record', entityId: firstEntity.id, values: { id: 'forged', createdAt: 'yesterday', name: 'ACME' } as never })
    const [record] = result.records[firstEntity.id]
    expect(record.id, 'a supplied id must not become the record id').not.toBe('forged')
    expect(record.createdAt, 'a supplied createdAt must not become the record timestamp').not.toBe('yesterday')
  })

  it('touches only the record it was told to touch', () => {
    const before: WorkspaceRecords = { [firstEntity.id]: [
      { id: 'a', createdAt: '1', updatedAt: '1', name: 'Keep me' },
      { id: 'b', createdAt: '1', updatedAt: '1', name: 'Change me' },
    ] }
    const after = executeWorkspaceAction(config, before, { type: 'update_record', entityId: firstEntity.id, recordId: 'b', values: { name: 'Changed' } })
    expect(after.records[firstEntity.id].find(item => item.id === 'a')?.name).toBe('Keep me')
    expect(after.records[firstEntity.id].find(item => item.id === 'b')?.name).toBe('Changed')
    expect(before[firstEntity.id][1].name, 'the original records must not be mutated in place').toBe('Change me')
  })

  it('leaves other entities alone when one is edited', () => {
    const before: WorkspaceRecords = {
      [firstEntity.id]: [{ id: 'a', createdAt: '1', updatedAt: '1', name: 'One' }],
      [other.id]: [{ id: 'z', createdAt: '1', updatedAt: '1', name: 'Untouched' }],
    }
    const after = executeWorkspaceAction(config, before, { type: 'delete_record', entityId: firstEntity.id, recordId: 'a' })
    expect(after.records[firstEntity.id]).toHaveLength(0)
    expect(after.records[other.id], 'deleting from one collection emptied another').toHaveLength(1)
  })

  it('does nothing when asked to change a record that is not there', () => {
    const before: WorkspaceRecords = { [firstEntity.id]: [{ id: 'a', createdAt: '1', updatedAt: '1', name: 'One' }] }
    const missing = executeWorkspaceAction(config, before, { type: 'update_record', entityId: firstEntity.id, recordId: 'nope', values: { name: 'X' } })
    expect(missing.records[firstEntity.id]).toHaveLength(1)
    expect(missing.records[firstEntity.id][0].name).toBe('One')
  })
})

describe('changing the workspace itself', () => {
  it('keeps the records when a capability is removed', () => {
    // Removing a system hides its pages. The data behind them is the operator's, and Wesify says so in
    // the message it returns — so it had better be true.
    const entity = config.entities.find(item => item.capabilityId) ?? firstEntity
    const before: WorkspaceRecords = { [entity.id]: [{ id: 'a', createdAt: '1', updatedAt: '1', name: 'Real work' }] }
    const after = executeWorkspaceAction(config, before, {
      type: 'deactivate_capability', capabilityId: entity.capabilityId ?? 'unknown', capabilityLabel: 'Something',
      entityIds: [entity.id], metricIds: [], workflowIds: [],
    })
    expect(after.records[entity.id], 'removing a capability deleted the operator’s records').toHaveLength(1)
    expect(after.config.entities.some(item => item.id === entity.id)).toBe(false)
    expect(after.message).toMatch(/preserved/i)
  })

  it('leaves no navigation pointing at a page that no longer exists', () => {
    const entity = config.entities.find(item => item.capabilityId) ?? firstEntity
    const after = executeWorkspaceAction(config, {}, {
      type: 'deactivate_capability', capabilityId: entity.capabilityId ?? 'unknown', capabilityLabel: 'Something',
      entityIds: [entity.id], metricIds: [], workflowIds: [],
    })
    const viewIds = new Set(after.config.views.map(view => view.id))
    for (const item of after.config.navigation) {
      if (item.viewId) expect(viewIds.has(item.viewId), `${item.label} points at a view that was removed`).toBe(true)
    }
    for (const metric of after.config.metrics) {
      expect(after.config.entities.some(candidate => candidate.id === metric.entityId), `${metric.label} counts records that no longer exist`).toBe(true)
    }
    for (const workflow of after.config.workflows) {
      expect(after.config.entities.some(candidate => candidate.id === workflow.trigger.entityId), `${workflow.name} triggers on records that no longer exist`).toBe(true)
    }
    for (const kpi of after.config.kpis ?? []) for (const source of kpi.dataSources) {
      expect(after.config.entities.some(candidate => candidate.id === source.entityId), `${kpi.name} reads an entity that no longer exists`).toBe(true)
    }
  })

  it('adds a field without disturbing the fields already there', () => {
    const after = executeWorkspaceAction(config, {}, { type: 'add_field', entityId: firstEntity.id, field: { id: 'tier', label: 'Tier', type: 'text', required: false } })
    const updated = after.config.entities.find(item => item.id === firstEntity.id)!
    expect(updated.fields).toHaveLength(firstEntity.fields.length + 1)
    expect(updated.fields.slice(0, firstEntity.fields.length)).toEqual(firstEntity.fields)
  })
})

describe('reading a typed command', () => {
  it('separates asking from doing', () => {
    expect(classifyWorkspaceIntent('how many clients do we have')).toBe('BUSINESS_QUERY')
    expect(classifyWorkspaceIntent('add a client called ACME')).toBe('BUSINESS_ACTION')
  })

  it('asks rather than guesses when the command names nothing it knows', () => {
    const result = interpretWorkspaceCommand('do the thing', config, {})
    expect(result.action, 'Wesify acted on a command it did not understand').toBeUndefined()
    expect(result.message).toBeTruthy()
  })

  it('says something rather than nothing when given an empty command', () => {
    expect(interpretWorkspaceCommand('   ', config, {}).message).toBeTruthy()
  })

  it('routes a destructive command through a preview', () => {
    const label = firstEntity.pluralLabel.toLowerCase()
    const result = interpretWorkspaceCommand(`delete all ${label}`, config, {})
    if (result.action) expect(result.needsPreview, 'a destructive command must not execute unseen').toBe(true)
  })
})
