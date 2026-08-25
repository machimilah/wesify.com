import { query, queryOne } from './db.mjs'

/**
 * Who is signed in, according to Clerk.
 *
 * Wesify used to run its own passwords, sessions and reset links. It does not any more: Clerk holds the
 * credential, and this file is the whole of what the server does with it — verify the token it was
 * handed, and make sure a row exists locally for the person it names.
 *
 * That local row is the point. Every table Wesify owns keys off `users.id` — a workspace's owner, a
 * membership, a subscription, a rebuild — and none of them should have to know where an identity
 * came from. So `users.id` *is* the Clerk user id, written once the first time somebody appears, and
 * nothing downstream changed when the provider did.
 *
 * The email is read from Clerk's API rather than from the token, because a session token carries no
 * email unless a JWT template is configured to add one. It is fetched exactly once per person, when
 * their row is created, and is a display detail from then on — Clerk remains the authority on what
 * their address is, and Wesify never authenticates anybody by it.
 */

/** Without a secret key the server cannot verify anything, so it has no accounts. */
export function clerkConfigured() {
  return Boolean(verifier || process.env.CLERK_SECRET_KEY)
}

let verifier = null
let clerkClient = null

/**
 * Test seam. The suite hands over a pair of functions rather than a network: `verify` stands in for
 * Clerk's token verification and `profile` for its user lookup, so every path below — a bad token, a
 * first sign-in, a returning one — is exercised against the real SQL without a Clerk account.
 */
export function useClerk(replacement) {
  verifier = replacement
  clerkClient = null
}

async function verifyClerkToken(token) {
  if (verifier) return verifier.verify(token)
  const { verifyToken } = await import('@clerk/backend')
  // `authorizedParties` is worth setting once there is a fixed list of origins; until then the token's
  // signature and expiry are what is checked, which is what stops a forged or stale one.
  return verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
}

async function clerkProfile(userId) {
  if (verifier) return verifier.profile(userId)
  if (!clerkClient) {
    const { createClerkClient } = await import('@clerk/backend')
    clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  }
  const user = await clerkClient.users.getUser(userId)
  const primary = user.emailAddresses?.find(address => address.id === user.primaryEmailAddressId)
  return { email: primary?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? '' }
}

/**
 * The account behind a Clerk session token, or null.
 *
 * Null rather than a throw for every way a token can fail to name somebody — missing, malformed,
 * expired, signed by another instance. The caller's answer is the same in all of them ("sign in"),
 * and distinguishing them in the response would only tell an attacker which of their guesses was
 * closer.
 */
export async function clerkUser(token) {
  if (!token || !clerkConfigured()) return null
  let claims
  try {
    claims = await verifyClerkToken(token)
  } catch {
    return null
  }
  const id = String(claims?.sub ?? '')
  if (!id) return null

  const existing = await queryOne('select id, email from users where id = $1', [id])
  if (existing) return { id: existing.id, email: existing.email ?? '' }

  // First time this person has reached Wesify. Their address is asked for once, here, and a failure to
  // get it does not keep them out: an account with no email still owns its workspaces perfectly well.
  let email = ''
  try { email = (await clerkProfile(id)).email } catch { email = '' }
  await query(
    'insert into users (id, email) values ($1, $2) on conflict (id) do nothing',
    [id, email || null],
  )
  return { id, email }
}
