// First: configuration has to be in place before any module decides what BO can do.
import './env.mjs'
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProject, currentManifest, listVersions, projectPaths, promoteProject, rollbackProject, runtimePath } from './project-builder.mjs'
import { reasoningAvailable, researchCompany } from './reasoning.mjs'
import { runDiscoveryTurn } from './discoveryAgent.mjs'
import { credentialFor, listConnections, recordSync, removeConnection, saveConnection } from './connections.mjs'
import { callerOf, rateLimit, spendModelCall } from './limits.mjs'
import { databaseAvailable, migrate } from './db.mjs'
import { readWorkspaceData, writeWorkspaceData } from './records.mjs'
import { authenticate, beginPasswordReset, claimWorkspace, completePasswordReset, createSession, destroyAllSessions, destroySession, membership, registerUser, sessionUser, workspacesFor } from './auth.mjs'
import { mailAvailable, sendPasswordReset } from './mail.mjs'
import { captureError, logRequest, monitoringAvailable, newRequestId, watchProcess } from './observability.mjs'
import { checkKey as checkStripeKey, pull as pullStripe, verify as verifyStripe } from './connectors/stripe.mjs'
import { industryVerdict, listIndustries, readIndustryProfile, recordObservations, saveResearch } from './industryKnowledge.mjs'

const requestedPort = Number(process.argv[process.argv.indexOf('--port') + 1])
// `PORT` is what every container host injects, and it is not BO's to choose there; `BO_API_PORT` stays
// ahead of it so a local `.env.local` still wins over whatever a shell happens to export.
const port = Number.isFinite(requestedPort) ? requestedPort : Number(process.env.BO_API_PORT || process.env.PORT || 8787)
// Loopback by default, so running BO on a laptop does not quietly publish it to the local network.
// A container has to bind every interface or nothing outside it can reach the port at all.
const host = process.env.BO_HOST || '127.0.0.1'
const distRoot = path.resolve(process.cwd(), 'dist')
const discoveryRoot = path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.discovery-sessions')
const accessRoot = path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.workspace-access')
const initialBuilds = new Map()

function send(response, status, value, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' })
  response.end(type.startsWith('application/json') ? JSON.stringify(value) : value)
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2_000_000) throw new Error('Request is too large.')
    chunks.push(chunk)
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }) }
}

