import { useClerk } from '../server/clerk.mjs'

/**
 * Clerk, for tests.
 *
 * The suite must be able to prove what the server does with a signed-in person without a Clerk
 * account, a network, or a key — so `useClerk` is handed a pair of functions instead. A token here is
 * the string `test:<clerk-user-id>`, and anything else fails verification exactly as a forged or
 * expired token would.
 *
 * What is deliberately *not* stubbed is everything below the seam: the users row, the workspace, the
 * membership and the SQL that writes them are the real ones. These tests are about Wesify's half of the
 * arrangement, and Clerk verifying its own signatures is Clerk's business to test.
 */
export function useTestClerk() {
  useClerk({
    verify: async token => {
      const [tag, sub] = String(token ?? '').split(':')
      if (tag !== 'test' || !sub) throw new Error('That token is not one this instance issued.')
      return { sub }
    },
    profile: async id => ({ email: `${id}@example.com` }),
  })
}

/** The token a test presents to act as somebody. */
export const tokenFor = clerkUserId => `test:${clerkUserId}`
