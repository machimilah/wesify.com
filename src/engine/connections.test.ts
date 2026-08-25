import { describe, expect, it } from 'vitest'
import {
  MAX_WRITE_ATTEMPTS, classifySync, connectionFor, idempotencyKeyFor, planConnections,
  pendingWrites, queueWrite, recordAttempt, stuckWrites, type OutboxEntry,
} from './connections'
import { providers } from '../data/providers'
import { capabilityById } from './capabilityCatalog'
import { emptyArchitecture, emptyBusinessState } from './businessDiscovery'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'
import type { AIBlueprint, ModuleId } from './blueprint'

const blueprint: AIBlueprint = { modules: ['processes'], startView: 'processes', moduleConfig: { pipelineStages: [], processSteps: [], billingCadence: '', inventoryStages: [], supportStages: [] } }

describe('provider registry', () => {
  it('only promises capabilities Wesify can actually build', () => {
    for (const provider of providers) {
      expect(provider.provides.length, `${provider.id} backs nothing`).toBeGreaterThan(0)
      for (const capabilityId of provider.provides) {
        expect(capabilityById.has(capabilityId), `${provider.id} claims unknown capability ${capabilityId}`).toBe(true)
      }
      expect(provider.signals.length, `${provider.id} has no signals`).toBeGreaterThan(0)
      expect(provider.home.startsWith('https://'), `${provider.id} home must be https`).toBe(true)
    }
  })
})

describe('deciding what another app owns', () => {
  it('hands over only capabilities the company already has an app for', () => {
    const connections = planConnections(['finance.invoicing', 'accounting.ledger', 'work.projects'], 'We do our books in Xero.')
    expect(connections.map(item => item.capabilityId).sort()).toEqual(['accounting.ledger', 'finance.invoicing'])
    expect(connections[0].providerLabel).toBe('Xero')
    expect(connections[0].evidence).toBe('xero')
    // Nothing is connected until someone authorizes it.
    expect(connections.every(item => item.status === 'not-connected')).toBe(true)
  })

  it('builds everything when the company named no tools', () => {
    expect(planConnections(['finance.invoicing', 'crm.contacts'], 'We are a plumbing company.')).toEqual([])
  })

  it('never hands over a capability the workspace does not have', () => {
    expect(planConnections(['work.projects'], 'We use Xero and Stripe.')).toEqual([])
  })

  it('gives each capability to one app, even when two could cover it', () => {
    const connections = planConnections(['crm.contacts', 'crm.pipeline'], 'We use HubSpot and Pipedrive.')
    const capabilityIds = connections.map(item => item.capabilityId)
    expect(new Set(capabilityIds).size).toBe(capabilityIds.length)
  })

  it('marks read-only apps read-only', () => {
    const connections = planConnections(['work.scheduling'], 'Bookings come through Calendly.')
    expect(connections[0].mode).toBe('read')
  })

  it('reaches the workspace, so a page can tell who owns it', () => {
    const state = { ...emptyBusinessState(), companySummary: 'A design studio', industry: 'Design agency', currentTools: ['Xero for accounting'] }
    const architecture = { ...emptyArchitecture(), capabilityIds: ['crm.contacts', 'finance.invoicing'], pages: ['Clients', 'Invoices'], modules: ['customers', 'finance'] satisfies ModuleId[], entities: [] }
    const config = generateWorkspaceConfigurationFromDiscovery({}, blueprint, state, architecture)
    const invoiceEntity = config.entities.find(item => item.id === 'invoices')
    expect(invoiceEntity?.capabilityId).toBe('finance.invoicing')
    expect(connectionFor(config.connections, invoiceEntity?.capabilityId)?.providerLabel).toBe('Xero')
    expect(connectionFor(config.connections, 'crm.contacts')).toBeUndefined()
  })
})

