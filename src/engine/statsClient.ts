import { apiUrl } from './apiBase'

/**
 * The public numbers the home page shows, which today is one: how many people signed up.
 *
 * No session travels with this and none is needed — the count names nobody, and the page asking for
 * it is the page a stranger lands on. A server that cannot answer (offline, no database, an older
 * deployment without the route) is not an error worth showing anybody a broken page over, so the
 * count is `null` and the caller shows nothing where the number would be.
 */
export async function userCount(): Promise<number | null> {
  try {
    const response = await fetch(apiUrl('/api/stats/users'))
    if (!response.ok) return null
    const body = await response.json()
    return Number.isFinite(body?.users) ? Number(body.users) : null
  } catch {
    return null
  }
}
