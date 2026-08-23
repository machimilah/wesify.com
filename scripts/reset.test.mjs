import assert from 'node:assert/strict'
import { newDb } from 'pg-mem'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchBrowser } from './browser.mjs'
import { useDatabase, migrate, query } from '../server/db.mjs'
import './noSpend.mjs'

/**
 * Forgetting a password, and getting back in.
 *
 * Until now BO's only answer to a forgotten password was to make another account, which loses the
 * person their workspace. A reset flow is easy to write and easy to write badly, and every way of
 * writing it badly is a way into somebody else's account, so this covers the failure modes rather
 * than the happy path alone:
 *
 *   - the link never comes back in the HTTP response, only by mail
 *   - asking about an address that has no account looks exactly like asking about one that does
 *   - the link works once, and not twice
 *   - an expired link is refused
 *   - a made-up token is refused
 *   - a short password is still refused, on this path as on registration
 *   - resetting signs the account out everywhere, because the reason for resetting may be that
 *     somebody else is holding a live session
 *   - the old password stops working, and the new one starts
 *
 * The last part of the test walks it in a real browser, because a reset flow whose routes are correct
 * and whose screen is unreachable helps nobody: the person arriving on a reset link cannot sign in,
 * so that screen has to render in front of the gate rather than behind it.
 */

const port = 8962
const vitePort = 4195
const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-reset-'))
process.env.BO_GENERATED_ROOT = generatedRoot
// No provider configured: sendPasswordReset logs the link instead of sending it, which is also how
// this test gets hold of it. A test that read the token out of the database would prove less — it
// would pass even if the link BO builds were wrong.
delete process.env.RESEND_API_KEY
delete process.env.BO_MAIL_FROM
process.env.BO_PUBLIC_URL = 'https://bo.example.com'
// This test makes more attempts in a minute than a person ever would, and the throttle is read per
// request, so it is lifted for the flow below and then lowered on purpose at the end to prove it works.
process.env.BO_RESET_RATE_LIMIT = '100'

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const logged = []
const realLog = console.log
console.log = (...args) => { logged.push(args.join(' ')); realLog(...args) }

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const email = 'forgetful@example.com'
const oldPassword = 'the-old-password'
const newPassword = 'a-brand-new-password'

