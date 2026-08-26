import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { projectPaths } from './project-builder.mjs'
import { databaseAvailable } from './db.mjs'
import { clerkConfigured } from './clerk.mjs'
import { claimWorkspace, membership, sessionUser, workspaceOwner, workspacesFor } from './auth.mjs'
import { requireWorkspaceRoom } from './billing.mjs'
import { callerOf, rateLimit, spendModelCall } from './limits.mjs'
import { bearer } from './http.mjs'

/**
 * Who is asking, whether they may, and what they did.
 *
 * Every workspace route begins with the same question and ends with the same record of the answer,
 * so both live here rather than being repeated per route module.
 */

const accessRoot = () => path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.workspace-access')

/**
 * Whether this request may act on this workspace.
 *
 * With a database, the answer comes from a signed-in account: the workspace has an owner, and a
 * session that is not a member of it is refused however many tokens it presents. A workspace the
 * caller has not claimed yet is claimed for them here, which is what makes the first build after
 * signing in belong to somebody.
 *
 * Without accounts — no database to own a workspace, or no Clerk instance to say who is asking —
 * Wesify keeps its previous behaviour: the first caller to present a token for a workspace id owns it
 * from then on. That is trust-on-first-use, it is not real security, and it exists so the prototype
 * still runs with no infrastructure. Both switches have to be on for the account path to be taken.
 *
 * `claim: false` is for the one action that must never bring a workspace into being: deleting it.
 * Claiming costs a workspace against the plan, so with the free plan's single workspace already
 * spent, deleting an unclaimed one was refused with "upgrade to build another" — a quota, quoted at
 * somebody trying to get *under* it. Nothing is created on that path, and the plan is not consulted.
 */
