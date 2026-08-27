import { launchBrowser, passOnboarding } from './browser.mjs'
import { newDb } from 'pg-mem'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useDatabase, migrate } from '../server/db.mjs'
import { useTestClerk, tokenFor } from './clerkStub.mjs'
import './noSpend.mjs'

/**
 * Being signed in, from the browser.
 *
 * `accounts.test.mjs` proves the routes refuse a stranger. This proves the part a person actually
 * meets: that a signed-out visitor is offered a way in rather than the product itself, that being
 * signed in survives a reload, that losing the session puts them back at the gate wherever they were,
 * and — the point of the whole exercise — that a second browser with nothing cached reaches the same
 * workspace rather than a fresh empty Wesify.
 *
 * What is deliberately not here is the sign-in form itself. Clerk draws it and Clerk checks what is
 * typed into it, against a hosted instance this suite has no business needing; testing it here would
 * be testing Clerk. Wesify's own part of the deal is a single call — `window.Clerk.openSignUp(...)` —
 * made at the right moments, and that is what is asserted: `window.Clerk` is stubbed with a spy rather
 * than left absent, so a click on "Get started" (or the effect that fires when a signed-out visitor
 * lands anywhere but the front page) can be proven to have asked Clerk to open, without a real Clerk
 * instance ever being loaded over the network.
 *
 * Being signed in is stood in for with `window.__BO_SESSION_TOKEN__`, the seam the interface falls
 * back to when there is no Clerk instance in the page. The token it holds is the stub the server
 * verifies. See clerkStub.mjs.
 */

const apiPort = 8959
const vitePort = 4183
process.env.BO_GENERATED_ROOT = await mkdtemp(path.join(tmpdir(), 'bo-signin-'))

const memory = newDb()
const { Pool } = memory.adapters.createPg()
useDatabase(new Pool())
useTestClerk()
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
const sessionToken = tokenFor('user_owner')

async function open({ signedIn = false } = {}) {
  // Every call is its own isolated context — Playwright gives a fresh one per `browser.newPage()` —
  // which is what stands in for "a different browser" throughout this file: empty localStorage,
  // nothing cached, nothing but the account this page arrives as.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    // A page that is not signed in deliberately asks the server who it is and is told nobody. The
    // 401 the browser logs is that working, not a fault to report.
    const text = message.text()
    if (message.type() !== 'error') return
    if (/Failed to load resource: the server responded with a status of 40[019]/.test(text)) return
    errors.push(text)
  })
  if (signedIn) {
    await page.addInitScript(value => { window.__BO_SESSION_TOKEN__ = value }, sessionToken)
  }
  /**
   * Standing in for Clerk's own script, which this suite deliberately never loads.
   *
   * The app's whole side of "open the sign-up panel" is one call — `window.Clerk.openSignUp(...)` —
   * made where the real SDK would already have attached itself to the page. Recording every call
   * rather than replacing the function's effect with anything is what lets a test assert that call
   * happened, with what arguments, at the moment it was supposed to and not before.
   */
  await page.addInitScript(() => {
    window.__BO_CLERK_SIGNUP_CALLS__ = []
    window.Clerk = { openSignUp: options => { window.__BO_CLERK_SIGNUP_CALLS__.push(options) } }
  })
  // Installed before React starts so this records a one-frame landing-page flash as well as a page
  // that remains visible. Checking only the final URL cannot catch that regression.
  await page.addInitScript(() => {
    window.__BO_PUBLIC_HOME_MOUNTS__ = 0
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches('[data-testid="public-home"]') || node.querySelector('[data-testid="public-home"]')) {
            window.__BO_PUBLIC_HOME_MOUNTS__ += 1
          }
        }
      }
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  // Only needed so the build below runs straight through to a finished Command Center rather than
  // stopping at the first question — the discovery model itself is not what this file is about.
  await page.addInitScript(() => {
    window.__BO_DISCOVERY_MODEL_MOCK__ = async () => ({
      businessState: {
        companySummary: 'A plumbing service business', industry: 'Plumbing', facts: [],
        businessModel: ['Field service'], productsOrServices: ['A plumbing service business'], customers: ['Homeowners'],
        revenueModel: ['Customers pay on completion'], team: ['A small team'], operations: ['Technicians visit customer homes'],
        resources: [], locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: ['Jobs'],
        knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
      },
      decision: 'READY_TO_ARCHITECT', acknowledgment: 'Ready.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] },
      architectureContext: {
        title: 'Plumbing Command Center', summary: 'Run dispatch and billing together.', explanation: 'Work orders connect customers, technicians and invoices.',
        modules: ['customers', 'field-service'], startView: 'field-service',
        capabilities: ['Work orders'], capabilityIds: ['crm.contacts', 'service.field-work'], excludedCapabilityIds: [],
        pages: ['Dashboard', 'Clients', 'Work orders'], entities: [{ name: 'Work orders', module: 'field-service', purpose: 'Dispatch jobs' }],
        workflows: [], metrics: ['Open work orders'], processStages: ['New', 'Complete'], pipelineStages: [], billingCadence: 'On completion',
      },
    })
  })
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  return page
}

