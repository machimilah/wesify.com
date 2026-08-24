import type { ArchitectureContext } from './businessDiscovery'
import type { BusinessResearch, ResearchFinding } from './businessResearch'
import { capabilityCatalogPrompt, capabilityIds } from './capabilityCatalog'
import { workspaceAccessHeaders } from './workspaceAccess'

/**
 * Client for BO's server-side frontier researcher.
 *
 * The local researcher in `businessResearch.ts` always runs and never leaves the browser. This adds
 * the second tier: a frontier model that searches the open web before deciding what the company
 * needs. It is optional by design — when the server has no API key, everything below no-ops and BO
 * behaves exactly as it does today.
 */

export interface FrontierFinding {
  conclusion: string
  because: string
  implication: string
  basis: 'stated' | 'researched' | 'inferred'
  confidence: number
  sourceUrl: string
  capabilityIds: string[]
}

export interface FrontierSource { title: string; url: string }

export interface FrontierResearch {
  model: string
  brief: string
  archetype: { id: string; label: string; confidence: number } | null
  summary: string
  findings: FrontierFinding[]
  capabilityIds: string[]
  excludedCapabilityIds: string[]
  openQuestion: { text: string; reason: string; suggestedAnswers: string[] } | null
  sources: FrontierSource[]
}

let statusPromise: Promise<{ available: boolean; model: string; research?: boolean }> | null = null

export function frontierResearchStatus() {
  statusPromise ??= fetch('/api/research/status')
    .then(response => response.ok ? response.json() as Promise<{ available: boolean; model: string; research?: boolean }> : { available: false, model: '' })
    .catch(() => ({ available: false, model: '' }))
  return statusPromise
}

export async function requestFrontierResearch(workspaceId: string, description: string, conversation: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<FrontierResearch | null> {
  const status = await frontierResearchStatus()
  // The web-search researcher is the Anthropic path only. `available` now covers the interview too,
  // which a free Gemini key alone turns on, so asking for research on that key would be a 503 the
  // operator sees as BO failing rather than as a tier it does not have.
  if (!(status.research ?? status.available)) return null
  const response = await fetch('/api/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...workspaceAccessHeaders(workspaceId) },
    body: JSON.stringify({ workspaceId, description, conversation, catalog: capabilityCatalogPrompt(), capabilityIds }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: 'BO could not reach the frontier researcher.' })) as { error?: string }
    throw new Error(detail.error || 'BO could not complete the frontier research.')
  }
  return await response.json() as FrontierResearch
}

/**
 * Frontier conclusions win where they exist; local readings, questions, and coverage stay, so the
 * journal and the planner keep working unchanged when the frontier tier is unavailable mid-session.
 */
export function mergeFrontierResearch(local: BusinessResearch, frontier: FrontierResearch | null): BusinessResearch {
  if (!frontier) return local
  const researched: ResearchFinding[] = frontier.findings.map(item => ({
    id: `frontier:${item.conclusion.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
    conclusion: item.conclusion,
    // The conclusion and the reason travel; the address BO read them at does not. What convinces an
    // operator is that BO understood their trade, and a link only invites them to audit a citation.
    because: item.because,
    implication: item.implication,
    basis: item.basis,
    confidence: item.confidence,
    capabilityIds: item.capabilityIds,
  }))
  const seen = new Set(researched.map(item => item.conclusion.toLowerCase()))
  const include = new Map(local.include.map(item => [item.capabilityId, item.reason]))
  for (const id of frontier.capabilityIds) include.set(id, `Frontier research: ${frontier.summary || 'required by the researched operating model'}`)
  const exclude = new Map(local.exclude.map(item => [item.capabilityId, item.reason]))
  for (const id of frontier.excludedCapabilityIds) { exclude.set(id, 'Frontier research found no evidence this company needs it.'); include.delete(id) }
  return {
    ...local,
    archetype: frontier.archetype ? { ...frontier.archetype, evidence: frontier.summary || 'researched' } : local.archetype,
    findings: [...researched, ...local.findings.filter(item => !seen.has(item.conclusion.toLowerCase()))],
    include: [...include.entries()].map(([capabilityId, reason]) => ({ capabilityId, reason })),
    exclude: [...exclude.entries()].map(([capabilityId, reason]) => ({ capabilityId, reason })),
  }
}

/** Applies researched capability decisions to the architecture BO is about to compile. */
export function applyFrontierArchitecture(architecture: ArchitectureContext, frontier: FrontierResearch | null): ArchitectureContext {
  if (!frontier) return architecture
  const excluded = new Set(frontier.excludedCapabilityIds)
  return {
    ...architecture,
    capabilityIds: [...new Set([...architecture.capabilityIds, ...frontier.capabilityIds])].filter(id => !excluded.has(id)),
    excludedCapabilityIds: [...new Set([...architecture.excludedCapabilityIds, ...frontier.excludedCapabilityIds])],
    explanation: frontier.summary || architecture.explanation,
  }
}
