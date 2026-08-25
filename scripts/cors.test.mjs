import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import './noSpend.mjs'

/**
 * The interface and the API are allowed to live on different hosts.
 *
 * They do not, on a laptop or in the container: one process serves `dist` and `/api`, no request is
 * cross-origin, and none of this runs. They do the moment the interface is deployed to a static host
 * — and then a browser refuses every call unless the server says which origins may make them. The
 * failure is invisible server-side: the request is answered correctly and the browser throws it away.
 *
 * So this asserts the parts a browser actually enforces: the preflight, the allow header echoed for a
 * known origin, silence for an unknown one, `Vary: Origin` so a cache cannot serve one origin's
 * permission to another, and the headers present on failures too — a 401 a browser cannot read is
 * reported as a network error, which hides the one thing the operator needed to be told.
 */

const port = 8975
const allowed = 'https://wesify.vercel.app'
const preview = 'https://wesify-git-branch-acme.vercel.app'
const stranger = 'https://not-wesify.example'

const workingDirectory = await mkdtemp(path.join(tmpdir(), 'bo-cors-'))
const server = spawn(process.execPath, [path.resolve('server/index.mjs'), '--port', String(port)], {
  cwd: workingDirectory,
  env: { ...process.env, BO_ALLOWED_ORIGINS: `${allowed}, https://*.vercel.app`, BO_GENERATED_ROOT: path.join(workingDirectory, 'generated-projects') },
  stdio: 'pipe',
})
server.stderr.on('data', chunk => process.stderr.write(chunk))
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the project service.')
}

const base = `http://127.0.0.1:${port}`

try {
  // 1. The preflight a browser sends before any call carrying a token header.
  const flight = await fetch(`${base}/api/discovery/turn`, {
    method: 'OPTIONS',
    headers: { origin: allowed, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  })
  assert.equal(flight.status, 204, 'The preflight was not answered.')
  assert.equal(flight.headers.get('access-control-allow-origin'), allowed)
  assert.equal(flight.headers.get('access-control-allow-credentials'), 'true')
  for (const header of ['authorization', 'x-bo-workspace-id', 'x-bo-access-token', 'x-bo-role']) {
    assert.ok(flight.headers.get('access-control-allow-headers')?.includes(header), `${header} is not allowed, so every authenticated call is blocked`)
  }

  // 2. A real request from that origin carries the permission back.
  const answered = await fetch(`${base}/api/health`, { headers: { origin: allowed } })
  assert.equal(answered.status, 200)
  assert.equal(answered.headers.get('access-control-allow-origin'), allowed)
  assert.ok((answered.headers.get('vary') ?? '').includes('Origin'), 'without Vary a cache can hand one origin the permission granted to another')

  // 3. Vercel names every preview deployment differently, so one wildcard entry has to cover them.
  const previewed = await fetch(`${base}/api/health`, { headers: { origin: preview } })
  assert.equal(previewed.headers.get('access-control-allow-origin'), preview, 'preview deployments are refused, so every branch build is broken')

  // 4. An origin nobody named gets nothing — the allowlist is the point.
  const refused = await fetch(`${base}/api/health`, { headers: { origin: stranger } })
  assert.equal(refused.status, 200, 'the server still answers; it is the browser that must refuse')
  assert.equal(refused.headers.get('access-control-allow-origin'), null, 'an unlisted origin was granted access')
  const refusedFlight = await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { origin: stranger, 'access-control-request-method': 'GET' } })
  assert.equal(refusedFlight.status, 403, 'an unlisted origin was told its preflight succeeded')

  // 5. Failures carry the headers too, or the browser reports them as an opaque network error.
  // A workspace route with no identity: a refusal that exists whether or not accounts are configured.
  const refusal = await fetch(`${base}/api/projects/ws-any`, { headers: { origin: allowed } })
  assert.ok(refusal.status >= 400, `expected a refusal, got ${refusal.status}`)
  assert.equal(refusal.headers.get('access-control-allow-origin'), allowed, 'a refusal the browser cannot read is a refusal nobody can act on')

  // 6. Same-origin deployments are untouched: no Origin header, no allow header, nothing changes.
  const sameOrigin = await fetch(`${base}/api/health`)
  assert.equal(sameOrigin.status, 200)
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), null)

  console.log('CORS test passed: the preflight is answered for a named origin and its previews, refused for an unlisted one, echoed on failures so a browser can read them, marked Vary so no cache confuses two origins, and absent entirely when the interface and the API share a host.')
} finally {
  server.kill()
  await rm(workingDirectory, { recursive: true, force: true })
}