describe('sync state', () => {
  it('is local-only before the record has ever reached the other app', () => {
    expect(classifySync({ localUpdatedAt: '2026-01-01T10:00:00Z' })).toBe('local-only')
  })

  it('is synced when neither side moved since they last agreed', () => {
    expect(classifySync({ externalId: 'INV-1', lastSyncedAt: '2026-01-02T10:00:00Z', localUpdatedAt: '2026-01-02T09:00:00Z', remoteUpdatedAt: '2026-01-02T09:30:00Z' })).toBe('synced')
  })

  it('is pending when only this side moved', () => {
    expect(classifySync({ externalId: 'INV-1', lastSyncedAt: '2026-01-02T10:00:00Z', localUpdatedAt: '2026-01-02T11:00:00Z' })).toBe('pending')
  })

  it('is a conflict when both sides moved, and never picks a winner', () => {
    const state = classifySync({ externalId: 'INV-1', lastSyncedAt: '2026-01-02T10:00:00Z', localUpdatedAt: '2026-01-02T11:00:00Z', remoteUpdatedAt: '2026-01-02T12:00:00Z' })
    expect(state).toBe('conflict')
  })
})

describe('writing back safely', () => {
  const draft = { connectionId: 'xero', entityId: 'invoices', recordId: 'inv-1', operation: 'create' as const, values: { amount: 100, customer: 'acme' } }

  it('gives the same change the same key however the values are ordered', () => {
    const a = idempotencyKeyFor(draft)
    const b = idempotencyKeyFor({ ...draft, values: { customer: 'acme', amount: 100 } })
    expect(a).toBe(b)
  })

  it('gives a different change a different key', () => {
    expect(idempotencyKeyFor(draft)).not.toBe(idempotencyKeyFor({ ...draft, values: { amount: 200, customer: 'acme' } }))
  })

  it('never queues the same write twice', () => {
    // The failure this prevents is real money: a double-submitted invoice created twice in Xero.
    let outbox: OutboxEntry[] = []
    outbox = queueWrite(outbox, draft)
    outbox = queueWrite(outbox, draft)
    expect(outbox).toHaveLength(1)
    expect(pendingWrites(outbox, 'invoices', 'inv-1')).toBe(true)
  })

  it('queues a genuinely different edit to the same record', () => {
    let outbox: OutboxEntry[] = []
    outbox = queueWrite(outbox, draft)
    outbox = queueWrite(outbox, { ...draft, operation: 'update', values: { amount: 250 } })
    expect(outbox).toHaveLength(2)
  })

  it('retries a failure, then gives up instead of retrying forever', () => {
    let outbox = queueWrite([], draft)
    const id = outbox[0].id
    for (let attempt = 1; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      outbox = recordAttempt(outbox, id, { ok: false, error: 'timeout' })
      expect(outbox[0].status, `attempt ${attempt} should still retry`).toBe('queued')
    }
    outbox = recordAttempt(outbox, id, { ok: false, error: 'timeout' })
    expect(outbox[0].status).toBe('abandoned')
    expect(outbox[0].attempts).toBe(MAX_WRITE_ATTEMPTS)
    // An abandoned write is surfaced, never dropped quietly.
    expect(stuckWrites(outbox)).toHaveLength(1)
  })

  it('clears the error when a retry succeeds', () => {
    let outbox = queueWrite([], draft)
    outbox = recordAttempt(outbox, outbox[0].id, { ok: false, error: 'timeout' })
    outbox = recordAttempt(outbox, outbox[0].id, { ok: true })
    expect(outbox[0].status).toBe('sent')
    expect(outbox[0].lastError).toBeUndefined()
  })

  it('lets the same change be re-queued once the previous one finished', () => {
    let outbox = queueWrite([], draft)
    outbox = recordAttempt(outbox, outbox[0].id, { ok: false, error: 'gone' })
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) outbox = recordAttempt(outbox, outbox[0].id, { ok: false, error: 'gone' })
    outbox = queueWrite(outbox, draft)
    expect(outbox).toHaveLength(2)
  })
})
