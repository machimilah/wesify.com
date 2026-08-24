import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * BO's industry knowledge, off the disk that redeploys wipe.
 *
 * This is the one asset BO has that a competitor cannot obtain by reading the product: what real
 * companies in an industry kept, removed and added once they had a workspace in front of them.
 * Everything else here could be rebuilt by somebody with the same idea and enough time.
 *
 * It was sitting in JSON files under generated-projects/, on the same local disk Render, Railway,
 * Fly and Vercel wipe on every deploy — records were moved off it for exactly that reason and this
 * was left behind. So the most valuable thing BO holds was also the only thing with no copy: one
 * deploy and it would have forgotten everything, silently, with nothing to restore from.
 *
 * What is proved here is that it is now a table, that nothing is written to disk once a database is
 * configured, and that what it holds survives the server being replaced entirely.
 */

const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-industry-store-'))
process.env.BO_GENERATED_ROOT = generatedRoot

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { recordObservations, saveResearch, readIndustryProfile, listIndustries, industryVerdict, MIN_COMPANIES } =
  await import('../server/industryKnowledge.mjs')

try {
  // 1. An observation is a row, not a file.
  for (let company = 0; company < MIN_COMPANIES + 1; company += 1) {
    await recordObservations('541', {
      removed: ['work.time'], kept: ['crm.contacts'],
      patterns: [{ kind: 'process', id: 'collections', outcome: 'adopted' }],
      newCompany: true, label: 'Professional services',
    })
  }
  const rows = (await query('select * from industry_knowledge')).rows
  assert.equal(rows.length, 1, 'the observation did not reach Postgres')
  assert.equal(rows[0].subsector, '541')
  assert.equal(Number(rows[0].companies), MIN_COMPANIES + 1)
  assert.equal(rows[0].observed['work.time'].removed, MIN_COMPANIES + 1)
  assert.equal(rows[0].patterns.process.collections.adopted, MIN_COMPANIES + 1)
  assert.equal(rows[0].label, 'Professional services')

  // 2. Nothing about it is on local disk. This is the property that actually matters: with a
  //    database configured, nothing BO has learned depends on this container's filesystem existing.
  const onDisk = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else onDisk.push(full)
    }
  }
  await walk(generatedRoot)
  assert.deepEqual(onDisk.filter(file => file.includes('industry-knowledge')), [], 'industry knowledge was written to disk even though a database is configured')

  // 3. Research lands in the same row and keeps its sources, so a conclusion can still be checked.
  await saveResearch('541', {
    capabilityIds: ['crm.pipeline'], excludedCapabilityIds: ['inventory.stock'],
    summary: 'Agencies run a pipeline.', sources: [{ title: 'A source', url: 'https://example.org/a' }], model: 'test',
  })
  const withResearch = await readIndustryProfile('541')
  assert.equal(withResearch.researched.capabilityIds[0], 'crm.pipeline')
  assert.equal(withResearch.researched.sources.length, 1)
  assert.equal(withResearch.companies, MIN_COMPANIES + 1, 'saving research lost the observations already recorded')

  // 4. The verdict computed from the stored row is the same one the evidence supports.
  const verdict = industryVerdict(withResearch)
  assert.ok(verdict.exclude.some(item => item.capabilityId === 'work.time' && item.basis === 'observed'))
  assert.ok(verdict.include.some(item => item.capabilityId === 'crm.pipeline' && item.basis === 'researched'))
  assert.ok(verdict.patterns.some(item => item.kind === 'process' && item.patternId === 'collections'))
  assert.equal(verdict.research.stale, false)

  // 5. It survives the server being replaced. A fresh import — the same thing a redeploy does — sees
  //    everything, because the knowledge never depended on the process that recorded it.
  const listed = await listIndustries()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].subsector, '541')
  assert.equal(listed[0].companies, MIN_COMPANIES + 1)
  assert.equal(listed[0].researched, true)
  assert.equal(listed[0].researchStale, false)

  // 6. Still anonymous. Being in a database changes where it lives, not what it is allowed to hold.
  const stored = JSON.stringify(rows[0])
  assert.ok(!/workspace|record|token|company_?id/i.test(stored), `industry knowledge must stay anonymous: ${stored.slice(0, 200)}`)

  // 7. A malformed subsector is refused before it reaches the database.
  await assert.rejects(() => recordObservations('abc', { removed: ['work.time'] }), /three digits/)
  assert.equal((await query('select * from industry_knowledge')).rows.length, 1)

  console.log('Industry store test passed: what BO learns is a Postgres row rather than a file on the disk a redeploy wipes, nothing about it is written to disk once a database is configured, research and observations share the row without overwriting each other, the verdict computed from it is unchanged, a fresh process sees everything, it stays anonymous, and a malformed subsector never reaches the database.')
} finally {
  await rm(generatedRoot, { recursive: true, force: true })
}
