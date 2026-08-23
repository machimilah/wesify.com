import Anthropic from '@anthropic-ai/sdk'

/**
 * The shared frontier-model plumbing.
 *
 * Two things talk to the model — the researcher and the interview consultant — and both need the same
 * awkward parts handled the same way: a paused tool loop that has to be resumed, a beta header that
 * some deployments reject, and a refusal that must surface as a refusal rather than a parse failure.
 * Getting one of those subtly different in two places is how a product ends up with a bug that only
 * appears on one screen.
 */

/**
 * The cheapest model that can do the job, not the best one available.
 *
 * BO makes several model calls per build — a turn per interview question, then an architecture pass,
 * then a research pass with web search — and the operator paying for them is whoever runs the
 * deployment. On a frontier model that adds up per company built, before BO has earned anything.
 *
 * `BO_REASONING_MODEL` raises it for anyone who wants the quality back on a specific deployment.
 */
export const MODEL = process.env.BO_REASONING_MODEL || 'claude-haiku-4-5-20251001'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function reasoningAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

/**
 * JSON Schema keywords the structured-output endpoint refuses.
 *
 * It rejects the whole request with a 400 rather than ignoring them, so one of these anywhere in a
 * schema means the model is never reached at all. BO shipped `maxItems` in its interview schema for
 * months without noticing, because every test stubs the model: the suites proved BO handled the
 * response correctly and none of them proved the request was one the API would accept.
 *
 * Stripped here, in one place, rather than remembered at each schema. The limits these expressed are
 * enforced where they belong anyway — in the validators that parse the reply, which have to distrust
 * the model regardless of what the schema asked for.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['maxItems', 'minimum', 'maximum'])

export function wireSchema(value) {
  if (Array.isArray(value)) return value.map(wireSchema)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYWORDS.has(key))
      .map(([key, item]) => [key, wireSchema(item)]),
  )
}

let client
export function getClient() {
  if (!reasoningAvailable()) throw Object.assign(new Error('BO frontier research is not configured. Set ANTHROPIC_API_KEY to enable it.'), { status: 503 })
  client ??= new Anthropic()
  return client
}

/**
 * Server tools run a sampling loop that stops at `pause_turn` when it hits its iteration limit.
 * Re-sending the conversation resumes it; the extra user message the loop is tempted to add would
 * derail the research, so the assistant turn goes back on its own.
 */
export async function runToCompletion(request, messages, maxContinuations = 4) {
  const anthropic = getClient()
  let conversation = messages
  let message
  for (let attempt = 0; attempt <= maxContinuations; attempt += 1) {
    const stream = anthropic.beta.messages.stream({ ...request, messages: conversation })
    message = await stream.finalMessage()
    if (message.stop_reason !== 'pause_turn') return { message, conversation }
    conversation = [...conversation, { role: 'assistant', content: message.content }]
  }
  return { message, conversation }
}

/**
 * Drops one optional parameter the model has just said it does not accept.
 *
 * Everything removed here is an optimisation rather than part of the answer: `effort` asks a model to
 * think harder, `thinking` asks for an adaptive budget, `fallbacks` is a routing convenience. A model
 * that does not implement one still answers the question perfectly well without it.
 */
function without(request, complaint) {
  if (/effort/i.test(complaint) && request.output_config?.effort) {
    const { effort, ...output } = request.output_config
    return { ...request, output_config: output }
  }
  if (/thinking/i.test(complaint) && request.thinking) {
    const { thinking, ...rest } = request
    return rest
  }
  return null
}

/**
 * The request, minus whatever this particular model refuses.
 *
 * Model capabilities differ, and the cheap ones differ most — Haiku rejects `effort` outright with a
 * 400 rather than ignoring it, which fails the whole call. Rather than keeping a table of which model
 * supports what, and having it go stale the week a new one ships, BO reads the complaint and drops
 * the one parameter named in it. Anything it does not recognise is re-thrown: a 400 that is actually
 * about the schema or the prompt must not be retried into silence.
 */
export async function withFallbacks(request, messages) {
  let attempt = { ...request, betas: [FALLBACK_BETA], fallbacks: 'default' }
  for (let tries = 0; tries < 4; tries += 1) {
    try {
      return await runToCompletion(attempt, messages)
    } catch (error) {
      if (error?.status !== 400) throw error
      const complaint = String(error?.message ?? '')
      // The beta is the first thing to go: a deployment that has not been granted it rejects the
      // request before looking at anything else.
      if (attempt.betas) { const { betas, fallbacks, ...bare } = attempt; attempt = bare; continue }
      const reduced = without(attempt, complaint)
      if (!reduced) throw error
      attempt = reduced
    }
  }
  return runToCompletion(attempt, messages)
}

/** `fallback` names what BO does instead, so the operator is told which surface stopped and why. */
export function refusal(message, fallback = 'BO continued with its built-in reasoning.') {
  if (message.stop_reason !== 'refusal') return null
  const category = message.stop_details?.category ?? 'unspecified'
  return Object.assign(new Error(`The request was declined by safety review (${category}). ${fallback}`), { status: 422 })
}

export function textOf(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
}

/** Sources the model actually opened, so the UI can show where a conclusion came from. */
export function citedSources(message) {
  const sources = []
  for (const block of message.content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const result of block.content) {
      if (result?.type === 'web_search_result' && result.url) sources.push({ title: String(result.title ?? result.url), url: String(result.url) })
    }
  }
  return sources.filter((item, index, items) => items.findIndex(candidate => candidate.url === item.url) === index).slice(0, 12)
}

export function conversationText(conversation) {
  return conversation
    .filter(item => item && typeof item.content === 'string')
    .slice(-16)
    .map(item => `${item.role === 'assistant' ? 'BO' : 'Operator'}: ${item.content}`)
    .join('\n')
}
