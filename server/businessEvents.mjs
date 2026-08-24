import { randomUUID } from 'node:crypto'
import { audit } from './access.mjs'
import { triggerManagedAutomations } from './automations.mjs'

export function mutationEventDefinitions(manifest, entityId, lifecycle) {
  return (manifest.specification?.eventArchitecture?.definitions ?? []).filter(definition => definition.lifecycle === lifecycle && definition.sourceEntityIds?.includes(entityId))
}

export function triggerEventNotifications(manifest, data, definitions, entityId, record) {
  const notifications = data._notifications ?? []
  const routes = manifest.specification?.eventArchitecture?.routes ?? []
  for (const definition of definitions) {
    const route = routes.find(item => item.eventType === definition.type)
    if (!route?.targets.some(target => target.kind === 'notification')) continue
    notifications.push({
      id: randomUUID(),
      message: `${definition.label}: ${String(record?.name ?? record?.title ?? record?.id ?? 'record')}`,
      entityId,
      recordId: String(record?.id ?? ''),
      eventType: definition.type,
      severity: definition.severity,
      createdAt: new Date().toISOString(),
      read: false,
    })
  }
  return { ...data, _notifications: notifications }
}

export async function dispatchMutationEvents(workspaceId, manifest, request, entityId, lifecycle, record, changes = {}) {
  const definitions = mutationEventDefinitions(manifest, entityId, lifecycle)
  await Promise.all(definitions.map(async definition => {
    const eventId = randomUUID()
    const occurredAt = new Date().toISOString()
    await audit(workspaceId, definition.type, request, {
      eventId,
      eventType: definition.type,
      severity: definition.severity,
      entityId,
      recordId: String(record?.id ?? ''),
      occurredAt,
      changes,
    })
    await triggerManagedAutomations(workspaceId, definition.type, entityId, { ...record, eventId, occurredAt, changes })
  }))
}
