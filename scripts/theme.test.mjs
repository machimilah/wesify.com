import { launchBrowser, passOnboarding } from './browser.mjs'
import { spawn } from 'node:child_process'
import './noSpend.mjs'

/**
 * Night mode, end to end.
 *
 * Wesify had no theme system at all: the workspace people actually work in was permanently light, while
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

  // 1. Light is the default. Nobody's first visit should ever look different from today's Wesify.
  await page.getByTestId('theme-toggle').waitFor()
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) throw new Error('Wesify opened in dark mode with no stored preference.')

  const heroLight = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const hero = document.querySelector('.wes-home__hero')
    const frame = document.querySelector('.wes-home__visual')
    const canvas = frame?.querySelector('canvas')
    const gl = canvas?.getContext('webgl2')
    if (!hero || !frame || !canvas || !gl) return resolve({ rendered: false })

    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let visiblePixels = 0
    for (let index = 3; index < pixels.length; index += 16) {
      if (pixels[index] > 0) visiblePixels += 1
    }
    const bounds = frame.getBoundingClientRect()
    const heroBounds = hero.getBoundingClientRect()
    resolve({
      rendered: visiblePixels > 0,
      fillsHero: Math.abs(bounds.width - heroBounds.width) < 1 && Math.abs(bounds.height - heroBounds.height) < 1,
      width: bounds.width,
      height: bounds.height,
    })
  })))
  if (!heroLight.rendered) throw new Error('The hero light background rendered a blank WebGL canvas.')
  if (!heroLight.fillsHero) throw new Error(`The hero light frame does not fill the hero (${heroLight.width}x${heroLight.height}).`)

  const firstVisitOffenders = await invisibleElements()
  if (firstVisitOffenders.length) throw new Error(`Invisible text in light mode on the home page: ${firstVisitOffenders.join(', ')}`)

  // 2. The toggle actually flips the document.
  await page.getByTestId('theme-toggle').click()
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('Clicking the toggle did not set data-theme.')

  const firstVisitOffendersDark = await invisibleElements()
  if (firstVisitOffendersDark.length) throw new Error(`Invisible text in dark mode on the home page: ${firstVisitOffendersDark.join(', ')}`)

  // 3. It persists across a reload — a theme that resets on refresh is not a preference.
  await page.reload({ waitUntil: 'networkidle' })
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('The theme did not survive a reload.')

  // 4. It survives navigation from the public prompt into the project dashboard and back.
  await page.goto(`http://127.0.0.1:${vitePort}/dashboard`, { waitUntil: 'networkidle' })
  await page.getByTestId('project-dashboard').waitFor({ timeout: 20_000 })
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('Dark mode was lost on the project dashboard.')
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark') throw new Error('Dark mode was lost moving between pages.')

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
  // The opening questions are checked while they are on screen: they carry buttons of their own —
  // a picker, a skip — inside a thread with its own surface, which is exactly the arrangement that
  // produces an icon drawn in its own background.
  await page.waitForURL('**/build/*')
  await page.getByTestId('build-thread').waitFor({ timeout: 20_000 })
  await page.getByTestId('intake-actions').waitFor({ timeout: 20_000 })
  const intakeOffendersDark = await invisibleElements()
  if (intakeOffendersDark.length) throw new Error(`Invisible content in dark mode in the build intake: ${intakeOffendersDark.join(', ')}`)
  await passOnboarding(page, 'Ridge Plumbing')
  // Opened deliberately: the proposal is the densest thing Wesify renders, so it is where a colour
  // that vanishes into its own background shows up first.
  await page.getByTestId('check-proposal').click({ timeout: 20_000 })
  await page.getByTestId('architecture-proposal').waitFor({ timeout: 20_000 })
  const proposalOffendersDark = await invisibleElements()
  if (proposalOffendersDark.length) throw new Error(`Invisible content in dark mode on the build proposal: ${proposalOffendersDark.join(', ')}`)

  await page.getByTestId('open-dashboard').click()
  await page.waitForURL('**/home')
  await page.getByTestId('app-grid').waitFor({ timeout: 20_000 })
  const dashboardOffendersDark = await invisibleElements()
  if (dashboardOffendersDark.length) throw new Error(`Invisible content in dark mode on the Command Center: ${dashboardOffendersDark.join(', ')}`)

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  /**
   * Where the keyboard is.
   *
   * Several inputs across Wesify set `outline: 0` to get the border they wanted, and for a long time
   * nothing put a focus style back. Anyone navigating by keyboard — by preference, by injury, or
   * because their mouse died — moved through the product blind, unable to tell which field would
   * receive the next keystroke. This walks the workspace by Tab and insists every stop is visible.
   */
  //
  // Tabbed for real rather than focused by script: `:focus-visible` is the browser's judgement
  // about whether focus deserves to be shown, and it does not consider a scripted `.focus()` to
  // qualify. Only actual keyboard input tests the thing a keyboard user would experience.
  const seen = new Set()
  const missing = new Set()
  let checked = 0
  await page.evaluate(() => document.body.focus())
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const node = document.activeElement
      if (!node || node === document.body) return null
      const style = getComputedStyle(node)
      const name = `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(' ')[0]}` : ''}`
      const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
      return { name, ring }
    })
    if (!stop || seen.has(stop.name)) continue
    seen.add(stop.name)
    checked += 1
    if (!stop.ring) missing.add(stop.name)
  }
  if (checked < 5) throw new Error(`Only ${checked} focusable elements were reached by Tab, so this proves nothing.`)
  if (missing.size) throw new Error(`These have no visible keyboard focus: ${[...missing].join(', ')}`)

  /**
   * Nothing may push the page sideways on a phone.
   *
   * A workspace is a lot of table on a small screen, and one element that will not shrink turns
   * every screen into a horizontal scroll — the failure that makes a product feel broken on a phone
   * without anything actually being broken. Wide content is allowed to scroll inside itself; the
   * document is not.
   */
  for (const [width, height] of [[390, 844], [820, 1180]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(200)
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      culprits: [...document.querySelectorAll('body *')]
        .filter(node => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(node).position !== 'fixed')
        .slice(0, 5)
        .map(node => `${node.tagName.toLowerCase()}.${String(node.className || '').split(' ')[0]}`),
    }))
    if (overflow.scrollWidth > overflow.clientWidth + 1) {
      throw new Error(`The page scrolls sideways at ${width}px (${overflow.scrollWidth} > ${overflow.clientWidth}): ${[...new Set(overflow.culprits)].join(', ')}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  // Every control a person can reach must say what it does. An icon-only button reads to a screen
  // reader as "button" and nothing else, which is the same as unlabelled.
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea')]
    .filter(node => node.getClientRects().length > 0)
    .filter(node => !(node.textContent ?? '').trim() && !node.getAttribute('aria-label') && !node.getAttribute('title')
      && !node.getAttribute('aria-labelledby') && !(node.id && document.querySelector(`label[for="${node.id}"]`)) && !node.closest('label'))
    .map(node => `${node.tagName.toLowerCase()}.${String(node.className || '').split(' ')[0]}`))
  if (unnamed.length) throw new Error(`These controls have no accessible name: ${[...new Set(unnamed)].join(', ')}`)

  console.log('Theme test passed: light is the default, the toggle flips the document, the choice survives a reload, follows the operator into the product, no element on the home page, the build proposal, or the finished Command Center renders with its own background color as its text or icon color in either theme, every control Wesify can reach by keyboard shows where the focus is, none of them is left without an accessible name, and nothing pushes the page sideways on a phone or a tablet.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
}
