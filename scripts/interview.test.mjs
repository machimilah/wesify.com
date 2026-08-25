import { launchBrowser } from './browser.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import './noInfra.mjs'

/**
 * The interview runs on the server, and the browser model is not downloaded when it does.
 *
 * Wesify's first minute used to be a one-gigabyte model download, a WebGPU requirement, and then a
 * questionnaire asking a plumber what their company sells. This covers the replacement: the turn goes
 * to the server, the question reaches the screen in plain words, the answer goes back with
 * the conversation attached, and the architecture that follows is the one the server produced.
 *
 * It also holds the fallback. With no key configured the server must decline and Wesify must keep going
 * on its own, because a product that stops working without a paid API is not a product.
 */

const anthropicPort = 8941
const apiPort = 8942
const vitePort = 4179

const turns = []
const question = {
  businessState: {
    companySummary: 'A plumbing service business', industry: 'Plumbing', facts: [{ topic: 'Delivery', value: 'Technicians visit customer homes', status: 'explicit', confidence: 0.9 }],
    businessModel: ['Field service'], productsOrServices: ['Plumbing callouts'], customers: ['Homeowners'], revenueModel: [], team: [], operations: ['Technicians visit customer homes'],
    resources: [], locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: ['Jobs'], knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
  },
  decision: 'ASK_QUESTION',
  acknowledgment: 'Understood.',
  nextQuestion: { text: 'Do your technicians carry stock in their vans?', reason: 'Decides van inventory.', suggestedAnswers: ['Yes, each van holds parts', 'No, they collect per job'] },
  architectureContext: emptyArchitecture(),
}
const architecture = {
  ...question,
  businessState: {
    ...question.businessState,
    facts: [
      ...question.businessState.facts,
      { topic: 'Job flow', value: 'Customer calls, technician visits, completed work is invoiced', status: 'explicit', confidence: 0.9, evidence: 'First the customer calls, then a technician visits, and after completion we invoice.', basis: 'user' },
      { topic: 'Billing', value: 'Invoice on completion', status: 'explicit', confidence: 0.9, evidence: 'We invoice after the job is complete.', basis: 'user' },
    ],
    revenueModel: ['Invoice on completion'],
    team: ['Technicians'],
    resources: ['Parts held in service vans'],
    knownWorkflows: ['First the customer calls, then a technician visits, and after completion the job is invoiced'],
  },
  decision: 'READY_TO_ARCHITECT',
  acknowledgment: 'Ready.',
  nextQuestion: { text: '', reason: '', suggestedAnswers: [] },
  architectureContext: {
    title: 'Plumbing Command Center', summary: 'Dispatch and billing in one place.', explanation: 'Work orders connect customers, technicians and invoices.',
    modules: ['customers', 'field-service', 'finance'], startView: 'field-service',
    capabilities: ['Work orders'], capabilityIds: ['crm.contacts', 'service.field-work'], excludedCapabilityIds: ['manufacturing.production'],
    pages: ['Clients', 'Work orders', 'Invoices'],
    entities: [{ name: 'Work orders', module: 'field-service', purpose: 'Dispatch jobs' }],
    workflows: [], metrics: ['Open work orders'], processStages: ['New', 'Scheduled', 'Complete'], pipelineStages: [], billingCadence: 'On completion',
  },
}

function emptyArchitecture() {
  return {
    title: '', summary: '', explanation: '', modules: [], startView: 'overview', capabilities: [], capabilityIds: [], excludedCapabilityIds: [],
    pages: [], entities: [], workflows: [], metrics: [], processStages: [], pipelineStages: [], billingCadence: '',
  }
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
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  const prompt = String(payload.system ?? '')
  const asked = String(payload.messages?.[0]?.content ?? '')
  turns.push({ consultant: prompt.includes("Wesify's business consultant"), architect: prompt.includes('Business Application Architect'), asked })
  // First interview turn asks; the second, after the operator answers, is ready to build.
  const answered = /Operator:.*van/i.test(asked)
  const body = prompt.includes('Business Application Architect') || answered ? architecture : question
  sse(response, [start(), ...text(JSON.stringify(body)), ...end()])
})
await new Promise(resolve => anthropic.listen(anthropicPort, '127.0.0.1', resolve))

