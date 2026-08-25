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
 * Being signed in is stood in for the way the interface actually reads it: `window.Clerk`, asked for a
 * token per request. A page with that object present is signed in, one without it is not, and the
 * token it returns is the stub the server verifies. See clerkStub.mjs.
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
    await page.addInitScript(value => { window.Clerk = { session: { getToken: async () => value } } }, sessionToken)
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
   * 1. The home page is public, and so is the box on it.
   *
   * There is one page now — `/`, and nothing else — and describing a company on it needs no
   * account. What stays gated is the workspace that describing one produces, so the check is not
   * "can a stranger see a prompt" but "can a stranger reach a Command Center".
   */
  await stranger.getByTestId('get-started').waitFor({ timeout: 20_000 })
  await stranger.getByTestId('get-started').click()
  await stranger.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('signin-form').count()) throw new Error('The home page was hidden behind a sign-in screen.')
  await stranger.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: 'networkidle' })
  await stranger.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('app-grid').count()) throw new Error('Wesify showed a workspace before anyone signed in.')

  // 2. Describing a company asks who you are before building anything — and keeps what was typed, so
  //    it is not asked for twice once they are back.
  await stranger.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await stranger.getByTestId('get-started').click()
  await stranger.getByTestId('company-brief').fill('We run a plumbing business and technicians visit customer homes.')
  await stranger.getByTestId('start-building').click()
  await stranger.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await stranger.getByTestId('build-thread').count()) throw new Error('Wesify started building for someone with no account.')

  // 3. Signed in, the same sentence goes straight through to a finished Command Center. Everything
  //    after this uses a real one on purpose: a workspace still mid-build proves nothing about
  //    whether a second device can open one.
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
  //    refresh is not a session — and a returning operator hitting "/" goes straight back to this
  //    same workspace rather than the prompt, which is checked here too, in the same reload.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('signin-form').count()) throw new Error('Reloading signed the operator out.')
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.waitForURL(new RegExp(`/workspace/${builtWorkspaceId}/home`), { timeout: 20_000 })

  /**
   * 5. The same account reaches the same workspace from a different browser — the real point of
   *    having accounts at all, and of the workspace living at a URL rather than in localStorage.
   *
   * `second` has never seen this workspace: nothing cached, nothing built here. Before workspace
   * configuration was fetched from the server as a fallback, this was exactly the browser that got
   * stuck on "Opening workspace..." forever, because the only copy of what the workspace looked like
   * was sitting in the localStorage of the browser that built it.
   */
  const second = await open({ signedIn: true })
  await second.waitForURL(new RegExp(`/workspace/${builtWorkspaceId}/home`), { timeout: 20_000 })
  await second.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  const secondPages = await second.locator('[data-testid^="schema-nav-"]').count()
  if (secondPages < 2) throw new Error(`A browser with nothing cached could not open the workspace it signed into: only ${secondPages} sections rendered.`)

  // 6. A different account is not shown somebody else's workspace, however it arrives at the URL.
  const other = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await other.addInitScript(value => { window.Clerk = { session: { getToken: async () => value } } }, tokenFor('user_intruder'))
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
  await page.addInitScript(() => { window.Clerk = { session: null } })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('A signed-out reload of the workspace URL still showed the workspace.')

  // The public home page still offers the way back in, and a legacy flat link is gated the same way.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('get-started').click()
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  await page.getByTestId('open-signin').waitFor({ timeout: 20_000 })

  await page.goto(`http://127.0.0.1:${vitePort}/home`, { waitUntil: 'networkidle' })
  await page.getByTestId('signin-form').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('app-grid').count()) throw new Error('A signed-out browser could still open the workspace.')

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Sign-in test passed: one public home page whose prompt anyone can type in, the workspace still gated behind an account, a signed-in operator carried from their sentence to a finished Command Center, the session surviving a reload and returning them to their workspace rather than the prompt, the same workspace opened by a browser that had never seen it, another account refused it, and a lost session clearing even a workspace already on screen.')
} finally {
  await browser.close()
  vite.kill()
  await new Promise(resolve => server.close(resolve))
  await rm(process.env.BO_GENERATED_ROOT, { recursive: true, force: true })
}
