import { readDiscoverySession, writeDiscoverySession } from '../discoverySessions.mjs'
import { audit, modelToll, tenant } from '../access.mjs'
import { interviewAvailable, interviewModel, runDiscoveryTurn } from '../discoveryAgent.mjs'
import { body, send } from '../http.mjs'
import { saveResearch } from '../industryKnowledge.mjs'
import { reasoningAvailable, researchCompany } from '../reasoning.mjs'

/**
 * The interview, and the research behind it.
 *
 * These are the two endpoints that cost money, so both pay the model toll before doing anything. The
 * interview is the one call Wesify cannot ask for a workspace token on: it is the call that produces the
 * workspace in the first place.
 */

/** Anything the caller sends that reaches a model is clipped and filtered first, never trusted raw. */
const conversationFrom = (value, turns) => (Array.isArray(value) ? value : [])
  .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
  .slice(-turns)
  .map(item => ({ role: item.role, content: item.content.slice(0, 2000) }))

const idsFrom = (value, limit) => (Array.isArray(value) ? value : [])
  .filter(id => typeof id === 'string' && /^[a-z][a-z0-9.-]{1,60}$/.test(id))
  .slice(0, limit)

export async function researchRoutes(request, response, segments) {
  if (segments[1] !== 'research') return false

  if (request.method === 'GET' && segments[2] === 'status') {
    /**
     * Two answers, because the two things a key buys are no longer the same key.
     *
     * `available` is the interview — Anthropic or Gemini, whichever is configured — and it is what
     * the build screen reads to decide against downloading a gigabyte of browser model. `research`
     * is the web-search pass, which only the Anthropic path can run. A deployment holding just a free
     * Gemini key gets the intelligent interview and Wesify's own local research, rather than neither.
     */
    return send(response, 200, { available: interviewAvailable(), model: interviewModel(), research: reasoningAvailable() })
  }

  if (request.method === 'POST' && segments.length === 2) {
    const toll = modelToll(request)
    if (toll) return send(response, toll.status, { error: toll.error })
    const input = await body(request)
    await tenant(request, String(input.workspaceId ?? ''))
    const description = String(input.description ?? '').trim().slice(0, 4000)
    if (!description) return send(response, 400, { error: 'A company description is required.' })
    const research = await researchCompany({
      description,
      conversation: conversationFrom(input.conversation, 20),
      catalog: String(input.catalog ?? '').slice(0, 20000),
      capabilityIds: idsFrom(input.capabilityIds, 200),
    })
    await audit(String(input.workspaceId), 'research.completed', request, { model: research.model, findings: research.findings.length, sources: research.sources.length })
    // One company pays for the research; every later company in the same industry inherits it.
    if (/^\d{3}$/.test(String(input.subsector ?? ''))) {
      await saveResearch(input.subsector, { ...research, label: String(input.industryLabel ?? '') }).catch(() => undefined)
    }
    return send(response, 200, research)
  }

  return send(response, 405, { error: 'Method not allowed.' })
}

export async function discoveryRoutes(request, response, segments) {
  if (segments[1] !== 'discovery') return false

  /**
   * One turn of the interview.
   *
   * No workspace token: the operator has not got a workspace yet — this call is what produces one.
   * The catalog and module list come from the client because they are the client's own definitions;
   * a second copy kept here would drift and start rejecting capabilities that exist.
   */
  if (request.method === 'POST' && segments[2] === 'turn') {
    const toll = modelToll(request)
    if (toll) return send(response, toll.status, { error: toll.error })
    const input = await body(request)
    const turn = await runDiscoveryTurn({
      mode: ['DISCOVER', 'ARCHITECT', 'REVIEW_ARCHITECTURE'].includes(input.mode) ? input.mode : 'DISCOVER',
      conversation: conversationFrom(input.conversation, 24),
      modules: (Array.isArray(input.modules) ? input.modules : []).filter(id => typeof id === 'string' && /^[a-z][a-z-]{1,40}$/.test(id)).slice(0, 60),
      capabilityIds: idsFrom(input.capabilityIds, 400),
      businessState: input.businessState && typeof input.businessState === 'object' ? input.businessState : null,
      catalog: String(input.catalog ?? '').slice(0, 20000),
      forceArchitecture: input.forceArchitecture === true,
      industry: String(input.industry ?? '').slice(0, 120),
      knowledgeRequirements: (Array.isArray(input.knowledgeRequirements) ? input.knowledgeRequirements : []).slice(0, 12).map(item => ({
        id: String(item?.id ?? '').slice(0, 80),
        domain: String(item?.domain ?? '').slice(0, 80),
        objective: String(item?.objective ?? '').slice(0, 240),
        priority: ['critical', 'high', 'medium'].includes(item?.priority) ? item.priority : 'medium',
        informationNeeded: (Array.isArray(item?.informationNeeded) ? item.informationNeeded : []).slice(0, 8).map(value => String(value).slice(0, 100)),
        decisionImpact: idsFrom(item?.decisionImpact, 20),
        rank: Number.isFinite(item?.rank) ? Math.max(0, Math.min(400, item.rank)) : 0,
      })).filter(item => item.id && item.objective),
      businessGaps: (Array.isArray(input.businessGaps) ? input.businessGaps : []).slice(0, 12).map(item => ({
        id: String(item?.id ?? '').slice(0, 80),
        title: String(item?.title ?? '').slice(0, 160),
        rationale: String(item?.rationale ?? '').slice(0, 260),
        classification: ['required', 'recommended', 'future'].includes(item?.classification) ? item.classification : 'recommended',
        confidence: Number.isFinite(item?.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0,
        capabilityIds: idsFrom(item?.capabilityIds, 30),
      })).filter(item => item.id && item.title),
      /**
       * Set when Wesify has just rejected this turn — a question it had already asked, or an
       * architecture missing something the process frameworks say this company must be able to do —
       * so the retry knows why rather than rolling the dice on the same prompt.
       *
       * The old cap was 400 characters, which was the length of a note about a repeated question. A
       * completeness repair names several missing processes with the evidence behind each, and at 400
       * it arrived cut off mid-sentence: the model was told a company needed something and not what.
       */
      repair: String(input.repair ?? '').slice(0, 2000),
    })
    return send(response, 200, turn)
  }

  if (segments[2] === 'sessions' && segments[3]) {
    const workspaceId = segments[3]
    await tenant(request, workspaceId)
    if (request.method === 'GET') return send(response, 200, await readDiscoverySession(workspaceId))
    if (request.method === 'PUT') {
      const session = await body(request)
      await writeDiscoverySession(workspaceId, session)
      return send(response, 200, session)
    }
    return send(response, 405, { error: 'Method not allowed.' })
  }

  return send(response, 404, { error: 'Not found.' })
}
