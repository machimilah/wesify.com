import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { currentManifest, projectPaths } from './project-builder.mjs'
import { writeJsonAtomic } from './atomicWrite.mjs'
import { readWorkspaceData, writeWorkspaceData } from './records.mjs'
import { compileGeneratedAutomations } from './automationPlanner.mjs'
import { workflowGraphFor, workflowTriggerMatches } from './workflowGraph.mjs'
import { validateRecordValues } from './recordValidation.mjs'
import { credentialFor } from './connections.mjs'

/** Managed workflows remain constrained to validated record actions, approvals, notifications, and SSRF-safe webhooks. */

export function emptyAutomationWorkspace() { return { connectors: [], automations: [], approvals: [], runs: [], receipts: [], schedules: [] } }

function normalizeAutomationWorkspace(value = {}) {
  return {
    connectors: Array.isArray(value.connectors) ? value.connectors : [],
    automations: Array.isArray(value.automations) ? value.automations : [],
    approvals: Array.isArray(value.approvals) ? value.approvals : [],
    runs: Array.isArray(value.runs) ? value.runs : [],
    receipts: Array.isArray(value.receipts) ? value.receipts : [],
    schedules: Array.isArray(value.schedules) ? value.schedules : [],
  }
}

const automationFile = workspaceId => path.join(projectPaths(workspaceId).root, 'automations.json')

export async function readAutomationWorkspace(workspaceId) {
  try { return normalizeAutomationWorkspace(JSON.parse(await readFile(automationFile(workspaceId), 'utf8'))) } catch (error) {
    if (error?.code === 'ENOENT') return emptyAutomationWorkspace()
    throw error
  }
}

export async function writeAutomationWorkspace(workspaceId, value) {
  await writeJsonAtomic(automationFile(workspaceId), normalizeAutomationWorkspace(value))
}

export async function ensureGeneratedAutomations(workspaceId, specification) {
  const state = await readAutomationWorkspace(workspaceId)
  const existingGenerated = new Map(state.automations.filter(item => item.origin === 'generated').map(item => [item.planKey, item]))
  const generated = compileGeneratedAutomations(specification).map(planned => {
    const existing = existingGenerated.get(planned.planKey)
    return existing ? {
      ...planned,
      name: existing.name ?? planned.name,
      enabled: existing.enabled,
      reviewStatus: existing.reviewStatus,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      ...(existing.graph ? { graph: existing.graph } : {}),
      ...(existing.graph ? { trigger: existing.trigger, action: existing.action } : {}),
      ...(existing.draftGraph ? { draftGraph: existing.draftGraph } : {}),
      ...(existing.version ? { version: existing.version } : {}),
      ...(existing.publishedAt ? { publishedAt: existing.publishedAt } : {}),
      ...(existing.hasUnpublishedChanges ? { hasUnpublishedChanges: true } : {}),
    } : planned
  })
  const automations = [...state.automations.filter(item => item.origin !== 'generated'), ...generated]
  if (JSON.stringify(automations) === JSON.stringify(state.automations)) return state
  const next = { ...state, automations }
  await writeAutomationWorkspace(workspaceId, next)
  return next
}

/**
 * Refuses a webhook target that would make Wesify into somebody's port scanner.
 *
 * A server that will POST to any URL it is given is a way to reach things only that server can
 * reach — a cloud metadata endpoint, a database admin page on a private network. HTTPS only, no
 * credentials in the URL, and no private or loopback address.
 */
export function safeWebhookUrl(value) {
  let url
  try { url = new URL(String(value ?? '')) } catch { throw Object.assign(new Error('Enter a valid HTTPS webhook URL.'), { status: 400 }) }
  if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('Webhook connectors require a credential-free HTTPS URL.'), { status: 400 })

  // The brackets matter: `new URL('https://[::1]/').hostname` is `[::1]`, brackets included, so a
  // check against the bare address never matches and IPv6 loopback walks straight through.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const private4 = /^(10\.|127\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/
  // ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local, and ::ffff:10.0.0.1 style mappings of
  // a private v4 address into v6 — all of them reach the same places by another spelling.
  const private6 = /^(::1|::|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/
  const mapped4 = hostname.startsWith('::ffff:') ? hostname.slice(7) : ''

  if (
    hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')
    || private4.test(hostname) || private6.test(hostname) || (mapped4 && private4.test(mapped4))
  ) {
    throw Object.assign(new Error('Private-network webhook targets are not allowed.'), { status: 400 })
  }
  return url.toString()
}

