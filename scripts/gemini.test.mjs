import './noSpend.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The free interview, against a mock Gemini API.
 *
 * Wesify's intelligent interview used to need a paid Anthropic key, so what most people actually met was
 * the built-in question bank: the same questions in the same order for every company, asked again
 * after they had been answered. Gemini's free tier removes that, and this covers the parts of the
 * swap that can silently break.
 *
 * The schema is the sharpest edge. Gemini rejects the whole request over a keyword it does not
 * support — `additionalProperties` and `maxLength` being two Wesify's schemas carry for Anthropic — and a
 * rejected request means the operator drops to the question bank without anything looking wrong.
 */

const geminiPort = 8951
const apiPort = 8952

const calls = []
const state = { failThinkingOnce: true, busyOnce: false, exhausted: new Set(), retired: new Map() }

const turn = {
  businessState: {
    companySummary: 'A plumbing service business', industry: 'Plumbing',
    facts: [{ topic: 'Delivery', value: 'Technicians visit homes', status: 'explicit', confidence: 0.9 }],
    businessModel: ['Field service'], productsOrServices: ['Callouts'], customers: ['Homeowners'], revenueModel: [], team: [],
    operations: [], resources: [], locations: [], currentTools: [], painPoints: [], goals: [], knownEntities: ['Jobs'],
    knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
  },
  decision: 'ASK_QUESTION',
  acknowledgment: 'Understood.',
  nextQuestion: { text: 'Do your technicians carry stock in their vans?', reason: 'Decides van inventory.', suggestedAnswers: [] },
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

const gemini = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  calls.push({ url: request.url, key: request.headers['x-goog-api-key'], payload })

  /**
   * The models that refuse `thinkingConfig` do not say so.
   *
   * `gemini-3.5-flash-lite` and `gemini-3.6-flash` answer a flat "Request contains an invalid
   * argument.", with no mention of thinking anywhere in it. Wesify used to look for that word, conclude
   * the model was broken, and skip past three perfectly usable ones — so the message here is the
   * unhelpful one on purpose.
   */
  if (state.failThinkingOnce && payload.generationConfig?.thinkingConfig) {
    state.failThinkingOnce = false
    return json(response, 400, { error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } })
  }

  const requested = decodeURIComponent(/models\/([^:]+):/.exec(request.url)?.[1] ?? '')

  // Google retires a model for new keys and names its replacement in the message. Following that is
  // the difference between Wesify healing itself and Wesify waiting for somebody to edit a list.
  if (state.retired.has(requested)) {
    return json(response, 404, { error: { code: 404, message: `This model models/${requested} is no longer available to new users. Please update your code to use models/${state.retired.get(requested)} for the latest features and improvements.`, status: 'NOT_FOUND' } })
  }

  /**
   * The free tier meters per model, so the newest one runs dry first. A daily quota carries no short
   * `retryDelay`, which is how Wesify tells "wait a moment" apart from "not today".
   */
  if (state.exhausted.has(requested)) {
    return json(response, 429, { error: { code: 429, message: 'You exceeded your current quota. * Quota exceeded for metric: generate_requests_per_model_per_day', status: 'RESOURCE_EXHAUSTED' } })
  }

  // The free tier is shared, and "currently experiencing high demand" is an ordinary answer on it.
  if (state.busyOnce) {
    state.busyOnce = false
    return json(response, 503, { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } })
  }

  return json(response, 200, {
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(turn) }] }, finishReason: 'STOP' }],
    modelVersion: requested,
  })
})
await new Promise(resolve => gemini.listen(geminiPort, '127.0.0.1', resolve))

/**
 * Run from a scratch directory, not the project root.
 *
 * `noSpend.mjs` above blanks every real key, and the scratch directory keeps the sessions this test
 * writes out of the developer's own `generated-projects`. Between them, what the server sees is a
 * deployment holding exactly one key: the free one this suite is about.
 */
const workingDirectory = await mkdtemp(path.join(tmpdir(), 'bo-gemini-'))
const env = {
  ...process.env,
  GEMINI_API_KEY: 'gemini-mock-key',
  GEMINI_BASE_URL: `http://127.0.0.1:${geminiPort}`,
  BO_GENERATED_ROOT: path.join(workingDirectory, 'generated-projects'),
}
delete env.BO_INTERVIEW_PROVIDER

const api = spawn(process.execPath, [path.resolve('server/index.mjs'), '--port', String(apiPort)], { cwd: workingDirectory, env, stdio: 'pipe' })
api.stderr.on('data', chunk => process.stderr.write(chunk))
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 100))
  if (attempt === 59) throw new Error('Could not start the project service.')
}

/** Every keyword anywhere in the schema, so an unsupported one cannot hide inside a nested object. */
function keywords(value, found = new Set()) {
  if (Array.isArray(value)) { value.forEach(item => keywords(item, found)); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, item] of Object.entries(value)) { found.add(key); keywords(item, found) }
  return found
}

