import { countedIndustries, industryContributionKeys, markIndustryContributions, markIndustryCounted, tenant } from '../access.mjs'
import { body, send } from '../http.mjs'
import { industryVerdict, listIndustries, readIndustryProfile, recordObservations } from '../industryKnowledge.mjs'
import { callerOf, rateLimit } from '../limits.mjs'
import platformPatternIds from '../../src/data/platformPatternIds.json' with { type: 'json' }

/**
 * Industry knowledge: shared across companies, aggregate counts only.
 *
 * Reading needs nothing — there is nothing in it belonging to any one company. Writing needs a real
 * workspace, because the count of companies is what decides whether an industry has spoken, and an
 * open write endpoint means anyone can invent five hundred companies and change what every genuine
 * one is given. It is the only defensible thing Wesify has, so it is the thing worth protecting first.
 *
 * The "already counted" marker lives with the company, not with the industry, so the shared store
 * still holds no trace of who contributed to it.
 */
export async function industryRoutes(request, response, segments) {
  if (segments[1] !== 'industries') return false

  if (request.method === 'GET' && segments.length === 2) return send(response, 200, await listIndustries())
  if (request.method === 'GET' && segments[2]) return send(response, 200, industryVerdict(await readIndustryProfile(segments[2])))

  if (request.method === 'POST' && segments[2] && segments[3] === 'observations') {
    const input = await body(request)
    const workspaceId = String(input.workspaceId ?? '')
    await tenant(request, workspaceId)
    const window = rateLimit(`observations:${callerOf(request)}`, { max: 30, windowMs: 60_000 })
    if (!window.ok) return send(response, 429, { error: `Too many requests. Try again in ${window.retryAfterSeconds} seconds.` })

    const ids = value => (Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && /^[a-z][a-z0-9.-]{1,60}$/.test(id)).slice(0, 200)
    const patternKinds = new Set(['workflow', 'kpi', 'schema', 'business-rule', 'automation', 'process', 'diagnostic'])
    const catalogKind = kind => ['workflow', 'business-rule'].includes(kind) ? 'automation' : kind
    const patterns = (Array.isArray(input.patterns) ? input.patterns : []).filter(item => item && patternKinds.has(item.kind) && /^[a-z][a-z0-9.-]{1,80}$/.test(String(item.id)) && platformPatternIds[catalogKind(item.kind)]?.includes(String(item.id)) && ['adopted', 'removed'].includes(item.outcome)).slice(0, 200).map(item => ({ kind: item.kind, id: String(item.id), outcome: item.outcome }))
    // One workspace is one company, once, however many times it reports. Without this the threshold
    // counts requests rather than companies, and a single caller can outvote an industry alone.
    const alreadyCounted = await countedIndustries(workspaceId)
    const contributed = new Set(await industryContributionKeys(workspaceId, segments[2]))
    const fresh = (values, outcome) => ids(values).filter(id => !contributed.has(`capability:${outcome}:${id}`))
    const kept = fresh(input.kept, 'kept')
    const removed = fresh(input.removed, 'removed')
    const added = fresh(input.added, 'added')
    const seenPatterns = new Set()
    const freshPatterns = patterns.filter(item => {
      const key = `pattern:${item.kind}:${item.outcome}:${item.id}`
      if (contributed.has(key) || seenPatterns.has(key)) return false
      seenPatterns.add(key)
      return true
    })
    const firstTime = input.newCompany === true && !alreadyCounted.includes(segments[2])
    const profile = await recordObservations(segments[2], {
      kept, removed, added, patterns: freshPatterns,
      label: String(input.label ?? '').slice(0, 120), newCompany: firstTime,
    })
    const keys = [...kept.map(id => `capability:kept:${id}`), ...removed.map(id => `capability:removed:${id}`), ...added.map(id => `capability:added:${id}`), ...freshPatterns.map(item => `pattern:${item.kind}:${item.outcome}:${item.id}`)]
    if (keys.length) await markIndustryContributions(workspaceId, segments[2], keys)
    if (firstTime) await markIndustryCounted(workspaceId, segments[2], alreadyCounted)
    return send(response, 200, industryVerdict(profile))
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
