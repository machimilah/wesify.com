// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { askWorkspaceAgent, type WorkspaceAgentResponse } from './workspaceAgent'
import type { BusinessRecord } from './workspaceActions'
import type { WorkspaceConfiguration } from './workspaceSchema'

/**
 * The gate between what a model says and what happens to a workspace.
 *
 * `askWorkspaceAgent` takes free text and turns it into an action against real records. Everything
 * dangerous about BO is on the other side of this function: a model that invents an entity id, a
 * field that does not exist, or a record id it has not seen must produce nothing at all, not an
 * approximate action against approximately the right data.
 *
 * The model is not called here. The same mock hook the browser suites use stands in for it, so what
 * is under test is the translation and its refusals rather than a model's mood.
 */

const config = {
  version: 1,
  id: 'ws-agent',
  profile: { companyName: 'Test Co', industry: 'Testing' },
  capabilities: [],
  entities: [
    {
      id: 'clients', label: 'Client', pluralLabel: 'Clients', module: 'customers', primaryField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'value', label: 'Value', type: 'currency' },
        { id: 'active', label: 'Active', type: 'boolean' },
      ],
    },
  ],
  views: [{ id: 'clients-table', label: 'Clients', entityId: 'clients', type: 'table', columns: ['name'] }],
  navigation: [{ id: 'home', label: 'Dashboard', kind: 'home' }, { id: 'clients', label: 'Clients', kind: 'entity', viewId: 'clients-table', module: 'customers' }],
  workflows: [],
  roles: [],
  metrics: [],
  modules: ['customers'],
} as unknown as WorkspaceConfiguration

// Typed through the agent's own response shape, so a change to what a model may return breaks this
// file rather than letting it drift into testing a shape that no longer exists.
type ModelAction = WorkspaceAgentResponse['action']

const emptyAction: ModelAction = {
  kind: 'none', entityId: '', recordId: '', navigationId: '', collectionName: '', capabilityId: '', values: [],
  field: { id: '', label: '', type: 'text', required: false },
  workflow: { name: '', entityId: '', event: 'created', conditionField: '', conditionEquals: '', message: '' },
}

/** Drives the agent with exactly the response a model would have returned. */
async function withResponse(action: Partial<ModelAction>, decision: WorkspaceAgentResponse['decision'] = 'EXECUTE') {
  window.__BO_WORKSPACE_AGENT_MOCK__ = async () => ({ decision, message: 'ok', action: { ...emptyAction, ...action } })
  return askWorkspaceAgent('anything', config, { clients: [{ id: 'rec-1', name: 'ACME' } as unknown as BusinessRecord] })
}

describe('what a model is allowed to do to a workspace', () => {
  beforeEach(() => { delete window.__BO_WORKSPACE_AGENT_MOCK__ })

  it('creates a record, keeping only fields the entity actually has', async () => {
    const { action } = await withResponse({
      kind: 'create_record', entityId: 'clients',
      values: [{ field: 'name', value: 'Northwind' }, { field: 'not-a-field', value: 'anything' }],
    })
    expect(action).toEqual({ type: 'create_record', entityId: 'clients', values: { name: 'Northwind' } })
  })

  it('reads a value as the type the field says it is, not as the string the model sent', async () => {
    const { action } = await withResponse({
      kind: 'create_record', entityId: 'clients',
      values: [{ field: 'name', value: 'Northwind' }, { field: 'value', value: '4200' }, { field: 'active', value: 'yes' }],
    })
    expect(action).toMatchObject({ values: { value: 4200, active: true } })
  })

  it('treats an unparseable number as zero rather than as NaN', async () => {
    // NaN in a currency field spreads: every total that touches it becomes NaN, and the workspace
    // shows nothing at all rather than a wrong number somebody would notice.
    const { action } = await withResponse({ kind: 'create_record', entityId: 'clients', values: [{ field: 'value', value: 'about four thousand' }] })
    expect(action).toMatchObject({ values: { value: 0 } })
  })

  /**
   * The refusals. Every one of these is a model naming something that does not exist, and the only
   * safe response to that is no action — never a near miss against real data.
   */
  it('refuses an entity that does not exist', async () => {
    for (const kind of ['create_record', 'update_record', 'delete_record', 'query', 'add_field'] as const) {
      const { action } = await withResponse({ kind, entityId: 'invented', recordId: 'rec-1', field: { id: 'x', label: 'X', type: 'text', required: false } })
      expect(action, `${kind} against an invented entity produced an action`).toBeUndefined()
    }
  })

  it('refuses a navigation target that does not exist', async () => {
    expect((await withResponse({ kind: 'navigate', navigationId: 'invented' })).action).toBeUndefined()
    expect((await withResponse({ kind: 'navigate', navigationId: 'clients' })).action).toEqual({ type: 'navigate', navigationId: 'clients' })
  })

  it('refuses an update or delete with no record named', async () => {
    expect((await withResponse({ kind: 'update_record', entityId: 'clients', recordId: '' })).action).toBeUndefined()
    expect((await withResponse({ kind: 'delete_record', entityId: 'clients', recordId: '' })).action).toBeUndefined()
  })

  it('refuses a field with an invented type', async () => {
    const { action } = await withResponse({ kind: 'add_field', entityId: 'clients', field: { id: 'colour', label: 'Colour', type: 'rainbow' as never, required: false } })
    expect(action).toBeUndefined()
  })

  it('refuses a new collection whose id already belongs to something', async () => {
    expect((await withResponse({ kind: 'add_collection', collectionName: 'Clients' })).action).toBeUndefined()
    expect((await withResponse({ kind: 'add_collection', collectionName: '' })).action).toBeUndefined()
    expect((await withResponse({ kind: 'add_collection', collectionName: 'Site Visits' })).action).toMatchObject({ type: 'activate_module', module: 'site-visits' })
  })

  it('refuses a workflow on an entity that does not exist', async () => {
    const workflow = { name: 'Tell me', entityId: 'invented', event: 'created' as const, conditionField: '', conditionEquals: '', message: 'A thing happened' }
    expect((await withResponse({ kind: 'create_workflow', workflow })).action).toBeUndefined()
    const valid = { ...workflow, entityId: 'clients' }
    expect((await withResponse({ kind: 'create_workflow', workflow: valid })).action).toMatchObject({ type: 'create_workflow' })
  })

  it('does nothing at all when the model decides nothing should happen', async () => {
    const { response, action } = await withResponse({ kind: 'none' }, 'CLARIFY')
    expect(action).toBeUndefined()
    expect(response.decision).toBe('CLARIFY')
  })
})
