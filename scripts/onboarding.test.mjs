import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate, query } from '../server/db.mjs'
import { useTestClerk, tokenFor } from './clerkStub.mjs'
import './noSpend.mjs'

/**
 * Onboarding: the name, the logo and the colleagues, asked before the build.
 *
 * The interesting half is not the form — it is that the three answers outlive the browser that gave
 * them. A name and a logo have to reach a second device; an invitation has to reach somebody who
 * does not have an account yet, and turn into a real membership at the moment they sign in. That
 * last one is the whole point of the invites table, and it is what this proves.
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

  // 5. A second person in a workspace is what the Business plan sells, so the free plan is refused
  //    — and refused before anything is recorded.
  const refused = await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: ownerToken, workspaceId, body: { email: 'user_ana@example.com', role: 'manager' } })
  assert.equal(refused.status, 402, `inviting on the free plan was allowed (${refused.status})`)
  assert.deepEqual((await (await call(`/api/projects/${workspaceId}/members`, { token: ownerToken, workspaceId })).json()).invites, [])

  await query("insert into subscriptions (user_id, plan, status) values ($1, 'business', 'active')", ['user_owner'])

  // 6. On a plan that allows it, the invitation is recorded against an address — nobody has to have
  //    an account for this to work, which is the entire difficulty it exists to solve.
  const invited = await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: ownerToken, workspaceId, body: { email: 'User_Ana@Example.com', role: 'manager' } })
  const invitedBody = await invited.text()
  assert.equal(invited.status, 201, `inviting failed: ${invitedBody}`)
  assert.deepEqual(JSON.parse(invitedBody), { email: 'user_ana@example.com', role: 'manager' })
  assert.equal((await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: ownerToken, workspaceId, body: { email: 'not-an-address' } })).status, 400)

  const team = await (await call(`/api/projects/${workspaceId}/members`, { token: ownerToken, workspaceId })).json()
  assert.equal(team.members.length, 1, 'the owner should be the only member so far')
  assert.deepEqual(team.invites.map(invite => [invite.email, invite.role]), [['user_ana@example.com', 'manager']])

  // 7. Until she signs in, the invitation buys nothing: an address on a list is not access.
  const anaToken = tokenFor('user_ana')
  const beforeSignIn = await call(`/api/projects/${workspaceId}/setup`, { token: tokenFor('user_stranger'), workspaceId })
  assert.equal(beforeSignIn.status, 403, 'a stranger read an invited workspace')

  // 8. Signing in is how an invitation is accepted. No link, no token: the address Clerk verified is
  //    the proof, and the workspace is simply there when she arrives.
  const ana = await (await call('/api/auth/me', { token: anaToken })).json()
  assert.equal(ana.workspaces.length, 1, 'an invited colleague did not receive the workspace on sign-in')
  assert.equal(ana.workspaces[0].id, workspaceId)
  assert.equal(ana.workspaces[0].role, 'manager')
  assert.equal(ana.workspaces[0].name, 'Northwind Freight')

  // 9. Redeeming happens once. Signing in again must not re-add her or resurrect the invitation.
  const anaAgain = await (await call('/api/auth/me', { token: anaToken })).json()
  assert.equal(anaAgain.workspaces.length, 1)
  const afterJoin = await (await call(`/api/projects/${workspaceId}/members`, { token: ownerToken, workspaceId })).json()
  assert.equal(afterJoin.members.length, 2, 'the invited colleague is not a member')
  assert.deepEqual(afterJoin.invites, [], 'an accepted invitation is still shown as waiting')

  // 10. Somebody already in the workspace cannot be invited into it a second time.
  assert.equal((await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: ownerToken, workspaceId, body: { email: 'user_ana@example.com' } })).status, 409)

  // 11. A member who is not an owner or admin cannot rename the workspace or invite anybody.
  assert.equal((await call(`/api/projects/${workspaceId}/setup`, { method: 'PUT', token: anaToken, workspaceId, body: { name: 'Ana Freight' } })).status, 403)
  assert.equal((await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: anaToken, workspaceId, body: { email: 'user_luis@example.com' } })).status, 403)

  // 12. An invitation can be withdrawn before it is accepted.
  await call(`/api/projects/${workspaceId}/members`, { method: 'POST', token: ownerToken, workspaceId, body: { email: 'user_luis@example.com', role: 'employee' } })
  assert.equal((await call(`/api/projects/${workspaceId}/members/${encodeURIComponent('user_luis@example.com')}`, { method: 'DELETE', token: ownerToken, workspaceId })).status, 200)
  const withdrawn = await (await call(`/api/projects/${workspaceId}/members`, { token: ownerToken, workspaceId })).json()
  assert.deepEqual(withdrawn.invites, [], 'a withdrawn invitation is still waiting')
  assert.equal((await (await call('/api/auth/me', { token: tokenFor('user_luis') })).json()).workspaces.length, 0, 'a withdrawn invitation still let somebody in')

  console.log('onboarding: name, logo and invitations survive the browser that gave them')
} finally {
  server.close()
}