/** The endpoint URL never leaves the server: it is a credential in everything but name. */
export function publicAutomationWorkspace(value) {
  const state = normalizeAutomationWorkspace(value)
  const automations = state.automations.map(automation => {
    const graph = workflowGraphFor(automation)
    return {
      ...automation,
      graph,
      draftGraph: automation.draftGraph ?? graph,
      version: automation.version ?? 1,
      hasUnpublishedChanges: Boolean(automation.hasUnpublishedChanges),
    }
  })
  const runs = state.runs.slice(-100).reverse().map(({ recordSnapshot, graphSnapshot, ...run }) => run)
  return { connectors: state.connectors.map(({ endpointUrl, credentialRef, ...connector }) => connector), automations, approvals: state.approvals.slice(-100).reverse(), runs }
}

function valueAt(record, field) {
  return String(field).split('.').reduce((value, key) => value == null ? undefined : value[key], record)
}

function conditionMatches(node, record) {
  const actual = valueAt(record, node.config.field)
  const expected = node.config.value
  if (node.config.operator === 'is-empty') return actual == null || String(actual).trim() === ''
  if (node.config.operator === 'is-not-empty') return actual != null && String(actual).trim() !== ''
  if (node.config.operator === 'not-equals') return String(actual ?? '') !== String(expected)
  if (node.config.operator === 'contains') return String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase())
  if (node.config.operator === 'greater-than') return Number(actual) > Number(expected)
  if (node.config.operator === 'less-than') return Number(actual) < Number(expected)
  return String(actual ?? '') === String(expected)
}

function materialize(value, record, event, entityId) {
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{\{\s*(record|event)\.([a-zA-Z0-9_-]+)\s*\}\}$/)
  if (exact) return exact[1] === 'record'
    ? valueAt(record, exact[2]) ?? ''
    : ({ type: event, entityId }[exact[2]] ?? '')
  return value.replace(/\{\{\s*(record|event)\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_, source, key) => String(source === 'record' ? valueAt(record, key) ?? '' : ({ type: event, entityId }[key] ?? '')))
}

