import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import { useTestClerk, tokenFor } from './clerkStub.mjs'
import './noSpend.mjs'

/**
 * Onboarding: the name and the logo, asked before the build.
 *
 * The interesting half is not the form — it is that both answers outlive the browser that gave them
 * and reach a second device belonging to the same person, and only to that person. A workspace has
 * one owner and no members, so the other half of this file is the proof that nobody else can reach
 * it and that no route survives which could ever let them.
 */

const port = 8963
process.env.BO_GENERATED_ROOT = await mkdtemp(path.join(tmpdir(), 'bo-onboarding-'))

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
useTestClerk()
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const call = (route, { method = 'GET', token = '', workspaceId = '', body: payload } = {}) => fetch(`${base}${route}`, {
  method,
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(workspaceId ? { 'x-bo-workspace-id': workspaceId } : {}),
    'x-bo-role': 'owner',
  },
  body: payload ? JSON.stringify(payload) : undefined,
})

const ownerToken = tokenFor('user_owner')
const workspaceId = 'ws-onboarded'
const logo = `data:image/png;base64,${'A'.repeat(400)}`

try {
  // 1. The account exists before the workspace does; onboarding runs before anything is built.
  assert.equal((await call('/api/auth/me', { token: ownerToken })).status, 200)

  // 2. Saving the name and the logo is also what claims the workspace, exactly as any other first
  //    request for it would be — there is no separate "create" step to forget.
  const saved = await call(`/api/projects/${workspaceId}/setup`, { method: 'PUT', token: ownerToken, workspaceId, body: { name: 'Northwind Freight', logo } })
  const savedBody = await saved.text()
  assert.equal(saved.status, 200, `saving onboarding failed: ${savedBody}`)
  assert.equal(JSON.parse(savedBody).name, 'Northwind Freight')

  // 3. And it travels: the account's own workspace list carries both, so a second device shows the
  //    same workspace rather than an untitled one.
  const mine = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.equal(mine.workspaces.length, 1)
  assert.equal(mine.workspaces[0].name, 'Northwind Freight')
  assert.equal(mine.workspaces[0].logo, logo)

  // 4. A logo is an image, and a bounded one. Both refusals are the server's, not the browser's.
  assert.equal((await call(`/api/projects/${workspaceId}/setup`, { method: 'PUT', token: ownerToken, workspaceId, body: { logo: 'https://example.com/logo.png' } })).status, 400)
  const huge = await call(`/api/projects/${workspaceId}/setup`, { method: 'PUT', token: ownerToken, workspaceId, body: { logo: `data:image/png;base64,${'A'.repeat(200_000)}` } })
  assert.equal(huge.status, 413, 'an unbounded logo was accepted')

  /**
   * 5. Nobody else gets in, and there is no route that could let them.
   *
   * This used to be the invitation half of the file: an address was recorded, a colleague signed in,
   * and the address turned into a membership. A workspace answers to one account now, so what is
   * worth proving is the opposite — that a second account, however it asks, is refused on reading,
   * on writing and on the workspace list, and that the surface which used to grant access is gone
   * rather than merely unused.
   */
  const anaToken = tokenFor('user_ana')
  const ana = await (await call('/api/auth/me', { token: anaToken })).json()
  assert.equal(ana.workspaces.length, 0, 'a second account arrived holding somebody else’s workspace')

  const anaRead = await call(`/api/projects/${workspaceId}/setup`, { token: anaToken, workspaceId })
  assert.equal(anaRead.status, 403, 'a second account read the workspace')
  const anaRename = await call(`/api/projects/${workspaceId}/setup`, { method: 'PUT', token: anaToken, workspaceId, body: { name: 'Ana Freight' } })
  assert.equal(anaRename.status, 403, 'a second account renamed somebody else’s workspace')
  assert.equal((await call(`/api/projects/${workspaceId}/setup`, { token: tokenFor('user_stranger'), workspaceId })).status, 403, 'a stranger read the workspace')

  // The member routes are gone, not merely refusing. An unmatched path falls through to the API's
  // own not-found rather than answering as though the feature were still there.
  const goneRoute = await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: ownerToken, workspaceId, body: { email: 'user_ana@example.com', role: 'manager' } })
  assert.equal(goneRoute.status, 404, `the member route still answers (${goneRoute.status}), so a workspace can still be shared`)

  // 6. The name survived all of that, and still belongs to exactly one account.
  const stillMine = await (await call('/api/auth/me', { token: ownerToken })).json()
  assert.equal(stillMine.workspaces.length, 1)
  assert.equal(stillMine.workspaces[0].name, 'Northwind Freight')
  assert.equal(stillMine.workspaces[0].role, 'owner')

  console.log('onboarding: name and logo survive the browser that gave them, and the workspace answers to one account with no route left that could share it')
} finally {
  server.close()
}
