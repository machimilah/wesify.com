import { launchBrowser } from './browser.mjs'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import './noSpend.mjs'

/**
 * A long interview must be re-readable.
 *
 * The build thread pinned itself to the bottom with `justify-content: flex-end`, which does the right
 * thing until the conversation outgrows the screen — then an overflowing flex container aligned to
 * its end pushes the earlier turns out past its own start edge. The browser reports
 * `scrollHeight === clientHeight`, so there is nothing to scroll, and fourteen questions in the first
 * half of the conversation sat a thousand pixels above the viewport, unreachable by mouse, keyboard
 * or scrollbar. Nothing threw, nothing looked broken, and the answers were simply gone.
 *
 * No model runs here: the session is seeded into localStorage, which is where Wesify keeps it anyway.
 */

const apiPort = 8955
const vitePort = 4182

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], { cwd: process.cwd(), stdio: 'pipe' })
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
}
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(apiPort) }, stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
}

const now = new Date().toISOString()
const emptyState = {
  companySummary: 'Importer of Uruguayan and Argentinian products', industry: 'Import and distribution', facts: [],
  businessModel: [], productsOrServices: [], customers: [], revenueModel: [], team: [], operations: [], resources: [],
  locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: [], knownWorkflows: [], uncertainties: [],
  assumptions: [], softwareImplications: [],
}

function session(workspaceId, turns) {
  const messages = []
  for (let index = 0; index < turns; index += 1) {
    messages.push({ id: `u${index}`, role: 'user', content: `Answer ${index + 1}. We import from Uruguay and Argentina and sell on to Spanish shops, restaurants and wholesalers around Madrid.`, createdAt: now })
    messages.push({ id: `a${index}`, role: 'assistant', content: `Question ${index + 1}: how does that part of the work run day to day?`, createdAt: now })
  }
  return {
    workspaceId, conversationId: `conversation-${turns}`, projectId: '', phase: 'DISCOVERING', architectureVersion: 0,
    businessState: emptyState, messages,
    currentQuestion: { text: 'How do the shops pay you?', reason: '', suggestedAnswers: [] },
    architecture: null,
    metrics: { discoveryTurns: turns, questionsAsked: turns, architectureEdits: 0, architectureApproved: false, startedAt: now, approvedAt: '' },
    createdAt: now, updatedAt: now,
  }
}

/** Everything about the thread that a person would notice, measured rather than eyeballed. */
const measure = page => page.evaluate(() => {
  const thread = document.querySelector('[data-testid="build-thread"]')
  const first = thread.firstElementChild
  const threadBox = thread.getBoundingClientRect()
  const initialScrollTop = thread.scrollTop
  thread.scrollTop = 0
  const firstBox = first.getBoundingClientRect()
  return {
    canScroll: thread.scrollHeight > thread.clientHeight + 2,
    startedAtBottom: initialScrollTop >= thread.scrollHeight - thread.clientHeight - 8,
    firstTurnReachable: Math.round(firstBox.top) >= Math.round(threadBox.top) - 2,
    firstTurnBelowViewportTop: Math.round(firstBox.top) - Math.round(threadBox.top),
    documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
  }
})

async function open(page, workspaceId, turns) {
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(value => {
    localStorage.clear()
    localStorage.setItem(`bo-discovery-session:${value.workspaceId}`, JSON.stringify(value))
  }, session(workspaceId, turns))
  await page.goto(`http://127.0.0.1:${vitePort}/build/${workspaceId}`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('build-thread').waitFor({ timeout: 30_000 })
  await page.getByTestId('discovery-question').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(400)
}

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  // A long interview scrolls, opens on the newest question, and can be read back to its first line.
  await open(page, 'scroll-long-workspace-01', 14)
  const long = await measure(page)
  if (!long.canScroll) throw new Error('A fourteen-question interview does not scroll at all.')
  if (!long.startedAtBottom) throw new Error('The thread did not open on the question Wesify is waiting on.')
  if (!long.firstTurnReachable) throw new Error(`The first answer is ${-long.firstTurnBelowViewportTop}px above the thread and cannot be scrolled to.`)
  if (long.documentScrolls) throw new Error('The page itself scrolls, so the composer leaves the screen.')

  // Scrolling up to re-read must not be undone by the next repaint.
  await page.evaluate(() => { document.querySelector('[data-testid="build-thread"]').scrollTop = 0 })
  await page.waitForTimeout(500)
  const held = await page.evaluate(() => document.querySelector('[data-testid="build-thread"]').scrollTop)
  assert.ok(held < 200, `Wesify pulled the view back down to ${held}px while the operator was reading earlier answers.`)

  // A short interview still sits at the bottom of the screen rather than floating at the top.
  await open(page, 'scroll-short-workspace-1', 1)
  const short = await measure(page)
  if (short.canScroll) throw new Error('A one-question interview should not need a scrollbar.')
  if (short.firstTurnBelowViewportTop < 60) throw new Error('A short conversation is no longer resting at the bottom of the thread.')

  // The same has to hold on a phone, where the thread is the whole screen.
  await page.setViewportSize({ width: 390, height: 740 })
  await open(page, 'scroll-mobile-workspace-1', 14)
  const mobile = await page.evaluate(() => {
    const thread = document.querySelector('[data-testid="build-thread"]')
    const first = thread.firstElementChild
    thread.scrollTop = 0
    return {
      scrollable: thread.scrollHeight > thread.clientHeight + 2 || document.documentElement.scrollHeight > window.innerHeight + 2,
      firstTurnReachable: Math.round(first.getBoundingClientRect().top) >= Math.round(thread.getBoundingClientRect().top) - 2,
    }
  })
  if (!mobile.scrollable) throw new Error('The interview cannot be scrolled on a phone.')
  if (!mobile.firstTurnReachable) throw new Error('The first answer is unreachable on a phone.')

  console.log('Scroll test passed: a long interview scrolls to its first line, opens on the newest question, holds position while reading, stays bottom-aligned when short, and works on a phone.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
}
