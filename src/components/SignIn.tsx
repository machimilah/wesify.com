import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { registerAccount, signIn, type Account } from '../engine/authClient'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * The way in, when BO has accounts.
 *
 * One screen for both signing up and signing in, because at this stage almost everybody arriving is
 * new and asking them to pick first is a decision about BO rather than about their business. The
 * server's messages are shown as they are: it already distinguishes "that email has an account" from
 * "that password is wrong", and rewriting them here would only make the screen less helpful.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [creating, setCreating] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (working || !email.trim() || !password) return
    setWorking(true); setError('')
    try {
      onSignedIn(await (creating ? registerAccount(email.trim(), password) : signIn(email.trim(), password)))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'BO could not sign you in.'
      setError(message)
      // The server says so plainly when an address is taken, so move them to the right form instead
      // of leaving them to work out that they already have an account.
      if (/already has an account/i.test(message)) setCreating(false)
    } finally {
      setWorking(false)
    }
  }

  return <main className="bo-signin">
    <ThemeToggle className="bo-signin__theme-toggle"/>
    <form onSubmit={submit} data-testid="signin-form">
      <Brand/>
      <h1>{creating ? 'Create your BO account' : 'Welcome back'}</h1>
      <label>
        <span>Email</span>
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required autoFocus data-testid="signin-email"/>
      </label>
      <label>
        <span>Password</span>
        <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 10 : undefined} data-testid="signin-password"/>
        {creating && <em>At least 10 characters.</em>}
      </label>
      {error && <p className="bo-signin-error" role="alert" data-testid="signin-error">{error}</p>}
      <button disabled={working} data-testid="signin-submit">{working ? 'One moment…' : creating ? 'Create account' : 'Sign in'} <ArrowRight size={15}/></button>
      <button type="button" className="bo-signin-switch" onClick={() => { setCreating(current => !current); setError('') }} data-testid="signin-switch">
        {creating ? 'I already have an account' : 'Create an account instead'}
      </button>
    </form>
  </main>
}
