import { randomUUID } from 'node:crypto'
import { audit, tenant } from '../access.mjs'
import { requireConnectedApps } from '../billing.mjs'
import { credentialFor, listConnections, recordSync, removeConnection, saveConnection } from '../connections.mjs'
import { checkKey as checkStripeKey, pull as pullStripe, verify as verifyStripe } from '../connectors/stripe.mjs'
import { databaseAvailable } from '../db.mjs'
import { body, send } from '../http.mjs'
import { readWorkspaceData, writeWorkspaceData } from '../records.mjs'

/**
 * Connected apps: /api/connections/:workspaceId[/:providerId[/sync]]
 *
 * Read-only for now, and the read direction is the safe one. Nothing here ever returns a stored
 * credential, and a sync never deletes a record the operator created in Wesify — records that came from
 * the other system are updated in place and matched on the id that system gave them.
 */

/**
 * Folds what another system holds into the workspace, without ever taking anything away.
 *
 * Matching is on the id the other system gave the record, kept in `connection.externalId`. A record
 * the operator typed into Wesify has no external id, so it can never be matched, overwritten or removed
 * by a sync — the worst a bad mapping can do here is add rows.
 *
 * Records that vanish from the other side are marked, not deleted. A customer disappearing from
 * Stripe is a fact worth showing; silently removing them from Wesify would be Wesify deciding something it
 * has no business deciding.
 */
export async function mergeConnectedRecords(workspaceId, providerId, pulled) {
  const data = await readWorkspaceData(workspaceId)
  const at = new Date().toISOString()
  const counts = {}

  for (const [entityId, incoming] of Object.entries(pulled)) {
    const existing = Array.isArray(data[entityId]) ? data[entityId] : []
    const byExternalId = new Map(existing.filter(record => record?.connection?.externalId).map(record => [record.connection.externalId, record]))
    const seen = new Set()
    let added = 0
    let updated = 0

    for (const item of incoming) {
      seen.add(item.externalId)
      const current = byExternalId.get(item.externalId)
      const connection = { providerId, externalId: item.externalId, lastSyncedAt: at, remoteUpdatedAt: item.remoteUpdatedAt || at, missingSince: '' }
      if (current) {
        Object.assign(current, item.values, { connection, updatedAt: at })
        updated += 1
      } else {
        existing.push({ id: randomUUID(), ...item.values, connection, createdAt: at, updatedAt: at })
        added += 1
      }
    }

    let missing = 0
    for (const [externalId, record] of byExternalId) {
      if (seen.has(externalId) || record.connection.missingSince) continue
      record.connection = { ...record.connection, missingSince: at }
      missing += 1
    }

    data[entityId] = existing
    counts[entityId] = { added, updated, missing }
  }

  await writeWorkspaceData(workspaceId, data)
  return counts
}

export async function connectionRoutes(request, response, segments) {
  if (segments[1] !== 'connections' || !segments[2]) return false

  const workspaceId = segments[2]
  const connecting = await tenant(request, workspaceId)
  const providerId = segments[3]
  // Reading which apps are connected stays open on every plan: an account that has lapsed must be
  // able to see what it had, and taking the list away would only make it harder to disconnect.
  if (request.method === 'POST' && databaseAvailable() && connecting?.user) await requireConnectedApps(connecting.user.id)

  if (request.method === 'GET' && !providerId) return send(response, 200, await listConnections(workspaceId))
  if (providerId && providerId !== 'stripe') return send(response, 404, { error: 'Wesify has no connector for that app yet.' })

  if (request.method === 'POST' && providerId === 'stripe' && !segments[4]) {
    const input = await body(request)
    const credential = checkStripeKey(input.apiKey)
    const account = await verifyStripe(credential)
    const saved = await saveConnection(workspaceId, 'stripe', { credential, mode: 'read', account: account.livemode ? 'Live' : 'Test' })
    await audit(workspaceId, 'connection.created', request, { providerId: 'stripe', mode: 'read' })
    return send(response, 200, saved)
  }

  if (request.method === 'POST' && providerId === 'stripe' && segments[4] === 'sync') {
    const credential = await credentialFor(workspaceId, 'stripe')
    try {
      const pulled = await pullStripe(credential)
      const counts = await mergeConnectedRecords(workspaceId, 'stripe', pulled)
      const connection = await recordSync(workspaceId, 'stripe', { counts })
      await audit(workspaceId, 'connection.synced', request, { providerId: 'stripe', ...counts })
      return send(response, 200, { connection, counts })
    } catch (error) {
      await recordSync(workspaceId, 'stripe', { error: error?.message ?? 'Sync failed.' })
      throw error
    }
  }

  if (request.method === 'DELETE' && providerId === 'stripe') {
    const removed = await removeConnection(workspaceId, 'stripe')
    if (removed) await audit(workspaceId, 'connection.removed', request, { providerId: 'stripe' })
    return send(response, 200, { removed })
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
