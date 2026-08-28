// First: configuration has to be in place before any module decides what Wesify can do.
import './env.mjs'
import { createServer } from 'node:http'
import { corsHeaders, handlePreflight } from './cors.mjs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { billingAvailable } from './billing.mjs'
import { databaseAvailable, migrate, queryOne } from './db.mjs'
import { durabilityWarnings } from './durability.mjs'
import { send } from './http.mjs'
import { clerkConfigured } from './clerk.mjs'
import { captureError, logRequest, monitoringAvailable, newRequestId, watchProcess } from './observability.mjs'
import { agentRoutes } from './routes/agent.mjs'
import { authRoutes } from './routes/auth.mjs'
import { billingRoutes } from './routes/billing.mjs'
import { connectionRoutes } from './routes/connections.mjs'
import { discoveryRoutes, researchRoutes } from './routes/discovery.mjs'
import { interviewAvailable } from './discoveryAgent.mjs'
import { reasoningAvailable } from './reasoning.mjs'
import { industryRoutes } from './routes/industries.mjs'
import { buildRoutes, projectRoutes } from './routes/projects.mjs'
import { automationRoutes } from './routes/automationRoutes.mjs'
import { startAutomationScheduler } from './automationScheduler.mjs'
import { workspaceSetupRoutes } from './routes/workspaceSetup.mjs'

/**
 * Wesify's server: what listens, and in what order it asks.
 *
 * This file used to be the whole server — every route, every helper, nine hundred lines of it. It is
 * now only the arrangement: which module gets asked about a request, what happens when one throws,
 * and what is true before the first request is served. Each module below answers `false` for a path
 * that is not its own, so the list reads as the routing table it is.
 */

const requestedPort = Number(process.argv[process.argv.indexOf('--port') + 1])
// `PORT` is what every container host injects, and it is not Wesify's to choose there; `BO_API_PORT` stays
// ahead of it so a local `.env.local` still wins over whatever a shell happens to export.
const port = Number.isFinite(requestedPort) ? requestedPort : Number(process.env.BO_API_PORT || process.env.PORT || 8787)
// Loopback by default, so running Wesify on a laptop does not quietly publish it to the local network.
// A container has to bind every interface or nothing outside it can reach the port at all.
const host = process.env.BO_HOST || '127.0.0.1'
const distRoot = path.resolve(process.cwd(), 'dist')

// One second. The home page polls this every two, and a sign-up should appear on it as it happens
// rather than after a wait nobody can explain. Still a cache, and that is what it is for: a hundred
// visitors polling together cost one count, not a hundred.
const USER_COUNT_TTL_MS = 1_000
let userCountCache = { at: 0, users: 0 }

/** Signed-up accounts, at most once a minute. `0` where there is no database to hold any. */
async function userCount() {
  if (!databaseAvailable()) return 0
  if (Date.now() - userCountCache.at < USER_COUNT_TTL_MS) return userCountCache.users
  try {
    const row = await queryOne('select count(*)::int as users from users')
    userCountCache = { at: Date.now(), users: Number(row?.users ?? 0) }
  } catch {
    // A count is not worth failing a page load over: the last known figure stands, and a first
    // failure leaves the zero this started at.
    userCountCache = { at: Date.now(), users: userCountCache.users }
  }
  return userCountCache.users
}

/** Asked in order. The first that does not return `false` has answered the request. */
const routes = [authRoutes, industryRoutes, billingRoutes, researchRoutes, discoveryRoutes, agentRoutes, connectionRoutes, buildRoutes, automationRoutes, workspaceSetupRoutes, projectRoutes]

async function api(request, response, url) {
  /**
   * Health, and what this deployment was actually given.
   *
   * `accounts` alone could not answer the question people actually have when a deployment misbehaves:
   * is the platform passing my configuration at all, or is one variable missing? Those need opposite
   * fixes, and telling them apart otherwise means adding a log line and redeploying to read it.
   *
   * Presence, never values — booleans computed from the same helpers the features use, so this cannot
   * claim something works that does not. It says no more than the product already reveals by
   * behaving: `/api/research/status` names the interview model, sign-in shows whether accounts exist,
   * and a checkout button appears only when billing is configured.
   */
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return send(response, 200, {
      status: 'healthy',
      // Both halves, because either one missing means nobody can sign in: the database is where a
      // workspace's owner is written, and Clerk is what says who the owner is.
      accounts: databaseAvailable() && clerkConfigured(),
      configured: {
        database: databaseAvailable(),
        signIn: clerkConfigured(),
        interview: interviewAvailable(),
        research: reasoningAvailable(),
        billing: billingAvailable(),
        monitoring: monitoringAvailable(),
        connections: Boolean(process.env.BO_CONNECTION_SECRET),
      },
      // Empty on a laptop, in a container with a volume, and anywhere with a database. Present only
      // where Wesify would otherwise lose work silently — see durability.mjs.
      warnings: durabilityWarnings(),
    })
  }
  /**
   * How many people have signed up, for the public home page.
   *
   * Public and unauthenticated on purpose: it is a single number on a page anybody can load, and it
   * names nobody. Counted from `users`, which holds one row per Clerk account the server has ever
   * seen, so it is the real figure rather than a stored tally that drifts.
   *
   * Cached for a minute because the home page is the most-loaded route Wesify has and this would
   * otherwise be a database round trip per visit. Without a database there are no accounts at all,
   * which is `0` rather than an error — the prototype path still renders the page.
   */
  if (request.method === 'GET' && url.pathname === '/api/stats/users') {
    return send(response, 200, { users: await userCount() })
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'api') return false

  for (const route of routes) {
    if (await route(request, response, segments, url) !== false) return
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
    // Any unknown path is the single-page app's to route, which is why this is not a 404.
    try { return send(response, 200, await readFile(path.join(distRoot, 'index.html')), 'text/html; charset=utf-8') }
    catch { return send(response, 404, 'Wesify frontend is not built.', 'text/plain; charset=utf-8') }
  }
}

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
 * One request, handled — whatever is holding the socket.
 *
 * Extracted from the server so a serverless platform can call it directly. Vercel hands a function
 * the same pair Node's http server does, so the routing, the CORS headers, the error shaping and the
 * request log all belong here rather than inside a listener that only exists on a long-running host.
 * The alternative is a second copy of this on the serverless path, and the copy that drifts is the
 * one that stops shaping errors the way the interface expects.
 */
