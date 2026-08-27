/**
 * Refuses an outbound target that would make Wesify into somebody's port scanner.
 *
 * A server that will call any URL it is given is a way to reach things only that server can reach —
 * a cloud metadata endpoint, a database admin page on a private network. HTTPS only, no credentials
 * in the URL, and no private or loopback address.
 *
 * This lived inside `automations.mjs` for as long as webhooks were the only thing Wesify called out
 * to. A connected ERP is the second, and `automations.mjs` imports the connector registry — so
 * leaving the guard where it was would have meant an import cycle, and copying it would have meant
 * two versions of a security check drifting apart. It belongs to neither caller; it belongs here.
 */

/**
 * @param {string} value
 * @param {{ allowInsecure?: boolean }} [options] `allowInsecure` lets a test point a connector at a
 *   local stub, exactly as `BO_STRIPE_API_URL` already does. It is never set in production.
 */
export function safeExternalUrl(value, { allowInsecure = false } = {}) {
  let url
  try { url = new URL(String(value ?? '')) } catch { throw Object.assign(new Error('Enter a valid HTTPS URL.'), { status: 400 }) }
  if (allowInsecure && (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url.toString()
  if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('This requires a credential-free HTTPS URL.'), { status: 400 })

  // The brackets matter: `new URL('https://[::1]/').hostname` is `[::1]`, brackets included, so a
  // check against the bare address never matches and IPv6 loopback walks straight through.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const private4 = /^(10\.|127\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/
  // ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local, and ::ffff:10.0.0.1 style mappings of
  // a private v4 address into v6 — all of them reach the same places by another spelling.
  const private6 = /^(::1|::|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/
  const mapped4 = hostname.startsWith('::ffff:') ? hostname.slice(7) : ''

  if (
    hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')
    || private4.test(hostname) || private6.test(hostname) || (mapped4 && private4.test(mapped4))
  ) {
    throw Object.assign(new Error('Private-network targets are not allowed.'), { status: 400 })
  }
  return url.toString()
}

/**
 * The webhook spelling, kept because its refusals name webhooks.
 *
 * An operator pasting a URL into the webhook field should be told about webhooks, not about "this".
 */
export function safeWebhookUrl(value) {
  try {
    return safeExternalUrl(value)
  } catch (error) {
    if (error?.status !== 400) throw error
    const webhook = /valid HTTPS URL/.test(error.message)
      ? 'Enter a valid HTTPS webhook URL.'
      : /credential-free/.test(error.message)
        ? 'Webhook connectors require a credential-free HTTPS URL.'
        : 'Private-network webhook targets are not allowed.'
    throw Object.assign(new Error(webhook), { status: 400 })
  }
}
