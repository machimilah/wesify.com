import { useEffect, useState } from 'react'
import { SignIn as ClerkSignIn, useAuth } from '@clerk/react'
import { currentAccount, type Account, type AccountWorkspace } from '../engine/authClient'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * The way in, when Wesify has accounts.
 *
 * The form used to be Wesify's own — two fields, a third mode for forgotten passwords, and a server that
 * hashed and mailed. Clerk owns all of that now, including the parts Wesify never built: verification
 * codes, social sign-in, and whatever a Clerk instance is configured to offer next week. What is left
 * here is the page around it, and the one step Clerk cannot take.
 *
 * That step is the handoff. Clerk signing somebody in proves who they are; it does not tell Wesify
 * anything, because Wesify's own account row and the workspaces attached to it live in Wesify's database.
 * So the moment Clerk reports a session, this asks the server who that is — which is also what creates
 * the local row the first time — and hands the answer up.
 *
 * No routing props: Wesify routes by reading `window.location` itself rather than through a router
 * Clerk could hook into, and with no `path` given the component keeps its flow on this screen
 * instead of pushing paths that App.tsx would then have to know about.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (account: Account, workspaces: AccountWorkspace[]) => void }) {
  /**
   * A server with accounts and an interface built without a Clerk key is a real deployment mistake —
   * the two are configured in different places, by different people, at different times. Saying so is
   * the whole of what can be done about it here, and it must be said without touching a Clerk hook:
   * those need the provider, which is exactly what is missing.
   */
  if (!String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim()) {
    return <main className="bo-signin">
      <ThemeToggle className="bo-signin__theme-toggle"/>
      <div className="bo-signin__panel" data-testid="signin-form">
        <Brand/>
        <div className="bo-signin-error" role="alert" data-testid="signin-error">
          This copy of Wesify was built without a sign-in key, so nobody can sign in. Set VITE_CLERK_PUBLISHABLE_KEY and build it again.
        </div>
      </div>
    </main>
  }
  return <ClerkGate onSignedIn={onSignedIn}/>
}

function ClerkGate({ onSignedIn }: { onSignedIn: (account: Account, workspaces: AccountWorkspace[]) => void }) {
  const { isLoaded, isSignedIn } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    let cancelled = false
    void (async () => {
      const found = await currentAccount()
      if (cancelled) return
      // Signed in with Clerk but unknown to Wesify means the server refused the token — a key from a
      // different Clerk instance, or a database that is down. Saying so beats a screen that sits on
      // "one moment" forever.
      if (!found) return setError('You are signed in, but Wesify could not open your account. Try again in a moment.')
      // Both halves, because this call already fetched them: the workspaces are what decides where
      // the person lands, and asking the server a second time for what is in hand is a round trip
      // spent on a screen whose whole job is to get out of the way.
      onSignedIn(found.user, found.workspaces)
    })()
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn, onSignedIn])

  return <main className="bo-signin">
    <ThemeToggle className="bo-signin__theme-toggle"/>
    <div className="bo-signin__panel" data-testid="signin-form">
      <Brand/>
      {error
        ? <div className="bo-signin-error" role="alert" data-testid="signin-error">{error}</div>
        : <ClerkSignIn
            /**
             * Signing up happens here too, rather than behind a link to Clerk's hosted pages.
             *
             * Almost everybody arriving at Wesify is new, and the alternative sends exactly those
             * people off to another domain in the middle of describing their company. One screen,
             * both jobs, which is what this screen always was.
             */
            withSignUp
            /**
             * Something in the shape of the form while Clerk's own script is still arriving.
             *
             * Without it the panel is empty for as long as that takes, and an empty panel under a
             * logo reads as a page that has finished loading badly rather than one still loading.
             */
            fallback={<div className="bo-signin__loading" aria-hidden="true"><i/><i/><i/></div>}
            appearance={{ variables: { colorBackground: 'transparent' } }}
          />}
    </div>
  </main>
}
