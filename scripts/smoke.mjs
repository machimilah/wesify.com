import { launchBrowser } from './browser.mjs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const captureScreenshots = process.env.BO_SMOKE_SCREENSHOTS === '1'
const screenshotDirectory = process.env.TEMP || process.cwd()

const apiPort = 8798
const apiServer = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], { cwd: process.cwd(), stdio: 'pipe' })
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* project service is starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 49) throw new Error('Could not start the project service.')
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { cwd: process.cwd(), env: { ...process.env, BO_API_PORT: String(apiPort) }, stdio: 'pipe' })
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch('http://127.0.0.1:4174/')).ok) break } catch { /* server is starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 49) throw new Error('Could not start the smoke-test server.')
}

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', message => message.type() === 'error' && errors.push(message.text()))
page.on('response', response => response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`))
page.on('pageerror', error => errors.push(error.message))

await page.addInitScript(() => {
  window.__BO_DISCOVERY_CALLS__ = 0
  window.__BO_DISCOVERY_MODEL_MOCK__ = async (request, stream) => {
    window.__BO_DISCOVERY_CALLS__ += 1
    await new Promise(resolve => setTimeout(resolve, 25))
    const userTurns = request.session.messages.filter(message => message.role === 'user').length
    const businessState = {
      companySummary: 'A marketing agency serving technology companies', industry: 'Marketing agency',
      facts: [{ topic: 'client type', value: 'Technology companies', status: 'explicit', confidence: 1 }],
      businessModel: ['Client services'], productsOrServices: ['Marketing campaigns'], customers: ['Technology companies'],
      revenueModel: userTurns > 1 ? ['Monthly retainers'] : [], team: userTurns > 2 ? ['A small internal team'] : [], operations: ['Campaign delivery'], resources: [],
      locations: [], currentTools: [], painPoints: [], goals: ['Run the agency in one place'], knownEntities: ['Leads', 'Clients', 'Campaigns'],
      knownWorkflows: ['Lead to client to campaign'], uncertainties: userTurns > 1 ? [] : ['Engagement and billing structure'], assumptions: [],
      softwareImplications: ['CRM', 'Campaign delivery', 'Billing'],
    }
    const architectureContext = {
      title: 'Agency Command Center', summary: 'Run sales, clients, campaigns and billing together.',
      explanation: 'Campaigns connect each client to deliverables, team work, invoices and expenses so the agency can manage delivery and profitability from one place.',
      modules: ['sales', 'customers', 'projects', 'processes', 'finance', 'team'], startView: 'projects',
      capabilities: ['Lead pipeline', 'Client records', 'Campaign delivery', 'Recurring invoices', 'Expense tracking', 'Team workload'],
      capabilityIds: ['crm.contacts', 'crm.pipeline', 'work.projects', 'work.tasks', 'subscriptions.billing', 'finance.expenses', 'people.directory'], excludedCapabilityIds: ['inventory.stock', 'manufacturing.production'],
      pages: ['Dashboard', 'Leads', 'Clients', 'Campaigns', 'Tasks', 'Invoices', 'Expenses', 'Team'],
      entities: [
        { name: 'Leads', module: 'sales', purpose: 'Track prospective clients' }, { name: 'Clients', module: 'customers', purpose: 'Keep client records' },
        { name: 'Campaigns', module: 'projects', purpose: 'Manage client delivery' }, { name: 'Tasks', module: 'projects', purpose: 'Assign campaign work' },
        { name: 'Invoices', module: 'finance', purpose: 'Bill clients' }, { name: 'Expenses', module: 'finance', purpose: 'Track costs' },
        { name: 'Team', module: 'team', purpose: 'Manage workload' },
      ],
      workflows: ['Lead to signed client', 'Client to campaign', 'Monthly invoice to payment'], metrics: ['Pipeline value', 'Active campaigns', 'Outstanding invoices', 'Campaign profitability'],
      processStages: ['Brief', 'Plan', 'Create', 'Client review', 'Complete'], pipelineStages: ['Lead', 'Discovery', 'Proposal', 'Won'], billingCadence: 'Monthly retainers',
    }
    if (request.mode === 'REVIEW_ARCHITECTURE' || userTurns > 1) {
      stream?.onText?.('Run sales, campaigns and billing together.')
      return { businessState, decision: 'READY_TO_ARCHITECT', acknowledgment: 'I have a good picture of how the agency works.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext }
    }
    const question = 'How do clients normally engage the agency: one-off projects, monthly retainers, or a mix?'
    stream?.onText?.(question)
    return {
      businessState, decision: 'ASK_QUESTION', acknowledgment: 'I understand that you deliver marketing work for technology companies.',
      nextQuestion: { text: question, reason: 'Engagement structure changes project and billing architecture.', suggestedAnswers: ['One-off projects', 'Monthly retainers', 'A mix'] },
      architectureContext: { title: '', summary: '', explanation: '', modules: [], startView: 'overview', capabilities: [], capabilityIds: [], excludedCapabilityIds: [], pages: [], entities: [], workflows: [], metrics: [], processStages: [], pipelineStages: [], billingCadence: '' },
    }
  }
  const emptyAgentAction = {
    kind: 'none', entityId: '', recordId: '', navigationId: '', collectionName: '', capabilityId: '', values: [],
    field: { id: '', label: '', type: 'text', required: false },
    workflow: { name: '', entityId: '', event: 'created', conditionField: '', conditionEquals: '', message: '' },
  }
  window.__BO_WORKSPACE_AGENT_MOCK__ = async command => {
    if (/new client.*acme/i.test(command)) return {
      decision: 'EXECUTE', message: 'Record created.',
      action: { ...emptyAgentAction, kind: 'create_record', entityId: 'customers', values: [{ field: 'name', value: 'ACME' }] },
    }
    if (/account tier/i.test(command)) return {
      decision: 'PREVIEW', message: 'I can add account tier to every client record.',
      action: { ...emptyAgentAction, kind: 'add_field', entityId: 'customers', field: { id: 'account-tier', label: 'account tier', type: 'text', required: false } },
    }
    return { decision: 'CLARIFY', message: 'What should BO change?', action: emptyAgentAction }
  }
})

/** Opens a section whether the sidebar shows it directly or behind a module group. */
async function openSection(page, id) {
  const direct = page.getByTestId(`schema-nav-${id}`)
  if (await direct.count()) { await direct.click(); return }
  for (const groupId of await page.locator('[data-testid^="schema-group-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')))) {
    await page.locator(`[data-testid="${groupId}"]`).click()
    await page.getByTestId('sub-sidebar').waitFor()
    if (await direct.count()) { await direct.click(); return }
  }
  throw new Error(`No way to reach section "${id}" from the sidebar.`)
}

