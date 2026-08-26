import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { audit, authorize, tenant } from '../access.mjs'
import { ensureGeneratedAutomations, executeManagedAutomation, publicAutomationWorkspace, readAutomationWorkspace, resumeManagedAutomation, retryManagedAutomationRun, safeWebhookUrl, writeAutomationWorkspace } from '../automations.mjs'
import { body, send } from '../http.mjs'
import { readWorkspaceData, writeWorkspaceData } from '../records.mjs'
import { createWorkflowGraph, validateWorkflowGraph, workflowGraphFor, workflowMetadata } from '../workflowGraph.mjs'
import { currentManifest } from '../project-builder.mjs'
import { planAutomation } from '../automationAgent.mjs'
import { runDueScheduledAutomations, runDueScheduledWorkspace } from '../automationScheduler.mjs'
import { removeConnection, saveConnection } from '../connections.mjs'

function graphContext(manifest, state) {
  return {
    entityIds: manifest.entities.map(item => item.id),
    entities: manifest.entities,
    connectorIds: state.connectors.map(item => item.id),
    eventDefinitions: manifest.specification?.eventArchitecture?.definitions ?? [],
  }
}

function schedulerAuthorized(request) {
  const expected = process.env.BO_AUTOMATION_SCHEDULER_SECRET || process.env.CRON_SECRET
  if (!expected || expected.length < 16) return null
  const authorization = String(request.headers.authorization ?? '')
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const expectedDigest = createHash('sha256').update(expected).digest()
  const suppliedDigest = createHash('sha256').update(supplied).digest()
  return timingSafeEqual(expectedDigest, suppliedDigest)
}

