import { apiUrl } from './apiBase'
import { parseDiscoveryResponse, type DiscoveryAgentResponse, type DiscoverySession } from './businessDiscovery'
import { capabilityCatalogPrompt, capabilityIds } from './capabilityCatalog'
import { moduleIds } from './blueprint'
import type { DiscoveryModelRequest } from './discoveryModel'
import { evaluateOperatingKnowledge, knowledgeRequirementsFor } from './knowledgeEngine'

/**
 * The interview, asked of the server.
 *
 * BO's own model runs in the browser, which is private and free and costs the operator a one-gigabyte
 * download before the first question appears. When a frontier model is configured, the interview goes
 * to the server instead: it starts instantly, works in any browser, and — because the model already
 * knows what a plumbing company is — asks about this company rather than asking it to define itself.
 *
 * Failure here is never fatal. Every path falls back to the browser model.
 */

let availability: Promise<boolean> | null = null

/** Cached for the session: the answer cannot change without a server restart. */
export function serverInterviewAvailable(): Promise<boolean> {
  availability ??= fetch(apiUrl('/api/research/status'))
    .then(response => response.ok ? response.json() : { available: false })
    .then(status => status.available === true)
    .catch(() => false)
  return availability
}

function conversationOf(session: DiscoverySession) {
  return session.messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({ role: message.role, content: message.content }))
}

/**
 * Why the last server turn was not used.
 *
 * Falling back is silent by design — the interview must never stop — but silent was indistinguishable
 * from broken: a spent free-tier quota, a server started before the key was set, and a model refusal
 * all looked identical from the screen, which simply started asking its built-in questions again. The
 * reason is recorded here and shown in BO's working, so "why is it asking me this?" has an answer.
 */
let lastIssue = ''
export function lastInterviewIssue() { return lastIssue }

/** The model that produced the last accepted turn, so the screen can say who is asking. */
let lastModel = ''
export function lastInterviewModel() { return lastModel }

export async function requestDiscoveryTurn(request: DiscoveryModelRequest, industry = '', repair = ''): Promise<DiscoveryAgentResponse | null> {
  lastIssue = ''
  if (!await serverInterviewAvailable()) {
    lastIssue = 'No interview model is configured on the server, so Wesify used its built-in questions. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY and restart it.'
    return null
  }
  try {
    const conversation = conversationOf(request.session)
    const knowledgeText = [
      ...conversation.filter(message => message.role === 'user').map(message => message.content),
      request.session.businessState.companySummary,
      request.session.businessState.industry,
      ...request.session.businessState.operations,
      ...request.session.businessState.resources,
    ].join(' ')
    const operatingKnowledge = evaluateOperatingKnowledge(knowledgeText, request.session.architecture?.capabilityIds ?? [])
    const response = await fetch(apiUrl('/api/discovery/turn'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: request.mode,
        conversation,
        businessState: request.session.businessState,
        capabilityIds,
        modules: [...moduleIds],
        // Only the architect needs the catalog, and it is large enough to be worth not sending twice.
        catalog: request.mode === 'DISCOVER' ? '' : capabilityCatalogPrompt(),
        forceArchitecture: request.forceArchitecture === true,
        industry,
        repair,
        knowledgeRequirements: knowledgeRequirementsFor(knowledgeText, request.session.architecture?.capabilityIds ?? []),
        businessGaps: operatingKnowledge.gaps,
      }),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string }
      lastIssue = `The interview model answered ${response.status}. ${detail.error ?? ''}`.trim()
      return null
    }
    const payload = await response.json() as { model?: string }
    const turn = parseDiscoveryResponse(payload)
    lastModel = typeof payload.model === 'string' ? payload.model : ''
    return turn
  } catch (reason) {
    lastIssue = reason instanceof Error ? reason.message : 'Wesify could not reach the interview model.'
    return null
  }
}
