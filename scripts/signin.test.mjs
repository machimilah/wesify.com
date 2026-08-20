import { chromium } from 'playwright-core'
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

const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
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

  // 1. The landing page is public. Nobody signs up for something they have not seen.
  await page.getByTestId('landing-get-started').waitFor({ timeout: 20_000 })
  await page.getByTestId('landing-examples').waitFor()
  if (await page.getByTestId('signin-form').count()) throw new Error('The landing page was hidden behind a sign-in screen.')
  if (await page.getByTestId('company-brief').count()) throw new Error('BO showed the product before anyone signed in.')

  // 2. "Get started for free" leads to signing in, not straight into the product.
  await page.getByTestId('landing-get-started').click()
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('company-brief').count()) throw new Error('BO let someone in without an account.')

  // 3. A password BO will not accept is refused, and says why.
  await page.getByTestId('signin-email').fill('owner@example.com')
  await page.getByTestId('signin-password').fill('short')
  await page.getByTestId('signin-password').evaluate(node => node.setAttribute('minlength', '1'))
  await page.getByTestId('signin-submit').click()
  await page.getByTestId('signin-error').waitFor()
  if (!/at least/i.test(await page.getByTestId('signin-error').innerText())) throw new Error('BO refused a weak password without saying what it wanted.')

  // 4. Signing up gets in.
  await page.getByTestId('signin-password').fill('a-long-enough-password')
  await page.getByTestId('signin-submit').click()
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })

  // 5. The session survives a reload. A sign-in that has to be repeated on refresh is not a session.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('signin-form').count()) throw new Error('Reloading signed the operator out.')

  // 6. The same account reaches BO from a different browser. This is what accounts are for: before
  //    them, a workspace lived in one browser and a second device saw an empty BO.
  const second = await open()
  await second.getByTestId('landing-get-started').click()
  await second.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  await second.getByTestId('signin-switch').click()
  await second.getByTestId('signin-email').fill('owner@example.com')
  await second.getByTestId('signin-password').fill('a-long-enough-password')
  await second.getByTestId('signin-submit').click()
  await second.getByTestId('company-brief').waitFor({ timeout: 20_000 })

  // 7. The wrong password does not get in, and does not say which half was wrong.
  const third = await open()
  await third.getByTestId('landing-get-started').click()
  await third.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  await third.getByTestId('signin-switch').click()
  await third.getByTestId('signin-email').fill('owner@example.com')
  await third.getByTestId('signin-password').fill('not-the-right-password')
  await third.getByTestId('signin-submit').click()
  await third.getByTestId('signin-error').waitFor()
  const refusal = await third.getByTestId('signin-error').innerText()
  if (/no account|not found|unknown/i.test(refusal)) throw new Error(`The sign-in form says whether an account exists: ${refusal}`)
  if (await third.getByTestId('company-brief').count()) throw new Error('A wrong password got in.')

  // 8. Signing out locally puts the form back.
  await page.evaluate(() => localStorage.removeItem('bo-session-token'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })

  // 9. The landing page still works signed out, and still offers the way back in.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('landing-get-started').waitFor({ timeout: 20_000 })

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Sign-in test passed: a public landing page, the product gated behind an account, weak passwords explained, the session surviving a reload, the same account reached from another browser, a wrong password refused without revealing whether the address exists, and signing out putting the form back.')
} finally {
  await browser.close()
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