for (const warning of durabilityWarnings()) console.warn(`Wesify: ${warning.message}`)

export async function handleRequest(request, response) {
  const requestId = newRequestId()
  const startedAt = Date.now()
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  // Sent back on every response so a customer reporting a problem can quote something that finds the
  // exact request in the log, rather than describing what they were doing at the time.
  response.setHeader('x-bo-request-id', requestId)

  /**
   * Set before anything is written, because a header cannot be added to a response already sent.
   *
   * Applied to every answer including failures: a browser that cannot read a 401 or a 500 reports it
   * as an opaque network error, which hides the one thing the operator needed to be told.
   */
  for (const [header, value] of Object.entries(corsHeaders(request))) response.setHeader(header, value)
  if (handlePreflight(request, response)) return

  try {
    if (await api(request, response, url) === false) await staticFile(response, url)
  } catch (error) {
    const status = Number(error?.status) || 500
    // A 4xx is Wesify telling the caller they got it wrong, which is the endpoint working. Reporting those
    // would bury the failures that are Wesify's fault under the ones that are not.
    //
    // Not awaited. The caller is owed an answer about their request, not a wait on a third party that
    // has nothing to do with it — and the monitor being slow or unreachable is precisely the case.
    // captureError never rejects, so nothing here needs catching.
    if (status >= 500) {
      void captureError(error, { requestId, method: request.method, path: url.pathname, status, workspaceId: String(request.headers['x-bo-workspace-id'] ?? '') || undefined })
    }
    send(response, status, {
      error: status === 500 ? 'Wesify could not complete the operation.' : error.message,
      // The reference is not the error: it says nothing about what broke, and is only useful to
      // someone holding the log. That is exactly what makes it safe to show.
      reference: status >= 500 ? requestId : undefined,
      // Refusals from a plan limit carry the plan that would allow it, so the interface can offer
      // the upgrade instead of a wall.
      upgradeTo: error?.upgradeTo,
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  } finally {
    if (!isNoisyPath(url.pathname)) {
      logRequest({ requestId, method: request.method, path: url.pathname, status: response.statusCode, ms: Date.now() - startedAt, workspaceId: String(request.headers['x-bo-workspace-id'] ?? '') || undefined })
    }
  }
}

export const server = createServer(handleRequest)

/**
 * Only start listening when this file is what was run.
 *
 * Imported instead, it hands over the server without opening a port or touching a database, which is
 * what lets the account rules be tested against the real routes rather than against a copy of them.
 */
const startedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
let stopAutomationScheduler = () => {}

/**
 * Schema first, then requests.
 *
 * A migration that fails is not something to serve around: the alternative is answering requests
 * against a half-built schema and writing data that will not fit it. Without a database configured
 * there is nothing to migrate and Wesify starts as it always did.
 */
if (startedDirectly) {
  // Only when Wesify is the process. Imported by a test, it must not install handlers that call
  // process.exit on the test runner.
  watchProcess()
  if (databaseAvailable()) {
    try {
      const ran = await migrate()
      if (ran.length) console.log(`Wesify applied ${ran.length} migration${ran.length === 1 ? '' : 's'}: ${ran.join(', ')}`)
    } catch (error) {
      // Reported before exiting: a deployment that dies on boot restarts in a loop, and the log of the
      // container that failed is the first thing a platform throws away.
      await captureError(error, { fatal: true, failed: 'migration' })
      console.error('Wesify could not prepare its database:', error?.message ?? error)
      process.exit(1)
    }
  }
  // Said at start rather than left to be discovered by the first person who tries to sign in.
  if (databaseAvailable() && !clerkConfigured()) console.warn('Wesify has a database but no sign-in configured (CLERK_SECRET_KEY), so nobody can sign in and no workspace can belong to anybody.')
  if (!monitoringAvailable()) console.warn('Wesify has no error monitoring configured (SENTRY_DSN), so failures are only written to this log. Nothing will tell you when Wesify breaks.')
  if (databaseAvailable() && !billingAvailable()) console.warn('Wesify has no billing configured (STRIPE_SECRET_KEY and BO_STRIPE_PRICE_PRO), so every account stays on the free plan and nobody can pay.')
  if (process.env.BO_AUTOMATION_SCHEDULER !== 'off') stopAutomationScheduler = startAutomationScheduler()
  server.listen(port, host, () => console.log(`Wesify project service listening on ${host}:${port}${databaseAvailable() && clerkConfigured() ? ' with accounts' : ` without accounts (no ${databaseAvailable() ? 'CLERK_SECRET_KEY' : 'DATABASE_URL'})`}`))
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopAutomationScheduler()
  server.close(() => process.exit(0))
})
