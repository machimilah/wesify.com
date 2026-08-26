import { launchBrowser } from './browser.mjs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import './noSpend.mjs'

const captureScreenshots = process.env.BO_SMOKE_SCREENSHOTS === '1'
const screenshotDirectory = process.env.TEMP || process.cwd()

const apiPort = 8798
const apiServer = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], {
  cwd: process.cwd(), stdio: 'pipe',
  env: { ...process.env, BO_CONNECTION_SECRET: 'smoke-test-connection-secret-32-bytes', BO_AUTOMATION_SCHEDULER: 'off' },
})
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
    if (request.mode === 'REVIEW_ARCHITECTURE' || userTurns > 2) {
      stream?.onText?.('Run sales, campaigns and billing together.')
      return { businessState, decision: 'READY_TO_ARCHITECT', acknowledgment: 'I have a good picture of how the agency works.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext }
    }
    /**
     * The second question is the model's, because there is no other kind any more.
     *
     * This mock used to answer the first reply with READY, and a real second question appeared on
     * screen regardless — Wesify overrode the decision with the next entry from a written list. That list
     * is gone, so a mock that wants a two-question interview has to ask the second question itself.
     */
    if (userTurns > 1) {
      const followUp = 'Who handles the work day to day?'
      stream?.onText?.(followUp)
      return {
        businessState, decision: 'ASK_QUESTION', acknowledgment: 'Monthly retainers, understood.',
        nextQuestion: { text: followUp, reason: 'Who does the work decides workload and team pages.', suggestedAnswers: [] },
        architectureContext: { title: '', summary: '', explanation: '', modules: [], startView: 'overview', capabilities: [], capabilityIds: [], excludedCapabilityIds: [], pages: [], entities: [], workflows: [], metrics: [], processStages: [], pipelineStages: [], billingCadence: '' },
      }
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
    return { decision: 'CLARIFY', message: 'What should Wesify change?', action: emptyAgentAction }
  }
})

/** Opens a section whether the sidebar shows it directly or behind a module group. */
async function openSection(page, id) {
  await page.locator('[data-testid^="schema-nav-"], [data-testid^="schema-group-"]').first().waitFor({ timeout: 20_000 })
  const direct = page.getByTestId(`schema-nav-${id}`)
  if (await direct.count()) { await direct.click(); return }
  for (const groupId of await page.locator('[data-testid^="schema-group-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')))) {
    await page.locator(`[data-testid="${groupId}"]`).click()
    await page.getByTestId('sub-sidebar').waitFor()
    if (await direct.count()) { await direct.click(); return }
  }
  const available = await page.locator('[data-testid^="schema-nav-"], [data-testid^="schema-group-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')).filter(Boolean))
  throw new Error(`No way to reach section "${id}" from the sidebar. Available controls: ${available.join(', ') || 'none'}.`)
}

