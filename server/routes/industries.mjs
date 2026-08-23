import { countedIndustries, markIndustryCounted, tenant } from '../access.mjs'
import { body, send } from '../http.mjs'
import { industryVerdict, listIndustries, readIndustryProfile, recordObservations } from '../industryKnowledge.mjs'
import { callerOf, rateLimit } from '../limits.mjs'

/**
 * Industry knowledge: shared across companies, aggregate counts only.
 *
 * Reading needs nothing — there is nothing in it belonging to any one company. Writing needs a real
 * workspace, because the count of companies is what decides whether an industry has spoken, and an
 * open write endpoint means anyone can invent five hundred companies and change what every genuine
 * one is given. It is the only defensible thing BO has, so it is the thing worth protecting first.
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
    // One workspace is one company, once, however many times it reports. Without this the threshold
    // counts requests rather than companies, and a single caller can outvote an industry alone.
    const alreadyCounted = await countedIndustries(workspaceId)
    const firstTime = input.newCompany === true && !alreadyCounted.includes(segments[2])
    const profile = await recordObservations(segments[2], {
      kept: ids(input.kept), removed: ids(input.removed), added: ids(input.added),
      label: String(input.label ?? '').slice(0, 120), newCompany: firstTime,
    })
    if (firstTime) await markIndustryCounted(workspaceId, segments[2], alreadyCounted)
    return send(response, 200, industryVerdict(profile))
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
