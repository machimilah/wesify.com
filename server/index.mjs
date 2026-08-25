// First: configuration has to be in place before any module decides what BO can do.
import './env.mjs'
import { createServer } from 'node:http'
import { corsHeaders, handlePreflight } from './cors.mjs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { billingAvailable } from './billing.mjs'
import { databaseAvailable, migrate } from './db.mjs'
import { send } from './http.mjs'
import { mailAvailable } from './mail.mjs'
import { captureError, logRequest, monitoringAvailable, newRequestId, watchProcess } from './observability.mjs'
import { authRoutes } from './routes/auth.mjs'
import { billingRoutes } from './routes/billing.mjs'
import { connectionRoutes } from './routes/connections.mjs'
import { discoveryRoutes, researchRoutes } from './routes/discovery.mjs'
import { industryRoutes } from './routes/industries.mjs'
import { buildRoutes, projectRoutes } from './routes/projects.mjs'

/**
 * BO's server: what listens, and in what order it asks.
 *
 * This file used to be the whole server — every route, every helper, nine hundred lines of it. It is
 * now only the arrangement: which module gets asked about a request, what happens when one throws,
 * and what is true before the first request is served. Each module below answers `false` for a path
 * that is not its own, so the list reads as the routing table it is.
 */

const requestedPort = Number(process.argv[process.argv.indexOf('--port') + 1])
// `PORT` is what every container host injects, and it is not BO's to choose there; `BO_API_PORT` stays
// ahead of it so a local `.env.local` still wins over whatever a shell happens to export.
const port = Number.isFinite(requestedPort) ? requestedPort : Number(process.env.BO_API_PORT || process.env.PORT || 8787)
// Loopback by default, so running BO on a laptop does not quietly publish it to the local network.
// A container has to bind every interface or nothing outside it can reach the port at all.
const host = process.env.BO_HOST || '127.0.0.1'
const distRoot = path.resolve(process.cwd(), 'dist')

/** Asked in order. The first that does not return `false` has answered the request. */
const routes = [authRoutes, industryRoutes, billingRoutes, researchRoutes, discoveryRoutes, connectionRoutes, buildRoutes, projectRoutes]

async function api(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { status: 'healthy', accounts: databaseAvailable() })
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
    catch { return send(response, 404, 'BO frontend is not built.', 'text/plain; charset=utf-8') }
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
    // A 4xx is BO telling the caller they got it wrong, which is the endpoint working. Reporting those
    // would bury the failures that are BO's fault under the ones that are not.
    //
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
  if (databaseAvailable() && !billingAvailable()) console.warn('BO has no billing configured (STRIPE_SECRET_KEY and BO_STRIPE_PRICE_PRO), so every account stays on the free plan and nobody can pay.')
  server.listen(port, host, () => console.log(`BO project service listening on ${host}:${port}${databaseAvailable() ? ' with accounts' : ' without accounts (no DATABASE_URL)'}`))
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
