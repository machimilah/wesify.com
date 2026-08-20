import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

/**
 * Exercises the frontier researcher against a mock Anthropic API.
 *
 * There is no API key in CI, and the paths that matter most are the awkward ones: a paused server-tool
 * loop, a safety refusal, a rejected beta, and malformed output. A scripted wire-level mock reaches
 * all of them deterministically, which a live key would not.
 */

const port = 8912
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
process.env.ANTHROPIC_API_KEY = 'sk-ant-mock'

const calls = []
// The scenario marker only reaches pass one, since pass two is prompted with the brief. A latch lets
// a scenario apply to both passes of one research run.
const state = { scenario: 'HAPPY' }
const reset = () => { calls.length = 0; state.scenario = 'HAPPY' }

const messageStart = (model = 'claude-opus-5') => ({ type: 'message_start', message: { id: `msg_${calls.length}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
const textBlock = (text, index = 0) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index },
]
const searchBlock = (results, index = 0) => [
  { type: 'content_block_start', index, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: results.map(item => ({ type: 'web_search_result', title: item.title, url: item.url, encrypted_content: '', page_age: null })) } },
  { type: 'content_block_stop', index },
]
const messageDelta = (stop_reason, delta = {}) => ({ type: 'message_delta', delta: { stop_reason, stop_sequence: null, ...delta }, usage: { output_tokens: 20 } })
const messageStop = () => ({ type: 'message_stop' })

function sse(response, events) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  response.end()
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

const compiled = {
  archetype: { id: 'field-service', label: 'Field service', confidence: 0.88 },
  summary: 'Dispatch-led plumbing operation that invoices on completion.',
  findings: [
    { conclusion: 'Technicians are dispatched to customer sites', because: 'Trade guidance on dispatch operations', implication: 'BO is connecting work orders, technicians, and assets.', basis: 'researched', confidence: 0.85, sourceUrl: 'https://example.org/dispatch', capabilityIds: ['service.field-work', 'work.scheduling'] },
    { conclusion: 'Parts are bought per job', because: 'You said parts are ordered when a job is booked', implication: 'BO is connecting suppliers and purchase orders to the work.', basis: 'stated', confidence: 0.95, sourceUrl: '', capabilityIds: ['procurement.purchasing', 'not.a.real.capability'] },
  ],
  capabilityIds: ['service.field-work', 'work.scheduling', 'procurement.purchasing', 'bogus.capability'],
  excludedCapabilityIds: ['manufacturing.production'],
  openQuestion: { text: 'Do technicians carry stock in their vans?', reason: 'Decides van inventory.', suggestedAnswers: ['Yes', 'No', 'Some do'] },
  sources: [{ title: 'Dispatch operations', url: 'https://example.org/dispatch' }, { title: 'Not a url', url: 'ftp://example.org/bad' }],
}

const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  const isCompile = Boolean(body.output_config?.format)
  const marker = /SCENARIO:([A-Z_]+)/.exec(JSON.stringify(body.messages))?.[1]
  // Pass two is prompted with the brief, so the marker never reaches it — latch it from pass one.
  if (!isCompile && marker) state.scenario = marker
  const scenario = isCompile ? state.scenario : (marker ?? 'HAPPY')
  const betas = String(request.headers['anthropic-beta'] ?? '')
  calls.push({ scenario, isCompile, betas, model: body.model, hasTools: Array.isArray(body.tools) && body.tools.length > 0, messages: body.messages.length, body })

  if (scenario === 'BETA_REJECTED' && betas.includes('server-side-fallback')) {
    return json(response, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'Unsupported beta: server-side-fallback-2026-07-01' } })
  }
  if (scenario === 'REFUSAL' && !isCompile) {
    return sse(response, [messageStart(), messageDelta('refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' } }), messageStop()])
  }
  if (scenario === 'REFUSAL_ON_COMPILE' && isCompile) {
    return sse(response, [messageStart(), messageDelta('refusal', { stop_details: { type: 'refusal', category: 'bio', explanation: 'declined' } }), messageStop()])
  }
  if (scenario === 'BAD_JSON' && isCompile) {
    return sse(response, [messageStart(), ...textBlock('this is not json at all'), messageDelta('end_turn'), messageStop()])
  }
  if (scenario === 'EMPTY_BRIEF' && !isCompile) {
    return sse(response, [messageStart(), messageDelta('end_turn'), messageStop()])
  }
  // A paused server-tool loop: the first research call stops early and must be resumed.
  if (scenario === 'PAUSE' && !isCompile && body.messages.length === 1) {
    return sse(response, [messageStart(), ...searchBlock([{ title: 'Partial', url: 'https://example.org/partial' }]), messageDelta('pause_turn'), messageStop()])
  }

  if (isCompile) return sse(response, [messageStart(), ...textBlock(JSON.stringify(compiled)), messageDelta('end_turn'), messageStop()])
  return sse(response, [
    messageStart(),
    ...searchBlock([{ title: 'Dispatch operations', url: 'https://example.org/dispatch' }, { title: 'Duplicate', url: 'https://example.org/dispatch' }], 0),
    ...textBlock('Research brief: this is a dispatch-led plumbing operation.', 1),
    messageDelta('end_turn'),
    messageStop(),
  ])
})

await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const { researchCompany, reasoningAvailable } = await import('../server/reasoning.mjs')
const capabilityIds = ['service.field-work', 'work.scheduling', 'procurement.purchasing', 'manufacturing.production', 'crm.contacts']
const run = (description, extra = {}) => researchCompany({ description, catalog: 'crm.contacts=Contacts', capabilityIds, ...extra })

try {
  assert.equal(reasoningAvailable(), true, 'a configured key must report as available')

  // 1. Happy path — two passes, sanitized output, deduplicated sources.
  reset()
  const happy = await run('We are a plumbing company.')
  assert.equal(calls.length, 2, 'research must run exactly two passes')
  assert.equal(calls[0].hasTools, true, 'pass one must carry the research tools')
  assert.equal(calls[0].body.tools.map(tool => tool.type).join(','), 'web_search_20260209,web_fetch_20260209')
  assert.equal(calls[1].hasTools, false, 'pass two must compile without tools')
  assert.ok(calls[1].body.output_config.format.schema, 'pass two must constrain output with a schema')
  assert.ok(calls[0].betas.includes('server-side-fallback-2026-07-01'), 'refusal fallbacks must be requested')
  assert.equal(happy.archetype.label, 'Field service')
  assert.equal(happy.findings.length, 2)
  assert.deepEqual(happy.findings[1].capabilityIds, ['procurement.purchasing'], 'unknown capability ids must be dropped from findings')
  assert.ok(!happy.capabilityIds.includes('bogus.capability'), 'unknown capability ids must be dropped from the plan')
  assert.deepEqual(happy.excludedCapabilityIds, ['manufacturing.production'])
  assert.equal(happy.openQuestion.text, 'Do technicians carry stock in their vans?')
  assert.deepEqual(happy.sources.map(source => source.url), ['https://example.org/dispatch'], 'sources must be https-only and deduplicated')
  assert.ok(happy.brief.includes('dispatch-led'), 'the brief must be returned for the journal')

  // 2. A paused server-tool loop resumes instead of returning a truncated brief.
  reset()
  const paused = await run('SCENARIO:PAUSE plumbing company')
  assert.equal(calls.length, 3, 'a paused research pass must resume before compiling')
  assert.equal(calls[1].messages, 2, 'the resume must replay the assistant turn without inventing a user message')
  assert.equal(calls[1].body.messages[1].role, 'assistant')
  assert.ok(paused.brief.includes('dispatch-led'), 'the resumed brief must be the one that is compiled')

  // 3. A rejected beta falls back to the same request without it.
  reset()
  const rejected = await run('SCENARIO:BETA_REJECTED plumbing company')
  assert.equal(calls.filter(call => call.betas.includes('server-side-fallback')).length, 2, 'both passes must attempt the fallback beta')
  assert.equal(calls.filter(call => !call.betas.includes('server-side-fallback')).length, 2, 'both passes must retry without it')
  assert.equal(rejected.findings.length, 2, 'a rejected beta must not lose the research')
  const retried = calls.find(call => !call.betas.includes('server-side-fallback'))
  assert.equal(retried.body.fallbacks, undefined, 'the retry must drop the fallbacks parameter with the beta')

  // 4. A safety refusal on either pass surfaces as a clear, non-fatal error.
  reset()
  await assert.rejects(() => run('SCENARIO:REFUSAL plumbing company'), error => {
    assert.equal(error.status, 422)
    assert.match(error.message, /declined by safety review \(cyber\)/)
    assert.match(error.message, /built-in researcher/)
    return true
  })

  reset()
  await assert.rejects(() => run('SCENARIO:REFUSAL_ON_COMPILE plumbing company'), error => {
    assert.equal(error.status, 422)
    assert.match(error.message, /declined by safety review \(bio\)/)
    return true
  })

  // 5. Malformed and empty model output fail loudly rather than producing a hollow workspace.
  reset()
  await assert.rejects(() => run('SCENARIO:BAD_JSON plumbing company'), error => {
    assert.equal(error.status, 502)
    assert.match(error.message, /could not read/)
    return true
  })
  reset()
  await assert.rejects(() => run('SCENARIO:EMPTY_BRIEF plumbing company'), error => {
    assert.equal(error.status, 502)
    assert.match(error.message, /empty brief/)
    return true
  })

  // 6. The catalog is required — a workspace must never be planned against an empty capability set.
  reset()
  await assert.rejects(() => researchCompany({ description: 'x', capabilityIds: [] }), error => {
    assert.equal(error.status, 400)
    return true
  })

  // 7. Conversation history is passed through and bounded.
  reset()
  await run('We are a plumbing company.', { conversation: Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `turn ${index}` })) })
  const prompt = calls[0].body.messages[0].content
  assert.ok(prompt.includes('turn 39'), 'the most recent turns must reach the researcher')
  assert.ok(!prompt.includes('turn 5'), 'older turns must be trimmed')

  // 8. The HTTP layer: auth, validation, and a real request through the running project service.
  const apiPort = 8914
  const api = spawn(process.execPath, ['server/index.mjs', '--port', String(apiPort)], {
    cwd: process.cwd(),
    env: { ...process.env, ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY: 'sk-ant-mock' },
    stdio: 'pipe',
  })
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100))
      if (attempt === 59) throw new Error('The project service did not start.')
    }
    const workspaceId = `research-http-${Date.now()}`
    const token = 'a'.repeat(40)
    const post = (payload, headers = {}) => fetch(`http://127.0.0.1:${apiPort}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': token, ...headers },
      body: JSON.stringify(payload),
    })

    const status = await (await fetch(`http://127.0.0.1:${apiPort}/api/research/status`)).json()
    assert.equal(status.available, true, 'a configured service must report the frontier tier as available')

    const missingDescription = await post({ workspaceId, capabilityIds })
    assert.equal(missingDescription.status, 400, 'a request without a description must be rejected')

    const wrongWorkspace = await post({ workspaceId: 'someone-elses-workspace', capabilityIds, description: 'x' })
    assert.equal(wrongWorkspace.status, 403, 'a workspace id that does not match the header must be denied')

    const wrongToken = await post({ workspaceId, capabilityIds, description: 'x' }, { 'x-bo-access-token': 'b'.repeat(40) })
    assert.equal(wrongToken.status, 403, 'a second token for the same workspace must be denied')

    reset()
    const ok = await post({ workspaceId, description: 'We are a plumbing company.', capabilityIds: [...capabilityIds, 'DROP TABLE', '../etc'], catalog: 'crm.contacts=Contacts' })
    assert.equal(ok.status, 200)
    const research = await ok.json()
    assert.equal(research.findings.length, 2, 'the endpoint must return compiled findings')
    assert.ok(!research.capabilityIds.includes('bogus.capability'))
    assert.equal(calls[0].body.messages[0].content.includes('DROP TABLE'), false, 'malformed capability ids must never reach the model prompt')

    reset()
    const refused = await post({ workspaceId, description: 'SCENARIO:REFUSAL plumbing', capabilityIds, catalog: 'x=y' })
    assert.equal(refused.status, 422, 'a refusal must reach the client as a non-fatal status')
    assert.match((await refused.json()).error, /built-in researcher/)
  } finally {
    api.kill()
  }

  console.log('Reasoning test passed: two-pass research, paused-loop resume, beta rejection retry, refusal handling on both passes, malformed output, catalog validation, conversation trimming, and HTTP auth/validation.')
} finally {
  server.close()
}
