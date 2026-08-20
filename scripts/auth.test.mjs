import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { useDatabase, migrate, query } from '../server/db.mjs'
import {
  authenticate, claimWorkspace, createSession, destroyAllSessions, destroySession,
  hashPassword, membership, registerUser, sessionUser, verifyPassword, workspacesFor,
  MIN_PASSWORD_LENGTH,
} from '../server/auth.mjs'

/**
 * BO's own user management.
 *
 * Writing your own accounts is where products quietly get this wrong: a password stored in a form
 * something can reverse, a session that never ends, a login that answers faster for addresses that
 * exist. These are the checks that make writing it defensible instead of reckless.
 *
 * pg-mem runs the real migration and the real SQL, so the schema is exercised rather than mocked.
 */

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())

const ran = await migrate()
assert.ok(ran.includes('001_accounts.sql'), `the accounts migration did not run: ${ran.join(', ')}`)
assert.deepEqual(await migrate(), [], 'migrations must not run twice')

// 1. A password is never recoverable from what is stored.
const hash = await hashPassword('correct horse battery staple')
assert.ok(!hash.includes('correct'), 'the password appeared in its own hash')
assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/, 'the hash does not carry the parameters it was made with')
assert.equal(await verifyPassword('correct horse battery staple', hash), true)
assert.equal(await verifyPassword('correct horse battery stapl', hash), false)

// The same password twice must not produce the same stored value, or the database tells an attacker
// which accounts share one.
assert.notEqual(await hashPassword('same password here'), await hashPassword('same password here'))

// 2. Signing up.
const user = await registerUser('  Operator@Example.COM ', 'a-long-enough-password')
assert.equal(user.email, 'operator@example.com', 'email must be normalised or the same person gets two accounts')

await assert.rejects(registerUser('operator@example.com', 'a-long-enough-password'), /already has an account/i)
await assert.rejects(registerUser('not-an-email', 'a-long-enough-password'), /valid email/i)
await assert.rejects(registerUser('short@example.com', 'x'.repeat(MIN_PASSWORD_LENGTH - 1)), /at least/i)
await assert.rejects(registerUser('same@example.com', 'same@example.com'), /cannot be your email/i)
await assert.rejects(registerUser('long@example.com', 'x'.repeat(500)), /limited to/i)

const stored = (await query('select password_hash from users where email = $1', ['operator@example.com'])).rows[0]
assert.ok(!stored.password_hash.includes('a-long-enough-password'), 'the plaintext password reached the database')

// 3. Signing in.
const signedIn = await authenticate('OPERATOR@example.com', 'a-long-enough-password')
assert.equal(signedIn.id, user.id, 'email comparison must not be case sensitive')
await assert.rejects(authenticate('operator@example.com', 'wrong-password-entirely'), /do not match/i)

// The same message either way, so the form cannot be used to find out who has an account.
const unknown = await authenticate('nobody@example.com', 'whatever-password').catch(error => error)
const wrong = await authenticate('operator@example.com', 'whatever-password').catch(error => error)
assert.equal(unknown.message, wrong.message, 'a missing account and a wrong password must not be distinguishable')
assert.equal(unknown.status, 401)

// 4. Sessions.
const session = await createSession(user.id)
assert.ok(session.token.length >= 40, 'a session token must not be guessable')
const rows = await query('select token_hash from sessions')
assert.ok(!rows.rows.some(row => row.token_hash === session.token), 'the raw session token was stored')

assert.equal((await sessionUser(session.token))?.email, 'operator@example.com')
assert.equal(await sessionUser('not-a-real-token'), null)
assert.equal(await sessionUser(''), null)

// An expired session is not a session, and is cleaned up as it is met.
await query('update sessions set expires_at = $1 where token_hash is not null', [new Date(Date.now() - 1000)])
assert.equal(await sessionUser(session.token), null, 'an expired session still authenticated someone')
assert.equal((await query('select token_hash from sessions')).rows.length, 0, 'the expired session was left behind')

const active = await createSession(user.id)
await destroySession(active.token)
assert.equal(await sessionUser(active.token), null, 'signing out did not end the session')

const first = await createSession(user.id)
const second = await createSession(user.id)
await destroyAllSessions(user.id)
assert.equal(await sessionUser(first.token), null)
assert.equal(await sessionUser(second.token), null, 'signing out everywhere left a session alive')

// 5. Workspaces belong to somebody.
const stranger = await registerUser('stranger@example.com', 'another-long-password')
await claimWorkspace('ws-1', user.id, 'Plumbing')
assert.equal((await membership('ws-1', user.id))?.role, 'owner')
assert.equal(await membership('ws-1', stranger.id), null, 'a stranger is not a member of someone else’s workspace')
await assert.rejects(claimWorkspace('ws-1', stranger.id), /belongs to someone else/i)

// Claiming your own workspace twice is what a reconnecting browser does, and must be harmless.
await claimWorkspace('ws-1', user.id)
assert.equal((await workspacesFor(user.id)).length, 1)
assert.equal((await workspacesFor(stranger.id)).length, 0)

// 6. Deleting a person takes their sessions and workspaces with them.
await createSession(stranger.id)
await claimWorkspace('ws-2', stranger.id)
await query('delete from users where id = $1', [stranger.id])
assert.equal((await query('select token_hash from sessions where user_id = $1', [stranger.id])).rows.length, 0, 'sessions outlived the account')
assert.equal((await query('select id from workspaces where id = $1', ['ws-2'])).rows.length, 0, 'workspaces outlived their owner')

console.log('Auth test passed: passwords hashed and salted, no plaintext stored, sign-in indistinguishable for unknown accounts, session tokens stored only as hashes, expiry and sign-out honoured, workspaces owned, and deleting an account taking its sessions and workspaces with it.')