export async function automationRoutes(request, response, segments) {
  if (segments[1] === 'system' && segments[2] === 'automations' && segments[3] === 'run-due' && segments.length === 4) {
    if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' })
    const authorized = schedulerAuthorized(request)
    if (authorized == null) return send(response, 503, { error: 'Scheduled automation calls need BO_AUTOMATION_SCHEDULER_SECRET or CRON_SECRET configured.' })
    if (!authorized) return send(response, 401, { error: 'Scheduler authorization failed.' })
    const runs = await runDueScheduledAutomations()
    return send(response, 200, {
      runs, due: runs.filter(item => item.status !== 'already-run').length,
      repeated: runs.filter(item => item.status === 'already-run').length,
    })
  }
  if (segments[1] !== 'projects' || !segments[2] || !['connectors', 'automations'].includes(segments[3])) return false
  const workspaceId = segments[2]
  await tenant(request, workspaceId)
  const manifest = await currentManifest(workspaceId)
  if (!manifest) return send(response, 404, { error: 'Project not built.' })

  if (segments[3] === 'connectors' && request.method === 'POST' && segments.length === 4) {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    if (!['make-webhook', 'n8n-webhook', 'generic-webhook'].includes(input.type) || !String(input.name ?? '').trim()) return send(response, 400, { error: 'Connector name and supported type are required.' })
    const endpointUrl = safeWebhookUrl(input.endpointUrl)
    const state = await readAutomationWorkspace(workspaceId)
    const id = randomUUID()
    const credentialRef = `automation-${id}`
    const connector = { id, name: String(input.name).trim().slice(0, 100), type: input.type, credentialRef, endpointHost: new URL(endpointUrl).hostname, status: 'connected', createdAt: new Date().toISOString() }
    await saveConnection(workspaceId, credentialRef, { credential: endpointUrl, mode: 'write', account: connector.endpointHost })
    try { await writeAutomationWorkspace(workspaceId, { ...state, connectors: [...state.connectors, connector] }) }
    catch (error) { await removeConnection(workspaceId, credentialRef); throw error }
    await audit(workspaceId, 'connector.created', request, { connectorId: connector.id, type: connector.type })
    const { credentialRef: hidden, ...safe } = connector
    return send(response, 201, safe)
  }

  if (segments[3] === 'connectors' && request.method === 'DELETE' && segments[4] && segments.length === 5) {
    authorize(manifest, request, 'admin')
    const state = await readAutomationWorkspace(workspaceId)
    const connector = state.connectors.find(item => item.id === segments[4])
    if (!connector) return send(response, 404, { error: 'Connection not found.' })
    const inUse = state.automations.some(automation => [automation.graph, automation.draftGraph].filter(Boolean).some(graph => graph.nodes.some(node => node.type === 'action' && node.config.type === 'webhook' && node.config.connectorId === connector.id)))
    if (inUse) return send(response, 409, { error: 'Remove this connection from every workflow before disconnecting it.' })
    await writeAutomationWorkspace(workspaceId, { ...state, connectors: state.connectors.filter(item => item.id !== connector.id) })
    if (connector.credentialRef) await removeConnection(workspaceId, connector.credentialRef)
    await audit(workspaceId, 'connector.removed', request, { connectorId: connector.id, type: connector.type })
    return send(response, 200, { removed: true })
  }

  if (segments[3] !== 'automations') return false

  if (request.method === 'GET' && segments.length === 4) {
    authorize(manifest, request, 'view')
    return send(response, 200, publicAutomationWorkspace(await ensureGeneratedAutomations(workspaceId, manifest.specification)))
  }

  if (request.method === 'POST' && segments[4] === 'plan') {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    const state = await readAutomationWorkspace(workspaceId)
    const existing = input.automationId ? state.automations.find(item => item.id === input.automationId) : null
    if (input.automationId && !existing) return send(response, 404, { error: 'Workflow to edit was not found.' })
    const plan = await planAutomation({ instruction: input.instruction, manifest, state, currentGraph: input.currentGraph ?? existing?.draftGraph ?? existing?.graph })
    const metadata = workflowMetadata(plan.graph)
    const now = new Date().toISOString()
    const automation = existing ? {
      ...existing,
      name: plan.name,
      summary: plan.summary,
      risk: plan.risk,
      humanControl: plan.humanControl,
      reviewStatus: 'draft',
      model: plan.model,
      draftGraph: plan.graph,
      hasUnpublishedChanges: true,
      updatedAt: now,
    } : {
      id: randomUUID(), origin: 'ai', name: plan.name, summary: plan.summary, risk: plan.risk,
      humanControl: plan.humanControl, reviewStatus: 'draft', model: plan.model, enabled: false,
      ...metadata, graph: plan.graph, draftGraph: plan.graph, version: 1, hasUnpublishedChanges: true,
      createdAt: now, updatedAt: now,
    }
    await writeAutomationWorkspace(workspaceId, { ...state, automations: existing ? state.automations.map(item => item.id === automation.id ? automation : item) : [...state.automations, automation] })
    await audit(workspaceId, existing ? 'automation.ai_revised' : 'automation.ai_created', request, { automationId: automation.id, source: plan.source, model: plan.model, safeguards: plan.safeguards.length })
    return send(response, existing ? 200 : 201, { automation, model: plan.model, source: plan.source, safeguards: plan.safeguards })
  }

  if (request.method === 'POST' && segments[4] === 'schedules' && segments[5] === 'run-due') {
    authorize(manifest, request, 'admin')
    const runs = await runDueScheduledWorkspace(workspaceId)
    await audit(workspaceId, 'automation.schedules_scanned', request, {
      due: runs.filter(item => item.status !== 'already-run').length,
      repeated: runs.filter(item => item.status === 'already-run').length,
    })
    return send(response, 200, { runs })
  }

  if (request.method === 'POST' && segments.length === 4) {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    const state = await readAutomationWorkspace(workspaceId)
    const candidate = input.graph ?? createWorkflowGraph({ entityId: input.entityId, event: input.event, action: { type: 'webhook', connectorId: input.connectorId } })
    const graph = validateWorkflowGraph(candidate, graphContext(manifest, state))
    const metadata = workflowMetadata(graph)
    const now = new Date().toISOString()
    const automation = {
      id: randomUUID(), origin: 'manual', name: String(input.name ?? '').trim().slice(0, 120) || `${metadata.trigger.entityId} ${metadata.trigger.event}`,
      enabled: false, ...metadata, graph, draftGraph: graph, version: 1, publishedAt: now, hasUnpublishedChanges: false,
      createdAt: now, updatedAt: now,
    }
    await writeAutomationWorkspace(workspaceId, { ...state, automations: [...state.automations, automation] })
    await audit(workspaceId, 'automation.created', request, { automationId: automation.id })
    return send(response, 201, automation)
  }

  const state = await readAutomationWorkspace(workspaceId)

  if (request.method === 'POST' && segments[4] === 'runs' && segments[5] && segments[6] === 'retry') {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    if (input.mode && !['current', 'original'].includes(input.mode)) return send(response, 400, { error: 'Retry mode must be current or original.' })
    const previous = state.runs.find(item => item.id === segments[5])
    if (!previous) return send(response, 404, { error: 'Execution not found.' })
    if (!['failed', 'cancelled'].includes(previous.status)) return send(response, 409, { error: 'Only failed or cancelled executions can be retried.' })
    const target = state.automations.find(item => item.id === previous.automationId)
    if (!target) return send(response, 409, { error: 'The workflow used by this execution no longer exists.' })
    const run = await retryManagedAutomationRun(workspaceId, previous, target, input.mode ?? 'current')
    await audit(workspaceId, 'automation.execution_retried', request, { automationId: target.id, runId: run.id, retryOf: previous.id, mode: input.mode ?? 'current' })
    return send(response, 201, run)
  }

  if (request.method === 'PATCH' && segments[4] === 'approvals' && segments[5]) {
    authorize(manifest, request, 'approve')
    const input = await body(request)
    if (!['approved', 'rejected'].includes(input.decision)) return send(response, 400, { error: 'Choose approve or reject.' })
    const approval = state.approvals.find(item => item.id === segments[5])
    if (!approval) return send(response, 404, { error: 'Approval request not found.' })
    if (approval.status !== 'pending') return send(response, 409, { error: 'This approval request has already been decided.' })
    const updated = { ...approval, status: input.decision, comment: String(input.comment ?? '').trim().slice(0, 500), decidedAt: new Date().toISOString() }
    await writeAutomationWorkspace(workspaceId, { ...state, approvals: state.approvals.map(item => item.id === updated.id ? updated : item) })
    const target = state.automations.find(item => item.id === approval.automationId)
    const resumed = target ? await resumeManagedAutomation(workspaceId, target, approval, input.decision) : null
    const data = await readWorkspaceData(workspaceId)
    const notification = { id: randomUUID(), message: `${approval.automationName}: ${input.decision}.`, entityId: approval.entityId, recordId: approval.recordId, automationId: approval.automationId, createdAt: updated.decidedAt, read: false }
    await writeWorkspaceData(workspaceId, { ...data, _notifications: [...(data._notifications ?? []), notification] })
    await audit(workspaceId, `automation.approval.${input.decision}`, request, { approvalId: approval.id, automationId: approval.automationId, recordId: approval.recordId, runStatus: resumed?.status })
    return send(response, 200, updated)
  }

  const automation = state.automations.find(item => item.id === segments[4])
  if (!automation) return send(response, 404, { error: 'Automation not found.' })

  if (request.method === 'PATCH' && segments.length === 5) {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    const context = graphContext(manifest, state)
    const now = new Date().toISOString()
    let updated = { ...automation, updatedAt: now }
    if (Object.hasOwn(input, 'name')) updated.name = String(input.name ?? '').trim().slice(0, 120) || automation.name
    if (input.draftGraph || input.graph) {
      const draftGraph = validateWorkflowGraph(input.draftGraph ?? input.graph, context)
      updated = { ...updated, draftGraph, hasUnpublishedChanges: JSON.stringify(draftGraph) !== JSON.stringify(workflowGraphFor(automation)) }
    }
    if (input.publish) {
      const graph = validateWorkflowGraph(updated.draftGraph ?? workflowGraphFor(automation), context)
      const graphChanged = JSON.stringify(graph) !== JSON.stringify(workflowGraphFor(automation))
      updated = {
        ...updated, ...workflowMetadata(graph), graph, draftGraph: graph,
        version: (automation.version ?? 1) + (graphChanged ? 1 : 0), publishedAt: now, hasUnpublishedChanges: false,
      }
    }
    if (Object.hasOwn(input, 'enabled')) {
      if (input.enabled) validateWorkflowGraph(workflowGraphFor(updated), context)
      updated.enabled = Boolean(input.enabled)
    }
    await writeAutomationWorkspace(workspaceId, { ...state, automations: state.automations.map(item => item.id === updated.id ? updated : item) })
    const event = input.publish ? 'automation.published' : Object.hasOwn(input, 'enabled') ? (updated.enabled ? 'automation.enabled' : 'automation.disabled') : 'automation.updated'
    await audit(workspaceId, event, request, { automationId: updated.id, version: updated.version ?? 1 })
    return send(response, 200, updated)
  }

  if (request.method === 'DELETE' && segments.length === 5) {
    authorize(manifest, request, 'admin')
    await writeAutomationWorkspace(workspaceId, { ...state, automations: state.automations.filter(item => item.id !== automation.id) })
    await audit(workspaceId, 'automation.deleted', request, { automationId: automation.id })
    return send(response, 200, { ok: true })
  }

  if (request.method === 'POST' && segments[5] === 'test') {
    authorize(manifest, request, 'admin')
    const input = await body(request)
    const record = { id: 'test-record', test: true, message: 'Wesify automation test' }
    const run = await executeManagedAutomation(workspaceId, automation, automation.trigger.event, automation.trigger.entityId, record, input.dryRun !== false, { useDraft: true })
    await audit(workspaceId, 'automation.tested', request, { automationId: automation.id, status: run.status })
    return send(response, 200, run)
  }

  return send(response, 404, { error: 'Automation route not found.' })
}
