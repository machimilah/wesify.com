import { useEffect, useLayoutEffect } from 'react'
import { useAuth } from '@clerk/react'
import { currentAccount, type Account, type AccountWorkspace } from '../engine/authClient'

export interface SignedInAccount { user: Account; workspaces: AccountWorkspace[] }

/**
 * Keeps Wesify's idea of who is signed in tied to Clerk's, rather than to a moment.
 *
 * Wesify used to ask once, at boot: fetch the session token, call /api/auth/me, done. That is a race
 * it cannot win. Clerk loads its own script and restores the session asynchronously, so "ask now"
 * means asking before there is a token to ask with — and the answer, "nobody", was then kept
 * forever. The visible symptom was the sign-in screen refusing to open for somebody who was already
 * signed in, because Clerk will not render a sign-in form to a person who has a session.
 *
 * So this watches instead. `isLoaded` says Clerk has finished deciding, `isSignedIn` says what it
 * decided, and every change is reported up — including the ones that happen long after boot: signing
 * out in another tab, a session revoked from a phone, a token that stops being renewed.
 *
 * It renders nothing. It exists to hold a hook, which is the one thing a plain module cannot do, and
 * it is mounted only where the Clerk provider is (see App.tsx) because `useAuth` requires it.
 */
export function AccountWatch({ onChange, onSessionChange }: {
  /** `null` means nobody. `signedInWithClerk` separates "signed out" from "signed in, but Wesify could not say who". */
  onChange: (account: SignedInAccount | null, signedInWithClerk: boolean) => void
  /** Report Clerk's decision before the slower Wesify account request finishes. */
  onSessionChange: (state: 'signed-in' | 'signed-out') => void
}) {
  const { isLoaded, isSignedIn } = useAuth()

  useLayoutEffect(() => {
    if (!isLoaded) return
    onSessionChange(isSignedIn ? 'signed-in' : 'signed-out')
  }, [isLoaded, isSignedIn, onSessionChange])

  useEffect(() => {
    // Still deciding. Reporting anything here is what caused the bug this component exists to fix.
    if (!isLoaded) return
    if (!isSignedIn) return onChange(null, false)
    let cancelled = false
    void (async () => {
      // This is also the call that creates the Wesify account the first time somebody appears.
      const found = await currentAccount()
      if (!cancelled) onChange(found, true)
    })()
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn, onChange])

  return null
}
