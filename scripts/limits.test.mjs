import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import './noSpend.mjs'

/**
 * BO must not be free to run up its owner's model bill.
 *
 * One endpoint here cannot ask for a workspace token, because it is the call that creates the
 * workspace — which means the address of a deployment is enough to reach it. Until there are accounts,
 * a rate limit and a daily ceiling are the whole defence, so they had better hold.
 *
 * No API key is configured in this run. That is deliberate: the limits have to be spent *before* the
 * model is reached, so a refused request costs nothing at all.
 */

const port = 8953
const root = await mkdtemp(path.join(tmpdir(), 'bo-limits-'))

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, BO_GENERATED_ROOT: root, ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', BO_MODEL_RATE_LIMIT: '5', BO_DAILY_MODEL_CALLS: '8' },
  stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('The project service did not start.')
}

const turn = (caller = '203.0.113.7') => fetch(`http://127.0.0.1:${port}/api/discovery/turn`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': caller },
  body: JSON.stringify({ mode: 'DISCOVER', capabilityIds: ['crm.contacts'], modules: ['customers'], conversation: [] }),
})

try {
  // 1. Under the limit the request is attempted. With no key configured that ends in 503, not 429 —
  //    which is the point: it got as far as the model and was stopped by configuration, not by us.
  const first = await turn()
  assert.ok(first.status !== 429, `the first request must not be rate limited, got ${first.status}`)

  // 2. One caller cannot hold the endpoint open.
  let limited = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await turn()
    if (response.status === 429) { limited = await response.json(); break }
  }
  assert.ok(limited, 'a caller was never rate limited after exceeding the window')
  assert.match(limited.error, /try again in \d+ seconds/i)

  // 3. A different caller is not punished for the first one's behaviour.
  const other = await turn('198.51.100.4')
  assert.notEqual(other.status, 429, 'one noisy caller must not lock everyone else out')

  // 4. Many callers of one request each still cannot exceed the deployment's daily budget.
  let exhausted = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await turn(`198.51.100.${attempt + 10}`)
    if (response.status === 429) {
      const detail = await response.json()
      if (/budget/i.test(detail.error)) { exhausted = detail; break }
    }
  }
  assert.ok(exhausted, 'the daily model budget was never enforced across callers')
  assert.match(exhausted.error, /model budget for today/i)

  // 5. Nothing that does not cost money is affected by any of this.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200)
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/research/status`)).status, 200)

  console.log('Limits test passed: one caller throttled, other callers unaffected, a deployment-wide daily ceiling enforced across callers, and free endpoints left alone.')
} finally {
  api.kill()
  await rm(root, { recursive: true, force: true })
}
