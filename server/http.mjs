/**
 * The handful of things every route needs from HTTP itself.
 *
 * These lived at the top of index.mjs while there was one file to put them in. They are here now so
 * that the route modules can be read on their own, without the reader having to hold the whole
 * server in their head to know what `send` or `tenant` does.
 */

/**
 * One response, with the headers a browser needs to be told rather than left to guess.
 *
 * `nosniff` stops a JSON error being executed as script if it is ever fetched into the wrong place;
 * `DENY` stops BO being framed by a page that wants to collect clicks on it; `no-store` keeps
 * workspace data out of shared caches. None of them cost anything and all of them are hard to
 * remember to add later, one route at a time.
 */
export function send(response, status, value, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
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
    if (size > 2_000_000) throw new Error('Request is too large.')
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
