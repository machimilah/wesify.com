import { launchBrowser } from './browser.mjs'
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
 * meets: that Wesify asks who they are before showing them anything, that being signed in survives a
 * reload, that losing the session puts them back at the gate, and — the point of the whole exercise —
 * that a second browser with nothing cached reaches the same workspace rather than a fresh empty Wesify.
 *
 * What is deliberately not here any more is the sign-in form itself. Clerk draws it and Clerk checks
 * what is typed into it, against a hosted instance this suite has no business needing; testing it here
 * would be testing Clerk. What Wesify still owns is everything on either side of it, and that is what
 * follows.
 *
 * Being signed in is stood in for with `window.__BO_SESSION_TOKEN__`, the seam the interface falls back
 * to when there is no Clerk instance in the page — which is the case here, because loading Clerk's
 * script over the network would make these suites depend on Clerk being up. The token it holds is the
 * stub the server verifies. See clerkStub.mjs.
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
   * 1. The page is public. Starting something is not.
   *
   * A stranger can read every word of the home page and scroll all of it — that is the entire
   * argument for the product, and hiding it behind a sign-in would mean asking people to buy
   * something they have not seen. What needs an account is the button that begins work, so this
   * checks the two halves separately: the page renders, and the door asks who is knocking.
   */
  await stranger.getByTestId('get-started').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('signin-form').count()) throw new Error('The home page was hidden behind a sign-in screen.')
  await stranger.getByTestId('learn-more').waitFor({ timeout: 20_000 })
  await stranger.getByTestId('get-started').click()
  await stranger.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('company-brief').count()) throw new Error('A stranger was handed the prompt without being asked who they are.')

  // 2. And the workspace itself stays gated however it is reached, not only through that button.
  await stranger.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: 'networkidle' })
  await stranger.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('app-grid').count()) throw new Error('Wesify showed a workspace before anyone signed in.')

  // 3. Signed in, the same button opens the box, and the sentence goes straight through to a
  //    finished Command Center. Everything after this uses a real one on purpose: a workspace still
  //    mid-build proves nothing about whether a second device can open one.
  const page = await open({ signedIn: true })
  await page.getByTestId('get-started').click()
  await page.getByTestId('company-brief').fill('We run a plumbing business and technicians visit customer homes.')
  await page.getByTestId('start-building').click()
  await page.getByTestId('build-thread').waitFor({ timeout: 30_000 })
  await page.waitForURL('**/build/**')
  await page.getByTestId('open-dashboard').waitFor({ timeout: 30_000 })
  await page.getByTestId('open-dashboard').click()
  await page.waitForURL(/\/workspace\/[a-zA-Z0-9-]+\/home/, { timeout: 30_000 })
  await page.getByTestId('app-grid').waitFor({ timeout: 30_000 })
  const builtWorkspaceId = page.url().match(/\/workspace\/([a-zA-Z0-9-]+)\//)?.[1]
  if (!builtWorkspaceId) throw new Error(`Approving the Command Center did not land on a workspace-scoped URL: ${page.url()}`)

  // 4. The session survives a reload of the workspace itself. One that has to be re-established on
  //    refresh is not a session.
  // `load` rather than `networkidle`: a finished Command Center keeps talking to the server — it
  // asks what it is, then what is in it — and waiting for the network to fall silent is waiting for
  // something that is not the assertion. What matters is that the workspace renders, which is the
  // next line.
  await page.reload({ waitUntil: 'load' })
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('signin-form').count()) throw new Error('Reloading signed the operator out.')

  /**
   * 4b. "/" is the home page for everybody, including the people who use Wesify most.
   *
   * It used to redirect somebody who owned a workspace straight to it, which made the page they
   * would most want to re-read the one page they could not reach. The workspace is a click away in
   * the header instead — and that click has to actually land there, or this is just a removal.
   */
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('get-started').waitFor({ timeout: 20_000 })
  if (!page.url().endsWith('/')) throw new Error(`Opening "/" redirected somewhere else: ${page.url()}`)
  await page.getByTestId('open-workspace').click()
  await page.waitForURL(new RegExp(`/workspace/${builtWorkspaceId}/home`), { timeout: 20_000 })
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })

  /**
   * 5. The same account reaches the same workspace from a different browser — the real point of
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
  await second.getByTestId('open-workspace').waitFor({ timeout: 20_000 })
  await second.getByTestId('open-workspace').click()
  await second.waitForURL(new RegExp(`/workspace/${builtWorkspaceId}/home`), { timeout: 20_000 })
  await second.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  const secondPages = await second.locator('[data-testid^="schema-nav-"]').count()
  if (secondPages < 2) throw new Error(`A browser with nothing cached could not open the workspace it signed into: only ${secondPages} sections rendered.`)

  // 6. A different account is not shown somebody else's workspace, however it arrives at the URL.
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
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('A signed-out reload of the workspace URL still showed the workspace.')

  // The public home page is readable again and offers the way back in — from the header, and from
  // the start button, which asks the same question of somebody who has just lost their session as
  // it does of somebody who never had one.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('open-signin').waitFor({ timeout: 20_000 })
  await page.getByTestId('get-started').click()
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })

  await page.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: 'networkidle' })
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('A signed-out browser could still open the workspace.')

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Sign-in test passed: a home page anybody can read, its start button asking who they are first, the workspace gated however it is reached, a signed-in operator carried from their sentence to a finished Command Center, the session surviving a reload, "/" staying the home page with the workspace one click away in the header, the same workspace opened by a browser that had never seen it, another account refused it, and a lost session clearing even a workspace already on screen.')
} finally {
  await browser.close()
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
