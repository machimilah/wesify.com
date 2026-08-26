import { launchBrowser, passOnboarding } from './browser.mjs'
import { spawn } from 'node:child_process'
import './noSpend.mjs'

/**
 * Opening a finished Command Center must feel like opening a finished app.
 *
 * The user has already watched it being built and approved it. A second full-screen "Wesify is adapting
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
let legacyPreviewSeen = 0
await page.exposeFunction('__boOverlaySeen', () => { overlaySeen += 1 })
await page.exposeFunction('__boLegacyPreviewSeen', () => { legacyPreviewSeen += 1 })

await page.addInitScript(() => {
  window.__BO_DISCOVERY_MODEL_MOCK__ = async () => {
    const businessState = {
      companySummary: 'A plumbing service business', industry: 'Plumbing', facts: [],
      businessModel: ['Field service'], productsOrServices: ['A plumbing service business'], customers: ['Homeowners'],
      revenueModel: ['An invoice is issued after completion and customers pay on completion'], team: ['A small team'], operations: ['A customer requests service, dispatch schedules a technician, the technician completes the job, then finance invoices the customer'],
      resources: [], locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: ['Jobs'],
      knownWorkflows: ['Customer request to scheduled visit to completed job to invoice to payment'], uncertainties: [], assumptions: [], softwareImplications: [],
    }
    const architectureContext = {
      title: 'Plumbing Command Center', summary: 'Run dispatch and billing together.',
      explanation: 'Work orders connect customers, technicians and invoices.',
      modules: ['customers', 'field-service', 'scheduling', 'finance'], startView: 'field-service',
      capabilities: ['Work orders', 'Invoicing'], capabilityIds: ['crm.contacts', 'service.field-work', 'work.scheduling', 'finance.invoicing', 'finance.payments'], excludedCapabilityIds: [],
      pages: ['Dashboard', 'Clients', 'Work orders', 'Schedule', 'Invoices', 'Payments'],
      entities: [{ name: 'Work orders', module: 'field-service', purpose: 'Dispatch jobs' }],
      workflows: [], metrics: ['Open work orders'], processStages: ['New', 'Complete'], pipelineStages: [], billingCadence: 'On completion',
    }
    return { businessState, decision: 'READY_TO_ARCHITECT', acknowledgment: 'Ready.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext }
  }
  // Report the build overlay the instant it is added. The init script runs before the document
  // exists, so wait for a root to observe.
  const watch = () => new MutationObserver(() => {
    if (document.querySelector('.bo-project-build')) window.__boOverlaySeen?.()
    if (document.querySelector('.bo-launch-overlay .bo-dashboard')) window.__boLegacyPreviewSeen?.()
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
  await passOnboarding(page, 'Ridge Plumbing')
  await page.waitForURL('**/build/*')

  try { await page.getByTestId('open-dashboard').waitFor({ timeout: 30_000 }) }
  catch (error) {
    const visible = (await page.locator('main').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').slice(0, 800)
    throw new Error(`Command Center approval did not appear at ${page.url()}. Visible screen: ${visible || 'empty'}. ${error instanceof Error ? error.message : error}`)
  }
  overlaySeen = 0
  legacyPreviewSeen = 0

  await page.getByTestId('open-dashboard').click()
  await page.waitForURL('**/home')
  await page.getByTestId('app-grid').waitFor({ timeout: 30_000 })
  // Give the background fetch time to finish and, if it were going to, to flash the overlay.
  await page.waitForTimeout(2500)

  if (overlaySeen > 0) throw new Error(`Opening the finished Command Center showed the build overlay ${overlaySeen} time(s). It should open like a finished app.`)
  if (legacyPreviewSeen > 0) throw new Error(`The launch transition rendered a legacy dashboard preview ${legacyPreviewSeen} time(s). The configured Command Center must be the first dashboard shown.`)
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

  await page.getByTestId('schema-nav-links').click()
  await page.waitForURL('**/links')
  await page.getByTestId('workflow-studio').waitFor()
  const workflowActions = page.locator('.bo-workflow-actions')
  const testWorkflowButton = workflowActions.getByRole('button', { name: 'Test workflow', exact: true })
  if (await testWorkflowButton.count() !== 1) throw new Error('The top action bar must contain exactly one Test workflow button.')
  const workflowActionOrder = await workflowActions.locator(':scope > *').evaluateAll(nodes => nodes.map(node => {
    if (node.classList.contains('bo-workflow-test')) return 'test'
    if (node.querySelector('[role="switch"]')) return 'status'
    return 'other'
  }))
  if (workflowActionOrder.indexOf('test') !== workflowActionOrder.indexOf('status') + 1) throw new Error('Test workflow is not immediately beside the Active/Inactive toggle.')
  if (await page.locator('.bo-canvas-run').count()) throw new Error('The old floating Test workflow canvas control is still present.')
  const generatedWorkflows = page.getByTestId('saved-link').filter({ hasText: 'Generated' })
  const inferredAutomations = await generatedWorkflows.count()
  if (inferredAutomations < 1) throw new Error('The generated command center did not expose its inferred automation plan.')
  const scheduledWorkflow = page.getByTestId('saved-link').filter({ hasText: 'Review overdue receivables daily' })
  if (await scheduledWorkflow.count() !== 1) throw new Error('The finance workspace did not expose its autonomous daily collections workflow.')
  await scheduledWorkflow.click()
  await page.getByTestId('link-trigger-node').click()
  if (await page.getByTestId('link-event').inputValue() !== 'scheduled') throw new Error('The scheduled workflow did not open as a scheduled trigger.')
  if (await page.getByLabel('Frequency').inputValue() !== 'daily' || await page.getByLabel('Run at').inputValue() !== '08:00' || await page.getByLabel('Timezone').inputValue() !== 'UTC') throw new Error('The scheduled trigger controls did not preserve cadence, time, and timezone.')
  const workflowListBox = await page.locator('.bo-workflow-list').boundingBox()
  const workflowEditorBox = await page.locator('.bo-workflow-editor').boundingBox()
  if (!workflowListBox || !workflowEditorBox || workflowListBox.x + workflowListBox.width > workflowEditorBox.x + 1) throw new Error('The generated workflow list overlaps the automation canvas.')
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (mobileOverflow > 2) throw new Error(`The Automations screen overflows the mobile viewport by ${mobileOverflow}px.`)
  const mobileCards = await generatedWorkflows.count()
  if (mobileCards !== inferredAutomations) throw new Error('Generated automation cards disappeared at the mobile breakpoint.')

  /**
   * The foot of the rail: who is signed in, and the way back out.
   *
   * Clerk is switched off in every browser suite, so the account menu itself renders nothing — the
   * container is what is checked here, exactly as on the workspace list. The door is the part that
   * has to work either way: a workspace with no way back to the list is a room with no handle on the
   * inside.
   */
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTestId('workspace-account').waitFor()
  await page.getByTestId('leave-workspace').click()
  await page.waitForURL('**/dashboard')
  await page.getByTestId('project-dashboard').waitFor()

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Launch test passed: finished workspace launch, navigation, generated workflows, the Automations canvas, and the account and exit controls at the foot of the rail.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
}
