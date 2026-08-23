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
const { industryVerdict, recordObservations, readIndustryProfile, saveResearch, MIN_COMPANIES, RESEARCH_FRESH_DAYS } =
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

/**
 * Every observation now comes from a real workspace, and each workspace counts as one company.
 *
 * A test that always used the same workspace would be testing the opposite of what the store is for,
 * so the default is a fresh one per call — the same thing five separate companies reporting looks
 * like. `as` pins a workspace when a check is specifically about the same company reporting twice.
 */
let workspaceCounter = 0
const observe = (subsector, payload, as = '') => {
  const workspaceId = as || `ws-industry-${(workspaceCounter += 1)}`
  return fetch(`http://127.0.0.1:${port}/api/industries/${subsector}/observations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bo-workspace-id': workspaceId,
      'x-bo-access-token': `token-${workspaceId}`.padEnd(40, 'x'),
    },
    body: JSON.stringify({ ...payload, workspaceId }),
  }).then(response => response.json())
}
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

  /**
   * The loop is the only thing BO has that a competitor cannot copy, so writing to it is guarded.
   *
   * An open endpoint means anyone can invent companies until the industry says whatever they want,
   * and the threshold that makes the verdict trustworthy becomes the thing that makes it forgeable.
   */
  const anonymous = await fetch(`http://127.0.0.1:${port}/api/industries/541/observations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ removed: ['crm.contacts'], newCompany: true }),
  })
  assert.ok(anonymous.status === 401 || anonymous.status === 403, `an anonymous caller must not be able to write to industry knowledge, got ${anonymous.status}`)

  // One workspace is one company however often it reports, so a single caller cannot reach a verdict.
  const beforeForgery = await readIndustryProfile('813')
  for (let i = 0; i < MIN_COMPANIES * 3; i += 1) await observe('813', { removed: ['crm.pipeline'], newCompany: true }, 'ws-persistent-liar')
  const afterForgery = await readIndustryProfile('813')
  assert.equal(afterForgery.companies, (beforeForgery.companies ?? 0) + 1, 'one workspace reporting fifteen times must count as one company')
  const forged = industryVerdict(afterForgery)
  assert.ok(!forged.exclude.some(item => item.capabilityId === 'crm.pipeline'), 'one caller reached a verdict on its own')

  // Reading stays open: the knowledge is aggregate and belongs to everyone using BO.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/industries/541`)).status, 200)

  /**
   * Research stops deciding once nobody has rechecked it.
   *
   * A researched answer is what the open web said on one day. Industries change, and research with
   * no expiry means a finding from years ago keeps choosing what today's operator is given with
   * exactly the confidence it had when it was true. It is still kept and still shown — it remains
   * the best account anyone has of how the industry once worked — but it stands down.
   */
  const stale = {
    subsector: '999', label: 'Stale', companies: 0, observed: {},
    researched: { capabilityIds: ['work.projects'], excludedCapabilityIds: ['inventory.stock'], summary: 'Once true', sources: [], model: 'test', at: new Date(Date.now() - (RESEARCH_FRESH_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString() },
  }
  const staleVerdict = industryVerdict(stale)
  assert.deepEqual(staleVerdict.include, [], 'research nobody has rechecked in half a year still decided what to build')
  assert.deepEqual(staleVerdict.exclude, [], 'stale research still excluded a capability')
  assert.equal(staleVerdict.research.stale, true, 'stale research is not marked as stale')
  assert.ok(staleVerdict.research.at, 'stale research was discarded rather than kept and marked')

  const fresh = { ...stale, researched: { ...stale.researched, at: new Date().toISOString() } }
  const freshVerdict = industryVerdict(fresh)
  assert.ok(freshVerdict.include.some(item => item.capabilityId === 'work.projects'), 'fresh research stopped deciding anything')
  assert.equal(freshVerdict.research.stale, false)

  console.log('Industry test passed: no verdict without evidence, a threshold before deciding, splits left open, behaviour beating research, per-company counting, anonymity, input validation, anonymous writes refused, one workspace counting once however often it reports, and research standing down once it is too old to be evidence.')
} finally {
  api.kill()
  await rm(root, { recursive: true, force: true })
}
