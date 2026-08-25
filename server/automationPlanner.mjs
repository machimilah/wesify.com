/**
 * Evidence-backed automation rules compiled from the command center specification.
 *
 * The interview has already selected the company's capabilities and records. These rules only
 * activate when both the supporting capability and the exact record shape exist, which keeps the
 * planner conservative: Wesify automates what it can prove the command center supports.
 */

const rules = [
  { id: 'blocked-work-escalation', capabilityIds: ['work.tasks'], entityId: 'tasks', event: 'updated', field: 'status', equals: 'Blocked', name: 'Escalate blocked work', summary: 'Alert the operating team when committed work becomes blocked.', action: 'notification', message: 'A task is blocked and needs attention.', risk: 'medium', pattern: 'Commitment monitoring and escalation' },
  { id: 'purchase-approval', capabilityIds: ['procurement.purchasing'], entityId: 'purchase-orders', event: 'updated', field: 'status', equals: 'Awaiting approval', name: 'Route purchase approvals', summary: 'Open a decision request when a purchase order reaches its approval gate.', action: 'approval', message: 'A purchase order is awaiting approval.', risk: 'high', pattern: 'Policy threshold approval' },
  { id: 'expense-approval', capabilityIds: ['finance.expenses'], entityId: 'expenses', event: 'updated', field: 'status', equals: 'Submitted', name: 'Route submitted expenses', summary: 'Send submitted spending to an authorized human before it can proceed.', action: 'approval', message: 'An expense is ready for review.', risk: 'high', pattern: 'Policy threshold approval' },
  { id: 'low-stock-response', capabilityIds: ['inventory.stock'], entityId: 'stock-items', event: 'updated', field: 'status', equals: 'Low stock', name: 'Respond to low stock', summary: 'Alert operations as soon as an item reaches its replenishment point.', action: 'notification', message: 'An inventory item has reached low stock.', risk: 'medium', pattern: 'Demand-based replenishment' },
  { id: 'quality-containment', capabilityIds: ['quality.inspections'], entityId: 'quality-checks', event: 'updated', field: 'status', equals: 'Fail', name: 'Contain failed inspections', summary: 'Create a controlled decision point when an inspection fails.', action: 'approval', message: 'A failed quality inspection requires a containment decision.', risk: 'high', pattern: 'Quality exception and containment' },
  { id: 'asset-exception', capabilityIds: ['maintenance.assets'], entityId: 'equipment', event: 'updated', field: 'status', equals: 'Out of service', name: 'Escalate unavailable equipment', summary: 'Alert the responsible team when an asset can no longer operate.', action: 'notification', message: 'Equipment is out of service and requires attention.', risk: 'medium', pattern: 'Asset lock and controlled release' },
  { id: 'maintenance-scheduling', capabilityIds: ['maintenance.assets'], entityId: 'maintenance-orders', event: 'updated', field: 'status', equals: 'Requested', name: 'Schedule requested maintenance', summary: 'Notify operations when preventive or corrective work is ready to schedule.', action: 'notification', message: 'A maintenance request is ready to schedule.', risk: 'low', pattern: 'Preventive work scheduling' },
  { id: 'delivery-exception', capabilityIds: ['logistics.shipping'], entityId: 'shipments', event: 'updated', field: 'status', equals: 'Exception', name: 'Escalate delivery exceptions', summary: 'Alert operations when a shipment leaves its expected flow.', action: 'notification', message: 'A shipment has a delivery exception.', risk: 'medium', pattern: 'Delivery proof and exception handling' },
  { id: 'collections-escalation', capabilityIds: ['finance.invoicing'], entityId: 'invoices', event: 'updated', field: 'status', equals: 'Overdue', name: 'Escalate overdue receivables', summary: 'Alert the finance owner when an invoice becomes overdue.', action: 'notification', message: 'An invoice is overdue and needs collection follow-up.', risk: 'medium', pattern: 'Receivables reminder and escalation' },
  { id: 'return-approval', capabilityIds: ['commerce.returns'], entityId: 'returns', event: 'updated', field: 'status', equals: 'Requested', name: 'Review return requests', summary: 'Create a decision request before a return or refund proceeds.', action: 'approval', message: 'A return request is awaiting a decision.', risk: 'high', pattern: 'Complaint evidence, decision and resolution' },
  { id: 'employee-onboarding-control', capabilityIds: ['people.directory'], entityId: 'employees', event: 'created', name: 'Review employee onboarding', summary: 'Create a controlled onboarding checkpoint for every new employee record.', action: 'approval', message: 'A new employee onboarding requires confirmation.', risk: 'high', pattern: 'Employee lifecycle control' },
  { id: 'contract-acceptance-control', capabilityIds: ['sales.contracts'], entityId: 'contracts', event: 'updated', field: 'status', equals: 'Awaiting signature', name: 'Review contract acceptance', summary: 'Keep contract acceptance behind an accountable human decision.', action: 'approval', message: 'A contract is awaiting acceptance and signature.', risk: 'high', pattern: 'Contract acceptance control' },
]

function supportsRule(rule, specification) {
  const active = new Set(specification.capabilities ?? [])
  const entity = (specification.entities ?? []).find(item => item.id === rule.entityId)
  if (!entity || !rule.capabilityIds.some(id => active.has(id))) return false
  if (!rule.field) return true
  const field = entity.fields?.find(item => item.id === rule.field)
  return Boolean(field && (!rule.equals || !field.options || field.options.includes(rule.equals)))
}

export function compileGeneratedAutomations(specification, now = new Date().toISOString()) {
  return rules.filter(rule => supportsRule(rule, specification)).map(rule => ({
    id: `generated-${rule.id}`,
    planKey: rule.id,
    origin: 'generated',
    name: rule.name,
    summary: rule.summary,
    rationale: `${rule.pattern} was selected because ${specification.entities.find(item => item.id === rule.entityId)?.pluralLabel ?? rule.entityId} are part of this command center.`,
    risk: rule.risk,
    humanControl: rule.action === 'approval' ? 'approval-required' : 'exception',
    enabled: true,
    reviewStatus: 'approved',
    trigger: { entityId: rule.entityId, event: rule.event, ...(rule.field ? { field: rule.field, equals: rule.equals } : {}) },
    action: { type: rule.action, message: rule.message },
    steps: [
      `Watch ${specification.entities.find(item => item.id === rule.entityId)?.pluralLabel ?? rule.entityId}`,
      ...(rule.field ? [`Check ${rule.field} = ${rule.equals}`] : []),
      rule.action === 'approval' ? 'Create a human approval request' : 'Notify the responsible team',
      'Record the outcome in the audit history',
    ],
    createdAt: now,
    updatedAt: now,
  }))
}
