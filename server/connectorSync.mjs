import { randomUUID } from 'node:crypto'
import { connectorFor } from './connectors/index.mjs'
import { credentialFor, listConnections, recordMapping, recordSync } from './connections.mjs'
import { readWorkspaceData, writeWorkspaceData } from './records.mjs'

/**
 * Bringing what another system holds into a workspace, without ever taking anything away.
 *
 * This lived inside the connections route while syncing was something only a person could ask for.
 * An ERP import runs from more than one place — a route, and the build that rebuilds a company from
 * its ERP — so it belongs beside the connectors rather than inside one caller.
 *
 * Matching is on the id the other system gave the record, kept in `connection.externalId`. A record
 * the operator typed into Wesify has no external id, so it can never be matched, overwritten or
 * removed by a sync — the worst a bad mapping can do here is add rows.
 */

/**
 * @param {boolean} partial True when `pulled` is a delta rather than the whole picture.
 *
 * `partial` is the single trap in incremental sync and the reason this argument exists. The sweep
 * below marks every externally-sourced record that was *not* in `pulled` as having disappeared
 * remotely. That is correct for a full pull and catastrophic for a delta: fed the handful of rows
 * that changed since Tuesday, it would condemn the entire dataset as vanished.
 */
export async function mergeConnectedRecords(workspaceId, providerId, pulled, { partial = false } = {}) {
  const data = await readWorkspaceData(workspaceId)
  const at = new Date().toISOString()
  const counts = {}

  for (const [entityId, incoming] of Object.entries(pulled)) {
    if (entityId.startsWith('_')) continue
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
    if (!partial) {
      for (const [externalId, record] of byExternalId) {
        if (seen.has(externalId) || record.connection.missingSince) continue
        record.connection = { ...record.connection, missingSince: at }
        missing += 1
      }
    }

    data[entityId] = existing
    counts[entityId] = { added, updated, missing }
  }

  await writeWorkspaceData(workspaceId, data)
  return counts
}

/**
 * How far back a connector has to look, per entity.
 *
 * A full sweep is forced when there has never been one, or when the last one is a day old, because a
 * delta can only ever tell Wesify what changed — never what was deleted. Deletions are found by
 * looking at everything, and once a day is often enough to notice one.
 */
const FULL_SWEEP_AFTER_HOURS = 24

function sweepIsDue(cursor, now) {
  const last = Date.parse(cursor?.lastFullSyncAt ?? '')
  return !Number.isFinite(last) || now - last > FULL_SWEEP_AFTER_HOURS * 60 * 60 * 1000
}

/**
 * One sync of one provider into one workspace.
 *
 * `partial` is derived here, from the connector's own declaration plus whether this run is a full
 * sweep — never passed in by a caller. A caller that had to remember it is a caller that will
 * eventually forget, and forgetting marks a company's whole dataset as deleted.
 */
export async function syncProvider(workspaceId, providerId, { full = false, now = Date.now(), mapping = null } = {}) {
  const connector = connectorFor(providerId)
  if (!connector) throw Object.assign(new Error('Wesify has no connector for that app yet.'), { status: 404 })
  const credential = await credentialFor(workspaceId, providerId)
  const stored = await connectionFor(workspaceId, providerId)
  const cursor = stored?.cursor ?? null
  const sweeping = full || !connector.incremental || sweepIsDue(cursor, now)
  const since = sweeping ? {} : cursor?.sinceByEntity ?? {}
  // A mapping supplied now replaces whatever was stored, because the workspace it describes has just
  // been rebuilt. One that is absent falls back to the last one, so an ordinary re-sync needs no
  // knowledge of the schema at all.
  if (mapping) await recordMapping(workspaceId, providerId, mapping)
  const active = mapping ?? stored?.mapping ?? []

  try {
    const pulled = await connector.pull(credential, { since, full: sweeping, mapping: active })
    const { _cursor: nextCursor, ...records } = pulled
    const counts = await mergeConnectedRecords(workspaceId, providerId, records, { partial: connector.incremental && !sweeping })
    const connection = await recordSync(workspaceId, providerId, {
      counts,
      cursor: {
        lastFullSyncAt: sweeping ? new Date(now).toISOString() : cursor?.lastFullSyncAt ?? '',
        sinceByEntity: { ...(cursor?.sinceByEntity ?? {}), ...(nextCursor ?? {}) },
      },
    })
    return { connection, counts }
  } catch (error) {
    await recordSync(workspaceId, providerId, { error: error?.message ?? 'Sync failed.' })
    throw error
  }
}

/** What a previous sync left behind: where to resume from, and the schema it was filling. */
async function connectionFor(workspaceId, providerId) {
  return (await listConnections(workspaceId)).find(item => item.providerId === providerId) ?? null
}
