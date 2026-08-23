/**
 * The handful of things every route needs from HTTP itself.
 *
 * These lived at the top of index.mjs while there was one file to put them in. They are here now so
 * that the route modules can be read on their own, without the reader having to hold the whole
 * server in their head to know what `send` or `tenant` does.
 */

/**
 * What a browser is told about BO on every single response.
 *
 * Set in one place because the alternative is remembering them per route, which nobody does. Each
 * one closes something specific:
 *
 *   nosniff       a JSON error is never executed as script if it is fetched into the wrong place
 *   DENY          BO cannot be framed by a page collecting clicks on top of it
 *   no-referrer   a workspace URL never leaks to a site someone follows a link to
 *   no-store      workspace data stays out of shared caches
 *   HSTS          a later visit cannot be downgraded to http and read in transit. Browsers ignore
 *                 it over plain http, so it costs local development nothing
 *
 * The CSP is the widest of them and the one worth reading. `wasm-unsafe-eval`, `blob:` workers and
 * `https:` connections are all there for one reason: without an API key BO runs its interview on a
 * model inside the browser, which is WebAssembly in a worker fetching weights from a CDN. Removing
 * any of those three silently breaks the no-key path. `unsafe-inline` covers only styles, which the
 * animation library sets on elements directly; script has no such allowance.
 */
const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export function send(response, status, value, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-security-policy': POLICY,
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  })
  response.end(type.startsWith('application/json') ? JSON.stringify(value) : value)
}

/**
 * The request body as text, capped.
 *
 * The cap is the point: without it, a single request can ask BO to hold as much memory as the sender
 * feels like sending. Stripe's webhook needs the raw text rather than the parsed object, because a
 * re-serialised body no longer matches the signature computed over the original bytes.
 */
export async function rawBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2_000_000) {
      // 413, not a bare throw. Without a status this surfaced as a 500 — BO reporting its own fault
      // for something the sender did — which also meant every oversized request woke the monitor.
      throw Object.assign(new Error('Request is too large.'), { status: 413 })
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function body(request) {
  const text = await rawBody(request)
  try { return text ? JSON.parse(text) : {} }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }) }
}

/** The session token a request carries, from the standard header. */
export function bearer(request) {
  const header = String(request.headers.authorization ?? '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/**
 * The address a link mailed to someone should point back at.
 *
 * `BO_PUBLIC_URL` first, because behind a proxy the request's own host header is the proxy's idea of
 * the world and not the one in the customer's address bar. The header is the fallback so this works
 * on a laptop with nothing configured; it is only ever used to build a link, never to decide anything.
 */
export function originOf(request) {
  if (process.env.BO_PUBLIC_URL) return String(process.env.BO_PUBLIC_URL).replace(/\/+$/, '')
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  const fallbackPort = Number(process.env.BO_API_PORT || process.env.PORT || 8787)
  const host = forwardedHost || String(request.headers.host ?? `127.0.0.1:${fallbackPort}`)
  const protocol = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
    || (host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https')
  return `${protocol}://${host}`
}

/** The request id BO put on the response, for anything that wants to report against it. */
export const requestIdOf = response => String(response.getHeader('x-bo-request-id') ?? '')
