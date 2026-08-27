import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { useDatabase, migrate, query } from '../server/db.mjs'
import { claimWorkspace, membership, sessionUser, workspacesFor } from '../server/auth.mjs'
import { useTestClerk, tokenFor } from './clerkStub.mjs'
import './noSpend.mjs'

/**
 * Who owns what.
 *
 * Wesify used to hash its own passwords and mint its own sessions, and most of this file tested that.
 * Clerk holds the credential now, so what is left is the half Wesify never handed over: a workspace
 * belongs to exactly one account, a stranger is not a member of it, and deleting a person takes their
 * workspaces with them. `clerk.test.mjs` covers the seam where an identity becomes a Wesify account.
 *
 * pg-mem runs the real migration and the real SQL, so the schema is exercised rather than mocked.
 */

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
useTestClerk()

const ran = await migrate()
assert.ok(ran.includes('001_identity_and_workspaces.sql'), `the identity migration did not run: ${ran.join(', ')}`)
assert.deepEqual(await migrate(), [], 'migrations must not run twice')

// 1. Nothing here holds a credential, and nothing here holds a second person.
//
// The credential tables went when Clerk took over authentication; the membership and invite tables
// went when a workspace became answerable to exactly one account. Both are asserted rather than
// assumed, because either one reappearing is a way for a workspace to become visible to somebody it
// does not belong to.
const tables = await query("select table_name from information_schema.tables where table_schema = 'public'")
for (const table of ['sessions', 'password_resets', 'workspace_members', 'workspace_invites']) {
  assert.equal(tables.rows.some(row => row.table_name === table), false, `${table} exists, so a workspace can be reached by more than its owner`)
}
const columns = await query("select column_name from information_schema.columns where table_name = 'users'")
assert.equal(columns.rows.some(row => row.column_name === 'password_hash'), false, 'users still has somewhere to put a password')

// 2. A token names a person, and a bad one names nobody.
const user = await sessionUser(tokenFor('user_operator'))
assert.equal(user.id, 'user_operator', 'users.id must be the Clerk user id')
assert.equal(await sessionUser('not-a-real-token'), null)
assert.equal(await sessionUser(''), null)

// 3. Workspaces belong to somebody.
const stranger = await sessionUser(tokenFor('user_stranger'))
await claimWorkspace('ws-1', user.id, 'Plumbing')
assert.equal((await membership('ws-1', user.id))?.role, 'owner')
assert.equal(await membership('ws-1', stranger.id), null, 'a stranger is not a member of someone else’s workspace')
await assert.rejects(claimWorkspace('ws-1', stranger.id), /belongs to someone else/i)

// Claiming your own workspace twice is what a reconnecting browser does, and must be harmless.
await claimWorkspace('ws-1', user.id)
assert.equal((await workspacesFor(user.id)).length, 1)
assert.equal((await workspacesFor(stranger.id)).length, 0)

// The dashboard shows the workspaces this account owns, and there is no other way onto that list.
// Nobody can be added to somebody else's workspace, because there is nowhere to record it.
await claimWorkspace('ws-second', user.id, 'Second workspace')
assert.equal((await workspacesFor(user.id)).some(row => row.id === 'ws-second'), true, 'an owner must see the workspace they created')
assert.equal((await workspacesFor(stranger.id)).some(row => row.id === 'ws-second'), false, 'a stranger must not see someone else’s workspace in the dashboard list')
assert.equal(await membership('ws-second', stranger.id), null, 'a stranger was granted a role on a workspace that is not theirs')

// A deleted workspace is nobody's, including the owner's. The row survives as a tombstone so the id
// cannot be claimed again, and that survival must not put it back on anybody's list.
await query('update workspaces set deleted_at = now() where id = $1', ['ws-second'])
assert.equal((await workspacesFor(user.id)).some(row => row.id === 'ws-second'), false, 'a deleted workspace came back in the owner’s list')
assert.equal(await membership('ws-second', user.id), null, 'a deleted workspace still authorized its owner')

// 4. Deleting a person takes their workspaces with them.
await claimWorkspace('ws-2', stranger.id)
await query('delete from users where id = $1', [stranger.id])
assert.equal((await query('select id from workspaces where id = $1', ['ws-2'])).rows.length, 0, 'workspaces outlived their owner')

console.log('Auth test passed: no credential or membership tables left behind, a Clerk id is the account id, workspaces owned by exactly one account with no second way in, strangers refused, deleted workspaces off every list, re-claiming harmless, and deleting an account taking its workspaces with it.')
