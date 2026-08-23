import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from '../atomicWrite.mjs'
import { audit, modelToll, tenant } from '../access.mjs'
import { runDiscoveryTurn } from '../discoveryAgent.mjs'
import { body, send } from '../http.mjs'
import { saveResearch } from '../industryKnowledge.mjs'
import { MODEL } from '../anthropic.mjs'
import { reasoningAvailable, researchCompany } from '../reasoning.mjs'

/**
 * The interview, and the research behind it.
 *
 * These are the two endpoints that cost money, so both pay the model toll before doing anything. The
 * interview is the one call BO cannot ask for a workspace token on: it is the call that produces the
 * workspace in the first place.
 */

const discoveryRoot = () => path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.discovery-sessions')

function discoveryFile(workspaceId) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(workspaceId)) throw Object.assign(new Error('Invalid workspace id.'), { status: 400 })
  return path.join(discoveryRoot(), `${workspaceId}.json`)
}

async function readDiscoverySession(workspaceId) {
  try { return JSON.parse(await readFile(discoveryFile(workspaceId), 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function writeDiscoverySession(workspaceId, value) {
  if (!value || value.workspaceId !== workspaceId || !Array.isArray(value.messages) || typeof value.phase !== 'string') {
    throw Object.assign(new Error('Invalid discovery session.'), { status: 400 })
  }
  await writeJsonAtomic(discoveryFile(workspaceId), value)
}

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
    // Named from one place, so the screen can never claim a model the server is not using.
    return send(response, 200, { available: reasoningAvailable(), model: MODEL })
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
