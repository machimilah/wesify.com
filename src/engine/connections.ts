import { detectProviders, providerById, type ProviderDefinition } from '../data/providers'

/**
 * Connected capabilities: pages BO shows but another app owns.
 *
 * Writing into someone else's system is the part that goes wrong, so the rules live here from the
 * start rather than being bolted on once a real connector exists:
 *
 * 1. **Every write is idempotent.** A queued write carries a key derived from what it changes. A
 *    retry after a timeout re-sends the same key, so a payment or invoice is never created twice —
 *    the failure mode that actually costs a business money.
 * 2. **Both sides changing is a conflict, not a merge.** BO never silently picks a winner. It marks
 *    the record and asks, because guessing wrong here quietly corrupts the other system.
 * 3. **Nothing claims to be synced when it is not.** `local-only` and `pending` are visible states,
 *    so a page never implies the other app agrees with it.
 */

export type ConnectionStatus = 'not-connected' | 'connected' | 'error'
export type ConnectionMode = 'read' | 'read-write'
export type SyncState = 'local-only' | 'synced' | 'pending' | 'conflict' | 'error'

export interface WorkspaceConnection {
  capabilityId: string
  providerId: string
  providerLabel: string
  mode: ConnectionMode
  status: ConnectionStatus
  /** What the company said that made BO believe it already uses this app. */
  evidence: string
}

/** Sync bookkeeping carried alongside a record whose home is another system. */
export interface ConnectedRecordMeta {
  externalId?: string
  /** Last moment local and remote were known to agree. */
  lastSyncedAt?: string
  localUpdatedAt?: string
  remoteUpdatedAt?: string
}

export interface OutboxEntry {
  id: string
  connectionId: string
  entityId: string
  recordId: string
  operation: 'create' | 'update' | 'delete'
  values: Record<string, unknown>
  idempotencyKey: string
  attempts: number
  status: 'queued' | 'sent' | 'failed' | 'abandoned'
  lastError?: string
  queuedAt: string
}

/** After this many failures BO stops retrying and shows the record as in error. */
export const MAX_WRITE_ATTEMPTS = 5

const after = (later?: string, earlier?: string) => Boolean(later && (!earlier || Date.parse(later) > Date.parse(earlier)))

/**
 * What state a connected record is in.
 *
 * A record is only `synced` when neither side has moved since they last agreed. If both moved it is
 * a conflict — never a merge, never last-write-wins.
 */
export function classifySync(meta: ConnectedRecordMeta, hasPendingWrite = false): SyncState {
  if (!meta.externalId) return hasPendingWrite ? 'pending' : 'local-only'
  const localMoved = after(meta.localUpdatedAt, meta.lastSyncedAt)
  const remoteMoved = after(meta.remoteUpdatedAt, meta.lastSyncedAt)
  if (localMoved && remoteMoved) return 'conflict'
  if (hasPendingWrite || localMoved) return 'pending'
  return 'synced'
}

/**
 * A stable key for one intended change.
 *
 * Derived from what the write targets and the values it carries, so re-queuing the same change
 * produces the same key and the far side can reject the duplicate. Two genuinely different edits to
 * the same field produce different keys and both go through.
 */
export function idempotencyKeyFor(entry: Pick<OutboxEntry, 'connectionId' | 'entityId' | 'recordId' | 'operation' | 'values'>) {
  const values = Object.keys(entry.values).sort().map(key => `${key}=${String(entry.values[key])}`).join('&')
  const seed = `${entry.connectionId}:${entity(entry)}:${entry.operation}:${values}`
  // Small, dependency-free, stable hash. Only needs to be collision-resistant enough to tell two
  // different edits apart, not to be cryptographic.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${entry.connectionId}-${entry.recordId}-${hash.toString(16)}`
}

const entity = (entry: Pick<OutboxEntry, 'entityId' | 'recordId'>) => `${entry.entityId}/${entry.recordId}`

export interface WriteDraft {
  connectionId: string
  entityId: string
  recordId: string
  operation: OutboxEntry['operation']
  values: Record<string, unknown>
}

/**
 * Adds a write to the queue, unless the identical write is already waiting.
 *
 * Double-clicking a save button, or a component re-running an effect, must not queue the same change
 * twice — that is how one invoice becomes two.
 */
export function queueWrite(outbox: OutboxEntry[], draft: WriteDraft, now = new Date().toISOString()): OutboxEntry[] {
  const idempotencyKey = idempotencyKeyFor(draft)
  const duplicate = outbox.some(item => item.idempotencyKey === idempotencyKey && (item.status === 'queued' || item.status === 'sent'))
  if (duplicate) return outbox
  return [...outbox, {
    id: `${idempotencyKey}-${outbox.length}`,
    ...draft,
    idempotencyKey,
    attempts: 0,
    status: 'queued',
    queuedAt: now,
  }]
}

/**
 * Records the outcome of one delivery attempt.
 *
 * A failure stays queued and is retried until `MAX_WRITE_ATTEMPTS`, then is abandoned rather than
 * retried forever — an endless retry against a rejecting API is how rate limits and duplicate charges
 * happen. An abandoned write is surfaced, never dropped quietly.
 */
export function recordAttempt(outbox: OutboxEntry[], id: string, outcome: { ok: boolean; error?: string }): OutboxEntry[] {
  return outbox.map(item => {
    if (item.id !== id) return item
    if (outcome.ok) return { ...item, status: 'sent', attempts: item.attempts + 1, lastError: undefined }
    const attempts = item.attempts + 1
    return { ...item, attempts, status: attempts >= MAX_WRITE_ATTEMPTS ? 'abandoned' : 'queued', lastError: outcome.error }
  })
}

export const pendingWrites = (outbox: OutboxEntry[], entityId: string, recordId: string) =>
  outbox.some(item => item.entityId === entityId && item.recordId === recordId && (item.status === 'queued' || item.status === 'sent'))

export const stuckWrites = (outbox: OutboxEntry[]) => outbox.filter(item => item.status === 'abandoned')

/**
 * Decides which capabilities another app should back.
 *
 * A capability is only handed over when the company said it already uses an app that covers it — BO
 * never assumes. Everything else stays built, so a company with no tools still gets a whole system.
 */
export function planConnections(capabilityIds: string[], toolsText: string): WorkspaceConnection[] {
  const selected = new Set(capabilityIds)
  const connections: WorkspaceConnection[] = []
  const claimed = new Set<string>()
  for (const { provider, signal } of detectProviders(toolsText)) {
    for (const capabilityId of provider.provides) {
      if (!selected.has(capabilityId) || claimed.has(capabilityId)) continue
      claimed.add(capabilityId)
      connections.push({
        capabilityId,
        providerId: provider.id,
        providerLabel: provider.label,
        mode: provider.writable ? 'read-write' : 'read',
        status: 'not-connected',
        evidence: signal,
      })
    }
  }
  return connections
}

export const connectionFor = (connections: WorkspaceConnection[] | undefined, capabilityId: string | undefined) =>
  capabilityId ? connections?.find(item => item.capabilityId === capabilityId) : undefined

export const providerOf = (connection: WorkspaceConnection): ProviderDefinition | undefined => providerById.get(connection.providerId)
