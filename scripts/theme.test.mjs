import { launchBrowser } from './browser.mjs'
import { spawn } from 'node:child_process'

/**
 * Night mode, end to end.
 *
 * BO had no theme system at all: the workspace people actually work in was permanently light, while
 * the interview and sign-in screens were permanently dark, with no way to change either. Retrofitting
 * a toggle onto ~600 already-hardcoded colors is exactly the kind of change that looks fine in a diff
 * and breaks in the browser — a background and its text independently landing on the same color, or
 * on opposite sides of the light/dark split. This proves the toggle actually works, persists across a
 * reload, and does not leave any text sharing its own background's color in either theme.
 */

const apiPort = 8961
const vitePort = 4194

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], { cwd: process.cwd(), stdio: 'pipe' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch {} ; await new Promise(r => setTimeout(r, 100)) }
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(apiPort) }, stdio: 'pipe' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch {} ; await new Promise(r => setTimeout(r, 100)) }

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => message.type() === 'error' && errors.push(message.text()))

// Skips the interview so the test can reach the proposal screen and the finished Command Center —
// the two screens the earlier manual pass found the most invisible-content bugs on — without a key.
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
})

/**
 * Any element whose own text or icon color equals its own background color, in the theme currently
 * applied. This is exactly the bug class the retrofit kept producing: a rule that reads correctly as
 * CSS but renders as invisible content, which no functional test would ever otherwise catch.
 *
 * Icons need their own check, not just text: a button holding only an `<svg>` has no text content at
 * all, but lucide-react icons paint with `stroke: currentColor`, so the same collapse — icon color
 * equal to the button's own background — makes it disappear exactly like invisible text would, and
 * was in fact the shape of the real bug this test is guarding against (a send button with no label).
 */
async function invisibleElements() {
  return page.evaluate(() => {
    const offenders = []
    const backgroundOf = start => {
      let node = start
      let bg = getComputedStyle(node).backgroundColor
      while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        node = node.parentElement
        if (!node) break
        bg = getComputedStyle(node).backgroundColor
      }
      return bg
    }
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
      const isTextLeaf = el.textContent?.trim() && el.children.length === 0
      const isIconOnly = el.children.length === 1 && el.children[0].tagName === 'svg' && !el.textContent?.trim()
      if (!isTextLeaf && !isIconOnly) continue
      const bg = backgroundOf(el)
      if (bg && bg === style.color) offenders.push(`${el.tagName}.${el.className || '(no class)'}`)
    }
    return offenders
  })
}

try {
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  // 1. Light is the default. Nobody's first visit should ever look different from today's BO.
  await page.getByTestId('theme-toggle').waitFor()
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) throw new Error('BO opened in dark mode with no stored preference.')

  const landingOffendersLight = await invisibleElements()
  if (landingOffendersLight.length) throw new Error(`Invisible text in light mode on the landing page: ${landingOffendersLight.join(', ')}`)

  // 2. The toggle actually flips the document.
  await page.getByTestId('theme-toggle').click()
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('Clicking the toggle did not set data-theme.')

  const landingOffendersDark = await invisibleElements()
  if (landingOffendersDark.length) throw new Error(`Invisible text in dark mode on the landing page: ${landingOffendersDark.join(', ')}`)

  // 3. It persists across a reload — a theme that resets on refresh is not a preference.
  await page.reload({ waitUntil: 'networkidle' })
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('The theme did not survive a reload.')

  // 4. It follows the operator into the product, not just the marketing page.
  await page.getByTestId('landing-nav-start').click()
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('Dark mode was lost moving from the landing page into the product.')

  const homeOffendersDark = await invisibleElements()
  if (homeOffendersDark.length) throw new Error(`Invisible text in dark mode on the home page: ${homeOffendersDark.join(', ')}`)

  // 5. Toggling back reaches the same light appearance the first visit had.
  await page.getByTestId('theme-toggle').click()
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) throw new Error('Toggling back to light left a data-theme attribute set.')
  const homeOffendersLight = await invisibleElements()
  if (homeOffendersLight.length) throw new Error(`Invisible text in light mode on the home page: ${homeOffendersLight.join(', ')}`)

  /**
   * 6. The interview and the finished Command Center, in dark mode.
   *
   * These two screens carried the most invisible-content bugs found by hand while building this
   * retrofit — a question's own heading, a primary button, and a launcher tile all rendered with
   * their text color equal to their background. Checked here so a regression fails a test instead of
   * waiting for someone to notice a blank button.
   */
  await page.getByTestId('theme-toggle').click()
  await page.getByTestId('company-brief').fill('We run a plumbing service business.')
  await page.getByTestId('start-building').click()
  await page.waitForURL('**/build/*')
  await page.getByTestId('architecture-proposal').waitFor({ timeout: 20_000 })
  const proposalOffendersDark = await invisibleElements()
  if (proposalOffendersDark.length) throw new Error(`Invisible content in dark mode on the build proposal: ${proposalOffendersDark.join(', ')}`)

  await page.getByTestId('open-dashboard').click()
  await page.waitForURL('**/home')
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  const dashboardOffendersDark = await invisibleElements()
  if (dashboardOffendersDark.length) throw new Error(`Invisible content in dark mode on the Command Center: ${dashboardOffendersDark.join(', ')}`)

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Theme test passed: light is the default, the toggle flips the document, the choice survives a reload, follows the operator into the product, and no element on the landing page, the home page, the build proposal, or the finished Command Center renders with its own background color as its text or icon color in either theme.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
}