try {
  // The interview is on, the model named is the one being used, and research is honestly off: only
  // the Anthropic path can run the web-search pass, and claiming otherwise turns into a 503 the
  // operator reads as Wesify being broken.
  const status = await (await fetch(`http://127.0.0.1:${apiPort}/api/research/status`)).json()
  assert.equal(status.available, true, 'The interview should be available on a Gemini key alone.')
  assert.equal(status.model, 'gemini-3.5-flash')
  assert.equal(status.research, false, 'Web-search research is not available without an Anthropic key.')

  const response = await fetch(`http://127.0.0.1:${apiPort}/api/discovery/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'DISCOVER',
      conversation: [
        { role: 'user', content: 'We run a plumbing service business.' },
        { role: 'assistant', content: 'Who does the work?' },
        { role: 'user', content: 'Four technicians in vans.' },
      ],
      businessState: null,
      capabilityIds: ['crm.contacts', 'service.field-work'],
      modules: ['customers', 'field-service'],
      repair: 'You just proposed a repeat.',
    }),
  })
  assert.equal(response.status, 200, 'The interview turn should succeed on the free tier.')
  const body = await response.json()
  assert.equal(body.decision, 'ASK_QUESTION')
  assert.equal(body.nextQuestion.text, 'Do your technicians carry stock in their vans?')
  assert.equal(body.model, 'gemini-3.5-flash')

  // Two calls: the first rejected `thinkingConfig`, the second dropped it and went through.
  assert.equal(calls.length, 2, `Expected the thinking retry, saw ${calls.length} calls.`)
  assert.ok(!calls[1].payload.generationConfig.thinkingConfig, 'Wesify kept sending a parameter the model refused.')
  assert.equal(calls[0].key, 'gemini-mock-key', 'The key goes in the header, never the URL.')
  assert.ok(!calls[0].url.includes('gemini-mock-key'), 'The key must not be in the request URL.')

  const config = calls[0].payload.generationConfig
  assert.equal(config.responseMimeType, 'application/json')
  const schemaKeywords = keywords(config.responseSchema)
  for (const unsupported of ['additionalProperties', 'maxLength', 'minimum', 'maximum']) {
    assert.ok(!schemaKeywords.has(unsupported), `The schema still carries ${unsupported}, which Gemini rejects outright.`)
  }
  assert.ok(schemaKeywords.has('enum') && schemaKeywords.has('required'), 'The schema lost the constraints Gemini does support.')

  // The interview is told what it has already asked, and why the last attempt was thrown away.
  const prompt = calls[0].payload.contents[0].parts[0].text
  assert.ok(prompt.includes('plumbing service business'), 'The model was not told what the operator wrote.')
  assert.ok(prompt.includes('Questions you have already asked'), 'The model was not told what it has already asked.')
  assert.ok(prompt.includes('Who does the work?'), 'The question already asked was not listed.')
  assert.ok(prompt.includes('You just proposed a repeat.'), 'The repeat correction never reached the model.')
  assert.ok(calls[0].payload.systemInstruction.parts[0].text.includes("Wesify's business consultant"), 'The consultant prompt was not sent.')

  /**
   * A busy free tier must not end the interview.
   *
   * Falling back on a 503 puts the operator in the fixed question bank halfway through, which is the
   * failure the free tier was added to remove — and it would happen at the busiest times of day.
   */
  state.busyOnce = true
  const before = calls.length
  const retried = await fetch(`http://127.0.0.1:${apiPort}/api/discovery/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'DISCOVER',
      conversation: [{ role: 'user', content: 'We run a plumbing service business.' }],
      capabilityIds: ['crm.contacts'],
      modules: ['customers'],
    }),
  })
  assert.equal(retried.status, 200, 'A busy free tier ended the interview instead of being waited out.')
  assert.equal((await retried.json()).decision, 'ASK_QUESTION')
  assert.equal(calls.length - before, 2, 'Wesify did not retry the overloaded call.')

  /**
   * A spent daily quota changes model, it does not end the interview.
   *
   * This is what a real free key does after a few dozen builds: the newest flash model 429s for the
   * rest of the day while every older one on the same key still answers. Falling back to the fixed
   * question bank there is exactly the bug the free tier was added to fix.
   */
  state.exhausted.add('gemini-3.5-flash')
  const spent = await fetch(`http://127.0.0.1:${apiPort}/api/discovery/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'DISCOVER',
      conversation: [{ role: 'user', content: 'We import wine from Argentina and sell it to Spanish shops.' }],
      capabilityIds: ['crm.contacts'],
      modules: ['customers'],
    }),
  })
  assert.equal(spent.status, 200, 'A spent daily quota on one model ended the interview.')
  const spentBody = await spent.json()
  assert.equal(spentBody.decision, 'ASK_QUESTION')
  assert.notEqual(spentBody.model, 'gemini-3.5-flash', 'Wesify stayed on the model that has no quota left.')
  assert.ok(spentBody.model.startsWith('gemini-'), `Wesify moved to something unexpected: ${spentBody.model}`)

  /**
   * A retired model is followed to its replacement, not treated as a dead end.
   *
   * Google retires models for keys issued after a date and says so in the 404, naming what to use
   * instead. A free key that met that on every remaining fallback ended the interview — with the
   * answer sitting in the error message Wesify had just been handed.
   */
  // Retires whichever model Wesify actually reaches here. The quota case above parked the one it leads
  // with for fifteen minutes, and these cases share a server process, so retiring that one again
  // would prove nothing: Wesify would skip it without ever seeing the 404.
  state.retired.set('gemini-3.1-flash-lite', 'gemini-3.5-flash-lite')
  const retired = await fetch(`http://127.0.0.1:${apiPort}/api/discovery/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'DISCOVER',
      conversation: [{ role: 'user', content: 'We run a small bakery with two shops.' }],
      capabilityIds: ['crm.contacts'],
      modules: ['customers'],
    }),
  })
  assert.equal(retired.status, 200, 'A retired model ended the interview instead of being replaced.')
  const retiredBody = await retired.json()
  assert.equal(retiredBody.model, 'gemini-3.5-flash-lite', `Wesify ignored the replacement Google named and used ${retiredBody.model}.`)

  console.log('Gemini test passed: the free tier runs the interview, the schema survives it, a busy tier is waited out, a spent daily quota moves to another free model, a retired one is followed to its replacement, and the model is told what it has already asked.')
} finally {
  api.kill()
  gemini.close()
  await rm(workingDirectory, { recursive: true, force: true })
}