function materializeFields(fields, record, event, entityId) {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([key, value]) => [key, materialize(value, record, event, entityId)]))
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function stableDigest(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function deterministicUuid(value) {
  const hex = stableDigest(value).slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

function sideEffectReceiptKey(workspaceId, automationId, rootExecutionKey, node) {
  if (node.type !== 'action' || node.config.type === 'approval') return ''
  const fingerprint = stableDigest(JSON.stringify({ type: node.config.type, config: node.config })).slice(0, 20)
  return `wfy_${stableDigest(`${workspaceId}:${automationId}:${rootExecutionKey}:${node.id}:${fingerprint}`).slice(0, 40)}`
}

async function persistAutomationReceipt(workspaceId, receipt) {
  const latest = await readAutomationWorkspace(workspaceId)
  if (latest.receipts.some(item => item.key === receipt.key)) return
  await writeAutomationWorkspace(workspaceId, { ...latest, receipts: [...latest.receipts.slice(-999), receipt] })
}

export async function executeManagedAutomation(workspaceId, automation, event, entityId, record, dryRun = false, options = {}) {
  const state = await readAutomationWorkspace(workspaceId)
  const resumed = options.resumeRunId ? state.runs.find(item => item.id === options.resumeRunId) : null
  const now = new Date().toISOString()
  const startedAt = resumed?.startedAt ?? now
  const graph = options.graph ?? resumed?.graphSnapshot ?? workflowGraphFor(automation, Boolean(options.useDraft))
  const naturalKey = String(record?.eventId ?? `${automation.id}:${event}:${entityId}:${record?.id ?? ''}:${record?.updatedAt ?? record?.createdAt ?? ''}`)
  const runId = resumed?.id ?? randomUUID()
  const rootExecutionKey = resumed?.rootExecutionKey ?? options.rootExecutionKey ?? stableDigest(`${automation.id}:${naturalKey}`)
  const rootRunId = resumed?.rootRunId ?? options.rootRunId ?? runId
  const idempotencyKey = dryRun
    ? `simulation:${randomUUID()}`
    : options.retryOf ? `retry:${options.retryOf}:${randomUUID()}` : naturalKey
  const completed = dryRun || resumed || options.retryOf ? undefined : state.runs.find(item => item.idempotencyKey === idempotencyKey && item.automationId === automation.id && item.status !== 'failed')
  if (completed) return completed
  const run = resumed ? {
    ...resumed, status: 'success', error: undefined, finishedAt: now,
  } : {
    id: runId, rootRunId, rootExecutionKey, idempotencyKey, automationId: automation.id, automationName: automation.name,
    workflowVersion: automation.version ?? 1, status: dryRun ? 'simulated' : 'success', event, entityId,
    recordId: String(record?.id ?? ''), recordSnapshot: record, graphSnapshot: graph,
    retryOf: options.retryOf, attempt: Number(options.attempt ?? 1), startedAt, finishedAt: now, nodeRuns: [],
  }
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) outgoing.get(edge.source)?.push(edge)
  let roots = options.triggerNodeId
    ? graph.nodes.filter(node => node.type === 'trigger' && node.id === options.triggerNodeId && node.config.event === event && node.config.entityId === entityId)
    : graph.nodes.filter(node => node.type === 'trigger' && node.config.event === event && node.config.entityId === entityId)
  if (dryRun && !roots.length) roots = graph.nodes.filter(node => node.type === 'trigger')
  const queue = options.resumeAfterNodeId
    ? (outgoing.get(options.resumeAfterNodeId) ?? []).map(edge => edge.target)
    : roots.map(node => node.id)
  const executed = new Set(options.resumeAfterNodeId ? (run.nodeRuns ?? []).map(item => item.nodeId) : [])
  const approvals = []
  const receiptCache = new Map(state.receipts.map(item => [item.key, item]))

  const completeSideEffect = async (node, receiptKey, output) => {
    if (!receiptKey || dryRun || receiptCache.has(receiptKey)) return
    const receipt = {
      key: receiptKey, rootExecutionKey, rootRunId, automationId: automation.id, nodeId: node.id,
      type: node.config.type, output, completedAt: new Date().toISOString(),
    }
    receiptCache.set(receiptKey, receipt)
    await persistAutomationReceipt(workspaceId, receipt)
  }

  if (!queue.length) {
    if (options.resumeAfterNodeId) {
      run.status = 'success'
      run.error = undefined
    } else {
      run.status = 'failed'
      run.error = 'No trigger in this workflow matches the event.'
    }
  }

  while (queue.length && run.status !== 'failed') {
    const nodeId = queue.shift()
    if (executed.has(nodeId)) continue
    executed.add(nodeId)
    const node = nodeById.get(nodeId)
    if (!node) continue
    const nodeStartedAt = new Date().toISOString()
    const nodeRun = { nodeId, nodeType: node.type, status: 'success', startedAt: nodeStartedAt, finishedAt: nodeStartedAt, output: {} }
    let branch
    let wait = false

    try {
      const receiptKey = sideEffectReceiptKey(workspaceId, automation.id, rootExecutionKey, node)
      const completedReceipt = receiptKey ? receiptCache.get(receiptKey) : null
      if (completedReceipt) {
        nodeRun.output = { ...completedReceipt.output, summary: 'Already completed in an earlier attempt', reused: true }
      } else if (node.type === 'trigger') {
        nodeRun.output = { summary: `${node.config.entityId} ${node.config.event}` }
      } else if (node.type === 'condition') {
        const result = conditionMatches(node, record)
        branch = result ? 'true' : 'false'
        nodeRun.output = { summary: `${node.config.field} returned ${branch}`, result }
      } else if (node.config.type === 'notification') {
        if (dryRun) {
          nodeRun.output = { summary: 'Notification validated' }
        } else {
          const notification = { id: deterministicUuid(receiptKey), message: materialize(node.config.message, record, event, entityId), entityId, recordId: String(record?.id ?? ''), severity: automation.risk ?? 'informational', automationId: automation.id, createdAt: nodeStartedAt, read: false }
          const data = await readWorkspaceData(workspaceId)
          const exists = (data._notifications ?? []).some(item => item.id === notification.id)
          if (!exists) await writeWorkspaceData(workspaceId, { ...data, _notifications: [...(data._notifications ?? []), notification] })
          nodeRun.output = { summary: exists ? 'Notification reused' : 'Notification created', recordId: notification.id }
          await completeSideEffect(node, receiptKey, nodeRun.output)
        }
      } else if (node.config.type === 'approval') {
        if (!dryRun) {
          approvals.push({ id: randomUUID(), runId: run.id, nodeId, automationId: automation.id, automationName: automation.name, message: materialize(node.config.message, record, event, entityId), entityId, recordId: String(record?.id ?? ''), status: 'pending', requestedAt: nodeStartedAt })
          run.status = 'waiting'
          wait = true
        }
        nodeRun.status = dryRun ? 'success' : 'waiting'
        nodeRun.output = { summary: dryRun ? 'Approval request validated' : 'Waiting for approval' }
      } else if (node.config.type === 'create-record' || node.config.type === 'update-record') {
        const manifest = await currentManifest(workspaceId)
        const targetEntity = manifest?.entities?.find(item => item.id === node.config.entityId)
        if (!targetEntity) throw new Error('The workflow record type is no longer available.')
        const rendered = materializeFields(node.config.fields, record, event, entityId)
        const data = await readWorkspaceData(workspaceId)
        if (dryRun) {
          validateRecordValues(targetEntity, rendered, { partial: node.config.type === 'update-record', data, checkRelations: false })
          nodeRun.output = { summary: `${node.config.type === 'create-record' ? 'Create' : 'Update'} ${targetEntity.label} validated` }
        } else {
          const values = validateRecordValues(targetEntity, rendered, { partial: node.config.type === 'update-record', data })
          if (node.config.type === 'create-record') {
            const timestamp = new Date().toISOString()
            const recordId = deterministicUuid(receiptKey)
            const existing = (data[targetEntity.id] ?? []).find(item => item.id === recordId)
            const created = existing ?? { id: recordId, workspaceId, ...values, createdAt: timestamp, updatedAt: timestamp }
            if (!existing) await writeWorkspaceData(workspaceId, { ...data, [targetEntity.id]: [...(data[targetEntity.id] ?? []), created] })
            nodeRun.output = { summary: existing ? `${targetEntity.label} reused` : `${targetEntity.label} created`, recordId: created.id }
            await completeSideEffect(node, receiptKey, nodeRun.output)
          } else {
            if (targetEntity.id !== entityId) throw new Error('Update actions can only change the record that triggered the workflow.')
            const collection = data[targetEntity.id] ?? []
            if (!collection.some(item => item.id === record?.id)) throw new Error('The triggering record no longer exists.')
            await writeWorkspaceData(workspaceId, { ...data, [targetEntity.id]: collection.map(item => item.id === record.id ? { ...item, ...values, updatedAt: new Date().toISOString() } : item) })
            nodeRun.output = { summary: `${targetEntity.label} updated`, recordId: String(record.id) }
            await completeSideEffect(node, receiptKey, nodeRun.output)
          }
        }
      } else if (node.config.type === 'webhook') {
        const connector = state.connectors.find(item => item.id === node.config.connectorId)
        if (!connector) throw new Error('Connector not found.')
        if (dryRun) {
          nodeRun.output = { summary: `Webhook to ${connector.endpointHost} validated`, attempts: 0 }
        } else {
          const endpointUrl = connector.endpointUrl ?? await credentialFor(workspaceId, connector.credentialRef)
          let response
          let lastError
          let attempts = 0
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            attempts = attempt
            try {
              response = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'user-agent': 'Wesify-Automation/1.0', 'idempotency-key': receiptKey, 'x-wesify-delivery-id': receiptKey },
                body: JSON.stringify({ source: 'Wesify', workspaceId, automation: { id: automation.id, name: automation.name }, event: { type: event, entityId, occurredAt: startedAt }, record }),
                signal: AbortSignal.timeout(12_000),
              })
              if (response.ok || (response.status < 500 && response.status !== 429)) break
              lastError = new Error(`Webhook returned ${response.status}.`)
            } catch (error) { lastError = error }
            if (attempt < 3) await delay(200 * attempt)
          }
          run.responseStatus = response?.status
          nodeRun.output = { summary: response ? `Webhook returned ${response.status}` : 'Webhook did not answer', responseStatus: response?.status, attempts }
          if (!response?.ok) throw lastError ?? new Error(`Webhook returned ${response?.status ?? 'no response'}.`)
          await completeSideEffect(node, receiptKey, nodeRun.output)
        }
      }
    } catch (error) {
      nodeRun.status = 'failed'
      nodeRun.error = error instanceof Error ? error.message : 'Workflow node failed.'
      run.status = 'failed'
      run.error = nodeRun.error
    }
    nodeRun.finishedAt = new Date().toISOString()
    run.nodeRuns.push(nodeRun)
    if (wait || run.status === 'failed') continue
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (node.type !== 'condition' || edge.sourceHandle === branch) queue.push(edge.target)
    }
  }

  run.finishedAt = new Date().toISOString()
  const latest = await readAutomationWorkspace(workspaceId)
  const runs = latest.runs.some(item => item.id === run.id)
    ? latest.runs.map(item => item.id === run.id ? run : item)
    : [...latest.runs.slice(-199), run]
  await writeAutomationWorkspace(workspaceId, { ...latest, approvals: [...latest.approvals, ...approvals], runs })
  return run
}

