import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { databaseAvailable, query, queryOne } from './db.mjs'

/**
 * Where BO keeps what it has learned about industries.
 *
 * This is the one thing BO owns that cannot be copied by reading the product: what real companies in
 * an industry kept, removed and added after being handed a workspace. Everything else about BO could
 * be rebuilt by somebody with the same idea; this is the accumulated behaviour of every operator who
 * ever corrected it.
 *
 * It lived in JSON files on local disk — the same disk Render, Railway, Fly and Vercel wipe on every
 * redeploy. Records were moved off it once for exactly that reason and this was left behind, which
 * made the most valuable thing BO holds also the least durable: one deploy and it would have
 * forgotten everything, silently, with nothing to restore from.
 *
 * With a database it is a table. Without one it is the files it always was, so the prototype still
 * runs with no infrastructure — the same bargain the rest of the server makes.
 */

const root = () => path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.industry-knowledge')

export const emptyProfile = subsector => ({ subsector, label: '', researched: null, observed: {}, companies: 0, updatedAt: '' })

export function checkSubsector(subsector) {
  if (!/^\d{3}$/.test(String(subsector))) throw Object.assign(new Error('A NAICS subsector is three digits.'), { status: 400 })
  return String(subsector)
}

const fileFor = subsector => path.join(root(), `${checkSubsector(subsector)}.json`)

const fromRow = row => ({
  subsector: row.subsector,
  label: row.label ?? '',
  companies: Number(row.companies ?? 0),
  observed: row.observed ?? {},
  researched: row.researched ?? null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
})

export async function readProfile(subsector) {
  checkSubsector(subsector)
  if (databaseAvailable()) {
    const row = await queryOne('select * from industry_knowledge where subsector = $1', [String(subsector)])
    return row ? fromRow(row) : emptyProfile(String(subsector))
  }
  try { return JSON.parse(await readFile(fileFor(subsector), 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return emptyProfile(String(subsector))
    throw error
  }
}

export async function writeProfile(profile) {
  checkSubsector(profile.subsector)
  if (databaseAvailable()) {
    await query(
      `insert into industry_knowledge (subsector, label, companies, observed, researched, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (subsector) do update set
         label = excluded.label, companies = excluded.companies,
         observed = excluded.observed, researched = excluded.researched, updated_at = now()`,
      [profile.subsector, profile.label ?? '', profile.companies ?? 0, JSON.stringify(profile.observed ?? {}), profile.researched ? JSON.stringify(profile.researched) : null],
    )
    return profile
  }
  const file = fileFor(profile.subsector)
  await mkdir(path.dirname(file), { recursive: true })
  const candidate = `${file}.${randomUUID()}.next`
  await writeFile(candidate, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  await rename(candidate, file)
  return profile
}

export async function allProfiles() {
  if (databaseAvailable()) {
    const result = await query('select * from industry_knowledge order by subsector')
    return result.rows.map(fromRow)
  }
  try {
    const files = await readdir(root())
    return Promise.all(files.filter(name => /^\d{3}\.json$/.test(name)).map(name => readProfile(name.slice(0, 3))))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}
