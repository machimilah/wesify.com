import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from './atomicWrite.mjs'
import { databaseAvailable, query } from './db.mjs'

/**
 * Where the interview lives.
 *
 * The same arrangement records use: Postgres when `DATABASE_URL` is configured, a JSON file when it
 * is not, and one shape for every caller either way. The interview is the most valuable thing Wesify
 * holds about a company that Wesify cannot regenerate — it is what the workspace was built from, what a
 * returning operator continues from, and what Wesify re-reads to explain a decision — and it was the
 * last thing still living only on the disk a redeploy wipes.
 */

const root = () => path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.discovery-sessions')

export function discoveryFile(workspaceId) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(workspaceId)) throw Object.assign(new Error('Invalid workspace id.'), { status: 400 })
  return path.join(root(), `${workspaceId}.json`)
}

export async function readDiscoverySession(workspaceId) {
  const file = discoveryFile(workspaceId)
  if (databaseAvailable()) {
    const found = await query('select session from discovery_sessions where workspace_id = $1', [workspaceId])
    if (found.rows[0]) return found.rows[0].session
  }
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function writeDiscoverySession(workspaceId, value) {
  if (!value || value.workspaceId !== workspaceId || !Array.isArray(value.messages) || typeof value.phase !== 'string') {
    throw Object.assign(new Error('Invalid discovery session.'), { status: 400 })
  }
  const file = discoveryFile(workspaceId)
  if (databaseAvailable()) {
    await query(
      `insert into discovery_sessions (workspace_id, session, updated_at) values ($1, $2, now())
       on conflict (workspace_id) do update set session = excluded.session, updated_at = now()`,
      [workspaceId, JSON.stringify(value)],
    )
    return value
  }
  await writeJsonAtomic(file, value)
  return value
}
