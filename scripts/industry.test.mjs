import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * BO learns what an industry needs from what companies in it actually did.
 *
 * The taxonomy classifies a business but holds no operating facts, so questions like "does a social
 * media agency need timesheets" used to be settled by whoever wrote the ontology. These checks cover
 * the replacement: evidence decides, and it only decides once there is enough of it.
 */

const root = await mkdtemp(path.join(tmpdir(), 'bo-industry-'))
const { industryVerdict, recordObservations, readIndustryProfile, saveResearch, MIN_COMPANIES } =
  await import('../server/industryKnowledge.mjs')

process.env.BO_GENERATED_ROOT = root
// The module reads the root per call, so setting it after import is fine — assert that.
const port = 8973
const api = spawn(process.execPath, ['server/index.mjs', '--port', String(port)], {
  cwd: process.cwd(), env: { ...process.env, BO_GENERATED_ROOT: root }, stdio: 'pipe',
})
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (i === 59) throw new Error('The project service did not start.')
}

const observe = (subsector, payload) => fetch(`http://127.0.0.1:${port}/api/industries/${subsector}/observations`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
}).then(response => response.json())
const verdictOf = subsector => fetch(`http://127.0.0.1:${port}/api/industries/${subsector}`).then(response => response.json())

try {
  // 1. An industry nobody has used decides nothing.
  const empty = await verdictOf('541')
  assert.deepEqual(empty.include, [])
  assert.deepEqual(empty.exclude, [])
  assert.equal(empty.companies, 0)

  // 2. One opinionated operator does not get to speak for an industry.
  await observe('541', { removed: ['work.time'], newCompany: true, label: 'Professional services' })
  const single = await verdictOf('541')
  assert.deepEqual(single.exclude, [], 'one company must not decide an industry')

  // 3. Enough companies agreeing does decide it.
  for (let i = 1; i < MIN_COMPANIES + 1; i += 1) await observe('541', { removed: ['work.time'], newCompany: true })
  const settled = await verdictOf('541')
  const dropped = settled.exclude.find(item => item.capabilityId === 'work.time')
  assert.ok(dropped, 'an industry that consistently removes a system should stop being given it')
  assert.equal(dropped.basis, 'observed')
  assert.match(dropped.reason, /companies in this industry removed it/)

  // 4. A split industry stays undecided rather than guessing.
  for (let i = 0; i < 5; i += 1) await observe('722', { removed: ['work.projects'], newCompany: true })
  for (let i = 0; i < 5; i += 1) await observe('722', { kept: ['work.projects'], newCompany: true })
  const split = await verdictOf('722')
  assert.ok(!split.exclude.some(item => item.capabilityId === 'work.projects'), 'a split industry must not be decided either way')
  assert.ok(!split.include.some(item => item.capabilityId === 'work.projects'))

  // 5. What companies do outranks what the research said.
  await saveResearch('541', { capabilityIds: ['work.time', 'crm.contacts'], excludedCapabilityIds: [], summary: 'Agencies bill by the hour.', sources: [{ title: 'A source', url: 'https://example.org/a' }], model: 'test' })
  const contested = industryVerdict(await readIndustryProfile('541'))
  assert.ok(contested.exclude.some(item => item.capabilityId === 'work.time'), 'behaviour must beat research')
  assert.ok(!contested.include.some(item => item.capabilityId === 'work.time'), 'a capability cannot be both included and excluded')
  assert.ok(contested.include.some(item => item.capabilityId === 'crm.contacts' && item.basis === 'researched'), 'research still decides where behaviour is silent')
  assert.equal(contested.sources.length, 1, 'the research keeps its sources so a conclusion can be checked')

  // 6. Counting is per company, so one busy operator cannot outvote an industry.
  const before = await readIndustryProfile('623')
  await observe('623', { removed: ['work.time', 'work.time', 'work.time'], newCompany: true })
  const after = await readIndustryProfile('623')
  assert.equal(after.observed['work.time'].removed, (before.observed['work.time']?.removed ?? 0) + 1, 'a repeated id counts once')
  assert.equal(after.companies, 1)

  // 7. The store holds aggregates only — nothing that identifies a company.
  const stored = JSON.stringify(await readIndustryProfile('541'))
  assert.ok(!/workspace|record|token|company_?id/i.test(stored), `industry knowledge must stay anonymous: ${stored.slice(0, 200)}`)

  // 8. Bad input is refused rather than stored.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/industries/abc`)).status, 400)
  await observe('541', { removed: ['DROP TABLE', '../etc/passwd', 'work.projects'] })
  const sanitised = await readIndustryProfile('541')
  assert.ok(!Object.keys(sanitised.observed).some(id => /[^a-z0-9.-]/.test(id)), 'malformed capability ids must never be stored')

  console.log('Industry test passed: no verdict without evidence, a threshold before deciding, splits left open, behaviour beating research, per-company counting, anonymity, and input validation.')
} finally {
  api.kill()
  await rm(root, { recursive: true, force: true })
}
