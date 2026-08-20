import { parseDiscoveryResponse, type DiscoveryAgentResponse, type DiscoverySession } from './businessDiscovery'
import { capabilityCatalogPrompt, capabilityIds } from './capabilityCatalog'
import { moduleIds } from './blueprint'
import type { DiscoveryModelRequest } from './discoveryModel'

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
  availability ??= fetch('/api/research/status')
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

export async function requestDiscoveryTurn(request: DiscoveryModelRequest, industry = ''): Promise<DiscoveryAgentResponse | null> {
  if (!await serverInterviewAvailable()) return null
  try {
    const response = await fetch('/api/discovery/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: request.mode,
        conversation: conversationOf(request.session),
        businessState: request.session.businessState,
        capabilityIds,
        modules: [...moduleIds],
        // Only the architect needs the catalog, and it is large enough to be worth not sending twice.
        catalog: request.mode === 'DISCOVER' ? '' : capabilityCatalogPrompt(),
        forceArchitecture: request.forceArchitecture === true,
        industry,
      }),
    })
    if (!response.ok) return null
    return parseDiscoveryResponse(await response.json())
  } catch {
    return null
  }
}
