/**
 * The signed-in account, in the browser.
 *
 * BO runs in two modes and the interface must not guess which. With a database configured the server
 * has accounts and a workspace belongs to one; without, BO is the single-browser prototype it has
 * always been. `accountsEnabled()` asks once and the rest of the app follows the answer, so nobody
 * is shown a sign-in screen for a server that cannot sign them in.
 *
 * The session token is the one secret the browser holds. It lives in localStorage because BO is a
 * single-page app talking to its own origin; moving it to an httpOnly cookie is worth doing and is a
 * change to the server, not to this file.
 */

const TOKEN_KEY = 'bo-session-token'

export interface Account { id: string; email: string }
export interface AccountWorkspace { id: string; name: string; role: string; created_at: string }

let accountsPromise: Promise<boolean> | null = null

/** Cached for the session: whether the server has accounts cannot change without a restart. */
export function accountsEnabled(): Promise<boolean> {
  accountsPromise ??= fetch('/api/health')
    .then(response => response.ok ? response.json() : { accounts: false })
    .then(health => health.accounts === true)
    .catch(() => false)
  return accountsPromise
}

export const sessionToken = () => localStorage.getItem(TOKEN_KEY) ?? ''

/** Present on every workspace request. Absent when signed out, which the server then refuses. */
export function sessionHeaders(): Record<string, string> {
  const token = sessionToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function readOrThrow(response: Response) {
  const detail = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(detail.error || 'BO could not complete that.')
  return detail
}

async function post(route: string, body?: unknown) {
  return readOrThrow(await fetch(`/api/auth/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  }))
}

export async function registerAccount(email: string, password: string): Promise<Account> {
  const result = await post('register', { email, password })
  localStorage.setItem(TOKEN_KEY, result.token)
  return result.user
}

export async function signIn(email: string, password: string): Promise<Account> {
  const result = await post('login', { email, password })
  localStorage.setItem(TOKEN_KEY, result.token)
  return result.user
}

/**
 * Asks for a reset link. The answer is deliberately the same whether or not the address has an
 * account, so this returns the server's message rather than a yes or a no.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const result = await post('forgot', { email })
  return result.message as string
}

/** Spends a reset link. The server signs them in on success, so the new token is stored here. */
export async function resetPassword(token: string, password: string): Promise<Account> {
  const result = await post('reset', { token, password })
  localStorage.setItem(TOKEN_KEY, result.token)
  return result.user
}

/**
 * Ends the session on the server, then locally whatever happened.
 *
 * A sign-out that fails because the network is down must still sign the person out of this browser —
 * that is the case they are most likely to care about.
 */
export async function signOut() {
  try { await post('logout') } catch { /* The local session goes either way. */ }
  localStorage.removeItem(TOKEN_KEY)
}

/** Who is signed in, or null. A rejected token is cleared so the app stops presenting it. */
export async function currentAccount(): Promise<{ user: Account; workspaces: AccountWorkspace[] } | null> {
  if (!sessionToken()) return null
  try {
    const response = await fetch('/api/auth/me', { headers: sessionHeaders() })
    if (response.status === 401) { localStorage.removeItem(TOKEN_KEY); return null }
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
