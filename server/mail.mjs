/**
 * Sending mail, of which Wesify sends exactly one kind.
 *
 * Written against Resend's HTTP API rather than SMTP, because SMTP would mean a dependency and a
 * connection pool for a product that sends one transactional message. Any provider with an HTTP API
 * fits behind the same two functions; only `deliver` would change.
 *
 * With no provider configured, the link is written to the server log instead. That keeps local
 * development working with no account anywhere — the same bargain the rest of Wesify makes with
 * `DATABASE_URL` — and it is why `mailAvailable()` exists: a deployment that can reset passwords but
 * cannot mail anybody is a thing the operator should be told about at start, not discover from a
 * confused customer.
 */

const API = process.env.BO_MAIL_API_URL || 'https://api.resend.com/emails'

export function mailAvailable() {
  return Boolean(process.env.RESEND_API_KEY && process.env.BO_MAIL_FROM)
}

async function deliver({ to, subject, text }) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.BO_MAIL_FROM, to, subject, text }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`The mail provider refused the message (${response.status}). ${detail.slice(0, 200)}`)
  }
}

/**
 * Mails a reset link, or logs it when there is no provider.
 *
 * Never returns the link to the caller. The whole security of a reset flow is that the link reaches
 * the address and nowhere else; handing it back in the HTTP response would turn "I forgot my
 * password" into "give me anyone's account".
 */
export async function sendPasswordReset(to, link) {
  const subject = 'Reset your Wesify password'
  const text = [
    'Someone asked to reset the password for this Wesify account.',
    '',
    link,
    '',
    'The link works once and expires in an hour.',
    'If this was not you, nothing has changed and you can ignore this message.',
  ].join('\n')

  if (!mailAvailable()) {
    console.log(`Wesify has no mail provider configured (set RESEND_API_KEY and BO_MAIL_FROM), so the reset link for ${to} was not sent. It is: ${link}`)
    return { delivered: false }
  }
  await deliver({ to, subject, text })
  return { delivered: true }
}