const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], {
  cwd: process.cwd(),
  /**
   * The provider is pinned, not inherited.
   *
   * This suite stubs Anthropic. A developer whose `.env.local` holds a Gemini key — or
   * `BO_INTERVIEW_PROVIDER=gemini` — would otherwise have the server pick that instead, walk straight
   * past the stub, and run the interview against the live free tier: real calls, real quota, and a
   * question this test is not expecting.
   */
  env: {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicPort}`,
    ANTHROPIC_API_KEY: 'sk-ant-mock',
    BO_INTERVIEW_PROVIDER: 'anthropic',
    GEMINI_API_KEY: '',
    GOOGLE_API_KEY: '',
  },
  stdio: 'pipe',
})
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the project service.')
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(apiPort) }, stdio: 'pipe',
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

// Anything fetched from a model host means the browser engine started loading despite the server.
const modelRequests = []
page.on('request', item => { if (/huggingface|mlc-ai|\.wasm$|params_shard/i.test(item.url())) modelRequests.push(item.url()) })

try {
  // `/` is the prompt: one home page, public, and the only place a company is described.
  await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  await page.getByTestId('get-started').click()
  await page.getByTestId('company-brief').fill('We run a plumbing service business.')
  await page.getByTestId('start-building').click()
  await page.waitForURL('**/build/*')

  // The consultant asks about this company, not about what a company is.
  await page.getByText('Do your technicians carry stock in their vans?', { exact: true }).waitFor({ timeout: 30_000 })
  // Answered by typing. The interview used to put two to four buttons under every question, which
  // taught people Wesify wanted a pick rather than a sentence — and the sentence is what the
  // architecture is built from, so the buttons are gone and this checks they stay gone.
  if (await page.locator('.bo-quick-answers').count()) throw new Error('The interview is offering clickable answers again.')

  /**
   * The interview has to be worth sitting through.
   *
   * The question is the thing the operator is being asked to do, so it goes above Wesify's own notes
   * rather than under a wall of them; it says how far in they are; and it does not print a different
   * "still open" line beside the question actually on screen.
   */
  const progress = page.getByTestId('question-progress')
  await progress.waitFor()
  const progressText = await progress.innerText()
  if (!/Question 2/i.test(progressText)) throw new Error(`The interview does not say how far in it is: ${progressText}`)
  if (!/\d+% understood/.test(progressText)) throw new Error(`The interview shows no measure of progress: ${progressText}`)

  // It reads as a conversation: what Wesify said, then the question, then the box you answer in. The
  // question being anywhere but last is what made the old build feel like a form with a log stapled
  // underneath it.
  const threadShape = await page.evaluate(() => {
    const thread = document.querySelector('[data-testid="build-thread"]')
    const question = document.querySelector('[data-testid="discovery-question"]')
    if (!thread || !question) return null
    return {
      questionIsLast: thread.lastElementChild === question,
      composerAfterThread: Boolean(thread.compareDocumentPosition(document.querySelector('.bo-composer')) & Node.DOCUMENT_POSITION_FOLLOWING),
    }
  })
  if (!threadShape) throw new Error('The build screen is not a single thread.')
  if (!threadShape.questionIsLast) throw new Error('Something is stacked below the question Wesify is waiting on.')
  if (!threadShape.composerAfterThread) throw new Error('The reply box is not under the conversation.')

  /**
   * Wesify's reasoning is not reading material.
   *
   * There used to be an expandable journal here — a paragraph per fact absorbed, per capability
   * chosen, per research finding. It was built to show Wesify's working and it read as Wesify talking to
   * itself at length while somebody waited to answer a question. The reasoning still decides what
   * gets built; it is no longer something the operator has to scroll past to reach the question.
   */
  if (await page.getByTestId('agent-thinking').count()) throw new Error('The reasoning journal is back on the build screen.')
  const threadText = await page.getByTestId('build-thread').innerText()
  for (const leak of [/Updating the operating model/i, /Choosing the business systems/i, /Knitting the Command Center/i, /Thought this through in \d+ step/i]) {
    if (leak.test(threadText)) throw new Error(`Wesify is still narrating its reasoning: ${threadText.slice(0, 400)}`)
  }

  const first = turns.find(turn => turn.consultant)
  if (!first) throw new Error(`The interview did not reach the server. Turns seen: ${JSON.stringify(turns.map(turn => turn.asked.slice(0, 60)))}`)
  if (!first.asked.includes('plumbing service business')) throw new Error('The server was not told what the operator wrote.')

  // Answering carries the conversation back, so the next turn is not asked in a vacuum.
  await page.getByTestId('discovery-answer').fill('Yes, each van holds parts')
  await page.getByTestId('answer-question').click()
  // The interview ends on a decision: two buttons, and the plan itself only if asked for.
  await page.getByTestId('open-dashboard').waitFor({ timeout: 30_000 })
  const withAnswer = turns.find(turn => /Operator:.*van/i.test(turn.asked))
  if (!withAnswer) throw new Error('The answer was not sent back with the next turn.')

  // The plan is out of the way until it is asked for, and then it is the one the server designed.
  if (await page.getByTestId('architecture-proposal').count()) throw new Error('The proposal is in the way before anyone asked to see it.')
  await page.getByTestId('check-proposal').click()
  await page.getByTestId('architecture-proposal').getByText('Plumbing Command Center', { exact: true }).waitFor()
  if (modelRequests.length) throw new Error(`The browser model was downloaded even though the server ran the interview: ${modelRequests.slice(0, 3).join(', ')}`)

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Interview test passed: the server ran the interview, asked about this company, carried the answer forward, built from it, and never downloaded the browser model.')
} finally {
  await browser.close()
  vite.kill()
  api.kill()
  anthropic.close()
}