export async function resumeManagedAutomation(workspaceId, automation, approval, decision) {
  const state = await readAutomationWorkspace(workspaceId)
  const run = state.runs.find(item => item.id === approval.runId)
  if (!run || !approval.nodeId) return null
  const decided = {
    ...run,
    status: decision === 'approved' ? 'success' : 'cancelled',
    error: decision === 'approved' ? undefined : 'Approval rejected.',
    finishedAt: new Date().toISOString(),
    nodeRuns: (run.nodeRuns ?? []).map(item => item.nodeId === approval.nodeId ? {
      ...item,
      status: decision === 'approved' ? 'success' : 'failed',
      output: { ...item.output, summary: decision === 'approved' ? 'Approved' : 'Rejected' },
      ...(decision === 'approved' ? {} : { error: 'Approval rejected.' }),
      finishedAt: new Date().toISOString(),
    } : item),
  }
  await writeAutomationWorkspace(workspaceId, { ...state, runs: state.runs.map(item => item.id === decided.id ? decided : item) })
  if (decision !== 'approved') return decided
  return executeManagedAutomation(workspaceId, automation, run.event, run.entityId, run.recordSnapshot ?? { id: run.recordId }, false, {
    resumeRunId: run.id,
    resumeAfterNodeId: approval.nodeId,
    graph: run.graphSnapshot,
  })
}

