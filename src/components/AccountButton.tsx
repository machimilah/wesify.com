import { UserButton } from '@clerk/clerk-react'

/**
 * The way out, and the only account control Wesify renders.
 *
 * Clerk's own menu rather than a "Sign out" of Wesify's: it is also where a person changes their email,
 * their password, or the devices they are signed in on — none of which Wesify stores, and all of which
 * it would otherwise have to build a settings page for.
 *
 * The key check is what keeps this safe to place anywhere. `UserButton` needs the Clerk provider, and
 * that provider is mounted only when this build has a publishable key (see main.tsx), so without one
 * this renders nothing instead of throwing inside a workspace that never had accounts.
 */
export function AccountButton() {
  if (!String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim()) return null
  // Back to the prompt, which is the only page a signed-out person can use.
  return <UserButton afterSignOutUrl="/"/>
}
