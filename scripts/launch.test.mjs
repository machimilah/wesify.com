import { launchBrowser } from './browser.mjs'
import { spawn } from 'node:child_process'
import './noSpend.mjs'

/**
 * Opening a finished Command Center must feel like opening a finished app.
 *
 * The user has already watched it being built and approved it. A second full-screen "BO is adapting
 * your Command Center" overlay on first load was both a repeat and a lie — nothing was being adapted,
 * the page was just fetching its records. The overlay belongs to real structural changes only.
 */

const apiPort = 8951
const vitePort = 4178

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], { cwd: process.cwd(), stdio: 'pipe' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch {} ; await new Promise(r => setTimeout(r, 100)) }
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(apiPort) }, stdio: 'pipe' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch {} ; await new Promise(r => setTimeout(r, 100)) }

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => message.type() === 'error' && errors.push(message.text()))

// Watch for the overlay at all times, not only when we happen to look — it is transient by nature.
let overlaySeen = 0
await page.exposeFunction('__boOverlaySeen', () => { overlaySeen += 1 })

await page.addInitScript(() => {
  window.__BO_DISCOVERY_MODEL_MOCK__ = async () => {
    const businessState = {
      companySummary: 'A plumbing service business', industry: 'Plumbing', facts: [],
      businessModel: ['Field service'], productsOrServices: ['A plumbing service business'], customers: ['Homeowners'],
      revenueModel: ['Customers pay on completion'], team: ['A small team'], operations: ['Technicians visit customer homes'],
      resources: [], locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: ['Jobs'],
      knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
    }
    const architectureContext = {
      title: 'Plumbing Command Center', summary: 'Run dispatch and billing together.',
      explanation: 'Work orders connect customers, technicians and invoices.',
      modules: ['customers', 'field-service', 'scheduling', 'finance'], startView: 'field-service',
      capabilities: ['Work orders'], capabilityIds: ['crm.contacts', 'service.field-work'], excludedCapabilityIds: [],
      pages: ['Dashboard', 'Clients', 'Work orders', 'Invoices'],
      entities: [{ name: 'Work orders', module: 'field-service', purpose: 'Dispatch jobs' }],
      workflows: [], metrics: ['Open work orders'], processStages: ['New', 'Complete'], pipelineStages: [], billingCadence: 'On completion',
    }
    return { businessState, decision: 'READY_TO_ARCHITECT', acknowledgment: 'Ready.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext }
  }
  // Report the build overlay the instant it is added. The init script runs before the document
  // exists, so wait for a root to observe.
  const watch = () => new MutationObserver(() => {
    if (document.querySelector('.bo-project-build')) window.__boOverlaySeen?.()
  }).observe(document.documentElement, { childList: true, subtree: true })
  if (document.documentElement) watch()
  else document.addEventListener('readystatechange', function once() { if (document.documentElement) { document.removeEventListener('readystatechange', once); watch() } })
})

try {
  // `/` is the prompt: one home page, public, and the only place a company is described.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  await page.getByTestId('company-brief').fill('We run a plumbing service business. Technicians visit customer homes. Customers pay on completion. We have a small team.')
  await page.getByTestId('start-building').click()
  await page.waitForURL('**/build/*')

  await page.getByTestId('architecture-proposal').waitFor({ timeout: 30_000 })
  overlaySeen = 0

  await page.getByTestId('open-dashboard').click()
  await page.waitForURL('**/home')
  await page.getByTestId('app-grid').waitFor({ timeout: 30_000 })
  // Give the background fetch time to finish and, if it were going to, to flash the overlay.
  await page.waitForTimeout(2500)

  if (overlaySeen > 0) throw new Error(`Opening the finished Command Center showed the build overlay ${overlaySeen} time(s). It should open like a finished app.`)
  if (await page.locator('.bo-project-build').count()) throw new Error('The build overlay is still on screen after opening the Command Center.')

  // The workspace must actually be usable, not merely quiet.
  await page.getByTestId('schema-nav-home').waitFor()
  const pages = await page.locator('[data-testid^="schema-nav-"]').count()
  if (pages < 4) throw new Error(`Only ${pages} sections rendered; the workspace did not load.`)

  // Home is a launcher: one tile per section. The rail groups pages behind modules, so gather its
  // targets by opening every group before comparing — the two must describe the same workspace.
  await page.getByTestId('app-grid').waitFor()
  const tileIds = (await page.locator('[data-testid^="app-tile-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')?.replace('app-tile-', '')))).filter(Boolean)
  const readNavIds = async () => (await page.locator('[data-testid^="schema-nav-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')?.replace('schema-nav-', '')))).filter(Boolean)
  const reachable = new Set(await readNavIds())
  // Only one group is open at a time, so collect each one's pages while it is the open one.
  const groupIds = await page.locator('[data-testid^="schema-group-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')))
  for (const id of groupIds) {
    await page.locator(`[data-testid="${id}"]`).click()
    await page.getByTestId('sub-sidebar').waitFor()
    for (const navId of await readNavIds()) reachable.add(navId)
  }
  const stranded = tileIds.filter(id => id !== 'home' && !reachable.has(id))
  if (stranded.length) throw new Error(`Tiles with no way to reach them from the sidebar: ${stranded.join(', ')}`)
  if (tileIds.length < 4) throw new Error(`Launcher only shows ${tileIds.length} tiles.`)
  const counts = await page.locator('[data-testid^="app-tile-"] small').allInnerTexts()
  const invented = counts.filter(text => /\d/.test(text) && !text.startsWith('0'))
  if (invented.length) throw new Error(`A tile shows a record count on an empty workspace: ${invented.join(', ')}`)
  await page.getByTestId('app-tile-today').click()
  await page.waitForURL('**/today')
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor()

  /**
   * The nested panel is opened by its button and by nothing else.
   *
   * It used to open itself whenever a nested page happened to be active, and never closed when the
   * operator moved on — so an unrelated rail sat there listing pages belonging to some other module.
   */
  const subSidebar = page.getByTestId('sub-sidebar')
  await page.getByTestId('schema-nav-home').click()
  if (await subSidebar.count()) throw new Error('The nested panel was open without its button being clicked.')

  const firstGroup = groupIds[0]
  if (!firstGroup) throw new Error('The workspace built no module groups, so this behaviour cannot be checked.')
  await page.locator(`[data-testid="${firstGroup}"]`).click()
  await subSidebar.waitFor()

  // Moving between pages of the module the panel belongs to is still inside it, so it stays.
  const insideIds = (await subSidebar.locator('[data-testid^="schema-nav-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')?.replace('schema-nav-', '')))).filter(Boolean)
  const insideId = insideIds[0]
  if (!insideId) throw new Error('The open group listed no pages.')
  await page.getByTestId(`schema-nav-${insideId}`).click()
  await subSidebar.waitFor()

  // Going to a section that has no panel must collapse it.
  await page.getByTestId('schema-nav-today').click()
  await page.waitForURL('**/today')
  if (await subSidebar.count()) throw new Error('The nested panel stayed open after moving to a section that has none.')

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Launch test passed: opening a finished Command Center shows no build overlay and loads a usable workspace.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
}
