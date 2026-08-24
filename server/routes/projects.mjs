import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { audit, authorize, readAudit, tenant } from '../access.mjs'
import { executeManagedAutomation, publicAutomationWorkspace, readAutomationWorkspace, safeWebhookUrl, triggerManagedAutomations, writeAutomationWorkspace } from '../automations.mjs'
import { recordRebuild, requireRebuildRoom, requireRecordRoom } from '../billing.mjs'
import { databaseAvailable } from '../db.mjs'
import { body, send } from '../http.mjs'
import { buildProject, currentManifest, listVersions, promoteProject, rollbackProject, runtimePath } from '../project-builder.mjs'
import { readWorkspaceData, writeWorkspaceData } from '../records.mjs'
import { readDiscoverySession } from '../discoverySessions.mjs'
import { compileOpeningRecords, proposeOpeningRecords } from '../openingRecords.mjs'

/**
 * The workspace itself: building it, changing it, and everything inside it.
 *
 * This is the largest surface in BO because it is the product. What is deliberately *not* here is
 * storage — records.mjs decides where a record lives — and access, which access.mjs decides. This
 * file is only the rules about what a request is allowed to mean.
 */

/** Two builds of the same workspace at once would race; the second waits on the first instead. */
const initialBuilds = new Map()

function validateRecord(entity, input, partial = false) {
  const allowed = new Set(entity.fields.map(field => field.id))
  const output = {}
  for (const [key, value] of Object.entries(input ?? {})) if (allowed.has(key)) output[key] = value
  if (!partial) for (const field of entity.fields.filter(field => field.required)) {
    if (output[field.id] === undefined || output[field.id] === '') throw Object.assign(new Error(`${field.label} is required.`), { status: 400 })
  }
  return output
}

function validateRelations(entity, values, data) {
  for (const field of entity.fields.filter(field => field.type === 'relation' && field.relationEntityId)) {
    const value = values[field.id]
    if (value && !(data[field.relationEntityId] ?? []).some(record => record.id === value)) {
      throw Object.assign(new Error(`${field.label} must reference an existing record.`), { status: 400 })
    }
  }
}

function triggerWorkflows(manifest, data, entityId, event, record) {
  const notifications = data._notifications ?? []
  for (const workflow of manifest.workflows ?? []) {
    const trigger = workflow.trigger
    if (!workflow.enabled || trigger.entityId !== entityId || trigger.event !== event) continue
    if (trigger.field && String(record[trigger.field] ?? '') !== String(trigger.equals ?? '')) continue
    if (workflow.action.type === 'notify') notifications.push({ id: randomUUID(), message: workflow.action.message, entityId, recordId: record.id, createdAt: new Date().toISOString(), read: false })
  }
  return { ...data, _notifications: notifications }
}

/**
 * The workspace opens holding what the operator already said.
 *
 * Run once, on the first build, from the interview the server already has — not asked of the
 * browser, which may be closed by the time this finishes, and not left to the operator, who has just
 * spent twelve questions telling BO these exact facts.
 *
 * Every failure here is swallowed on purpose. An empty table is a workspace with a head start
 * missing; a failed build is no workspace at all, and the second must never be caused by the first.
 */
async function openWorkspaceWithWhatTheySaid(workspaceId, project, request) {
  try {
    const entities = project?.specification?.entities ?? []
    if (!entities.length) return
    const existing = await readWorkspaceData(workspaceId)
    // Only ever into an empty workspace. A rebuild must not re-add rows somebody has since deleted.
    if (Object.entries(existing).some(([entityId, rows]) => entityId !== '_notifications' && (rows ?? []).length)) return
    const session = await readDiscoverySession(workspaceId)
    if (!session?.messages?.length) return

    const proposal = await proposeOpeningRecords({
      conversation: session.messages.map(message => ({ role: message.role, content: String(message.content ?? '').slice(0, 2000) })).slice(-24),
      businessState: session.businessState ?? null,
      entities,
    })
    const { records, summary } = compileOpeningRecords(proposal, entities, () => randomUUID())
    const total = Object.values(records).reduce((count, rows) => count + rows.length, 0)
    if (!total && !summary) return

    const notifications = existing._notifications ?? []
    if (summary) notifications.push({ id: randomUUID(), message: summary, entityId: '', recordId: '', createdAt: new Date().toISOString(), read: false })
    await writeWorkspaceData(workspaceId, { ...existing, ...records, _notifications: notifications })
    await audit(workspaceId, 'workspace.opening_records', request, { records: total, entities: Object.keys(records) })
  } catch (error) {
    console.warn(`BO could not open ${workspaceId} with what the operator said: ${error?.message ?? error}`)
  }
}