try {
  // A person meets the home page first, and it is the prompt, so the journey starts by typing.
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  await page.getByTestId('public-home').waitFor({ timeout: 20_000 })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  // Connecting tools is reached from inside the box and nowhere else. The second button under the
  // prompt, and the row naming CRM, ERP, Automations and KPIs beneath that, are gone: there is one
  // thing to do on this page, and everything competing with it was removed.
  await page.getByTestId('prompt-connect-tools').click()
  await page.getByTestId('tool-connections-dialog').waitFor()
  await page.getByLabel('Close tool connections').click()
  if (await page.getByTestId('open-tool-connections').count()) throw new Error('The second connect-tools button under the home prompt is back.')
  if (await page.locator('.bo-prompt__guidance').count()) throw new Error('The CRM/ERP/Automations/KPIs row under the home prompt is back.')
  if (await page.getByTestId('get-started').count()) throw new Error('The removed home-page interstitial returned.')
  if (await page.getByText('Build the operating system for your business.', { exact: true }).count() !== 1) throw new Error('The home-page title is missing.')
  if (await page.getByText('Describe how your company works. Wesify turns it into connected CRM, ERP, workflows, finance, people, permissions, and reporting.', { exact: true }).count() !== 1) throw new Error('The home-page explanation is missing.')
  await page.getByTestId('trusted-section').waitFor()
  await page.getByTestId('how-it-works').waitFor()
  await page.getByRole('heading', { name: 'One connected business suite' }).waitFor()
  await page.waitForFunction(() => (document.querySelector('.bo-prompt__example span')?.textContent?.length ?? 0) > 12)
  const publicPrompt = page.getByTestId('company-brief')
  const compactPromptBounds = await publicPrompt.boundingBox()
  if (!compactPromptBounds) throw new Error('The home prompt has no measurable bounds.')
  await publicPrompt.fill(Array.from({ length: 8 }, (_, index) => `Business detail ${index + 1}`).join('\n'))
  await page.waitForFunction(initialHeight => {
    const textarea = document.querySelector('[data-testid="company-brief"]')
    return textarea instanceof HTMLTextAreaElement && textarea.getBoundingClientRect().height > Number(initialHeight) + 30
  }, compactPromptBounds.height)
  const expandedPromptBounds = await publicPrompt.boundingBox()
  if (!expandedPromptBounds || Math.abs(expandedPromptBounds.width - compactPromptBounds.width) > 1) throw new Error('The home prompt changed width while expanding.')
  await publicPrompt.fill('')
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-home-typewriter.png'), fullPage: true })

  // In local mode `/dashboard` is directly inspectable; account-enabled servers gate this same route.
  await page.goto('http://127.0.0.1:4174/dashboard', { waitUntil: 'networkidle' })
  await page.getByTestId('project-dashboard').waitFor({ timeout: 20_000 })
  await page.getByTestId('dashboard-brief').waitFor()
  await page.getByTestId('prompt-connect-tools').click()
  await page.getByTestId('tool-connections-dialog').waitFor()
  await page.getByLabel('Close tool connections').click()

  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor({ timeout: 20_000 })
  if (await page.getByTestId('starter').count()) throw new Error('The removed homepage starter choices returned.')
  await page.getByTestId('company-brief').click()
  await page.locator('.bo-prompt__example.hidden').waitFor({ state: 'attached' })
  await page.getByTestId('company-brief').fill('We run a marketing agency for technology companies.')
  await page.getByTestId('start-building').click()

  /**
   * The three things Wesify has to be told, asked inside the build.
   *
   * They were a dialog in front of the build until they were questions inside it: a name Wesify cannot
   * infer, a logo it cannot draw, colleagues it cannot guess. Checked here rather than skipped past,
   * because they are the only thing anybody is asked to type about themselves rather than about
   * their business — and because not one of the three is required.
   */
  await page.waitForURL('**/build/*')
  await page.getByTestId('build-thread').waitFor({ timeout: 20_000 })
  await page.getByText('How should we name this workspace?', { exact: true }).waitFor()
  await page.getByTestId('discovery-answer').fill('Northwind Studio')
  await page.getByTestId('answer-question').click()

  // A logo cannot be typed, so the picker travels with the question — and beside it, the way past.
  await page.getByText('Should we add a logo now, or skip this step?', { exact: true }).waitFor()
  await page.getByTestId('intake-logo-pick').waitFor()
  await page.getByTestId('intake-skip').click()

  // A reply that is not an address is said to be one rather than quietly dropped: a colleague
  // silently not invited is worse than a question asked twice.
  await page.getByText('Should we add any team members?', { exact: true }).waitFor()
  await page.getByTestId('intake-skip').waitFor()
  await page.getByTestId('discovery-answer').fill('not-an-address')
  await page.getByTestId('answer-question').click()
  await page.getByTestId('intake-problem').waitFor()
  await page.getByTestId('discovery-answer').fill('colleague@northwind.example')
  await page.getByTestId('answer-question').click()

  // What Wesify was told is kept with the workspace it was told about, and the interview reads it back.
  const onboarded = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(candidate => candidate.startsWith('bo-workspace-setup:'))
    return key ? JSON.parse(localStorage.getItem(key) ?? '{}') : null
  })
  if (onboarded?.name !== 'Northwind Studio') throw new Error(`The intake did not keep the name it was given: ${JSON.stringify(onboarded)}`)
  if (onboarded?.invites?.[0]?.email !== 'colleague@northwind.example') throw new Error('The intake did not keep the colleague it was given.')
  await page.getByTestId('build-stages').waitFor()
  await page.getByText('How do clients normally engage the agency: one-off projects, monthly retainers, or a mix?', { exact: true }).waitFor()
  // Wesify asks and waits. Its reasoning is not printed into the thread for the operator to read past.
  if (await page.locator('[data-testid="agent-thinking"]').count()) throw new Error('The reasoning journal is back on the build screen.')
  // Answers are typed, not picked. Wesify used to offer two to four buttons under each question, which
  // quietly taught people it wanted a choice rather than a sentence — and a sentence in the
  // operator's own words is what the architecture is actually built from.
  if (await page.locator('.bo-quick-answers').count()) throw new Error('The interview is offering clickable answers again.')
  await page.getByTestId('discovery-answer').fill('Monthly retainers')
  await page.getByTestId('answer-question').click()
  await page.getByText('Who handles the work day to day?', { exact: true }).waitFor()
  await page.getByTestId('discovery-answer').fill('A small internal team')
  await page.getByTestId('answer-question').click()

  /**
   * The thread is in the order it was said in.
   *
   * The three opening questions used to be drawn after the whole message list rather than after the
   * sentence that started the build, so they slid down the thread with every answer given since —
   * "How should we name this workspace?" printed underneath the third question of an interview it
   * had already finished. Read as positions rather than presence, because both versions contained
   * all of these lines; only one of them had them in the right places.
   */
  const threadOrder = await page.locator('.bo-turn').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() ?? ''))
  const at = text => threadOrder.findIndex(line => line.includes(text))
  const brief = at('We run a marketing agency')
  const naming = at('How should we name this workspace?')
  const team = at('Should we add any team members?')
  const firstInterview = at('How do clients normally engage the agency')
  if (brief !== 0) throw new Error(`The sentence that started the build is not the first thing in the thread (position ${brief}).`)
  if (!(brief < naming && naming < team && team < firstInterview)) {
    throw new Error(`The build thread is out of order: brief ${brief}, naming ${naming}, team ${team}, first interview question ${firstInterview}.`)
  }

  await page.getByTestId('open-dashboard').waitFor()
  await page.getByTestId('check-proposal').click()
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
  await page.getByTestId('operating-map').waitFor()
  if (captureScreenshots) {
    await page.getByTestId('operating-map').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshotDirectory, 'bo-operating-map.png') })
  }
  await page.getByTestId('schema-nav-control').click()
  await page.waitForURL('**/control')
  await page.getByTestId('permission-matrix').waitFor()
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-access-control.png'), fullPage: true })
  await page.getByTestId('schema-nav-home').click()
  await page.waitForURL('**/home')

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
  // Bare `/dashboard` now owns project selection rather than aliasing a workspace home page.
  await page.goto('http://127.0.0.1:4174/dashboard', { waitUntil: 'networkidle' })
  await page.getByTestId('project-dashboard').waitFor()
  await page.getByTestId('open-workspace').first().waitFor()
  // An unknown path must fall back to the prompt home rather than rendering an empty workspace.
  await page.goto('http://127.0.0.1:4174/not-a-real-section', { waitUntil: 'networkidle' })
  await page.getByTestId('company-brief').waitFor()
  await page.goto('http://127.0.0.1:4174/home', { waitUntil: 'networkidle' })
  await page.getByTestId('app-grid').waitFor()

  await page.getByTestId('schema-nav-links').click()
  await page.waitForURL('**/links')
  await page.getByTestId('workflow-studio').waitFor()
  const automationMainBounds = await page.locator('.bo-dashboard__main').boundingBox()
  const automationStudioBounds = await page.getByTestId('workflow-studio').boundingBox()
  const automationViewport = page.viewportSize()
  if (!automationMainBounds || !automationStudioBounds || !automationViewport) throw new Error('The automation workspace has no measurable bounds.')
  if (automationStudioBounds.width < automationMainBounds.width * .9) throw new Error(`The automation workspace uses only ${Math.round(automationStudioBounds.width / automationMainBounds.width * 100)}% of the available dashboard width.`)
  if (automationStudioBounds.height < automationViewport.height * .72) throw new Error(`The automation workspace uses only ${Math.round(automationStudioBounds.height / automationViewport.height * 100)}% of the viewport height.`)
  // Connected apps remain available beside the workflow runtime, and must say what they do and do not do.
  await page.getByTestId('connected-apps').waitFor()
  const stripeRow = page.getByTestId('connected-app-stripe')
  await stripeRow.getByText('Stripe', { exact: true }).waitFor()
  await stripeRow.getByTestId('stripe-key').waitFor()
  const stripeCopy = await stripeRow.innerText()
  if (!/never changes anything in Stripe/i.test(stripeCopy)) throw new Error(`The connector did not state that it is read-only: ${stripeCopy}`)
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  const connectionsDialog = page.getByRole('dialog', { name: 'Workflow connections' })
  await connectionsDialog.getByTestId('connector-name').fill('Make test')
  await connectionsDialog.getByTestId('connector-url').fill('https://hook.eu2.make.com/bo-smoke-test')
  await connectionsDialog.getByRole('button', { name: 'Save connection', exact: true }).click()
  await page.getByText(/Connection saved/).waitFor()
  await connectionsDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  // The agency calls these Leads and that is what the page says; the record itself is the catalog's
  // pipeline entity, renamed rather than built a second time alongside it.
  await page.getByTestId('link-trigger-source-opportunities').dragTo(page.getByTestId('links-canvas'), { targetPosition: { x: 520, y: 230 } })
  const triggerAfterFirstDrag = await page.getByTestId('link-trigger-node').innerText()
  if (!triggerAfterFirstDrag.includes('Lead')) throw new Error(`Lead drag created the wrong trigger node: ${triggerAfterFirstDrag}`)
  await page.getByTestId('link-trigger-node').getByRole('button', { name: 'Add next step' }).click()
  await page.getByRole('button', { name: /If condition/ }).click()
  await page.getByTestId('link-condition-node').getByRole('button', { name: 'Add step to yes branch' }).click()
  await page.getByTestId('link-action-source').click()
  await page.getByTestId('link-trigger-node').waitFor()
  await page.getByTestId('link-action-node').waitFor()
  await page.getByTestId('link-condition-node').waitFor()
  const triggerAfterAction = await page.getByTestId('link-trigger-node').innerText()
  if (!triggerAfterAction.includes('Lead')) throw new Error(`Action placement replaced the lead trigger: ${triggerAfterAction}`)
  await page.getByTestId('link-name').fill('Send new leads to Make')
  await page.getByRole('button', { name: 'Save automation', exact: true }).click()
  await page.getByText(/Automation saved in paused mode/).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="workflow-studio"]')?.getAttribute('data-frame-ready') === 'true')
  const savedLink = page.getByTestId('saved-link').filter({ hasText: 'Send new leads to Make' })
  const savedTrigger = await savedLink.getAttribute('data-trigger')
  if (savedTrigger !== 'opportunities') throw new Error(`The graphical automation did not preserve the dragged lead trigger (saved ${savedTrigger}).`)
  if (captureScreenshots) {
    await page.locator('.bo-dashboard__main').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: join(screenshotDirectory, 'bo-links-editor.png'), fullPage: true })
  }
  await page.getByRole('button', { name: 'Test workflow', exact: true }).click()
  await page.getByText(/Simulation passed/).waitFor()
  await page.getByText('Simulated', { exact: true }).first().waitFor()
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
  await page.getByTestId('schema-nav-control').click()
  await page.waitForURL('**/control')
  await page.getByTestId('permission-matrix').waitFor()
  const mobileControlOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (mobileControlOverflow > 1) throw new Error(`Mobile access control overflows horizontally by ${mobileControlOverflow}px.`)
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-access-control-mobile.png'), fullPage: true })
  await page.getByTestId('schema-nav-links').click()
  await page.waitForURL('**/links')
  await page.getByRole('tab', { name: /Editor/ }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="workflow-studio"]')?.getAttribute('data-frame-ready') === 'true')
  const mobileWorkflowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (mobileWorkflowOverflow > 1) throw new Error(`Mobile workflow editor overflows horizontally by ${mobileWorkflowOverflow}px.`)
  if (captureScreenshots) await page.screenshot({ path: join(screenshotDirectory, 'bo-links-mobile.png'), fullPage: true })

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log('Smoke test passed: sequential AI onboarding, dashboard routing, n8n-style workflow canvas, Make connection, draft simulation, generated forms, role settings, and change preview.')
} finally {
  await browser.close()
  server.kill()
  apiServer.kill()
}
