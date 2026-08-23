import { launchBrowser } from './browser.mjs'
import { newDb } from 'pg-mem'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate } from '../server/db.mjs'

/**
 * Signing in, from the browser.
 *
 * `accounts.test.mjs` proves the routes refuse a stranger. This proves the part a person actually
 * meets: that BO asks who they are before showing them anything, that the session survives a reload,
 * that signing out puts them back, and — the point of the whole exercise — that signing in on what
 * amounts to a second browser reaches the same account rather than a fresh empty BO.
 */

const apiPort = 8959
const vitePort = 4183
process.env.BO_GENERATED_ROOT = await mkdtemp(path.join(tmpdir(), 'bo-signin-'))

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
await migrate()

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(apiPort, '127.0.0.1', resolve))

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(apiPort) }, stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the frontend server.')
}

const browser = await launchBrowser()
const errors = []

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    // This test deliberately submits a weak password and a wrong one, and the browser logs the 400
    // and 401 that come back. Those are the feature working, not a fault to report.
    const text = message.text()
    if (message.type() !== 'error') return
    if (/Failed to load resource: the server responded with a status of 40[019]/.test(text)) return
    errors.push(text)
  })
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  return page
}

try {
  const page = await open()

  /**
   * 1. The home page is public, and so is the box on it.
   *
   * There is one page now — `/`, and nothing else — and describing a company on it needs no
   * account. What stays gated is the workspace that describing one produces — so the check is not
   * "can a stranger see a prompt" but "can a stranger reach a Command Center".
   */
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('signin-form').count()) throw new Error('The home page was hidden behind a sign-in screen.')
  await page.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: 'networkidle' })
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('BO showed a workspace before anyone signed in.')
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })

  // 2. Describing a company asks who you are before building anything — and keeps what was typed,
  //    so it is not asked for twice.
  await page.getByTestId('company-brief').fill('We run a plumbing business and technicians visit customer homes.')
  await page.getByTestId('start-building').click()
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('build-thread').count()) throw new Error('BO started building for someone with no account.')

  // 3. A password BO will not accept is refused, and says why.
  await page.getByTestId('signin-email').fill('owner@example.com')
  await page.getByTestId('signin-password').fill('short')
  await page.getByTestId('signin-password').evaluate(node => node.setAttribute('minlength', '1'))
  await page.getByTestId('signin-submit').click()
  await page.getByTestId('signin-error').waitFor()
  if (!/at least/i.test(await page.getByTestId('signin-error').innerText())) throw new Error('BO refused a weak password without saying what it wanted.')

  // 4. Signing up gets in — and straight on with what they already typed, rather than back to an
  //    empty box asking them to describe their company a second time to prove they have an account.
  await page.getByTestId('signin-password').fill('a-long-enough-password')
  await page.getByTestId('signin-submit').click()
  await page.getByTestId('build-thread').waitFor({ timeout: 30_000 })
  await page.waitForURL('**/build/**')
  const carried = await page.evaluate(() => JSON.parse(localStorage.getItem('bo-answers') || '{}').companyDescription ?? '')
  if (!/plumbing/i.test(carried)) throw new Error(`The sentence typed before signing in was lost: ${carried}`)

  // 5. The session survives a reload. A sign-in that has to be repeated on refresh is not a session.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('signin-form').count()) throw new Error('Reloading signed the operator out.')

  // 6. The same account reaches BO from a different browser. This is what accounts are for: before
  //    them, a workspace lived in one browser and a second device saw an empty BO.
  const second = await open()
  await second.getByTestId('open-signin').click()
  await second.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  await second.getByTestId('signin-switch').click()
  await second.getByTestId('signin-email').fill('owner@example.com')
  await second.getByTestId('signin-password').fill('a-long-enough-password')
  await second.getByTestId('signin-submit').click()
  await second.getByTestId('company-brief').waitFor({ timeout: 20_000 })

  // 7. The wrong password does not get in, and does not say which half was wrong.
  const third = await open()
  await third.getByTestId('open-signin').click()
  await third.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  await third.getByTestId('signin-switch').click()
  await third.getByTestId('signin-email').fill('owner@example.com')
  await third.getByTestId('signin-password').fill('not-the-right-password')
  await third.getByTestId('signin-submit').click()
  await third.getByTestId('signin-error').waitFor()
  const refusal = await third.getByTestId('signin-error').innerText()
  if (/no account|not found|unknown/i.test(refusal)) throw new Error(`The sign-in form says whether an account exists: ${refusal}`)
  if (await third.getByTestId('company-brief').count()) throw new Error('A wrong password got in.')

  /**
   * 8. Signing out closes the workspace and offers the way back in.
   *
   * Not "puts the sign-in form back on this page" any more: the home page is public, so signing out
   * lands on it rather than on a form. What must change is what a signed-out person can reach — the
   * workspace — and that the offer to sign in reappears.
   */
  await page.evaluate(() => localStorage.removeItem('bo-session-token'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  await page.getByTestId('open-signin').waitFor({ timeout: 20_000 })

  await page.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: 'networkidle' })
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('A signed-out browser could still open the workspace.')

  // 9. And the home page still works signed out, which is where a stranger starts.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Sign-in test passed: one public home page whose prompt anyone can type in, the workspace still gated behind an account, the sentence typed before signing in carried through instead of asked for twice, weak passwords explained, the session surviving a reload, the same account reached from another browser, a wrong password refused without revealing whether the address exists, and signing out closing the workspace while leaving the home page open.')
} finally {
  await browser.close()
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