export async function buildRoutes(request, response, segments) {
  if (request.method !== 'POST' || segments[1] !== 'builds') return false

  const input = await body(request)
  await tenant(request, input.workspaceId)
  const existing = await currentManifest(input.workspaceId)
  if (existing?.specification?.profile?.description === input.specification?.profile?.description) return send(response, 200, existing)
  const pending = initialBuilds.get(input.workspaceId)
  if (pending) return send(response, 200, await pending)
  const build = (async () => {
    const project = await buildProject({ workspaceId: input.workspaceId, specification: input.specification, changeDescription: input.changeDescription, changeType: 'initial' })
    await audit(input.workspaceId, 'project.created', request, { version: project.version })
    await openWorkspaceWithWhatTheySaid(input.workspaceId, project, request)
    return project
  })()
  initialBuilds.set(input.workspaceId, build)
  try { return send(response, 201, await build) }
  finally { initialBuilds.delete(input.workspaceId) }
}

export async function projectRoutes(request, response, segments, url) {
  if (segments[1] !== 'projects' || !segments[2]) return false

  const workspaceId = segments[2]
  // Kept, not discarded: the plan limits below are about the account, and this is where BO learns
  // which account is asking.
  const caller = await tenant(request, workspaceId)

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
    // The metered action. Building the first Command Center is free for everyone — it is the only
    // way anybody finds out what BO does — and changing it afterwards is what the plans sell.
    if (databaseAvailable() && caller?.user) await requireRebuildRoom(caller.user.id)
    const project = await buildProject({ workspaceId, specification: input.specification, changeDescription: input.changeDescription ?? 'Updated Command Center', changeType: input.changeType ?? 'workspace-change', promote: false })
    if (databaseAvailable() && caller?.user) await recordRebuild(caller.user.id, workspaceId)
    await audit(workspaceId, 'project.change_prepared', request, { version: project.version, changeType: input.changeType ?? 'workspace-change' })
    return send(response, 201, project)
  }

  if (request.method === 'POST' && (segments[3] === 'promote' || segments[3] === 'rollback')) {
    const input = await body(request)
    const current = await currentManifest(workspaceId)
    if (current) authorize(current, request, 'admin')
    const project = segments[3] === 'promote' ? await promoteProject(workspaceId, input.version) : await rollbackProject(workspaceId, input.version)
    await audit(workspaceId, segments[3] === 'promote' ? 'project.version_promoted' : 'project.version_rolled_back', request, { version: input.version })
    return send(response, 200, project)
  }

  if (request.method === 'GET' && segments[3] === 'runtime.mjs') {
    const file = await runtimePath(workspaceId, url.searchParams.get('version'))
    if (!file) return send(response, 404, 'Not found.', 'text/plain; charset=utf-8')
    return send(response, 200, await readFile(file, 'utf8'), 'text/javascript; charset=utf-8')
  }

  const manifest = await currentManifest(workspaceId)
  if (!manifest) return send(response, 404, { error: 'Project not built.' })

  /**
   * Everything the workspace holds, in one file.
   *
   * Deliberately on every plan, including a lapsed one. BO tells people their records stay theirs;
   * a product that says that and offers no way to carry them out is asking to be believed on trust
   * it has not earned. It needs `view` and nothing more — exporting is reading.
   */
  if (request.method === 'GET' && segments[3] === 'export') {
    authorize(manifest, request, 'view')
    const data = await readWorkspaceData(workspaceId)
    const { _notifications: notifications = [], ...records } = data
    await audit(workspaceId, 'workspace.exported', request, { entities: Object.keys(records).length })
    // Named so it lands in a downloads folder as something recognisable a year from now.
    response.setHeader('content-disposition', `attachment; filename="bo-${workspaceId}-${new Date().toISOString().slice(0, 10)}.json"`)
    return send(response, 200, {
      exportedAt: new Date().toISOString(),
      workspaceId,
      // The specification travels with the records: a pile of rows with no idea what its fields
      // meant is not the same thing as having your data.
      specification: manifest.specification,
      version: manifest.version,
      entities: manifest.entities,
      records,
      notifications,
    })
  }

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
    const connector = { id: randomUUID(), name: String(input.name).trim().slice(0, 100), type: input.type, endpointUrl, endpointHost: new URL(endpointUrl).hostname, status: 'connected', createdAt: new Date().toISOString() }
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
      if (!manifest.entities.some(item => item.id === input.entityId) || !['created', 'updated'].includes(input.event) || !state.connectors.some(item => item.id === input.connectorId)) {
        return send(response, 400, { error: 'Choose a valid record type, trigger, and connector.' })
      }
      const now = new Date().toISOString()
      const automation = { id: randomUUID(), name: String(input.name ?? '').trim().slice(0, 120) || `${input.entityId} ${input.event}`, enabled: false, trigger: { entityId: input.entityId, event: input.event }, action: { type: 'webhook', connectorId: input.connectorId }, createdAt: now, updatedAt: now }
      await writeAutomationWorkspace(workspaceId, { ...state, automations: [...state.automations, automation] })
      await audit(workspaceId, 'automation.created', request, { automationId: automation.id })
      return send(response, 201, automation)
    }

    const state = await readAutomationWorkspace(workspaceId)
    const automation = state.automations.find(item => item.id === segments[4])
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
    const data = await readWorkspaceData(workspaceId)
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
      await writeWorkspaceData(workspaceId, { ...data, _notifications: notifications.map(item => item.id === updated.id ? updated : item) })
      await audit(workspaceId, 'notification.updated', request, { notificationId: updated.id, read: updated.read })
      return send(response, 200, updated)
    }
  }

  if (segments[3] === 'records' && segments[4]) {
    const entityId = segments[4]
    const entity = manifest.entities.find(item => item.id === entityId)
    if (!entity) return send(response, 404, { error: 'Entity not found.' })
    const data = await readWorkspaceData(workspaceId)
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
      // Counted across the whole workspace, not per entity: what a plan sells is room for a business,
      // and a business does not care which table its thousandth row landed in. Notifications are BO's
      // own bookkeeping and are not charged for.
      if (databaseAvailable() && caller?.user) {
        const held = Object.entries(data).filter(([id]) => id !== '_notifications').reduce((total, [, rows]) => total + (Array.isArray(rows) ? rows.length : 0), 0)
        await requireRecordRoom(caller.user.id, held)
      }
      const values = validateRecord(entity, await body(request))
      validateRelations(entity, values, data)
      const now = new Date().toISOString()
      const record = { id: randomUUID(), workspaceId, ...values, createdAt: now, updatedAt: now }
      let next = { ...data, [entityId]: [...collection, record] }
      next = triggerWorkflows(manifest, next, entityId, 'created', record)
      await writeWorkspaceData(workspaceId, next)
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
      await writeWorkspaceData(workspaceId, next)
      await audit(workspaceId, 'record.updated', request, { entityId, recordId })
      await triggerManagedAutomations(workspaceId, 'updated', entityId, record)
      return send(response, 200, record)
    }

    if (request.method === 'DELETE') {
      authorize(manifest, request, 'delete')
      await writeWorkspaceData(workspaceId, { ...data, [entityId]: collection.filter(record => record.id !== recordId) })
      await audit(workspaceId, 'record.deleted', request, { entityId, recordId })
      return send(response, 200, { deleted: true })
    }
  }

  if (request.method === 'GET' && segments[3] === 'records') {
    authorize(manifest, request, 'view')
    const data = await readWorkspaceData(workspaceId)
    return send(response, 200, Object.fromEntries(manifest.entities.map(entity => [entity.id, data[entity.id] ?? []])))
  }

  if (request.method === 'POST' && segments[3] === 'query') {
    authorize(manifest, request, 'view')
    const input = await body(request)
    const data = await readWorkspaceData(workspaceId)
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
