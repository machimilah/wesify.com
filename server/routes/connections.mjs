import { audit, tenant } from '../access.mjs'
import { requireConnectedApps } from '../billing.mjs'
import { connectableProviders, connectorFor } from '../connectors/index.mjs'
import { credentialFor, listConnections, removeConnection, saveConnection } from '../connections.mjs'
import { syncProvider } from '../connectorSync.mjs'
import { databaseAvailable } from '../db.mjs'
import { body, send } from '../http.mjs'

/**
 * Connected apps: /api/connections/providers, and /api/connections/:workspaceId[/:providerId[/sync|introspect]]
 *
 * Read-only, in every direction, permanently. Wesify reads what another system holds — for an ERP,
 * both its records and the shape of the company behind them — rebuilds that operation as a workspace
 * of its own, and owns the records from then on. Nothing is ever written back.
 *
 * Nothing here returns a stored credential, and a sync never deletes a record the operator created
 * in Wesify: records that came from the other system are matched on the id that system gave them, and
 * a record typed by hand has no such id to match.
 */

/** Clipped and filtered before it decides which Odoo fields get read. Never trusted raw. */
function mappingFrom(value) {
  if (!Array.isArray(value)) return null
  const text = (candidate, max) => String(candidate ?? '').slice(0, max)
  const entries = value.slice(0, 40).map(entry => ({
    model: text(entry?.model, 80),
    entityId: text(entry?.entityId, 60),
    fields: (Array.isArray(entry?.fields) ? entry.fields : []).slice(0, 60).map(field => ({
      from: text(field?.from, 80),
      to: text(field?.to, 60),
      kind: text(field?.kind, 20),
    })).filter(field => field.from && field.to),
  })).filter(entry => entry.model && entry.entityId && entry.fields.length)
  return entries.length ? entries : null
}

export async function connectionRoutes(request, response, segments, url) {
  if (segments[1] !== 'connections' || !segments[2]) return false

  /**
   * The connect forms, drawn from what the connectors actually parse.
   *
   * Open, and deliberately: it names which apps exist and what each one asks for, which is public
   * product information. It carries no workspace, no account and no value of any kind.
   */
  if (segments[2] === 'providers') {
    if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' })
    return send(response, 200, connectableProviders())
  }

  const workspaceId = segments[2]
  const connecting = await tenant(request, workspaceId)
  const providerId = segments[3]
  // Reading which apps are connected stays open on every plan: an account that has lapsed must be
  // able to see what it had, and taking the list away would only make it harder to disconnect.
  if (request.method === 'POST' && databaseAvailable() && connecting?.user) await requireConnectedApps(connecting.user.id)

  if (request.method === 'GET' && !providerId) return send(response, 200, await listConnections(workspaceId))

  const connector = providerId ? connectorFor(providerId) : null
  if (providerId && !connector) return send(response, 404, { error: 'Wesify has no connector for that app yet.' })

  if (request.method === 'POST' && connector && !segments[4]) {
    const input = await body(request)
    const credential = connector.checkCredential(input)
    // A connector may learn something at verification that every later call would otherwise re-derive
    // — which dialect an ERP speaks, which user id its key belongs to — and hand back a credential
    // carrying it. One that learns nothing returns no credential and the original is stored.
    const verified = await connector.verify(credential)
    const saved = await saveConnection(workspaceId, providerId, {
      credential: verified.credential ?? credential,
      mode: connector.mode,
      account: String(verified.account ?? ''),
    })
    await audit(workspaceId, 'connection.created', request, { providerId, mode: connector.mode })
    return send(response, 200, saved)
  }

  if (request.method === 'POST' && connector && segments[4] === 'sync') {
    const full = url?.searchParams.has('full') ?? false
    // The mapping is the client's, derived from the introspection that built this workspace's
    // entities. Sent on the import that follows a rebuild, absent on every ordinary re-sync.
    const input = await body(request).catch(() => ({}))
    const { connection, counts } = await syncProvider(workspaceId, providerId, { full, mapping: mappingFrom(input.mapping) })
    await audit(workspaceId, 'connection.synced', request, { providerId, ...counts })
    return send(response, 200, { connection, counts })
  }

  /**
   * What the other system says the company does.
   *
   * Only an ERP has an answer: which of its modules are installed, which of those hold any records,
   * what fields somebody added to make it fit this company, and what states their work moves
   * through. It is the evidence Wesify rebuilds the operation from, and it is strictly better than an
   * interview, because a module nobody has ever put a record into is a module this company does not
   * use, whatever anybody remembers about it.
   */
  if (request.method === 'POST' && connector && segments[4] === 'introspect') {
    if (!connector.introspect) return send(response, 400, { error: `${connector.label} has no company structure for Wesify to read.` })
    const credential = await credentialFor(workspaceId, providerId)
    const introspection = await connector.introspect(credential)
    await audit(workspaceId, 'connection.introspected', request, { providerId, models: introspection.models?.length ?? 0 })
    return send(response, 200, introspection)
  }

  if (request.method === 'DELETE' && connector) {
    const removed = await removeConnection(workspaceId, providerId)
    if (removed) await audit(workspaceId, 'connection.removed', request, { providerId })
    return send(response, 200, { removed })
  }

  return send(response, 405, { error: 'Method not allowed.' })
}
