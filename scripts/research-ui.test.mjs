import { launchBrowser } from './browser.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

/**
 * Verifies that frontier research reaches the interface.
 *
 * `reasoning.test.mjs` proves the server produces correct research; `researchClient.test.ts` proves
 * the merge is correct. This proves the wiring between them: that a researched conclusion, its
 * evidence, and its sources actually appear in the reasoning journal and on the approval screen.
 */

const anthropicPort = 8921
const apiPort = 8922
const vitePort = 4176

const compiled = {
  archetype: { id: 'field-service', label: 'Field service', confidence: 0.9 },
  summary: 'Dispatch-led plumbing operation billing on completion.',
  findings: [
    { conclusion: 'Technicians are dispatched to customer sites', because: 'Industry guidance on dispatch operations', implication: 'BO is connecting work orders, technicians, and the assets they service.', basis: 'researched', confidence: 0.9, sourceUrl: 'https://example.org/dispatch', capabilityIds: ['service.field-work', 'work.scheduling'] },
  ],
  capabilityIds: ['service.field-work', 'work.scheduling', 'procurement.purchasing'],
  excludedCapabilityIds: ['manufacturing.production'],
  openQuestion: { text: 'Do technicians carry stock in their vans?', reason: 'Decides van inventory.', suggestedAnswers: ['Yes', 'No'] },
  sources: [{ title: 'Dispatch operations guide', url: 'https://example.org/dispatch' }],
}

const sse = (response, events) => {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  response.end()
}
const start = () => ({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
const text = value => [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } },
  { type: 'content_block_stop', index: 0 },
]
const end = () => [{ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' }]

const anthropic = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  const payload = body.output_config?.format ? JSON.stringify(compiled) : 'Research brief: dispatch-led plumbing operation.'
  sse(response, [start(), ...text(payload), ...end()])
})
await new Promise(resolve => anthropic.listen(anthropicPort, '127.0.0.1', resolve))

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], {
  cwd: process.cwd(),
  env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicPort}`, ANTHROPIC_API_KEY: 'sk-ant-mock' },
  stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the project service.')
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: process.cwd(),
  env: { ...process.env, BO_API_PORT: String(apiPort) },
  stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the frontend server.')
}

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => message.type() === 'error' && errors.push(message.text()))

// The local discovery model is mocked so the run reaches the approval screen without WebGPU.
await page.addInitScript(() => {
  window.__BO_DISCOVERY_MODEL_MOCK__ = async request => {
    const businessState = {
      companySummary: 'A plumbing company', industry: 'Plumbing', facts: [],
      businessModel: ['Field service'], productsOrServices: ['A plumbing service business'], customers: ['Homeowners'],
      revenueModel: ['Customers pay on completion'], team: ['A small team'], operations: ['Technicians visit customer homes'], resources: ['Parts'],
      locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: ['Jobs'],
      knownWorkflows: ['Booking to invoice'], uncertainties: [], assumptions: [], softwareImplications: [],
    }
    const architectureContext = {
      title: 'Plumbing Command Center', summary: 'Run dispatch and billing together.',
      explanation: 'Work orders connect customers, technicians and invoices.',
      modules: ['customers', 'field-service', 'scheduling', 'finance'], startView: 'field-service',
      capabilities: ['Work orders'], capabilityIds: ['crm.contacts', 'service.field-work'], excludedCapabilityIds: [],
      pages: ['Dashboard', 'Clients', 'Work orders', 'Invoices'],
      entities: [{ name: 'Work orders', module: 'field-service', purpose: 'Dispatch jobs' }],
      workflows: [], metrics: ['Open work orders'], processStages: ['New', 'Scheduled', 'Complete'], pipelineStages: [], billingCadence: 'On completion',
    }
    if (request.mode === 'DISCOVER') return { businessState, decision: 'READY_TO_ARCHITECT', acknowledgment: 'Understood.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext: { ...architectureContext, modules: [], pages: [], entities: [], capabilityIds: [] } }
    return { businessState, decision: 'READY_TO_ARCHITECT', acknowledgment: 'Ready.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext }
  }
})

try {
  // `/` is the public landing page now; the prompt this suite is about lives at /start.
  await page.goto(`http://127.0.0.1:${vitePort}/start`, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  const status = await page.evaluate(async () => (await fetch('/api/research/status')).json())
  if (status.available !== true) throw new Error(`The frontier tier should be available in this run: ${JSON.stringify(status)}`)

  // Every essential operating-model dimension is stated, so BO has enough to architect without asking.
  await page.getByTestId('company-brief').fill('We run a plumbing service business. Technicians visit customer homes. Customers pay on completion. We have a small team.')
  await page.getByTestId('start-building').click()
  await page.waitForURL('**/build/*')

  // BO's working is collapsed in the thread; open it before reading what it says.
  await page.getByRole('button', { name: /Thinking|Thought this through|Understanding|Designing|Researching/ }).first().click({ timeout: 30_000 })
  const journal = page.locator('[data-testid="agent-thinking"]')
  await journal.getByText('Researching this kind of business', { exact: true }).waitFor({ timeout: 30_000 })
  await journal.getByText('Technicians are dispatched to customer sites', { exact: true }).waitFor({ timeout: 30_000 })
  const journalText = await journal.innerText()
  if (!journalText.includes('https://example.org/dispatch')) throw new Error('The journal did not cite the source of a researched conclusion.')
  if (!journalText.includes('Sources BO read')) throw new Error('The journal did not list the sources BO opened.')

  await page.getByTestId('architecture-proposal').waitFor({ timeout: 30_000 })
  await page.getByTestId('research-sources').waitFor()
  const sourceLink = page.getByTestId('research-sources').getByRole('link', { name: 'Dispatch operations guide' })
  if ((await sourceLink.getAttribute('href')) !== 'https://example.org/dispatch') throw new Error('The approval screen did not link the researched source.')

  // Researched capability decisions must reach the compiled workspace, not just the journal.
  // The live preview must be readable at a glance, exactly like the finished Command Center. It once
  // drew every page with the same generic document icon, so a twenty-page sidebar was twenty
  // identical glyphs telling the operator nothing about what BO was building.
  const previewIcons = await page.$$eval('[data-testid="building-command-center"] nav button svg', nodes => nodes.map(node => node.innerHTML))
  if (previewIcons.length < 4) throw new Error(`The build preview showed only ${previewIcons.length} pages.`)
  const distinctIcons = new Set(previewIcons).size
  if (distinctIcons < Math.ceil(previewIcons.length * 0.6)) throw new Error(`The build preview drew ${previewIcons.length} pages with only ${distinctIcons} distinct icons.`)

  await page.getByTestId('open-dashboard').click()
  await page.waitForURL('**/home')
  const capabilities = await page.evaluate(() => JSON.parse(localStorage.getItem('bo-workspace-config') ?? '{}').capabilities ?? [])
  for (const required of ['service.field-work', 'work.scheduling', 'procurement.purchasing']) {
    if (!capabilities.includes(required)) throw new Error(`Researched capability ${required} did not reach the workspace: ${capabilities.join(', ')}`)
  }
  if (capabilities.includes('manufacturing.production')) throw new Error('A researched exclusion still reached the workspace.')

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Research UI test passed: live research journal with cited evidence, linked sources on the approval screen, and researched capability decisions compiled into the workspace.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
  anthropic.close()
}
