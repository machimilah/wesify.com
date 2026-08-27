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
assert.ok(ran.includes('001_accounts.sql'), `the accounts migration did not run: ${ran.join(', ')}`)
assert.ok(ran.includes('008_clerk_identities.sql'), 'the Clerk migration did not run')
assert.deepEqual(await migrate(), [], 'migrations must not run twice')

// 1. The tables that held credentials are gone, so there is nothing left to leak.
const tables = await query("select table_name from information_schema.tables where table_schema = 'public'")
for (const table of ['sessions', 'password_resets']) {
  assert.equal(tables.rows.some(row => row.table_name === table), false, `${table} survived the move to Clerk`)
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

// The dashboard shows only workspaces this account created, not every workspace it was invited to.
await claimWorkspace('ws-shared', user.id, 'Shared workspace')
await query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', ['ws-shared', stranger.id, 'employee'])
assert.equal((await workspacesFor(user.id)).some(row => row.id === 'ws-shared'), true, 'an owner must still see the workspace they created')
assert.equal((await workspacesFor(stranger.id)).some(row => row.id === 'ws-shared'), false, 'a collaborator must not see someone else’s workspace in the dashboard list')

// 4. Deleting a person takes their workspaces with them.
await claimWorkspace('ws-2', stranger.id)
await query('delete from users where id = $1', [stranger.id])
assert.equal((await query('select id from workspaces where id = $1', ['ws-2'])).rows.length, 0, 'workspaces outlived their owner')

console.log('Auth test passed: no credential tables left behind, a Clerk id is the account id, workspaces owned by exactly one account, strangers refused, re-claiming harmless, and deleting an account taking its workspaces with it.')
