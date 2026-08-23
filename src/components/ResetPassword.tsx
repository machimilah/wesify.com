import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { resetPassword, type Account } from '../engine/authClient'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * The screen a reset link opens.
 *
 * It has to render before the sign-in gate, not behind it: the person arriving here is by definition
 * unable to sign in. The token comes from the URL and is never shown — there is nothing useful a
 * person can do with it that this form is not already doing for them.
 *
 * Succeeding signs them in, because the link already proved they hold the address and asking for the
 * password they typed a second ago is a step that exists only to be annoying.
 */
export function ResetPassword({ token, onSignedIn, onGiveUp }: { token: string; onSignedIn: (account: Account) => void; onGiveUp: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (working || !password) return
    setWorking(true); setError('')
    try {
      onSignedIn(await resetPassword(token, password))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'BO could not change your password.')
    } finally {
      setWorking(false)
    }
  }

  // A link with no token at all is a mistyped or truncated URL, and there is nothing to submit.
  if (!token) return <main className="bo-signin">
    <ThemeToggle className="bo-signin__theme-toggle"/>
    <form onSubmit={event => { event.preventDefault(); onGiveUp() }} data-testid="reset-form">
      <Brand/>
      <h1>That reset link is incomplete</h1>
      <p className="bo-signin-error" role="alert" data-testid="reset-error">Open the link from your email again, or ask for a new one.</p>
      <button data-testid="reset-submit">Back to sign in <ArrowRight size={15}/></button>
    </form>
  </main>

  return <main className="bo-signin">
    <ThemeToggle className="bo-signin__theme-toggle"/>
    <form onSubmit={submit} data-testid="reset-form">
      <Brand/>
      <h1>Choose a new password</h1>
      <label>
        <span>New password</span>
        <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength={10} autoFocus data-testid="reset-password"/>
        <em>At least 10 characters.</em>
      </label>
      {error && <p className="bo-signin-error" role="alert" data-testid="reset-error">{error}</p>}
      <button disabled={working} data-testid="reset-submit">{working ? 'One moment…' : 'Set password and sign in'} <ArrowRight size={15}/></button>
      <button type="button" className="bo-signin-switch" onClick={onGiveUp} data-testid="reset-cancel">Back to sign in</button>
    </form>
  </main>
}
