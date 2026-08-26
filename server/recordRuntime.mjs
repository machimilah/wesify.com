import { randomUUID } from 'node:crypto'
import { audit } from './access.mjs'
import { triggerManagedAutomations } from './automations.mjs'
import { dispatchMutationEvents, mutationEventDefinitions, triggerEventNotifications } from './businessEvents.mjs'
import { reconcileReceivables } from './financialIntegrity.mjs'
import { reconcileInventory } from './inventoryIntegrity.mjs'

export function triggerWorkflows(manifest, data, entityId, event, record) {
  const notifications = data._notifications ?? []
  for (const workflow of manifest.workflows ?? []) {
    const trigger = workflow.trigger
    if (!workflow.enabled || trigger.entityId !== entityId || trigger.event !== event) continue
    if (trigger.field && String(record[trigger.field] ?? '') !== String(trigger.equals ?? '')) continue
    if (workflow.action.type === 'notify') notifications.push({ id: randomUUID(), message: workflow.action.message, entityId, recordId: record.id, createdAt: new Date().toISOString(), read: false })
  }
  return { ...data, _notifications: notifications }
}

export function integrityAfterMutation(manifest, previousData, nextData, mutation = {}) {
  const reconciled = reconcileInventory(nextData, manifest, previousData)
  const changed = reconciled.changed.filter(record => reconciled.entityId !== mutation.entityId || record.id !== mutation.recordId)
  let data = reconciled.data
  for (const record of changed) {
    data = triggerWorkflows(manifest, data, reconciled.entityId, 'updated', record)
    data = triggerEventNotifications(manifest, data, mutationEventDefinitions(manifest, reconciled.entityId, 'updated'), reconciled.entityId, record)
  }
  const finance = reconcileReceivables(data, manifest)
  const financeChanged = finance.changed.filter(record => finance.entityId !== mutation.entityId || record.id !== mutation.recordId)
  data = finance.data
  for (const record of financeChanged) {
    data = triggerWorkflows(manifest, data, finance.entityId, 'updated', record)
    data = triggerEventNotifications(manifest, data, mutationEventDefinitions(manifest, finance.entityId, 'updated'), finance.entityId, record)
  }
  return { ...reconciled, data, changed, finance: { ...finance, changed: financeChanged } }
}

export async function emitIntegrityEffects(workspaceId, manifest, request, inventory) {
  if (!inventory.changed.length && !inventory.finance?.changed.length) return
  if (inventory.entityId && inventory.changed.length) {
    await audit(workspaceId, 'inventory.reconciled', request, { entityId: inventory.entityId, records: inventory.changed.map(record => record.id) })
    for (const record of inventory.changed) {
      await triggerManagedAutomations(workspaceId, 'updated', inventory.entityId, record)
      await dispatchMutationEvents(workspaceId, manifest, request, inventory.entityId, 'updated', record, { quantity: record.quantity ?? record.stock, status: record.status })
    }
  }
  if (inventory.finance?.changed.length) {
    await audit(workspaceId, 'receivables.reconciled', request, { records: inventory.finance.changed.map(record => record.id) })
    for (const record of inventory.finance.changed) {
      await triggerManagedAutomations(workspaceId, 'updated', inventory.finance.entityId, record)
      await dispatchMutationEvents(workspaceId, manifest, request, inventory.finance.entityId, 'updated', record, { balance: record.balance, status: record.status })
    }
  }
}
