import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * BO's database, when it has one.
 *
 * Accounts arrived first, because they are what stands between BO and a second person using the
 * product at all. Workspace records — the actual clients, invoices and work orders an operator
 * creates — followed once accounts existed to own them; see records.mjs for that migration.
 *
 * `DATABASE_URL` is a Supabase connection string. Without one, BO runs exactly as it did before, with
 * no accounts and workspace data back in local JSON files. That keeps the prototype usable with zero
 * infrastructure and keeps the test suite honest about which path it is exercising;
 * `databaseAvailable()` is what the rest of the server asks before choosing either.
 */

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

let pool = null
let connecting = null

/** Test seam: pg-mem hands back a driver-compatible pool, so the suite exercises the real SQL. */
export function useDatabase(replacement) {
  pool = replacement
  connecting = null
}

export function databaseAvailable() {
  return Boolean(pool || process.env.DATABASE_URL)
}

async function getPool() {
  if (pool) return pool
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('BO has no database configured. Set DATABASE_URL to your Supabase connection string.'), { status: 503 })
  connecting ??= import('pg').then(({ default: pg }) => {
    // Supabase terminates TLS with its own certificate chain; verifying it needs the CA bundle, which
    // is a deployment concern rather than a code one.
    const created = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false }, max: 10 })
    pool = created
    return created
  })
  return connecting
}

export async function query(text, values = []) {
  const client = await getPool()
  // A statement with no parameters is sent as a plain query. Handing the driver an empty array makes
  // it prepare the statement instead, which is both pointless and a path some drivers handle worse.
  return values.length ? client.query(text, values) : client.query(text)
}

/** The first row, or null. Most reads here want one row and nothing else. */
export async function queryOne(text, values = []) {
  const result = await query(text, values)
  return result.rows[0] ?? null
}

/**
 * Runs `run` against one checked-out connection inside BEGIN/COMMIT, rolling back on any error.
 *
 * Needed wherever a write has to be all-or-nothing across several statements — replacing every
 * record a workspace holds, for instance, where a crash partway through must never leave the
 * workspace with half its records deleted and the other half not yet re-inserted.
 */
export async function withTransaction(run) {
  const pooled = await getPool()
  const client = await pooled.connect()
  try {
    await client.query('begin')
    const scoped = (text, values = []) => (values.length ? client.query(text, values) : client.query(text))
    const result = await run(scoped)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/**
 * Applies every migration that has not run yet, in filename order.
 *
 * Recorded by name rather than by count, so a migration inserted out of order is noticed instead of
 * silently skipping the one that happened to share its number.
 */
export async function migrate() {
  // Asked rather than asserted with `if not exists`: this runs on every start, and issuing DDL each
  // time to have the database decide it is unnecessary is work and noise in the log for nothing.
  const ledgerExists = await queryOne("select 1 as found from information_schema.tables where table_name = 'schema_migrations'")
  if (!ledgerExists) await query('create table schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const applied = new Set((await query('select name from schema_migrations')).rows.map(row => row.name))
  const files = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort()
  const ran = []
  for (const name of files) {
    if (applied.has(name)) continue
    const sql = await readFile(path.join(migrationsDirectory, name), 'utf8')
    // Full-line comments are stripped before splitting on `;`. Without this, a migration ending in an
    // explanatory comment after its last real statement — normal in this codebase's style — leaves a
    // trailing comment-only fragment that is not blank once trimmed, so it gets sent as a "statement"
    // and fails wherever the driver cannot parse a bare comment on its own.
    const withoutComments = sql.replace(/^\s*--.*$/gm, '')
    for (const statement of withoutComments.split(/;\s*$/m).map(item => item.trim()).filter(Boolean)) await query(statement)
    await query('insert into schema_migrations (name) values ($1)', [name])
    ran.push(name)
  }
  return ran
}