try {
  const stranger = await open()

  /**
   * 1. A signed-out visitor is offered the pitch and one button, not the box that describes a
   *    company — that box is what greets them the moment they are signed in, not before.
   */
  await stranger.getByTestId('public-home').waitFor({ timeout: 20_000 })
  await stranger.getByTestId('get-started').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('company-brief').count()) throw new Error('A signed-out visitor was shown the company prompt before signing up.')

  // Clicking it is the whole of Wesify's own part of signing somebody up: one call asking Clerk to
  // open its panel, made with nothing left for a click to have silently done nothing.
  await stranger.getByTestId('get-started').click()
  await stranger.waitForFunction(() => window.__BO_CLERK_SIGNUP_CALLS__.length > 0, undefined, { timeout: 20_000 })
  const firstCall = await stranger.evaluate(() => window.__BO_CLERK_SIGNUP_CALLS__[0])
  if (firstCall?.redirectUrl !== '/dashboard') throw new Error(`Getting started did not ask Clerk to land somewhere after sign-up: ${JSON.stringify(firstCall)}`)

  /**
   * 2. Two addresses Wesify no longer owns — /signin was its old sign-in page, /reset was for links
   *    its own server used to mail — both answered the same way: back to the front page, with
   *    Wesify's own panel already open over it rather than Clerk's, since neither of those old
   *    addresses is a click Wesify can attribute to "get started".
   */
  await stranger.goto(`http://127.0.0.1:${vitePort}/signin`, { waitUntil: 'networkidle' })
  await stranger.waitForFunction(() => window.location.pathname === '/', undefined, { timeout: 20_000 })
  await stranger.locator('dialog.wes-signin[open]').waitFor({ timeout: 20_000 })

  /**
   * 3. A signed-out visitor who lands anywhere other than the front page — a bookmark, a shared
   *    workspace link, a stale tab — is sent back to it and asked to sign in there, not shown
   *    whatever they were trying to reach.
   */
  // A real navigation, so the init scripts run again and `__BO_CLERK_SIGNUP_CALLS__` starts empty —
  // the call this waits for belongs to landing here signed out, not to the earlier click.
  await stranger.goto(`http://127.0.0.1:${vitePort}/workspace/nonexistent/home`, { waitUntil: 'networkidle' })
  await stranger.waitForFunction(() => window.location.pathname === '/', undefined, { timeout: 20_000 })
  await stranger.getByTestId('get-started').waitFor({ timeout: 20_000 })
  await stranger.waitForFunction(() => window.__BO_CLERK_SIGNUP_CALLS__.length > 0, undefined, { timeout: 20_000 })
  if (await stranger.getByTestId('app-grid').count()) throw new Error('Wesify showed a workspace before anyone signed in.')

  // 4. Signed in, the account lands on its dashboard and can build a finished Command Center there.
  const page = await open({ signedIn: true })
  await page.waitForURL('**/dashboard', { timeout: 20_000 })
  await page.getByTestId('project-dashboard').waitFor({ timeout: 20_000 })
  const publicHomeMounts = await page.evaluate(() => window.__BO_PUBLIC_HOME_MOUNTS__)
  if (publicHomeMounts !== 0) throw new Error(`The public home mounted ${publicHomeMounts} time(s) before a signed-in dashboard redirect.`)
  await page.getByTestId('dashboard-brief').fill('We run a plumbing business and technicians visit customer homes.')
  await page.getByTestId('dashboard-start-building').click()
  await passOnboarding(page, 'Ridge Plumbing')
  await page.getByTestId('build-thread').waitFor({ timeout: 30_000 })
  await page.waitForURL('**/build/**')
  await page.getByTestId('open-dashboard').waitFor({ timeout: 30_000 })
  await page.getByTestId('open-dashboard').click()
  await page.waitForURL(/\/workspace\/[a-zA-Z0-9-]+\/home/, { timeout: 30_000 })
  await page.getByTestId('app-grid').waitFor({ timeout: 30_000 })
  const builtWorkspaceId = page.url().match(/\/workspace\/([a-zA-Z0-9-]+)\//)?.[1]
  if (!builtWorkspaceId) throw new Error(`Approving the Command Center did not land on a workspace-scoped URL: ${page.url()}`)

  // 5. The session survives a reload of the workspace itself. One that has to be re-established on
  //    refresh is not a session.
  // `load` rather than `networkidle`: a finished Command Center keeps talking to the server — it
  // asks what it is, then what is in it — and waiting for the network to fall silent is waiting for
  // something that is not the assertion. What matters is that the workspace renders, which is the
  // next line.
  await page.reload({ waitUntil: 'load' })
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('get-started').count()) throw new Error('Reloading signed the operator out.')

  // 4b. A signed-in visit to `/` resolves to the project dashboard, where its workspace is one click away.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.waitForURL('**/dashboard', { timeout: 20_000 })
  await page.getByTestId('project-dashboard').waitFor({ timeout: 20_000 })
  await page.getByTestId('open-workspace').first().click()
  await page.waitForURL(new RegExp(`/workspace/${builtWorkspaceId}/home`), { timeout: 20_000 })
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })

  /**
   * 6. The same account reaches the same workspace from a different browser — the real point of
   *    having accounts at all, and of the workspace living at a URL rather than in localStorage.
   *
   * `second` has never seen this workspace: nothing cached, nothing built here. Before workspace
   * configuration was fetched from the server as a fallback, this was exactly the browser that got
   * stuck on "Opening workspace..." forever, because the only copy of what the workspace looked like
   * was sitting in the localStorage of the browser that built it.
   */
  /**
   * First, wait for the server to actually hold the build.
   *
   * The browser that built it renders from its own cache the moment it has one, which is earlier
   * than the server finishing and storing the generated project. A second browser has no cache and
   * nothing to fall back on, so opening one before that point is a race — and one this suite would
   * lose by reporting a real bug that is not there.
   */
  for (let attempt = 0; ; attempt += 1) {
    const stored = await fetch(`http://127.0.0.1:${apiPort}/api/projects/${builtWorkspaceId}`, {
      headers: { authorization: `Bearer ${sessionToken}`, 'x-bo-workspace-id': builtWorkspaceId, 'x-bo-role': 'owner' },
    })
    if (stored.ok) break
    if (attempt === 100) throw new Error('The server never stored the build that the browser had already rendered.')
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  const second = await open({ signedIn: true })
  // The workspace is offered to it at all only because the server told it this account owns one —
  // this browser has never heard of it otherwise.
  await second.waitForURL('**/dashboard', { timeout: 20_000 })
  await second.getByTestId('project-dashboard').waitFor({ timeout: 20_000 })
  await second.getByTestId('open-workspace').first().waitFor({ timeout: 20_000 })
  await second.getByTestId('open-workspace').first().click()
  await second.waitForURL(new RegExp(`/workspace/${builtWorkspaceId}/home`), { timeout: 20_000 })
  await second.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  const secondPages = await second.locator('[data-testid^="schema-nav-"]').count()
  if (secondPages < 2) throw new Error(`A browser with nothing cached could not open the workspace it signed into: only ${secondPages} sections rendered.`)

  // 7. A different account is not shown somebody else's workspace, however it arrives at the URL.
  const other = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await other.addInitScript(value => { window.__BO_SESSION_TOKEN__ = value }, tokenFor('user_intruder'))
  await other.goto(`http://127.0.0.1:${vitePort}/workspace/${builtWorkspaceId}/home`, { waitUntil: 'networkidle' })
  const intruderPages = await other.locator('[data-testid^="schema-nav-"]').count()
  if (intruderPages > 0) throw new Error('Another account was shown the sections of a workspace it does not own.')

  /**
   * 7. Losing the session closes the workspace, wherever it was reached from.
   *
   * `page` is sitting on the workspace URL itself here, which is the case that matters most: a
   * session ended elsewhere — signed out on another device, revoked, expired — must never leave stale
   * workspace content on screen just because the page has not been asked to go anywhere.
   */
  await page.addInitScript(() => { delete window.__BO_SESSION_TOKEN__ })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.location.pathname === '/', undefined, { timeout: 20_000 })
  await page.getByTestId('get-started').waitFor({ timeout: 20_000 })
  await page.waitForFunction(() => window.__BO_CLERK_SIGNUP_CALLS__.length > 0, undefined, { timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('A signed-out reload of the workspace URL still showed the workspace.')

  // Landing on the front page directly, signed out, offers the same one way in.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('get-started').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('company-brief').count()) throw new Error('A signed-out visitor was shown the company prompt after signing out.')
  await page.getByTestId('get-started').click()
  await page.waitForFunction(() => window.__BO_CLERK_SIGNUP_CALLS__.length > 0, undefined, { timeout: 20_000 })

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Sign-in test passed: a signed-out visitor offered a way in rather than the product, Clerk asked to open at every one of those moments, a gated workspace, flash-free signed-in routing to /dashboard, dashboard creation of a finished Command Center, session persistence, project reopening from the dashboard in a second browser, tenant isolation, and losing a session returning to that same gate wherever it was lost.')
} finally {
  await browser.close()
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
