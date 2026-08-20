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

export const MODEL = process.env.BO_REASONING_MODEL || 'claude-opus-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function reasoningAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
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

/** `fallbacks` is Claude-API only and beta-gated; a rejected beta must not fail the request. */
export async function withFallbacks(request, messages) {
  try {
    return await runToCompletion({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' }, messages)
  } catch (error) {
    if (error?.status !== 400) throw error
    return runToCompletion(request, messages)
  }
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
