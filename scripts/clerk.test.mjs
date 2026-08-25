import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { useDatabase, migrate, query } from '../server/db.mjs'
import { clerkConfigured, clerkUser, useClerk } from '../server/clerk.mjs'
import './noSpend.mjs'

/**
 * The seam between a Clerk identity and a Wesify account.
 *
 * One thing happens here that happens nowhere else: the first time somebody signed in with Clerk
 * reaches Wesify, a row is written for them, and every workspace, membership and subscription from then
 * on hangs off it. So this checks what that row is made of, and — just as important — what it costs:
 * a returning person must not send Wesify back to Clerk's API on every request.
 */

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

let verifications = 0
let profileLookups = 0
const install = ({ profile } = {}) => useClerk({
  verify: async token => {
    verifications += 1
    const [tag, sub] = String(token ?? '').split(':')
    if (tag !== 'test' || !sub) throw new Error('bad token')
    return { sub }
  },
  profile: profile ?? (async id => { profileLookups += 1; return { email: `${id}@example.com` } }),
})

install()
assert.equal(clerkConfigured(), true, 'a configured instance said it was not configured')

// 1. Nothing presented, nothing granted — and no verification attempted for an empty token.
assert.equal(await clerkUser(''), null)
assert.equal(await clerkUser(null), null)
assert.equal(verifications, 0, 'an empty token was sent to Clerk to be verified')

// 2. A token Clerk refuses names nobody, and writes nobody.
assert.equal(await clerkUser('forged'), null)
assert.equal((await query('select id from users')).rows.length, 0, 'a refused token created an account')

// 3. First sign-in: the row is created, keyed by the Clerk user id, carrying the address Clerk holds.
const first = await clerkUser('test:user_alice')
assert.deepEqual(first, { id: 'user_alice', email: 'user_alice@example.com' })
const stored = await query('select id, email from users')
assert.equal(stored.rows.length, 1)
assert.deepEqual(stored.rows[0], { id: 'user_alice', email: 'user_alice@example.com' })

// 4. Returning: the token is still verified every time, but Clerk's API is asked about a person once.
const again = await clerkUser('test:user_alice')
assert.deepEqual(again, { id: 'user_alice', email: 'user_alice@example.com' })
assert.equal(profileLookups, 1, 'a returning person cost another call to Clerk')
assert.equal((await query('select id from users')).rows.length, 1, 'a second sign-in created a second account')

// 5. A profile Clerk cannot produce does not keep somebody out. They own workspaces perfectly well
//    without an address, and it is a display detail rather than what they are identified by.
install({ profile: async () => { throw new Error('Clerk is down') } })
const nameless = await clerkUser('test:user_bob')
assert.deepEqual(nameless, { id: 'user_bob', email: '' })
assert.equal((await query('select email from users where id = $1', ['user_bob'])).rows[0].email, null)

// 6. With no instance configured there are no accounts, whatever anybody presents.
useClerk(null)
delete process.env.CLERK_SECRET_KEY
assert.equal(clerkConfigured(), false)
assert.equal(await clerkUser('test:user_alice'), null, 'a token was accepted with no Clerk instance to verify it against')

console.log('Clerk test passed: empty and forged tokens name nobody and write nothing, a first sign-in creates exactly one row keyed by the Clerk id, a returning one costs no further Clerk call, a missing profile does not lock anybody out, and an unconfigured instance grants nothing.')
