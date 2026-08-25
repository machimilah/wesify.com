/**
 * Who may call this API from a browser.
 *
 * Wesify used to be one origin: the same Node process served the interface and the API, so a browser
 * never made a cross-origin request and there was nothing to allow. Splitting the deployment — the
 * interface on a static host, the API on a machine that can hold a process — makes every call from
 * the interface cross-origin, and a browser refuses those by default however correct the server's
 * answer is. Without this the split simply does not work, and it fails in the browser rather than in
 * any log the server keeps.
 *
 * An allowlist rather than `*`, because these endpoints are not public reads: they carry a bearer
 * token and a workspace token, and `*` cannot be combined with credentials anyway. Nothing is
 * allowed until `BO_ALLOWED_ORIGINS` names it, so a deployment that forgets to set it fails closed.
 */

const configured = () => String(process.env.BO_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)

/**
 * Vercel gives every deployment its own hostname, so pinning one URL means every preview build is
 * refused. A single trailing-wildcard entry — `https://*.vercel.app` — covers them; it matches one
 * label and never a bare `https://vercel.app`, so it cannot be widened into "anything".
 */
function matches(origin, pattern) {
  if (pattern === origin) return true
  if (!pattern.includes('*')) return false
  const [scheme, host] = pattern.split('://')
  const [, originHost] = origin.split('://')
  if (!host?.startsWith('*.') || !originHost || !origin.startsWith(`${scheme}://`)) return false
  const suffix = host.slice(1)
  return originHost.endsWith(suffix) && originHost.length > suffix.length
}

export function allowedOrigin(request) {
  const origin = String(request.headers.origin ?? '').trim().replace(/\/+$/, '')
  if (!origin) return ''
  return configured().some(pattern => matches(origin, pattern)) ? origin : ''
}

/**
 * The headers that make a cross-origin call work, and only for an origin Wesify recognises.
 *
 * `Vary: Origin` matters as much as the rest: without it a cache in front of Wesify can serve one
 * origin's allow header to another origin, which either leaks access or blocks a caller at random.
 */
export function corsHeaders(request) {
  const origin = allowedOrigin(request)
  if (!origin) return { vary: 'Origin' }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, content-type, x-bo-workspace-id, x-bo-access-token, x-bo-role',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

/**
 * The preflight. A browser sends it before anything that is not a simple request — which is every
 * call Wesify makes, because they all carry a token header — and it must be answered before the real
 * request is ever sent. Answered here rather than in a route, since it is about the connection
 * rather than about what is being asked for.
 */
export function handlePreflight(request, response) {
  if (request.method !== 'OPTIONS') return false
  const headers = corsHeaders(request)
  // 204 for a recognised origin, 403 for one Wesify does not know: a preflight that quietly succeeds
  // for an unknown caller teaches nobody anything, and the browser reports the block either way.
  response.writeHead(headers['access-control-allow-origin'] ? 204 : 403, headers)
  response.end()
  return true
}
