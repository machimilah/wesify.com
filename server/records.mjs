import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
  const file = projectPaths(workspaceId).data
  await mkdir(path.dirname(file), { recursive: true })
  const candidate = `${file}.next`
  await writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(candidate, file)
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