try {
  // A person meets the home page first, and it is the prompt, so the journey starts by typing.
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  // One page: `/` is the prompt, so there is nowhere to click through to any more.
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => (document.querySelector('.bo-prompt__example span')?.textContent?.length ?? 0) > 12)
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-home-typewriter.png'), fullPage: true })
  if ((await page.getByTestId('starter').count()) < 3) throw new Error('The home page lost its one-click starters.')
  await page.getByTestId('company-brief').click()
  await page.locator('.bo-prompt__example.hidden').waitFor({ state: 'attached' })
  await page.getByTestId('company-brief').fill('We run a marketing agency for technology companies.')
  await page.getByTestId('start-building').click()
  await page.waitForURL('**/build/*')
  await page.getByTestId('build-stages').waitFor()
  await page.getByText('How do clients normally engage the agency: one-off projects, monthly retainers, or a mix?', { exact: true }).waitFor()
  // BO's working is collapsed, the way a chat shows reasoning. It opens in one click and it is real.
  await page.getByRole('button', { name: /Thinking|Thought this through|Understanding|Designing|Researching/ }).first().click()
  const thinkingEntries = await page.locator('[data-testid="agent-thinking"] article').count()
  if (thinkingEntries < 2) throw new Error('BO did not retain a growing build narrative.')
  await page.getByText('Updating the operating model', { exact: true }).waitFor()
  // Answers are typed, not picked. BO used to offer two to four buttons under each question, which
  // quietly taught people it wanted a choice rather than a sentence — and a sentence in the
  // operator's own words is what the architecture is actually built from.
  if (await page.locator('.bo-quick-answers').count()) throw new Error('The interview is offering clickable answers again.')
  await page.getByTestId('discovery-answer').fill('Monthly retainers')
  await page.getByTestId('answer-question').click()
  await page.getByText('Who handles the work day to day?', { exact: true }).waitFor()
  await page.getByTestId('discovery-answer').fill('A small internal team')
  await page.getByTestId('answer-question').click()
  await page.getByTestId('architecture-proposal').waitFor()
  await page.getByTestId('architecture-proposal').getByText('Campaigns', { exact: true }).waitFor()
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-build-review.png'), fullPage: true })
  if ((await page.evaluate(() => window.__BO_DISCOVERY_CALLS__)) < 4) throw new Error('The discovery, architecture, and critic model stages did not run.')

  await page.getByTestId('open-dashboard').click()
  await page.waitForURL('**/home')

  await openSection(page, 'sales')
  await page.waitForURL('**/sales')
  await page.getByRole('heading', { name: 'Leads' }).waitFor()
  await page.getByTestId('schema-add-record').click()
  await page.getByTestId('field-name').fill('Acme campaign')
  await page.getByTestId('schema-create-record').click()
  await page.getByText('Acme campaign', { exact: true }).waitFor()
  // The assistant is reachable from wherever the operator is standing, not a place they navigate to.
  await page.getByTestId('assistant-launcher').click()
  await page.getByTestId('assistant-panel').waitFor()
  await page.getByTestId('assistant-command').fill('Create a new client called ACME')
  await page.getByTestId('assistant-command').press('Enter')
  // Scoped to the panel: the strip may still carry the same sentence from an earlier form action.
  await page.getByTestId('assistant-panel').getByText('Record created.', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-assistant.png') })
  await page.getByLabel('Close assistant').click()
  await openSection(page, 'customers')
  await page.waitForURL('**/customers')
  await page.getByText('ACME', { exact: true }).waitFor()

  await page.getByTestId('schema-nav-home').click()
  await page.waitForURL('**/home')
  await page.getByTestId('app-grid').waitFor()
  // Setup guidance is a banner across the top of every page now, not a card on Home.
  await page.getByTestId('setup-banner').waitFor()
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-command-center.png'), fullPage: true })

  // Every section owns an indexed URL: reachable directly, survives reload, and back/forward works.
  const workspaceId = await page.evaluate(() => localStorage.getItem('bo-active-workspace-id'))
  if (!workspaceId) throw new Error('The workspace did not record an active id for indexed routing.')
  await page.goto('http://127.0.0.1:4174/customers', { waitUntil: 'networkidle' })
  await page.getByText('ACME', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('ACME', { exact: true }).waitFor()
  await page.goBack()
  await page.waitForURL('**/home')
  await page.getByTestId('app-grid').waitFor()
  await page.goForward()
  await page.waitForURL('**/customers')
  await page.getByText('ACME', { exact: true }).waitFor()
  // Workspace-scoped and legacy dashboard links must still resolve to the indexed route.
  await page.goto(`http://127.0.0.1:4174/workspace/${workspaceId}/sales`, { waitUntil: 'networkidle' })
  await page.waitForURL('**/sales')
  await page.getByRole('heading', { name: 'Leads' }).waitFor()
  await page.goto('http://127.0.0.1:4174/dashboard/today', { waitUntil: 'networkidle' })
  await page.waitForURL('**/today')
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor()
  // An unknown path must fall back to the prompt home rather than rendering an empty workspace.
  await page.goto('http://127.0.0.1:4174/not-a-real-section', { waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor()
  await page.goto('http://127.0.0.1:4174/home', { waitUntil: 'networkidle' })
  await page.getByTestId('app-grid').waitFor()

  await page.getByTestId('schema-nav-links').click()
  await page.waitForURL('**/links')
  await page.getByRole('heading', { name: 'Links', exact: true }).waitFor()
  // Connected apps sit above the automation canvas, and must say what they do and do not do.
  await page.getByTestId('connected-apps').waitFor()
  const stripeRow = page.getByTestId('connected-app-stripe')
  await stripeRow.getByText('Stripe', { exact: true }).waitFor()
  await stripeRow.getByTestId('stripe-key').waitFor()
  const stripeCopy = await stripeRow.innerText()
  if (!/never changes anything in Stripe/i.test(stripeCopy)) throw new Error(`The connector did not state that it is read-only: ${stripeCopy}`)
  await page.getByTestId('connector-name').fill('Make test')
  await page.getByTestId('connector-url').fill('https://hook.eu2.make.com/bo-smoke-test')
  await page.getByRole('button', { name: 'Save connection', exact: true }).click()
  await page.getByText(/Connector saved/).waitFor()
  await page.getByTestId('link-trigger-source-leads').dragTo(page.getByTestId('links-canvas'), { targetPosition: { x: 260, y: 230 } })
  const triggerAfterFirstDrag = await page.getByTestId('link-trigger-node').innerText()
  if (!triggerAfterFirstDrag.includes('Lead')) throw new Error(`Lead drag created the wrong trigger node: ${triggerAfterFirstDrag}`)
  await page.getByTestId('link-action-source').dragTo(page.getByTestId('links-canvas'), { targetPosition: { x: 670, y: 230 } })
  await page.getByTestId('link-trigger-node').waitFor()
  if (!(await page.getByTestId('link-action-node').isVisible())) await page.getByTestId('link-action-source').click()
  await page.getByTestId('link-action-node').waitFor()
  const triggerAfterAction = await page.getByTestId('link-trigger-node').innerText()
  if (!triggerAfterAction.includes('Lead')) throw new Error(`Action placement replaced the lead trigger: ${triggerAfterAction}`)
  await page.getByTestId('link-name').fill('Send new leads to Make')
  await page.getByRole('button', { name: 'Save Link', exact: true }).click()
  await page.getByText(/Link saved in paused mode/).waitFor()
  const savedTrigger = await page.getByTestId('saved-link').getAttribute('data-trigger')
  if (savedTrigger !== 'leads') throw new Error(`The graphical Link did not preserve the dragged lead trigger (saved ${savedTrigger}).`)
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await page.getByText(/Simulation passed/).waitFor()
  await page.getByText('Simulated', { exact: true }).waitFor()
  if (captureScreenshots) {
    await page.locator('.bo-dashboard__main').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: join(screenshotDirectory, 'bo-links.png'), fullPage: true })
  }

  await page.getByTestId('schema-nav-settings').click()
  await page.getByTestId('schema-role').selectOption('accountant')
  await page.getByTestId('schema-nav-today').click()
  await page.waitForURL('**/today')
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor()
  await page.getByTestId('schema-nav-settings').click()
  await page.getByTestId('schema-role').selectOption('owner')
  await page.getByTestId('assistant-launcher').click()
  await page.getByTestId('assistant-panel').waitFor()
  await page.getByTestId('assistant-command').fill('Track account tier for clients')
  await page.getByTestId('assistant-command').press('Enter')
  // A structural request opens the change preview over everything, the panel included.
  await page.getByText('TESTED WORKSPACE PREVIEW', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Apply changes' }).click()
  await page.getByText('account tier added.', { exact: true }).waitFor()
  await page.getByLabel('Close assistant').click()
  await page.getByTestId('schema-nav-settings').click()
  try { await page.getByText('Version 2 · Healthy', { exact: true }).waitFor() }
  catch (error) { throw new Error(`Workspace version did not promote. Visible settings: ${await page.locator('.bo-profile-grid').innerText()}\n${error.message}`) }
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-settings.png'), fullPage: true })
  await page.getByTestId('schema-nav-home').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('What needs attention', { exact: true }).waitFor()
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (mobileOverflow > 1) throw new Error(`Mobile workspace overflows horizontally by ${mobileOverflow}px.`)
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-command-center-mobile.png'), fullPage: true })

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Smoke test passed: sequential AI onboarding, navbar-free Command Center, indexed Links route, graphical drag-and-drop automation canvas, Make connection, simulation, generated forms, role settings, and change preview.')
} finally {
  await browser.close()
  server.kill()
  apiServer.kill()
}