/** The session token a request carries, from the standard header. */
function bearer(request) {
  const header = String(request.headers.authorization ?? '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/**
 * The address a link mailed to someone should point back at.
 *
 * `BO_PUBLIC_URL` first, because behind a proxy the request's own host header is the proxy's idea of
 * the world and not the one in the customer's address bar. The header is the fallback so this works
 * on a laptop with nothing configured; it is only ever used to build a link, never to decide anything.
 */
function originOf(request) {
  if (process.env.BO_PUBLIC_URL) return String(process.env.BO_PUBLIC_URL).replace(/\/+$/, '')
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  const host = forwardedHost || String(request.headers.host ?? `127.0.0.1:${port}`)
  const protocol = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || (host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https')
  return `${protocol}://${host}`
}

/**
 * Whether this request may act on this workspace.
 *
 * With a database, the answer comes from a signed-in account: the workspace has an owner, and a
 * session that is not a member of it is refused however many tokens it presents. A workspace the
 * caller has not claimed yet is claimed for them here, which is what makes the first build after
 * signing in belong to somebody.
 *
 * Without a database, BO keeps its previous behaviour: the first caller to present a token for a
 * workspace id owns it from then on. That is trust-on-first-use, it is not real security, and it
 * exists so the prototype still runs with no infrastructure. `databaseAvailable()` is the switch.
 */
async function tenant(request, workspaceId) {
  const header = String(request.headers['x-bo-workspace-id'] ?? '').toLowerCase()
  if (!header || header !== String(workspaceId).toLowerCase()) throw Object.assign(new Error('Workspace access denied.'), { status: 403 })

  if (databaseAvailable()) {
    const user = await sessionUser(bearer(request))
    if (!user) throw Object.assign(new Error('Sign in to use this workspace.'), { status: 401 })
    const existing = await membership(workspaceId, user.id)
    if (existing) return { user, role: existing.role }
    // Claiming refuses a workspace that already has a different owner, so this cannot take one over.
    await claimWorkspace(workspaceId, user.id)
    return { user, role: 'owner' }
  }

  const token = String(request.headers['x-bo-access-token'] ?? '')
  if (!/^[a-zA-Z0-9_-]{32,200}$/.test(token)) throw Object.assign(new Error('Workspace session is missing or invalid.'), { status: 401 })
  const digest = createHash('sha256').update(token).digest('hex')
  const file = path.join(accessRoot, `${String(workspaceId).toLowerCase()}.json`)
  let stored
  try { stored = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(accessRoot, { recursive: true })
    await writeFile(file, `${JSON.stringify({ workspaceId, digest, createdAt: new Date().toISOString() }, null, 2)}
`, 'utf8')
    return { user: null, role: 'owner' }
  }
  const supplied = Buffer.from(digest)
  const expected = Buffer.from(String(stored.digest ?? ''))
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw Object.assign(new Error('Workspace session is not authorized.'), { status: 403 })
  return { user: null, role: 'owner' }
}

function authorize(manifest, request, permission) {
  const roleId = String(request.headers['x-bo-role'] ?? '')
  const role = manifest.permissions?.find(candidate => candidate.id === roleId)
  if (!role?.permissions?.includes(permission) && !role?.permissions?.includes('admin')) throw Object.assign(new Error('Your role does not allow this action.'), { status: 403 })
}

// Storage moved to records.mjs (Postgres when configured, the original JSON file otherwise); these
// two names stay so every call site below — written against "read the whole object, write the whole
// object back" — did not have to change.
const readData = readWorkspaceData
const writeData = writeWorkspaceData

/**
 * Folds what another system holds into the workspace, without ever taking anything away.
 *
 * Matching is on the id the other system gave the record, kept in `connection.externalId`. A record
 * the operator typed into BO has no external id, so it can never be matched, overwritten or removed
 * by a sync — the worst a bad mapping can do here is add rows.
 *
 * Records that vanish from the other side are marked, not deleted. A customer disappearing from
 * Stripe is a fact worth showing; silently removing them from BO would be BO deciding something it
 * has no business deciding.
 */
async function mergeConnectedRecords(workspaceId, providerId, pulled) {
  const data = await readData(workspaceId)
  const at = new Date().toISOString()
  const counts = {}

  for (const [entityId, incoming] of Object.entries(pulled)) {
    const existing = Array.isArray(data[entityId]) ? data[entityId] : []
    const byExternalId = new Map(existing.filter(record => record?.connection?.externalId).map(record => [record.connection.externalId, record]))
    const seen = new Set()
    let added = 0
    let updated = 0

    for (const item of incoming) {
      seen.add(item.externalId)
      const current = byExternalId.get(item.externalId)
      const connection = { providerId, externalId: item.externalId, lastSyncedAt: at, remoteUpdatedAt: item.remoteUpdatedAt || at, missingSince: '' }
      if (current) {
        Object.assign(current, item.values, { connection, updatedAt: at })
        updated += 1
      } else {
        existing.push({ id: crypto.randomUUID(), ...item.values, connection, createdAt: at, updatedAt: at })
        added += 1
      }
    }

    let missing = 0
    for (const [externalId, record] of byExternalId) {
      if (seen.has(externalId) || record.connection.missingSince) continue
      record.connection = { ...record.connection, missingSince: at }
      missing += 1
    }

    data[entityId] = existing
    counts[entityId] = { added, updated, missing }
  }

  await writeData(workspaceId, data)
  return counts
}

/**
 * What every model-backed request pays before it is allowed to cost anything.
 *
 * One caller is slowed by the window; the whole deployment is capped by the daily budget. Returning a
 * value here means the request is refused, and the message says which limit was hit so the operator
 * can tell "too fast" apart from "out of budget for today".
 */
function modelToll(request) {
  const window = rateLimit(`model:${callerOf(request)}`, { max: Number(process.env.BO_MODEL_RATE_LIMIT || 20), windowMs: 60_000 })
  if (!window.ok) return { status: 429, error: `Too many requests. Try again in ${window.retryAfterSeconds} seconds.` }
  const budget = spendModelCall()
  if (!budget.ok) return { status: 429, error: `BO has reached its model budget for today (${budget.limit} requests). It resets at midnight UTC.` }
  return null
}

/** Industries this workspace has already been counted towards, kept in the workspace's own folder. */
async function countedIndustries(workspaceId) {
  try { return JSON.parse(await readFile(path.join(projectPaths(workspaceId).root, 'industry.json'), 'utf8')).counted ?? [] }
  catch { return [] }
}

async function markIndustryCounted(workspaceId, subsector, already) {
  const root = projectPaths(workspaceId).root
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'industry.json'), `${JSON.stringify({ counted: [...already, subsector] }, null, 2)}
`, 'utf8')
}

async function audit(workspaceId, event, request, detail = {}) {
  const root = projectPaths(workspaceId).root
  await mkdir(root, { recursive: true })
  const record = { id: crypto.randomUUID(), workspaceId, event, role: String(request.headers['x-bo-role'] ?? 'system'), at: new Date().toISOString(), detail }
  await appendFile(path.join(root, 'audit.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
}

async function readAudit(workspaceId) {
  try {
    const lines = (await readFile(path.join(projectPaths(workspaceId).root, 'audit.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean)
    return lines.slice(-100).reverse().map(line => JSON.parse(line))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function emptyAutomationWorkspace() { return { connectors: [], automations: [], runs: [] } }
function automationFile(workspaceId) { return path.join(projectPaths(workspaceId).root, 'automations.json') }
async function readAutomationWorkspace(workspaceId) {
  try { return JSON.parse(await readFile(automationFile(workspaceId), 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return emptyAutomationWorkspace()
    throw error
  }
}
async function writeAutomationWorkspace(workspaceId, value) {
  const file = automationFile(workspaceId)
  await mkdir(path.dirname(file), { recursive: true })
  const candidate = `${file}.${crypto.randomUUID()}.next`
  await writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(candidate, file)
}
function safeWebhookUrl(value) {
  let url
  try { url = new URL(String(value ?? '')) } catch { throw Object.assign(new Error('Enter a valid HTTPS webhook URL.'), { status: 400 }) }
  if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('Webhook connectors require a credential-free HTTPS URL.'), { status: 400 })
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local') || /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) throw Object.assign(new Error('Private-network webhook targets are not allowed.'), { status: 400 })
  return url.toString()
}
function publicAutomationWorkspace(value) {
  return { connectors: value.connectors.map(({ endpointUrl, ...connector }) => connector), automations: value.automations, runs: value.runs.slice(-100).reverse() }
}
async function executeManagedAutomation(workspaceId, automation, event, entityId, record, dryRun = false) {
  const state = await readAutomationWorkspace(workspaceId)
  const connector = state.connectors.find(item => item.id === automation.action.connectorId)
  const startedAt = new Date().toISOString()
  const run = { id: crypto.randomUUID(), automationId: automation.id, automationName: automation.name, status: dryRun ? 'simulated' : 'success', event, entityId, recordId: String(record?.id ?? ''), startedAt, finishedAt: startedAt }
  if (!connector) { run.status = 'failed'; run.error = 'Connector not found.' }
  else if (!dryRun) {
    try {
      const response = await fetch(connector.endpointUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BO-Automation/1.0' }, body: JSON.stringify({ source: 'BO', workspaceId, automation: { id: automation.id, name: automation.name }, event: { type: event, entityId, occurredAt: startedAt }, record }), signal: AbortSignal.timeout(12_000) })
      run.responseStatus = response.status
      if (!response.ok) { run.status = 'failed'; run.error = `Webhook returned ${response.status}.` }
    } catch (error) { run.status = 'failed'; run.error = error instanceof Error ? error.message : 'Webhook delivery failed.' }
  }
  run.finishedAt = new Date().toISOString()
  const latest = await readAutomationWorkspace(workspaceId)
  await writeAutomationWorkspace(workspaceId, { ...latest, runs: [...latest.runs.slice(-199), run] })
  return run
}
async function triggerManagedAutomations(workspaceId, event, entityId, record) {
  const state = await readAutomationWorkspace(workspaceId)
  const matching = state.automations.filter(item => item.enabled && item.trigger.event === event && item.trigger.entityId === entityId)
  await Promise.allSettled(matching.map(item => executeManagedAutomation(workspaceId, item, event, entityId, record)))
}

function discoveryFile(workspaceId) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(workspaceId)) throw Object.assign(new Error('Invalid workspace id.'), { status: 400 })
  return path.join(discoveryRoot, `${workspaceId}.json`)
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
  await mkdir(discoveryRoot, { recursive: true })
  const file = discoveryFile(workspaceId)
  const candidate = `${file}.${crypto.randomUUID()}.next`
  await writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(candidate, file)
}

function validateRecord(entity, input, partial = false) {
  const allowed = new Set(entity.fields.map(field => field.id))
  const output = {}
  for (const [key, value] of Object.entries(input ?? {})) if (allowed.has(key)) output[key] = value
  if (!partial) for (const field of entity.fields.filter(field => field.required)) if (output[field.id] === undefined || output[field.id] === '') throw Object.assign(new Error(`${field.label} is required.`), { status: 400 })
  return output
}

function validateRelations(entity, values, data) {
  for (const field of entity.fields.filter(field => field.type === 'relation' && field.relationEntityId)) {
    const value = values[field.id]
    if (value && !(data[field.relationEntityId] ?? []).some(record => record.id === value)) throw Object.assign(new Error(`${field.label} must reference an existing record.`), { status: 400 })
  }
}

function triggerWorkflows(manifest, data, entityId, event, record) {
  const notifications = data._notifications ?? []
  for (const workflow of manifest.workflows ?? []) {
    const trigger = workflow.trigger
    if (!workflow.enabled || trigger.entityId !== entityId || trigger.event !== event) continue
    if (trigger.field && String(record[trigger.field] ?? '') !== String(trigger.equals ?? '')) continue
    if (workflow.action.type === 'notify') notifications.push({ id: crypto.randomUUID(), message: workflow.action.message, entityId, recordId: record.id, createdAt: new Date().toISOString(), read: false })
  }
  return { ...data, _notifications: notifications }
}

async function api(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { status: 'healthy', accounts: databaseAvailable() })
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'api') return false

  /**
   * Accounts: /api/auth/...
   *
   * Sign-up and sign-in are rate limited by caller, because a login form is the one endpoint an
   * attacker is happy to call ten thousand times. The session token is returned once, here, and never
   * again — the server keeps only its hash.
   */
  if (segments[1] === 'auth') {
    if (!databaseAvailable()) return send(response, 503, { error: 'BO has no database configured, so it has no accounts yet. Set DATABASE_URL to your Supabase connection string.' })

    if (request.method === 'GET' && segments[2] === 'me') {
      const user = await sessionUser(bearer(request))
      if (!user) return send(response, 401, { error: 'Not signed in.' })
      return send(response, 200, { user, workspaces: await workspacesFor(user.id) })
    }

    if (request.method === 'POST' && (segments[2] === 'register' || segments[2] === 'login')) {
      const window = rateLimit(`auth:${callerOf(request)}`, { max: Number(process.env.BO_AUTH_RATE_LIMIT || 10), windowMs: 60_000 })
      if (!window.ok) return send(response, 429, { error: `Too many attempts. Try again in ${window.retryAfterSeconds} seconds.` })
      const input = await body(request)
      const user = segments[2] === 'register'
        ? await registerUser(input.email, input.password)
        : await authenticate(input.email, input.password)
      const session = await createSession(user.id)
      return send(response, 200, { user, token: session.token, expiresAt: session.expiresAt })
    }

    /**
     * Forgotten passwords: /api/auth/forgot, then /api/auth/reset.
     *
     * `forgot` answers the same thing whether or not the address has an account, and takes no shortcut
     * when it does not: an endpoint that responds differently for a known address is how a list of
     * BO's customers gets built. The link is mailed and never returned here, so asking is not a way to
     * be handed someone else's account.
     */
    if (request.method === 'POST' && segments[2] === 'forgot') {
      // Tighter than sign-in: this one sends mail, so an unthrottled caller can also use BO to spray
      // messages at addresses that never asked for them.
      const window = rateLimit(`forgot:${callerOf(request)}`, { max: Number(process.env.BO_RESET_RATE_LIMIT || 5), windowMs: 60_000 })
      if (!window.ok) return send(response, 429, { error: `Too many attempts. Try again in ${window.retryAfterSeconds} seconds.` })
      const input = await body(request)
      const issued = await beginPasswordReset(input.email)
      if (issued) {
        const link = `${originOf(request)}/reset?token=${encodeURIComponent(issued.token)}`
        // A provider that is down must not become a way to learn that the address exists, so the
        // failure is logged for the operator and answered generically like everything else here.
        // Reported, not just logged: a mail provider that is refusing messages means nobody can get
        // back into their account, and it is invisible from the outside — every caller still gets the
        // same cheerful "a reset link is on its way".
        try { await sendPasswordReset(issued.user.email, link) } catch (error) { void captureError(error, { requestId: String(response.getHeader('x-bo-request-id') ?? ''), path: '/api/auth/forgot', failed: 'password-reset-email' }) }
      }
      return send(response, 200, { sent: true, message: 'If that email has an account, a reset link is on its way.' })
    }

    if (request.method === 'POST' && segments[2] === 'reset') {
      const window = rateLimit(`reset:${callerOf(request)}`, { max: Number(process.env.BO_RESET_RATE_LIMIT || 5), windowMs: 60_000 })
      if (!window.ok) return send(response, 429, { error: `Too many attempts. Try again in ${window.retryAfterSeconds} seconds.` })
      const input = await body(request)
      const user = await completePasswordReset(input.token, input.password)
      // Signed in on the spot. The reset already proved they hold the address, and the alternative is
      // a sign-in form asking for the password they typed ten seconds ago.
      const session = await createSession(user.id)
      return send(response, 200, { user, token: session.token, expiresAt: session.expiresAt })
    }

    if (request.method === 'POST' && segments[2] === 'logout') {
      await destroySession(bearer(request))
      return send(response, 200, { signedOut: true })
    }

    if (request.method === 'POST' && segments[2] === 'logout-everywhere') {
      const user = await sessionUser(bearer(request))
      if (!user) return send(response, 401, { error: 'Not signed in.' })
      await destroyAllSessions(user.id)
      return send(response, 200, { signedOut: true })
    }

    return send(response, 405, { error: 'Method not allowed.' })
  }

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
  if (segments[1] === 'industries') {
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

  if (request.method === 'GET' && segments[1] === 'research' && segments[2] === 'status') {
    return send(response, 200, { available: reasoningAvailable(), model: process.env.BO_REASONING_MODEL || 'claude-opus-5' })
  }

  if (request.method === 'POST' && segments[1] === 'research' && segments.length === 2) {
    const toll = modelToll(request)
    if (toll) return send(response, toll.status, { error: toll.error }, 'application/json; charset=utf-8')
    const input = await body(request)
    await tenant(request, String(input.workspaceId ?? ''))
    const description = String(input.description ?? '').trim().slice(0, 4000)
    if (!description) return send(response, 400, { error: 'A company description is required.' })
    const capabilityIds = Array.isArray(input.capabilityIds) ? input.capabilityIds.filter(id => typeof id === 'string' && /^[a-z][a-z0-9.-]{1,60}$/.test(id)).slice(0, 200) : []
    const conversation = Array.isArray(input.conversation)
      ? input.conversation.filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-20).map(item => ({ role: item.role, content: item.content.slice(0, 2000) }))
      : []
    const research = await researchCompany({ description, conversation, catalog: String(input.catalog ?? '').slice(0, 20000), capabilityIds })
    await audit(String(input.workspaceId), 'research.completed', request, { model: research.model, findings: research.findings.length, sources: research.sources.length })
    // One company pays for the research; every later company in the same industry inherits it.
    if (/^\d{3}$/.test(String(input.subsector ?? ''))) {
      await saveResearch(input.subsector, { ...research, label: String(input.industryLabel ?? '') }).catch(() => undefined)
    }
    return send(response, 200, research)
  }

  /**
   * One turn of the interview.
   *
   * No workspace token: the operator has not got a workspace yet — this call is what produces one.
   * The catalog and module list come from the client because they are the client's own definitions;
   * a second copy kept here would drift and start rejecting capabilities that exist.
   */
  if (request.method === 'POST' && segments[1] === 'discovery' && segments[2] === 'turn') {
    const toll = modelToll(request)
    if (toll) return send(response, toll.status, { error: toll.error }, 'application/json; charset=utf-8')
    const input = await body(request)
    const mode = ['DISCOVER', 'ARCHITECT', 'REVIEW_ARCHITECTURE'].includes(input.mode) ? input.mode : 'DISCOVER'
    const capabilityIds = Array.isArray(input.capabilityIds) ? input.capabilityIds.filter(id => typeof id === 'string' && /^[a-z][a-z0-9.-]{1,60}$/.test(id)).slice(0, 400) : []
    const modules = Array.isArray(input.modules) ? input.modules.filter(id => typeof id === 'string' && /^[a-z][a-z-]{1,40}$/.test(id)).slice(0, 60) : []
    const conversation = Array.isArray(input.conversation)
      ? input.conversation.filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-24).map(item => ({ role: item.role, content: item.content.slice(0, 2000) }))
      : []
    const turn = await runDiscoveryTurn({
      mode, conversation, modules, capabilityIds,
      businessState: input.businessState && typeof input.businessState === 'object' ? input.businessState : null,
      catalog: String(input.catalog ?? '').slice(0, 20000),
      forceArchitecture: input.forceArchitecture === true,
      industry: String(input.industry ?? '').slice(0, 120),
    })
    return send(response, 200, turn)
  }

  /**
   * Connected apps: /api/connections/:workspaceId[/:providerId[/sync]]
   *
   * Read-only for now, and the read direction is the safe one. Nothing here ever returns a stored
   * credential, and a sync never deletes a record the operator created in BO — records that came from
   * the other system are updated in place and matched on the id that system gave them.
   */
  if (segments[1] === 'connections' && segments[2]) {
    const workspaceId = segments[2]
    await tenant(request, workspaceId)
    const providerId = segments[3]

    if (request.method === 'GET' && !providerId) return send(response, 200, await listConnections(workspaceId))

    if (providerId && providerId !== 'stripe') return send(response, 404, { error: 'BO has no connector for that app yet.' })

    if (request.method === 'POST' && providerId === 'stripe' && !segments[4]) {
      const input = await body(request)
      const credential = checkStripeKey(input.apiKey)
      const account = await verifyStripe(credential)
      const saved = await saveConnection(workspaceId, 'stripe', { credential, mode: 'read', account: account.livemode ? 'Live' : 'Test' })
      await audit(workspaceId, 'connection.created', request, { providerId: 'stripe', mode: 'read' })
      return send(response, 200, saved)
    }

    if (request.method === 'POST' && providerId === 'stripe' && segments[4] === 'sync') {
      const credential = await credentialFor(workspaceId, 'stripe')
      try {
        const pulled = await pullStripe(credential)
        const counts = await mergeConnectedRecords(workspaceId, 'stripe', pulled)
        const connection = await recordSync(workspaceId, 'stripe', { counts })
        await audit(workspaceId, 'connection.synced', request, { providerId: 'stripe', ...counts })
        return send(response, 200, { connection, counts })
      } catch (error) {
        await recordSync(workspaceId, 'stripe', { error: error?.message ?? 'Sync failed.' })
        throw error
      }
    }

    if (request.method === 'DELETE' && providerId === 'stripe') {
      const removed = await removeConnection(workspaceId, 'stripe')
      if (removed) await audit(workspaceId, 'connection.removed', request, { providerId: 'stripe' })
      return send(response, 200, { removed })
    }

    return send(response, 405, { error: 'Method not allowed.' })
  }

  if (segments[1] === 'discovery' && segments[2] === 'sessions' && segments[3]) {
    const workspaceId = segments[3]
    await tenant(request, workspaceId)
    if (request.method === 'GET') {
      const session = await readDiscoverySession(workspaceId)
      return send(response, 200, session)
    }
    if (request.method === 'PUT') {
      const session = await body(request)
      await writeDiscoverySession(workspaceId, session)
      return send(response, 200, session)
    }
    return send(response, 405, { error: 'Method not allowed.' })
  }

  if (request.method === 'POST' && segments[1] === 'builds') {
    const input = await body(request)
    await tenant(request, input.workspaceId)
    const existing = await currentManifest(input.workspaceId)
    if (existing?.specification?.profile?.description === input.specification?.profile?.description) return send(response, 200, existing)
    const pending = initialBuilds.get(input.workspaceId)
    if (pending) return send(response, 200, await pending)
    const build = (async () => {
      const project = await buildProject({ workspaceId: input.workspaceId, specification: input.specification, changeDescription: input.changeDescription, changeType: 'initial' })
      await audit(input.workspaceId, 'project.created', request, { version: project.version })
      return project
    })()
    initialBuilds.set(input.workspaceId, build)
    try { return send(response, 201, await build) }
    finally { initialBuilds.delete(input.workspaceId) }
  }

  if (segments[1] !== 'projects' || !segments[2]) return send(response, 404, { error: 'Not found.' })
  const workspaceId = segments[2]
  await tenant(request, workspaceId)

  if (request.method === 'GET' && segments.length === 3) {
    const manifest = await currentManifest(workspaceId)
    return manifest ? send(response, 200, manifest) : send(response, 404, { error: 'Project not built.' })
  }
  if (request.method === 'GET' && segments[3] === 'versions') return send(response, 200, await listVersions(workspaceId))
  if (request.method === 'POST' && segments[3] === 'changes') {
    const input = await body(request)
    const current = await currentManifest(workspaceId)
    if (!current) return send(response, 404, { error: 'Project not built.' })
    authorize(current, request, 'admin')
    const project = await buildProject({ workspaceId, specification: input.specification, changeDescription: input.changeDescription ?? 'Updated Command Center', changeType: input.changeType ?? 'workspace-change', promote: false })
    await audit(workspaceId, 'project.change_prepared', request, { version: project.version, changeType: input.changeType ?? 'workspace-change' })
    return send(response, 201, project)
  }
  if (request.method === 'POST' && segments[3] === 'promote') {
    const input = await body(request)
    const current = await currentManifest(workspaceId)
    if (current) authorize(current, request, 'admin')
    const project = await promoteProject(workspaceId, input.version)
    await audit(workspaceId, 'project.version_promoted', request, { version: input.version })
    return send(response, 200, project)
  }
  if (request.method === 'POST' && segments[3] === 'rollback') {
    const input = await body(request)
    const current = await currentManifest(workspaceId)
    if (current) authorize(current, request, 'admin')
    const project = await rollbackProject(workspaceId, input.version)
    await audit(workspaceId, 'project.version_rolled_back', request, { version: input.version })
    return send(response, 200, project)
  }
  if (request.method === 'GET' && segments[3] === 'runtime.mjs') {
    const file = await runtimePath(workspaceId, url.searchParams.get('version'))
    if (!file) return send(response, 404, 'Not found.', 'text/plain; charset=utf-8')
    return send(response, 200, await readFile(file, 'utf8'), 'text/javascript; charset=utf-8')
  }

  const manifest = await currentManifest(workspaceId)
  if (!manifest) return send(response, 404, { error: 'Project not built.' })

  if (request.method === 'GET' && segments[3] === 'audit') {
    authorize(manifest, request, 'admin')
    return send(response, 200, await readAudit(workspaceId))
  }

  if (segments[3] === 'connectors' && request.method === 'POST' && segments.length === 4) {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    if (!['make-webhook', 'generic-webhook'].includes(input.type) || !String(input.name ?? '').trim()) return send(response, 400, { error: 'Connector name and supported type are required.' })
    const endpointUrl = safeWebhookUrl(input.endpointUrl)
    const state = await readAutomationWorkspace(workspaceId)
    const connector = { id: crypto.randomUUID(), name: String(input.name).trim().slice(0, 100), type: input.type, endpointUrl, endpointHost: new URL(endpointUrl).hostname, status: 'connected', createdAt: new Date().toISOString() }
    await writeAutomationWorkspace(workspaceId, { ...state, connectors: [...state.connectors, connector] })
    await audit(workspaceId, 'connector.created', request, { connectorId: connector.id, type: connector.type })
    const { endpointUrl: hidden, ...safe } = connector
    return send(response, 201, safe)
  }

  if (segments[3] === 'automations') {
    if (request.method === 'GET' && segments.length === 4) {
      authorize(manifest, request, 'view')
      return send(response, 200, publicAutomationWorkspace(await readAutomationWorkspace(workspaceId)))
    }
    if (request.method === 'POST' && segments.length === 4) {
      authorize(manifest, request, 'admin')
      const input = await body(request)
      const state = await readAutomationWorkspace(workspaceId)
      if (!manifest.entities.some(item => item.id === input.entityId) || !['created', 'updated'].includes(input.event) || !state.connectors.some(item => item.id === input.connectorId)) return send(response, 400, { error: 'Choose a valid record type, trigger, and connector.' })
      const now = new Date().toISOString()
      const automation = { id: crypto.randomUUID(), name: String(input.name ?? '').trim().slice(0, 120) || `${input.entityId} ${input.event}`, enabled: false, trigger: { entityId: input.entityId, event: input.event }, action: { type: 'webhook', connectorId: input.connectorId }, createdAt: now, updatedAt: now }
      await writeAutomationWorkspace(workspaceId, { ...state, automations: [...state.automations, automation] })
      await audit(workspaceId, 'automation.created', request, { automationId: automation.id })
      return send(response, 201, automation)
    }
    const automationId = segments[4]
    const state = await readAutomationWorkspace(workspaceId)
    const automation = state.automations.find(item => item.id === automationId)
    if (!automation) return send(response, 404, { error: 'Automation not found.' })
    if (request.method === 'PATCH' && segments.length === 5) {
      authorize(manifest, request, 'admin')
      const input = await body(request)
      const updated = { ...automation, enabled: Boolean(input.enabled), updatedAt: new Date().toISOString() }
      await writeAutomationWorkspace(workspaceId, { ...state, automations: state.automations.map(item => item.id === updated.id ? updated : item) })
      await audit(workspaceId, updated.enabled ? 'automation.enabled' : 'automation.disabled', request, { automationId: updated.id })
      return send(response, 200, updated)
    }
    if (request.method === 'POST' && segments[5] === 'test') {
      authorize(manifest, request, 'admin')
      const input = await body(request)
      const record = { id: 'test-record', test: true, message: 'BO automation test' }
      const run = await executeManagedAutomation(workspaceId, automation, 'test', automation.trigger.entityId, record, input.dryRun !== false)
      await audit(workspaceId, 'automation.tested', request, { automationId: automation.id, status: run.status })
      return send(response, 200, run)
    }
  }

  if (segments[3] === 'notifications') {
    const data = await readData(workspaceId)
    const notifications = data._notifications ?? []
    if (request.method === 'GET' && segments.length === 4) {
      authorize(manifest, request, 'view')
      return send(response, 200, notifications.slice().reverse())
    }
    if (request.method === 'PATCH' && segments[4]) {
      authorize(manifest, request, 'edit')
      const input = await body(request)
      const notification = notifications.find(item => item.id === segments[4])
      if (!notification) return send(response, 404, { error: 'Notification not found.' })
      const updated = { ...notification, read: Boolean(input.read) }
      await writeData(workspaceId, { ...data, _notifications: notifications.map(item => item.id === updated.id ? updated : item) })
      await audit(workspaceId, 'notification.updated', request, { notificationId: updated.id, read: updated.read })
      return send(response, 200, updated)
    }
  }

  if (segments[3] === 'records' && segments[4]) {
    const entityId = segments[4]
    const entity = manifest.entities.find(item => item.id === entityId)
    if (!entity) return send(response, 404, { error: 'Entity not found.' })
    const data = await readData(workspaceId)
    const collection = data[entityId] ?? []
    if (request.method === 'GET' && segments.length === 5) {
      authorize(manifest, request, 'view')
      let result = collection
      const filterField = url.searchParams.get('filterField')
      const filterValue = url.searchParams.get('filterValue')
      if (filterField && filterValue !== null) result = result.filter(record => String(record[filterField] ?? '') === filterValue)
      const sort = url.searchParams.get('sort')
      if (sort) result = result.slice().sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')))
      return send(response, 200, result)
    }
    if (request.method === 'POST' && segments.length === 5) {
      authorize(manifest, request, 'create')
      const values = validateRecord(entity, await body(request))
      validateRelations(entity, values, data)
      const now = new Date().toISOString()
      const record = { id: crypto.randomUUID(), workspaceId, ...values, createdAt: now, updatedAt: now }
      let next = { ...data, [entityId]: [...collection, record] }
      next = triggerWorkflows(manifest, next, entityId, 'created', record)
      await writeData(workspaceId, next)
      await audit(workspaceId, 'record.created', request, { entityId, recordId: record.id })
      await triggerManagedAutomations(workspaceId, 'created', entityId, record)
      return send(response, 201, record)
    }
    const recordId = segments[5]
    const current = collection.find(record => record.id === recordId)
    if (!current) return send(response, 404, { error: 'Record not found.' })
    if (request.method === 'PATCH') {
      authorize(manifest, request, 'edit')
      const values = validateRecord(entity, await body(request), true)
      validateRelations(entity, values, data)
      const record = { ...current, ...values, workspaceId, updatedAt: new Date().toISOString() }
      let next = { ...data, [entityId]: collection.map(item => item.id === recordId ? record : item) }
      next = triggerWorkflows(manifest, next, entityId, 'updated', record)
      await writeData(workspaceId, next)
      await audit(workspaceId, 'record.updated', request, { entityId, recordId })
      await triggerManagedAutomations(workspaceId, 'updated', entityId, record)
      return send(response, 200, record)
    }
    if (request.method === 'DELETE') {
      authorize(manifest, request, 'delete')
      await writeData(workspaceId, { ...data, [entityId]: collection.filter(record => record.id !== recordId) })
      await audit(workspaceId, 'record.deleted', request, { entityId, recordId })
      return send(response, 200, { deleted: true })
    }
  }

  if (request.method === 'GET' && segments[3] === 'records') {
    authorize(manifest, request, 'view')
    const data = await readData(workspaceId)
    return send(response, 200, Object.fromEntries(manifest.entities.map(entity => [entity.id, data[entity.id] ?? []])))
  }

  if (request.method === 'POST' && segments[3] === 'query') {
    authorize(manifest, request, 'view')
    const input = await body(request)
    const data = await readData(workspaceId)
    if (input.query === 'most-expensive-project') {
      const costs = new Map()
      for (const record of data['project-costs'] ?? []) costs.set(record.project, (costs.get(record.project) ?? 0) + Number(record.amount ?? 0))
      const winner = [...costs.entries()].sort((a, b) => b[1] - a[1])[0]
      const project = (data.projects ?? []).find(item => item.id === winner?.[0])
      return send(response, 200, winner ? { project, cost: winner[1] } : { project: null, cost: 0 })
    }
    return send(response, 400, { error: 'Unknown business query.' })
  }

  return send(response, 404, { error: 'Not found.' })
}

async function staticFile(response, url) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
  const candidate = path.resolve(distRoot, relative)
  if (!candidate.startsWith(distRoot)) return send(response, 403, 'Forbidden', 'text/plain; charset=utf-8')
  try {
    const info = await stat(candidate)
    if (!info.isFile()) throw new Error('Not a file')
    const ext = path.extname(candidate)
    const type = ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream'
    return send(response, 200, await readFile(candidate), type)
  } catch {
    try { return send(response, 200, await readFile(path.join(distRoot, 'index.html')), 'text/html; charset=utf-8') } catch { return send(response, 404, 'BO frontend is not built.', 'text/plain; charset=utf-8') }
  }
}

export const server = createServer(async (request, response) => {
  const requestId = newRequestId()
  const startedAt = Date.now()
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  // Sent back on every response so a customer reporting a problem can quote something that finds the
  // exact request in the log, rather than describing what they were doing at the time.
  response.setHeader('x-bo-request-id', requestId)

  try {
    if (await api(request, response, url) === false) await staticFile(response, url)
  } catch (error) {
    const status = Number(error?.status) || 500
    // A 4xx is BO telling the caller they got it wrong, which is the endpoint working. Reporting those
    // would bury the failures that are BO's fault under the ones that are not.
    // Not awaited. The caller is owed an answer about their request, not a wait on a third party that
    // has nothing to do with it — and the monitor being slow or unreachable is precisely the case.
    // captureError never rejects, so nothing here needs catching.
    if (status >= 500) {
      void captureError(error, { requestId, method: request.method, path: url.pathname, status, workspaceId: String(request.headers['x-bo-workspace-id'] ?? '') || undefined })
    }
    send(response, status, {
      error: status === 500 ? 'BO could not complete the operation.' : error.message,
      // The reference is not the error: it says nothing about what broke, and is only useful to
      // someone holding the log. That is exactly what makes it safe to show.
      reference: status >= 500 ? requestId : undefined,
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  } finally {
    if (!isNoisyPath(url.pathname)) {
      logRequest({ requestId, method: request.method, path: url.pathname, status: response.statusCode, ms: Date.now() - startedAt, workspaceId: String(request.headers['x-bo-workspace-id'] ?? '') || undefined })
    }
  }
})

/**
 * Static assets are not worth a line each.
 *
 * A single page load fetches the bundle, the stylesheet and every icon; logging those buries the
 * handful of API calls that say what the person was actually doing.
 */
function isNoisyPath(pathname) {
  return pathname.startsWith('/assets/') || /\.(js|css|map|png|svg|ico|woff2?)$/.test(pathname)
}

/**
 * Only start listening when this file is what was run.
 *
 * Imported instead, it hands over the server without opening a port or touching a database, which is
 * what lets the account rules be tested against the real routes rather than against a copy of them.
 */
const startedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

/**
 * Schema first, then requests.
 *
 * A migration that fails is not something to serve around: the alternative is answering requests
 * against a half-built schema and writing data that will not fit it. Without a database configured
 * there is nothing to migrate and BO starts as it always did.
 */
if (startedDirectly) {
  // Only when BO is the process. Imported by a test, it must not install handlers that call
  // process.exit on the test runner.
  watchProcess()
  if (databaseAvailable()) {
    try {
      const ran = await migrate()
      if (ran.length) console.log(`BO applied ${ran.length} migration${ran.length === 1 ? '' : 's'}: ${ran.join(', ')}`)
    } catch (error) {
      // Reported before exiting: a deployment that dies on boot restarts in a loop, and the log of the
      // container that failed is the first thing a platform throws away.
      await captureError(error, { fatal: true, failed: 'migration' })
      console.error('BO could not prepare its database:', error?.message ?? error)
      process.exit(1)
    }
  }
  // Said at start rather than left to be discovered from a customer who never got their reset link.
  if (databaseAvailable() && !mailAvailable()) console.warn('BO has no mail provider configured (RESEND_API_KEY and BO_MAIL_FROM), so password reset links will be written to this log instead of being sent.')
  if (!monitoringAvailable()) console.warn('BO has no error monitoring configured (SENTRY_DSN), so failures are only written to this log. Nothing will tell you when BO breaks.')
  server.listen(port, host, () => console.log(`BO project service listening on ${host}:${port}${databaseAvailable() ? ' with accounts' : ' without accounts (no DATABASE_URL)'}`))
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
