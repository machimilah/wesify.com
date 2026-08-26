import { SignIn as ClerkSignIn } from '@clerk/react'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Brand } from './Brand'
import './SignIn.css'

/**
 * The way in, when Wesify has accounts — a panel over the product rather than a page of its own.
 *
 * It was a page, at /signin, and being a page is what was wrong with it: describing a company is
 * public and takes one sentence, and the moment somebody finished typing it they were navigated away
 * from everything they had just seen to a screen with a logo and a form on it. Sending a person who
 * is mid-thought to a different address to prove who they are is how you lose them between two
 * screens. The prompt stays exactly where it was, and Wesify asks over the top of it.
 *
 * The form inside is Clerk's — verification codes, social sign-in, forgotten passwords, and whatever
 * that instance is configured to offer next week. What is here is the panel around it and nothing
 * else: no session watching, which `AccountWatch` does on every page and never unmounts, and no
 * routing, which App.tsx owns.
 */
export function SignInDialog({ open, unreachable = false, onClose }: {
  open: boolean
  /** Signed in with Clerk, but the server would not say who. See App.tsx. */
  unreachable?: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!open) {
      if (dialog.open) dialog.close()
      return
    }
    if (!dialog.open) dialog.showModal()
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = previousOverflow }
  }, [open])

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

  return <dialog
    ref={dialogRef}
    className="wes-signin"
    aria-labelledby="wes-signin-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClose={onClose}
  >
    <div className="wes-signin__panel" data-testid="signin-form">
      <header>
        <div>
          <Brand inverse/>
          <p id="wes-signin-title">Sign in or create your account to keep building.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close sign in" data-testid="close-signin"><X size={17}/></button>
      </header>

      {problem
        ? <div className="wes-signin__error" role="alert" data-testid="signin-error">{problem}</div>
        : <ClerkSignIn
            /**
             * Signing up happens here too, rather than behind a link to Clerk's hosted pages.
             *
             * Almost everybody arriving at Wesify is new, and the alternative sends exactly those
             * people off to another domain in the middle of describing their company. One panel,
             * both jobs, which is what this always was.
             */
            withSignUp
            /**
             * Something in the shape of the form while Clerk's own script is still arriving.
             *
             * Without it the panel is empty for as long as that takes, and an empty panel under a
             * logo reads as a page that has finished loading badly rather than one still loading.
             */
            fallback={<div className="wes-signin__loading" aria-hidden="true"><i/><i/><i/></div>}
            appearance={{
              // The panel is dark in both themes, like every other product surface Wesify opens over a
              // page, so Clerk is told to paint into it rather than onto its own white card.
              variables: {
                colorBackground: 'transparent',
                colorForeground: '#f1f3ef',
                colorMutedForeground: '#9aa197',
                colorInput: '#202320',
                colorInputForeground: '#f1f3ef',
                colorBorder: 'rgba(255, 255, 255, .14)',
                colorPrimary: '#f2f4ef',
                colorPrimaryForeground: '#16180f',
                colorDanger: '#e4a83e',
                borderRadius: '10px',
              },
              elements: { cardBox: { boxShadow: 'none', border: '0' }, card: { boxShadow: 'none' } },
            }}
          />}
    </div>
  </dialog>
}
