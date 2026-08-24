import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './atomicWrite.mjs'
import { databaseAvailable, query, withTransaction } from './db.mjs'
import { projectPaths } from './project-builder.mjs'

/**
 * Where a workspace's records actually live.
 *
 * The shape everywhere else in the server expects is unchanged by this file on purpose: an object
 * keyed by entity id, each value an array of records, with `_notifications` living in the same
 * object as just another entity. That shape predates this module; index.mjs's whole records and
 * notifications API is written against it. Moving the storage underneath it means the only thing
 * that had to change to gain real persistence was these two functions.
 *
 * With `DATABASE_URL` set, records live in Postgres — see migrations/002_records.sql. Without one,
 * they fall back to the JSON file BO always used, so local development still needs no infrastructure.
 */

async function readDataFile(workspaceId) {
  try { return JSON.parse(await readFile(projectPaths(workspaceId).data, 'utf8')) }
  catch { return {} }
}

async function writeDataFile(workspaceId, value) {
  await writeJsonAtomic(projectPaths(workspaceId).data, value)
}

export async function readWorkspaceData(workspaceId) {
  if (!databaseAvailable()) return readDataFile(workspaceId)
  const result = await query('select entity_id, data from records where workspace_id = $1', [workspaceId])
  const grouped = {}
  for (const row of result.rows) (grouped[row.entity_id] ??= []).push(row.data)
  return grouped
}

/**
 * Replaces everything a workspace holds with `value`, atomically.
 *
 * Every call site already does read-modify-write on the whole object — the same pattern the JSON
 * file used — so this keeps that contract rather than introducing a new one. The transaction is what
 * makes it safe: without it, a crash between the delete and the re-insert would leave the workspace
 * missing records that were never actually lost, only in flight.
 */
export async function writeWorkspaceData(workspaceId, value) {
  if (!databaseAvailable()) return writeDataFile(workspaceId, value)
  await withTransaction(async tx => {
    /**
     * The workspace row is made here rather than demanded from elsewhere.
     *
     * `records` references `workspaces`, and BO's whole promise is that you describe a company and
     * get a workspace before signing up for anything — so with a database configured, the first
     * record written to an unclaimed workspace failed on a foreign key nobody was in a position to
     * satisfy. Migration 006 made the owner optional; this fills the row in, and signing in later
     * claims it by name.
     */
    await tx('insert into workspaces (id) values ($1) on conflict (id) do nothing', [workspaceId])
    await tx('delete from records where workspace_id = $1', [workspaceId])
    for (const [entityId, records] of Object.entries(value)) {
      for (const record of records ?? []) {
        if (!record?.id) continue
        await tx(
          'insert into records (workspace_id, entity_id, id, data, updated_at) values ($1, $2, $3, $4, now())',
          [workspaceId, entityId, String(record.id), JSON.stringify(record)],
        )
      }
    }
  })
}
