import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { projectPaths } from './project-builder.mjs'
import { writeJsonAtomic } from './atomicWrite.mjs'

/**
 * Managed automations: when a record changes, tell another system.
 *
 * The only action is an outbound webhook, and that is deliberate. BO sending a POST somewhere cannot
 * damage the workspace it came from, while an automation that writes back into BO could — and
 * automations are written by an operator experimenting, not by someone who will test them first.
 */

export function emptyAutomationWorkspace() { return { connectors: [], automations: [], runs: [] } }

const automationFile = workspaceId => path.join(projectPaths(workspaceId).root, 'automations.json')

export async function readAutomationWorkspace(workspaceId) {
  try { return JSON.parse(await readFile(automationFile(workspaceId), 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return emptyAutomationWorkspace()
    throw error
  }
}

export async function writeAutomationWorkspace(workspaceId, value) {
  await writeJsonAtomic(automationFile(workspaceId), value)
}

/**
 * Refuses a webhook target that would make BO into somebody's port scanner.
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
  return { connectors: value.connectors.map(({ endpointUrl, ...connector }) => connector), automations: value.automations, runs: value.runs.slice(-100).reverse() }
}

export async function executeManagedAutomation(workspaceId, automation, event, entityId, record, dryRun = false) {
  const state = await readAutomationWorkspace(workspaceId)
  const connector = state.connectors.find(item => item.id === automation.action.connectorId)
  const startedAt = new Date().toISOString()
  const run = { id: randomUUID(), automationId: automation.id, automationName: automation.name, status: dryRun ? 'simulated' : 'success', event, entityId, recordId: String(record?.id ?? ''), startedAt, finishedAt: startedAt }
  if (!connector) { run.status = 'failed'; run.error = 'Connector not found.' }
  else if (!dryRun) {
    try {
      const response = await fetch(connector.endpointUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'BO-Automation/1.0' },
        body: JSON.stringify({ source: 'BO', workspaceId, automation: { id: automation.id, name: automation.name }, event: { type: event, entityId, occurredAt: startedAt }, record }),
        signal: AbortSignal.timeout(12_000),
      })
      run.responseStatus = response.status
      if (!response.ok) { run.status = 'failed'; run.error = `Webhook returned ${response.status}.` }
    } catch (error) { run.status = 'failed'; run.error = error instanceof Error ? error.message : 'Webhook delivery failed.' }
  }
  run.finishedAt = new Date().toISOString()
  const latest = await readAutomationWorkspace(workspaceId)
  await writeAutomationWorkspace(workspaceId, { ...latest, runs: [...latest.runs.slice(-199), run] })
  return run
}

export async function triggerManagedAutomations(workspaceId, event, entityId, record) {
  const state = await readAutomationWorkspace(workspaceId)
  const matching = state.automations.filter(item => item.enabled && item.trigger.event === event && item.trigger.entityId === entityId)
  await Promise.allSettled(matching.map(item => executeManagedAutomation(workspaceId, item, event, entityId, record)))
}
