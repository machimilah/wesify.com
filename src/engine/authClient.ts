import { apiUrl } from './apiBase'

/**
 * The signed-in account, in the browser.
 *
 * Wesify runs in two modes and the interface must not guess which. With a database and a Clerk instance
 * the server has accounts and a workspace belongs to one; without either, Wesify is the single-browser
 * prototype it has always been. `accountsEnabled()` asks once and the rest of the app follows the
 * answer, so nobody is shown a sign-in screen for a server that cannot sign them in.
 *
 * Wesify holds no credential of its own any more. Clerk keeps the session, and what travels to the
 * server is a short-lived token Clerk mints on request — which is why `sessionHeaders()` is async:
 * these tokens expire in about a minute, so the right one is fetched per request rather than cached
 * somewhere and hoped over.
 *
 * `window.Clerk` rather than a React hook, deliberately. These functions are called from plain
 * modules — the project client, the billing client, the discovery client — and threading a hook's
 * value through all of them would mean every one of those files knowing about React.
 */

declare global {
  interface Window {
    Clerk?: { session?: { getToken: () => Promise<string | null> } | null; loaded?: boolean }
    /**
     * A session for a browser with no Clerk instance behind it — the suites, which have no business
     * loading Clerk's script over the network to prove what Wesify does with a token.
     *
     * Read only when Clerk itself is absent, so it can never override a real session, and worth
     * nothing to anybody who sets it in their own browser: it is a bearer token like any other, and
     * the server verifies it with Clerk before it means a thing.
     */
    __BO_SESSION_TOKEN__?: string
  }
}

let accountsPromise: Promise<boolean> | null = null

/** Cached for the session: whether the server has accounts cannot change without a restart. */
export function accountsEnabled(): Promise<boolean> {
  accountsPromise ??= fetch(apiUrl('/api/health'))
    .then(response => response.ok ? response.json() : { accounts: false })
    .then(health => health.accounts === true)
    .catch(() => false)
  return accountsPromise
}

/** Clerk's session token, or '' when nobody is signed in or Clerk has not loaded yet. */
export async function sessionToken(): Promise<string> {
  try {
    // Checked first, and deliberately: the SDK puts `window.Clerk` in the page whether or not this
    // build has a key, and it does so at a moment of its own choosing — so "use the seam only when
    // Clerk is absent" is a race, and a page could be signed in for one request and not the next.
    if (window.__BO_SESSION_TOKEN__) return window.__BO_SESSION_TOKEN__
    return (await window.Clerk?.session?.getToken()) ?? ''
  } catch {
    // A token that cannot be minted — offline, a session revoked from another device — is the same
    // as not being signed in, and the server will say so.
    return ''
  }
}

/** Present on every workspace request. Absent when signed out, which the server then refuses. */
export async function sessionHeaders(): Promise<Record<string, string>> {
  const token = await sessionToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export interface Account { id: string; email: string }
export interface AccountWorkspace { id: string; name: string; role: string; created_at: string }

/**
 * Who is signed in, and what they have, according to Wesify rather than Clerk.
 *
 * Clerk already knows the person; this is the call that turns them into a Wesify account — the server
 * writes the local row the first time it sees them — and returns the workspaces that row owns.
 */
export async function currentAccount(): Promise<{ user: Account; workspaces: AccountWorkspace[] } | null> {
  const headers = await sessionHeaders()
  if (!headers.authorization) return null
  try {
    const response = await fetch(apiUrl('/api/auth/me'), { headers })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