export async function retryManagedAutomationRun(workspaceId, run, automation, mode = 'current') {
  const data = await readWorkspaceData(workspaceId)
  const record = (data[run.entityId] ?? []).find(item => item.id === run.recordId) ?? run.recordSnapshot
  if (!record) throw Object.assign(new Error('The record used by this execution no longer exists.'), { status: 409 })
  if (mode === 'original' && !run.graphSnapshot) throw Object.assign(new Error('This earlier execution did not retain its workflow version.'), { status: 409 })
  return executeManagedAutomation(workspaceId, automation, run.event, run.entityId, record, false, {
    graph: mode === 'original' ? run.graphSnapshot : workflowGraphFor(automation),
    retryOf: run.id,
    rootRunId: run.rootRunId ?? run.id,
    rootExecutionKey: run.rootExecutionKey,
    attempt: Number(run.attempt ?? 1) + 1,
  })
}

export async function triggerManagedAutomations(workspaceId, event, entityId, record) {
  const state = await readAutomationWorkspace(workspaceId)
  const matching = state.automations.filter(item => item.enabled && workflowTriggerMatches(item, event, entityId))
  for (const automation of matching) {
    try { await executeManagedAutomation(workspaceId, automation, event, entityId, record) }
    catch (error) { console.warn(`Automation ${automation.id} failed: ${error?.message ?? error}`) }
  }
}
