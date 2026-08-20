import type { ArchitectureContext } from './businessDiscovery'
import { workspaceAccessHeaders } from './workspaceAccess'

/**
 * What other companies in the same industry actually kept.
 *
 * BO's ontology is a set of rules someone wrote. This is evidence: research about the industry, and
 * the corrections real companies made to the workspace BO gave them. Where the evidence is strong
 * enough it decides, and the rules step aside.
 *
 * Only aggregate counts cross the wire. There is no company name, no record, nothing that says who
 * removed what.
 */

export interface IndustryDecision {
  capabilityId: string
  reason: string
  basis: 'observed' | 'researched'
}

export interface IndustryVerdict {
  subsector: string
  label: string
  /** How many companies in this industry have contributed. Below the threshold nothing is decided. */
  companies: number
  include: IndustryDecision[]
  exclude: IndustryDecision[]
  sources: Array<{ title: string; url: string }>
}

export async function loadIndustryVerdict(subsector: string | undefined): Promise<IndustryVerdict | null> {
  if (!subsector || !/^\d{3}$/.test(subsector)) return null
  try {
    const response = await fetch(`/api/industries/${subsector}`)
    if (!response.ok) return null
    const verdict = await response.json() as IndustryVerdict
    return verdict.include.length || verdict.exclude.length ? verdict : null
  } catch {
    return null
  }
}

/**
 * Tells the shared store what this company did.
 *
 * The workspace identifies itself so the server can count a company once however often it reports.
 * The id is used for that check and is not stored in the shared knowledge. Failure is silent: losing
 * one observation is never worth interrupting someone's work.
 */
export async function recordIndustryObservations(subsector: string | undefined, workspaceId: string, observations: { kept?: string[]; removed?: string[]; added?: string[]; label?: string; newCompany?: boolean }) {
  if (!subsector || !/^\d{3}$/.test(subsector) || !workspaceId) return
  try {
    await fetch(`/api/industries/${subsector}/observations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...workspaceAccessHeaders(workspaceId) },
      body: JSON.stringify({ ...observations, workspaceId }),
    })
  } catch { /* Losing one observation is not worth interrupting anyone's work. */ }
}

/**
 * Folds the industry's evidence into the architecture BO is about to compile.
 *
 * Applied before per-company research, so anything BO learned about *this* company still wins over
 * what is merely typical of its industry.
 */
export function applyIndustryVerdict(architecture: ArchitectureContext, verdict: IndustryVerdict | null): ArchitectureContext {
  if (!verdict) return architecture
  const excluded = new Set(verdict.exclude.map(item => item.capabilityId))
  return {
    ...architecture,
    capabilityIds: [...new Set([...architecture.capabilityIds, ...verdict.include.map(item => item.capabilityId)])].filter(id => !excluded.has(id)),
    excludedCapabilityIds: [...new Set([...architecture.excludedCapabilityIds, ...excluded])],
  }
}
