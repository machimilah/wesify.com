import './noSpend.mjs'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

/**
 * A key that cannot be used is not a reason to stop when another one is configured.
 *
 * This is the failure as it actually reached an operator: two keys set, Anthropic preferred because
 * it is the one the research pass also uses, and the Anthropic account out of credit. The API
 * answers 400 "Your credit balance is too low", Wesify reported that the interview could not continue,
 * and the free Gemini key that would have answered sat unused a line away in the same config.
 *
 * The distinction being tested is the one that makes this safe: an unusable *key* moves to the next
 * provider, while a 400 about the *request* does not — that one fails identically on the second
 * provider, so retrying it only doubles the wait before saying the same thing.
 */

const anthropicPort = 8977
const geminiPort = 8978

const state = { anthropicCalls: 0, geminiCalls: 0, anthropicFailure: 'credit' }

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

const anthropic = createServer(async (request, response) => {
  state.anthropicCalls += 1
  if (state.anthropicFailure === 'credit') {
    return json(response, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } })
  }
  // A 400 about the request itself, which the other provider would reject just as surely.
  return json(response, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'messages.0: all messages must have non-empty content' } })
})
await new Promise(resolve => anthropic.listen(anthropicPort, '127.0.0.1', resolve))

const turn = {
  businessState: {
    companySummary: 'A bakery', industry: 'Bakery', facts: [],
    businessModel: [], productsOrServices: [], customers: [], revenueModel: [], team: [], operations: [],
    resources: [], locations: [], currentTools: [], goals: [], knownEntities: [], knownWorkflows: [],
    softwareImplications: [],
  },
  decision: 'ASK_QUESTION',
  acknowledgment: 'Understood.',
  nextQuestion: { text: 'Do you sell wholesale to cafes, or only from the shop?', reason: 'Decides the sales side.', suggestedAnswers: [] },
}

const gemini = createServer(async (request, response) => {
  state.geminiCalls += 1
  const requested = decodeURIComponent(/models\/([^:]+):/.exec(request.url)?.[1] ?? '')
  json(response, 200, { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(turn) }] }, finishReason: 'STOP' }], modelVersion: requested })
})
await new Promise(resolve => gemini.listen(geminiPort, '127.0.0.1', resolve))

// Both keys configured, Anthropic preferred — exactly the deployment that failed.
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicPort}`
process.env.ANTHROPIC_API_KEY = 'sk-ant-mock'
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${geminiPort}`
process.env.GEMINI_API_KEY = 'gemini-mock-key'
delete process.env.BO_INTERVIEW_PROVIDER

const { runDiscoveryTurn, interviewProviders, unusableKey } = await import('../server/discoveryAgent.mjs')

const ask = () => runDiscoveryTurn({
  mode: 'DISCOVER',
  conversation: [{ role: 'user', content: 'We run a bakery with two shops.' }],
  capabilityIds: ['crm.contacts'],
  modules: ['customers'],
})

try {
  // Anthropic is genuinely the preferred provider here, or the test proves nothing.
  assert.deepEqual(interviewProviders(), ['anthropic', 'gemini'], 'Anthropic must lead, or this is not the failing configuration')

  // 1. The interview continues on the free key rather than stopping.
  const answered = await ask()
  assert.equal(answered.nextQuestion.text, turn.nextQuestion.text, 'the interview did not fall back to the working key')
  assert.ok(state.anthropicCalls > 0, 'Anthropic was never tried, so the preference was not honoured')
  assert.ok(state.geminiCalls > 0, 'Gemini was never reached')

  // 2. The dead key is parked, so the next question does not pay for that discovery again.
  const anthropicCallsSoFar = state.anthropicCalls
  const second = await ask()
  assert.equal(second.nextQuestion.text, turn.nextQuestion.text)
  assert.equal(state.anthropicCalls, anthropicCallsSoFar, 'Wesify asked the exhausted account again instead of remembering')
  assert.deepEqual(interviewProviders(), ['gemini'], 'the parked provider is still being offered')

  // 3. A 400 about the request is not a billing problem and must not be treated as one.
  assert.equal(unusableKey({ status: 400, message: 'messages.0: all messages must have non-empty content' }), false)
  assert.equal(unusableKey({ status: 400, message: 'Your credit balance is too low' }), true)
  assert.equal(unusableKey({ status: 401, message: 'invalid x-api-key' }), true)
  assert.equal(unusableKey({ status: 500, message: 'overloaded' }), false)

  console.log('Provider fallback test passed: an account out of credit hands the interview to the free key, the dead key is parked so the next question does not wait on it again, and a 400 about the request is still an error rather than a reason to switch.')
} finally {
  anthropic.close()
  gemini.close()
}
