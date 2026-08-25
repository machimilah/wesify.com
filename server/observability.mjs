import { randomUUID } from 'node:crypto'

/**
 * Knowing that Wesify broke, and where.
 *
 * Until this existed, a 500 in production was answered with "Wesify could not complete the operation."
 * and then discarded — not logged, not counted, not reported anywhere. The only way to learn that
 * something was broken was for a customer to say so, and the only thing to go on afterwards was their
 * description of it. That is not a monitoring gap so much as a promise that every production bug will
 * be diagnosed twice: once by the customer, once from scratch.
 *
 * Two outputs, and the first one always happens:
 *
 *   1. A structured line on stdout for every request and every failure. Every host collects stdout,
 *      so this works with no account anywhere, and JSON means it can be queried rather than read.
 *   2. Sentry, when `SENTRY_DSN` is set. Written against its HTTP envelope endpoint with fetch rather
 *      than its SDK, for the same reason mail.mjs is: one shape of event does not justify a large
 *      dependency, and `BO_SENTRY_URL` lets the test point it at a server it controls.
 *
 * What is deliberately never reported: request bodies, headers, and query strings. A body holds
 * passwords and API keys, an Authorization header holds a live session, and a reset link lives in a
 * query string. An error reporter that leaks those has done more damage than the error it reported.
 */

const started = Date.now()

/** Ties a log line, a Sentry event, and the reference the customer was shown to the same failure. */
export const newRequestId = () => randomUUID().replace(/-/g, '').slice(0, 12)

const environment = () => process.env.BO_ENVIRONMENT || process.env.NODE_ENV || 'development'

function line(fields) {
  // One JSON object per line: greppable by a person, queryable by every log tool worth using.
  console.log(JSON.stringify({ at: new Date().toISOString(), ...fields }))
}

/** One line per request. `ms` is what turns "it feels slow" into something that can be checked. */
export function logRequest({ requestId, method, path: pathname, status, ms, workspaceId, userId }) {
  line({ event: 'request', requestId, method, path: pathname, status, ms, workspaceId, userId })
}

export function monitoringAvailable() {
  return Boolean(process.env.SENTRY_DSN)
}

/**
 * Splits a DSN into the pieces its ingest endpoint needs.
 *
 * A DSN is `https://<key>@<host>/<project>`. It is not a secret in the way an API key is — it ships in
 * browser bundles by design — but it is still only ever read from the environment here.
 */
function ingest() {
  if (process.env.BO_SENTRY_URL) return { url: process.env.BO_SENTRY_URL, key: 'test' }
  try {
    const dsn = new URL(process.env.SENTRY_DSN)
    const project = dsn.pathname.replace(/^\/+/, '')
    if (!dsn.username || !project) return null
    return { url: `${dsn.protocol}//${dsn.host}/api/${project}/envelope/`, key: dsn.username }
  } catch {
    return null
  }
}

async function report(event) {
  const target = ingest()
  if (!target) return false
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')
  const response = await fetch(`${target.url}?sentry_key=${encodeURIComponent(target.key)}&sentry_version=7`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope' },
    body: envelope,
    // A monitor is unreachable exactly when something else is already wrong, and an unbounded fetch
    // would hold the connection — and, if anything ever awaited this, the request — for as long as the
    // monitor felt like taking.
    signal: AbortSignal.timeout(Number(process.env.BO_MONITOR_TIMEOUT_MS || 3000)),
  })
  return response.ok
}

/**
 * Records one failure: always to stdout, and to Sentry when it is configured.
 *
 * Never throws and never rejects. A reporter that can fail the request it is reporting on turns one
 * broken endpoint into a broken server, and the moment it matters most is the moment everything else
 * is already going wrong.
 */
export async function captureError(error, context = {}) {
  const eventId = randomUUID().replace(/-/g, '')
  const type = error?.name || 'Error'
  const message = error?.message ? String(error.message) : String(error)
  const stack = error?.stack ? String(error.stack) : undefined

  line({ event: 'error', eventId, type, message, stack, ...context })

  try {
    await report({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      logger: 'bo.server',
      environment: environment(),
      release: process.env.BO_RELEASE || undefined,
      server_name: process.env.BO_SERVER_NAME || undefined,
      // Sentry groups on type and value. The stack goes alongside as text rather than as parsed
      // frames: frames would group a little better, and a wrong frame parser reports fiction.
      exception: { values: [{ type, value: message }] },
      // Only ever the shape of the request. See the note at the top of this file for why.
      tags: { requestId: context.requestId, method: context.method, path: context.path, status: context.status },
      extra: { stack, uptimeSeconds: Math.round((Date.now() - started) / 1000), workspaceId: context.workspaceId, userId: context.userId },
    })
  } catch (failure) {
    line({ event: 'error-reporting-failed', eventId, message: failure?.message ?? String(failure) })
  }
  return eventId
}

/**
 * Catches what escapes every handler.
 *
 * An unhandled rejection leaves the process in a state nobody reasoned about, so Wesify reports it and
 * then stops rather than serving on from it — a container that exits is restarted, and a container
 * that keeps answering wrongly is not noticed at all.
 */
export function watchProcess() {
  process.on('unhandledRejection', reason => {
    void captureError(reason instanceof Error ? reason : new Error(`Unhandled rejection: ${reason}`), { fatal: true })
      .then(() => process.exit(1))
  })
  process.on('uncaughtException', error => {
    void captureError(error, { fatal: true }).then(() => process.exit(1))
  })
}