export async function tenant(request, workspaceId, { claim = true } = {}) {
  const header = String(request.headers['x-bo-workspace-id'] ?? '').toLowerCase()
  if (!header || header !== String(workspaceId).toLowerCase()) throw Object.assign(new Error('Workspace access denied.'), { status: 403 })

  if (databaseAvailable() && clerkConfigured()) {
    const user = await sessionUser(bearer(request))
    if (!user) throw Object.assign(new Error('Sign in to use this workspace.'), { status: 401 })
    const existing = await membership(workspaceId, user.id)
    if (existing) {
      request.boRole = existing.role
      return { user, role: existing.role }
    }
    if (!claim) {
      // Somebody else's workspace stays somebody else's. An id no account holds is nobody's to be
      // protected from — only the browser that made it knows it exists — so it is the caller's to
      // throw away, and throwing it away is all this path is ever used for.
      const owner = await workspaceOwner(workspaceId)
      if (owner && owner !== user.id) throw Object.assign(new Error('That workspace belongs to someone else.'), { status: 403 })
      request.boRole = 'owner'
      return { user, role: 'owner' }
    }
    // The plan's workspace limit is checked here, at the only moment a new workspace comes into
    // being. Existing ones are never revisited: a plan that lapses does not take a workspace away.
    await requireWorkspaceRoom(user.id, (await workspacesFor(user.id)).length)
    // Claiming refuses a workspace that already has a different owner, so this cannot take one over.
    await claimWorkspace(workspaceId, user.id)
    request.boRole = 'owner'
    return { user, role: 'owner' }
  }

  const token = String(request.headers['x-bo-access-token'] ?? '')
  if (!/^[a-zA-Z0-9_-]{32,200}$/.test(token)) throw Object.assign(new Error('Workspace session is missing or invalid.'), { status: 401 })
  const digest = createHash('sha256').update(token).digest('hex')
  const file = path.join(accessRoot(), `${String(workspaceId).toLowerCase()}.json`)
  let stored
  try { stored = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(accessRoot(), { recursive: true })
    await writeFile(file, `${JSON.stringify({ workspaceId, digest, createdAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    return { user: null, role: 'owner' }
  }
  const supplied = Buffer.from(digest)
  const expected = Buffer.from(String(stored.digest ?? ''))
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw Object.assign(new Error('Workspace session is not authorized.'), { status: 403 })
  return { user: null, role: 'owner' }
}

/**
 * Forgets a deleted workspace's trust-on-first-use token.
 *
 * Only ever holds anything in the infrastructure-free mode above, where the file *is* the ownership
 * record. Leaving it behind would mean a workspace id that has been deleted still answers to the
 * browser that created it, and a rebuild under that id would silently inherit the old owner.
 */
export async function forgetWorkspaceAccess(workspaceId) {
  await rm(path.join(accessRoot(), `${String(workspaceId).toLowerCase()}.json`), { force: true })
}

export function authorize(manifest, request, permission) {
  // With accounts, tenant() writes the database membership here. The browser's role header remains
  // useful only in infrastructure-free local mode, where it powers the explicit role preview.
  const roleId = String(request.boRole ?? request.headers['x-bo-role'] ?? '')
  const role = manifest.permissions?.find(candidate => candidate.id === roleId)
  if (!role?.permissions?.includes(permission) && !role?.permissions?.includes('admin')) throw Object.assign(new Error('Your role does not allow this action.'), { status: 403 })
}

export async function audit(workspaceId, event, request, detail = {}) {
  const root = projectPaths(workspaceId).root
  await mkdir(root, { recursive: true })
  const record = { id: randomUUID(), workspaceId, event, role: String(request.boRole ?? request.headers['x-bo-role'] ?? 'system'), at: new Date().toISOString(), detail }
  await appendFile(path.join(root, 'audit.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
}

export async function readAudit(workspaceId) {
  try {
    const lines = (await readFile(path.join(projectPaths(workspaceId).root, 'audit.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean)
    return lines.slice(-100).reverse().map(line => JSON.parse(line))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/** Industries this workspace has already been counted towards, kept in the workspace's own folder. */
export async function countedIndustries(workspaceId) {
  try { return JSON.parse(await readFile(path.join(projectPaths(workspaceId).root, 'industry.json'), 'utf8')).counted ?? [] }
  catch { return [] }
}

export async function markIndustryCounted(workspaceId, subsector, already) {
  const root = projectPaths(workspaceId).root
  await mkdir(root, { recursive: true })
  let receipt = {}
  try { receipt = JSON.parse(await readFile(path.join(root, 'industry.json'), 'utf8')) } catch { /* First receipt. */ }
  await writeFile(path.join(root, 'industry.json'), `${JSON.stringify({ ...receipt, counted: [...already, subsector] }, null, 2)}\n`, 'utf8')
}

export async function industryContributionKeys(workspaceId, subsector) {
  try { return JSON.parse(await readFile(path.join(projectPaths(workspaceId).root, 'industry.json'), 'utf8')).contributions?.[subsector] ?? [] }
  catch { return [] }
}

export async function markIndustryContributions(workspaceId, subsector, keys) {
  const root = projectPaths(workspaceId).root
  await mkdir(root, { recursive: true })
  let receipt = {}
  try { receipt = JSON.parse(await readFile(path.join(root, 'industry.json'), 'utf8')) } catch { /* First receipt. */ }
  const contributions = { ...(receipt.contributions ?? {}), [subsector]: [...new Set([...(receipt.contributions?.[subsector] ?? []), ...keys])] }
  await writeFile(path.join(root, 'industry.json'), `${JSON.stringify({ ...receipt, contributions }, null, 2)}\n`, 'utf8')
}

/**
 * What every model-backed request pays before it is allowed to cost anything.
 *
 * One caller is slowed by the window; the whole deployment is capped by the daily budget. Returning a
 * value here means the request is refused, and the message says which limit was hit so the operator
 * can tell "too fast" apart from "out of budget for today".
 */
export function modelToll(request) {
  const window = rateLimit(`model:${callerOf(request)}`, { max: Number(process.env.BO_MODEL_RATE_LIMIT || 20), windowMs: 60_000 })
  if (!window.ok) return { status: 429, error: `Too many requests. Try again in ${window.retryAfterSeconds} seconds.` }
  const budget = spendModelCall()
  if (!budget.ok) return { status: 429, error: `Wesify has reached its model budget for today (${budget.limit} requests). It resets at midnight UTC.` }
  return null
}
