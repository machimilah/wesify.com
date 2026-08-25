import { SignIn as ClerkSignIn } from '@clerk/react'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * The way in, when Wesify has accounts.
 *
 * The form used to be Wesify's own — two fields, a third mode for forgotten passwords, and a server that
 * hashed and mailed. Clerk owns all of that now, including the parts Wesify never built: verification
 * codes, social sign-in, and whatever a Clerk instance is configured to offer next week. What is left
 * here is the page around it, and nothing else.
 *
 * Nothing else is the point. This screen used to also watch for a session and fetch the account when
 * one appeared — which meant the fetch only happened while this screen was on screen, and only while
 * Clerk agreed to render it. Clerk refuses to render a sign-in form to somebody who already has a
 * session, so the one case that most needed noticing was the one case nothing was watching. That job
 * belongs to `AccountWatch`, which is mounted on every page and never unmounts.
 *
 * No routing props: Wesify routes by reading `window.location` itself rather than through a router
 * Clerk could hook into, and with no `path` given the component keeps its flow on this screen
 * instead of pushing paths that App.tsx would then have to know about.
 */
export function SignIn({ unreachable = false }: {
  /** Signed in with Clerk, but the server would not say who. See App.tsx. */
  unreachable?: boolean
}) {
  /**
   * A server with accounts and an interface built without a Clerk key is a real deployment mistake —
   * the two are configured in different places, by different people, at different times. Saying so is
   * the whole of what can be done about it here.
   */
  const configured = Boolean(String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim())
  const problem = !configured
    ? 'This copy of Wesify was built without a sign-in key, so nobody can sign in. Set VITE_CLERK_PUBLISHABLE_KEY and build it again.'
    : unreachable
      ? 'You are signed in, but Wesify could not open your account. Try again in a moment.'
      : ''

  return <main className="bo-signin">
    <ThemeToggle className="bo-signin__theme-toggle"/>
    <div className="bo-signin__panel" data-testid="signin-form">
      <Brand/>
      {problem
        ? <div className="bo-signin-error" role="alert" data-testid="signin-error">{problem}</div>
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
