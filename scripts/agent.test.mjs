import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import './noSpend.mjs'

/**
 * The agent inside a workspace runs on the server now.
 *
 * It used to run on the 0.5B model in the browser — the same model the interview was rescued from
 * years of product-time ago — and everything it could not do was read as Wesify not being able to do
 * it. This covers the replacement: the turn goes to the server, a request to change the workspace is
 * asked of the building prompt rather than the command one, the answer comes back as a plan, and the
 * call is refused outright without a workspace token.
 *
 * Nothing here executes anything. Deciding and changing stay two events, and the second one is the
 * versioned build the workspace already had.
 */

const modelPort = 8971
const port = 8972
process.env.BO_GENERATED_ROOT = await mkdtemp(path.join(tmpdir(), 'bo-agent-'))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${modelPort}`
process.env.ANTHROPIC_API_KEY = 'sk-ant-mock'
process.env.BO_INTERVIEW_PROVIDER = 'anthropic'
process.env.GEMINI_API_KEY = ''
process.env.GOOGLE_API_KEY = ''

const asked = []

const command = {
  decision: 'EXECUTE',
  message: 'Marked the ACME invoice as paid.',
  action: {
    kind: 'update_record', entityId: 'invoices', recordId: 'rec-1', navigationId: '', collectionName: '', capabilityId: '',
    values: [{ field: 'status', value: 'Paid' }],
    field: { id: '', label: '', type: 'text', required: false },
    workflow: { name: '', entityId: '', event: 'created', conditionField: '', conditionEquals: '', message: '' },
  },
}

const plan = {
  decision: 'PLAN',
  message: 'Adds the suppliers you buy from, what you order from them, and a warning when an order is late.',
  question: '',
  plan: {
    label: 'Supplier management', module: 'procurement', capabilityIds: [],
    entities: [{
      name: 'Suppliers', purpose: 'Who the bakery buys flour from',
      fields: [{ label: 'Supplier', type: 'text', required: true }, { label: 'Lead time days', type: 'number' }],
      states: ['Active', 'On hold'],
    }],
    entityUpdates: [], workflows: [], metrics: [],
  },
}

const sse = (response, body) => {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const events = [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(body) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  response.end()
}

const model = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  const system = String(payload.system ?? '')
  const building = system.includes('building inside')
  asked.push({ building, maxTokens: payload.max_tokens, prompt: String(payload.messages?.[0]?.content ?? '') })
  sse(response, building ? plan : command)
})
await new Promise(resolve => model.listen(modelPort, '127.0.0.1', resolve))

const { server } = await import('../server/index.mjs')
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

const base = `http://127.0.0.1:${port}`
const workspaceId = 'ws-agent-test'

const context = {
  company: { name: 'Bakery', industry: 'Bakery', description: 'We bake bread and sell it to cafes.' },
  modules: ['commerce'],
  activeCapabilities: ['commerce.products'],
  entities: [{ id: 'invoices', label: 'Invoice', pluralLabel: 'Invoices', primaryField: 'number', fields: [{ id: 'number', label: 'Invoice number', type: 'text' }, { id: 'status', label: 'Status', type: 'select', options: ['Draft', 'Sent', 'Paid'] }] }],
  navigation: [{ id: 'invoices', label: 'Invoices', kind: 'entity' }],
  records: [{ entityId: 'invoices', id: 'rec-1', label: 'ACME-1', status: 'Sent' }],
}

// Trust on first use, the same way every other workspace endpoint is reached with no database.
const accessToken = 'agent-test-token-agent-test-token-1234'

const turn = async (body, headers = {}) => {
  const response = await fetch(`${base}/api/agent/${workspaceId}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': accessToken, ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json().catch(() => ({})) }
}

const status = await (await fetch(`${base}/api/agent/status`)).json()
assert.equal(status.available, true, 'the agent should report itself available with a key configured')
assert.ok(status.model, 'the status should name the model behind the agent')

const refused = await fetch(`${base}/api/agent/${workspaceId}/turn`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'anything', context }),
})
assert.equal(refused.status, 403, 'a turn for a workspace the caller did not name must be refused')

const unauthenticated = await fetch(`${base}/api/agent/${workspaceId}/turn`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-bo-workspace-id': workspaceId },
  body: JSON.stringify({ command: 'anything', context }),
})
assert.equal(unauthenticated.status, 401, 'a turn without a workspace session must be refused')

const empty = await turn({ command: '   ', context })
assert.equal(empty.status, 400, 'an empty command is a bad request, not a model call')

const commanded = await turn({ command: 'mark the ACME invoice paid', mode: 'command', context })
assert.equal(commanded.status, 200)
assert.equal(commanded.payload.decision, 'EXECUTE')
assert.equal(commanded.payload.action.entityId, 'invoices')
assert.equal(commanded.payload.mode, 'command')
assert.ok(commanded.payload.model, 'the turn should say which model answered')

const built = await turn({ command: 'set up supplier management', mode: 'build', context: { ...context, catalog: 'procurement.suppliers=Suppliers' } })
assert.equal(built.status, 200)
assert.equal(built.payload.decision, 'PLAN')
assert.equal(built.payload.mode, 'build')
assert.equal(built.payload.plan.entities[0].name, 'Suppliers')

const [first, second] = asked
assert.equal(first.building, false, 'a command must reach the command prompt')
assert.equal(second.building, true, 'a change to the workspace must reach the building prompt')
assert.ok(second.maxTokens > first.maxTokens, 'building gets the larger budget; a command does not need it')
assert.ok(second.prompt.includes('set up supplier management'), 'the request reaches the model')
assert.ok(!first.prompt.includes('procurement.suppliers='), 'the catalog is twenty thousand characters and a command has no use for it')

const audit = await readFile(path.join(process.env.BO_GENERATED_ROOT, workspaceId, 'audit.jsonl'), 'utf8')
const events = audit.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(item => item.event === 'agent.turn')
assert.equal(events.length, 2, 'every turn is recorded, whether or not the operator applies it')
assert.equal(events[1].detail.mode, 'build')

server.close()
model.close()
console.log('Agent test passed: the workspace agent runs on the server, a change reaches the building prompt with the larger budget, a command does not carry the catalog, turns are audited, and a call without a workspace token is refused.')