async function json(pathname, init = {}) {
  const response = await fetch(`${base}${pathname}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
  return { status: response.status, payload: await response.json().catch(() => ({})) }
}

const post = (pathname, payload, headers) => json(pathname, { method: 'POST', body: JSON.stringify(payload), headers })

/** The link BO built, taken from where an unconfigured mail provider leaves it. */
function lastLink() {
  const line = [...logged].reverse().find(entry => entry.includes('/reset?token='))
  return line ? line.slice(line.indexOf('https://')) : ''
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(port) }, stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the frontend server.')
}

const browser = await launchBrowser()
const errors = []

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  return page
}

try {
  const registered = await post('/api/auth/register', { email, password: oldPassword })
  assert.equal(registered.status, 200)
  const originalToken = registered.payload.token

  // 1. Asking for a link says nothing about whether the address has an account, and above all does
  //    not hand the link back to whoever asked.
  const asked = await post('/api/auth/forgot', { email })
  assert.equal(asked.status, 200)
  assert.equal(JSON.stringify(asked.payload).includes('token'), false, 'the reset endpoint returned a token to its caller')
  const stranger = await post('/api/auth/forgot', { email: 'nobody@example.com' })
  assert.deepEqual(stranger.payload, asked.payload, 'BO answers differently for an address that has no account, which is how a customer list gets built')

  // 2. The link points at the public URL, carries a token, and that token is not what is stored.
  const link = lastLink()
  assert.ok(link.startsWith('https://bo.example.com/reset?token='), `the mailed link was wrong: ${link}`)
  const token = new URL(link).searchParams.get('token')
  assert.ok(token && token.length > 20)
  const stored = (await query('select token_hash, used_at from password_resets')).rows
  assert.equal(stored.length, 1)
  assert.notEqual(stored[0].token_hash, token, 'the reset token is stored in the clear, so a stolen database is a way into every account')
  assert.equal(stored[0].used_at, null)

  // 3. A made-up token is refused, and so is a short password on a real one.
  const invented = await post('/api/auth/reset', { token: 'not-a-real-token', password: newPassword })
  assert.equal(invented.status, 400)
  const tooShort = await post('/api/auth/reset', { token, password: 'short' })
  assert.equal(tooShort.status, 400)
  assert.match(tooShort.payload.error, /at least 10 characters/i)

  // 4. Asking again invalidates the first link. Someone who clicks twice because the first mail was
  //    slow must not be left holding two live keys to their account.
  await post('/api/auth/forgot', { email })
  const secondLink = lastLink()
  const secondToken = new URL(secondLink).searchParams.get('token')
  assert.notEqual(secondToken, token)
  const supersededAttempt = await post('/api/auth/reset', { token, password: newPassword })
  assert.equal(supersededAttempt.status, 400, 'an older reset link still worked after a newer one was issued')

  // 5. The real thing: the link works, and signs them straight in.
  const reset = await post('/api/auth/reset', { token: secondToken, password: newPassword })
  assert.equal(reset.status, 200)
  assert.equal(reset.payload.user.email, email)
  assert.ok(reset.payload.token)

  // 6. It works once. The same link a second time is refused.
  const replayed = await post('/api/auth/reset', { token: secondToken, password: 'yet-another-password' })
  assert.equal(replayed.status, 400, 'a reset link could be used twice')

  // 7. Every session that existed before the reset is gone — including the one from registration,
  //    which may well belong to whoever the person is resetting the password to get away from.
  const oldSession = await json('/api/auth/me', { headers: { authorization: `Bearer ${originalToken}` } })
  assert.equal(oldSession.status, 401, 'a session issued before the reset survived it')
  const newSession = await json('/api/auth/me', { headers: { authorization: `Bearer ${reset.payload.token}` } })
  assert.equal(newSession.status, 200)

  // 8. The password really changed: the old one is refused and the new one is accepted.
  const withOld = await post('/api/auth/login', { email, password: oldPassword })
  assert.equal(withOld.status, 401, 'the password before the reset still works')
  const withNew = await post('/api/auth/login', { email, password: newPassword })
  assert.equal(withNew.status, 200)

  // 9. An expired link is refused even though it was never used. A link sits in an inbox forever.
  await post('/api/auth/forgot', { email })
  const staleToken = new URL(lastLink()).searchParams.get('token')
  await query("update password_resets set expires_at = now() - interval '1 minute' where used_at is null")
  const stale = await post('/api/auth/reset', { token: staleToken, password: 'one-more-password-here' })
  assert.equal(stale.status, 400, 'an expired reset link still worked')

  // 10. The throttle is real. This endpoint sends mail, so an unthrottled caller can use BO to spray
  //     messages at addresses that never asked for anything.
  process.env.BO_RESET_RATE_LIMIT = '1'
  await post('/api/auth/forgot', { email })
  const flooded = await post('/api/auth/forgot', { email })
  assert.equal(flooded.status, 429, 'the forgot-password endpoint can be called without limit')
  process.env.BO_RESET_RATE_LIMIT = '100'

  // 11. The same journey, in a browser, by a person who cannot sign in.
  const uiEmail = 'locked-out@example.com'
  await post('/api/auth/register', { email: uiEmail, password: 'the-forgotten-one' })
  const page = await openPage()

  // The home page is public now, so the sign-in screen is asked for rather than landed on.
  await page.getByTestId('open-signin').click()
  await page.getByTestId('signin-form').waitFor({ timeout: 10_000 })
  await page.getByTestId('signin-switch').click()          // "I already have an account"
  await page.getByTestId('signin-forgot').click()          // "I forgot my password"
  await page.getByTestId('signin-email').fill(uiEmail)
  await page.getByTestId('signin-submit').click()
  await page.getByTestId('signin-notice').waitFor({ timeout: 10_000 })
  const shown = await page.getByTestId('signin-notice').innerText()
  assert.match(shown, /if that email has an account/i)
  assert.equal(shown.includes('token'), false, 'the screen showed the reset token to whoever asked')

  // Opening the link the way a person does: from their mail, in a browser with no session at all.
  const uiToken = new URL(lastLink()).searchParams.get('token')
  await page.goto(`http://127.0.0.1:${vitePort}/reset?token=${encodeURIComponent(uiToken)}`, { waitUntil: 'networkidle' })
  await page.getByTestId('reset-form').waitFor({ timeout: 10_000 })
  await page.getByTestId('reset-password').fill('a-password-i-will-keep')
  await page.getByTestId('reset-submit').click()

  // Signed in and inside the product, not returned to the sign-in screen to type it all again.
  await page.waitForFunction(() => !document.querySelector('[data-testid="reset-form"]'), { timeout: 15_000 })
  assert.equal(await page.getByTestId('signin-form').count(), 0, 'resetting the password left the person at the sign-in screen')
  assert.ok(await page.evaluate(() => localStorage.getItem('bo-session-token')), 'the browser was left with no session after a successful reset')

  // And the new password is the one that works now.
  assert.equal((await post('/api/auth/login', { email: uiEmail, password: 'the-forgotten-one' })).status, 401)
  assert.equal((await post('/api/auth/login', { email: uiEmail, password: 'a-password-i-will-keep' })).status, 200)
  assert.deepEqual(errors, [], `the browser reported errors: ${errors.join(' | ')}`)

  // 12. Deleting the account takes its reset links with it, so none outlives the user it belonged to.
  //     Scoped to this account on purpose: the other one in this test still holds its spent link, and
  //     an assertion that the whole table is empty would pass for the wrong reason.
  const doomed = (await query('select id from users where email = $1', [email])).rows[0].id
  assert.ok((await query('select * from password_resets where user_id = $1', [doomed])).rows.length > 0)
  await query('delete from users where email = $1', [email])
  assert.equal((await query('select * from password_resets where user_id = $1', [doomed])).rows.length, 0)

  console.log = realLog
  console.log('Password reset test passed: the link is mailed and never returned, an unknown address is answered identically to a known one, the token is stored only as a hash, a superseded or replayed or expired or invented link is refused, a short password is still refused, resetting signs the account out everywhere, the old password stops working and the new one starts, the endpoint is throttled, and deleting the account takes its links with it.')
} finally {
  console.log = realLog
  await browser.close().catch(() => undefined)
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await rm(generatedRoot, { recursive: true, force: true })
}
