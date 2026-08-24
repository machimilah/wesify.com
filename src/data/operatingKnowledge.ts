/**
 * Generalized operating knowledge derived from IOS-PYME.
 *
 * This is not a second product model and it is not a manufacturing preset. It is evidence the
 * existing discovery, capability planner and workspace compiler can consult when the company being
 * described makes a pattern relevant. Source wording is intentionally not reproduced.
 */

export type KnowledgeLayer = 'universal' | 'business-model' | 'industry' | 'jurisdiction'
export type KnowledgePriority = 'critical' | 'high' | 'medium'

export interface ProcessPattern {
  id: string
  name: string
  layer: KnowledgeLayer
  purpose: string
  capabilityIds: string[]
  events: string[]
  applicabilitySignals: string[]
  sourceStatus?: 'complete' | 'incomplete'
}

export interface MasterFieldHint {
  id: string
  label: string
  type: 'text' | 'long-text' | 'number' | 'currency' | 'date' | 'boolean' | 'email' | 'phone' | 'select' | 'relation' | 'file'
  options?: string[]
  required?: boolean
  evidenceSignals?: string[]
}

export interface MasterDataTemplate {
  id: string
  names: string[]
  layer: KnowledgeLayer
  capabilityIds: string[]
  coreFields: MasterFieldHint[]
  optionalFields: MasterFieldHint[]
  events: string[]
}

export interface AutomationPattern {
  id: string
  name: string
  layer: KnowledgeLayer
  pattern: Array<'trigger' | 'context' | 'condition' | 'decision' | 'approval' | 'action' | 'monitoring' | 'escalation' | 'audit'>
  capabilityIds: string[]
  humanControl: 'none' | 'exception' | 'approval-required'
}

export interface KpiPattern {
  id: string
  name: string
  layer: KnowledgeLayer
  purpose: string
  operation: 'count' | 'sum' | 'ratio' | 'duration' | 'variance' | 'trend'
  capabilityIds: string[]
}

export interface KnowledgeRequirementSpec {
  id: string
  domain: string
  objective: string
  priority: KnowledgePriority
  appliesWhen: string[]
  resolvedBy: string[]
  capabilityIds: string[]
}

export interface GapRule {
  id: string
  title: string
  rationale: string
  layer: KnowledgeLayer
  appliesWhen: string[]
  recommendCapabilityIds: string[]
  severity: 'important' | 'watch'
}

export interface CapabilityKnowledge {
  layer: KnowledgeLayer
  source: 'platform' | 'ios-pyme-generalized' | 'mixed'
  knowledgeRequirementIds: string[]
  processIds: string[]
  eventTypes: string[]
  risks: string[]
  jurisdiction?: string
  executable: boolean
}

export const operatingKnowledgeSource = {
  id: 'ios-pyme',
  version: 1,
  treatment: 'generalized-operating-knowledge' as const,
  principles: ['connected company state', 'quality at source', 'exception-driven work', 'single source of truth', 'planning before execution', 'measurable commitments'],
}

/** Recorded so excluded material cannot quietly re-enter through a later prompt or catalog update. */
export const excludedOperatingKnowledge = [
  {
    id: 'do-payroll-and-labor-calculations',
    sourceArea: 'process-17-payroll',
    reason: 'Dominican payroll, working-time, overtime, holiday and labor calculations are jurisdiction-specific and explicitly excluded from this implementation.',
    executable: false,
  },
] as const

export const processPatterns: ProcessPattern[] = [
  { id: 'planning', name: 'Integrated planning', layer: 'universal', purpose: 'Align demand, capacity, cash, people, risks and commitments into one approved operating plan.', capabilityIds: ['finance.budgets', 'analytics.reporting', 'work.tasks'], events: ['plan.created', 'plan.approved', 'commitment.overdue'], applicabilitySignals: [] },
  { id: 'supply', name: 'Supply and purchasing', layer: 'business-model', purpose: 'Turn demand into controlled supplier commitments, receipts and exceptions.', capabilityIds: ['procurement.suppliers', 'procurement.purchasing', 'inventory.stock'], events: ['purchase.requested', 'purchase.approved', 'purchase.confirmed', 'goods.received', 'supplier.exception'], applicabilitySignals: ['supplier', 'vendor', 'materials', 'stock'] },
  { id: 'sales', name: 'Sales and order acceptance', layer: 'universal', purpose: 'Connect demand, commercial commitments, credit conditions and deliverability.', capabilityIds: ['crm.contacts', 'crm.pipeline', 'sales.quotes', 'sales.orders'], events: ['lead.created', 'quote.sent', 'order.accepted', 'order.blocked'], applicabilitySignals: ['customer', 'client', 'sell', 'order', 'quote'] },
  { id: 'production-planning', name: 'Constraint-aware production planning', layer: 'industry', purpose: 'Create feasible production commitments from orders, materials, capacity and constraints.', capabilityIds: ['manufacturing.production', 'manufacturing.bom', 'inventory.stock'], events: ['production.plan.created', 'production.order.blocked', 'capacity.changed'], applicabilitySignals: ['manufacturing', 'factory', 'production line', 'fabrication'] },
  { id: 'production', name: 'Controlled production execution', layer: 'industry', purpose: 'Execute work from setup through completion with traceability and controlled handoffs.', capabilityIds: ['manufacturing.production', 'inventory.traceability'], events: ['production.started', 'production.completed', 'production.closed'], applicabilitySignals: ['manufacturing', 'production', 'factory'] },
  { id: 'quality-control', name: 'Quality at source', layer: 'industry', purpose: 'Prevent defects through specifications, in-process checks and immediate containment.', capabilityIds: ['quality.inspections', 'inventory.traceability'], events: ['inspection.completed', 'quality.threshold_exceeded'], applicabilitySignals: ['quality', 'inspection', 'regulated product', 'batch'] },
  { id: 'nonconformance', name: 'Nonconformance management', layer: 'industry', purpose: 'Contain, classify, decide and learn from material or service deviations.', capabilityIds: ['quality.inspections', 'support.tickets'], events: ['nonconformance.created', 'nonconformance.dispositioned', 'corrective-action.completed'], applicabilitySignals: ['defect', 'nonconforming', 'scrap', 'quality issue'] },
  { id: 'corrective-maintenance', name: 'Corrective maintenance', layer: 'industry', purpose: 'Restore critical assets while exposing production, cost and safety impact.', capabilityIds: ['maintenance.assets', 'service.assets'], events: ['asset.failed', 'maintenance.requested', 'asset.returned-to-service'], applicabilitySignals: ['machine', 'equipment', 'breakdown', 'asset'] },
  { id: 'finished-output-handoff', name: 'Finished-output and material handoff', layer: 'industry', purpose: 'Move completed output and unused inputs with complete inventory traceability.', capabilityIds: ['manufacturing.production', 'inventory.stock', 'inventory.traceability'], events: ['finished-goods.received', 'material.returned'], applicabilitySignals: ['finished goods', 'production', 'warehouse'] },
  { id: 'finished-goods-warehouse', name: 'Finished-goods warehouse', layer: 'industry', purpose: 'Control finished inventory before dispatch.', capabilityIds: ['inventory.warehouses', 'inventory.traceability'], events: ['finished-goods.stored', 'finished-goods.released'], applicabilitySignals: ['finished goods warehouse'], sourceStatus: 'incomplete' },
  { id: 'distribution', name: 'Distribution and delivery', layer: 'business-model', purpose: 'Plan loads, routes, vehicles, delivery evidence and exceptions.', capabilityIds: ['logistics.shipping', 'logistics.fleet'], events: ['shipment.planned', 'shipment.dispatched', 'delivery.completed', 'delivery.exception'], applicabilitySignals: ['ship', 'delivery', 'fleet', 'route', 'distribution'] },
  { id: 'collections', name: 'Receivables and collections', layer: 'universal', purpose: 'Protect cash flow through visible balances, promises, reminders and escalation.', capabilityIds: ['finance.invoicing', 'finance.payments'], events: ['invoice.issued', 'invoice.overdue', 'payment.promise.created', 'payment.received'], applicabilitySignals: ['invoice', 'credit terms', 'late payment', 'accounts receivable'] },
  { id: 'payments', name: 'Controlled outgoing payments', layer: 'universal', purpose: 'Validate obligations, approvals, liquidity and payment confirmation.', capabilityIds: ['finance.expenses', 'finance.payments', 'documents.approvals'], events: ['payment.proposed', 'payment.approved', 'payment.executed'], applicabilitySignals: ['supplier payment', 'accounts payable', 'payment run'] },
  { id: 'complaints', name: 'Complaint and return resolution', layer: 'universal', purpose: 'Capture evidence, decide resolution, control financial impact and prevent recurrence.', capabilityIds: ['support.tickets', 'commerce.returns', 'quality.inspections'], events: ['complaint.created', 'return.approved', 'complaint.resolved'], applicabilitySignals: ['complaint', 'claim', 'return', 'customer issue'] },
  { id: 'preventive-maintenance', name: 'Preventive maintenance', layer: 'industry', purpose: 'Plan interventions, resources and release-to-service for operational assets.', capabilityIds: ['maintenance.assets'], events: ['maintenance.due', 'asset.locked', 'maintenance.completed', 'asset.released'], applicabilitySignals: ['machine', 'equipment', 'preventive maintenance', 'fleet'] },
  { id: 'indirect-purchasing', name: 'Indirect purchasing', layer: 'universal', purpose: 'Control non-planned purchases through approved suppliers, limits and evidence.', capabilityIds: ['procurement.suppliers', 'procurement.purchasing', 'documents.approvals'], events: ['purchase.requested', 'purchase.approved', 'purchase.received'], applicabilitySignals: ['office supplies', 'services purchased', 'indirect purchase', 'maintenance supplies'] },
  { id: 'recruiting', name: 'Recruiting and onboarding', layer: 'universal', purpose: 'Move an approved workforce need through selection, offer and readiness.', capabilityIds: ['people.recruiting', 'people.directory', 'documents.repository'], events: ['vacancy.opened', 'candidate.selected', 'offer.accepted', 'employee.onboarded'], applicabilitySignals: ['hire', 'recruit', 'vacancy', 'growing team'] },
  { id: 'offboarding', name: 'Employee offboarding', layer: 'universal', purpose: 'Coordinate knowledge transfer, assets, access, obligations and workforce continuity.', capabilityIds: ['people.directory', 'documents.repository', 'work.tasks'], events: ['employee.departure-requested', 'access.revoked', 'employee.offboarded'], applicabilitySignals: ['employee exit', 'offboarding', 'staff turnover'] },
  { id: 'period-close', name: 'Operational and financial period close', layer: 'universal', purpose: 'Validate completeness, reconcile exceptions, publish results and lock the period.', capabilityIds: ['accounting.ledger', 'analytics.reporting'], events: ['period.preclose-started', 'period.exception-found', 'period.closed'], applicabilitySignals: ['month end', 'financial close', 'accounting close'] },
  { id: 'waste-recovery', name: 'Waste and recovery control', layer: 'industry', purpose: 'Track waste origin, disposition, recovery, cost and improvement actions.', capabilityIds: ['manufacturing.production', 'quality.inspections', 'inventory.traceability'], events: ['waste.recorded', 'material.recovered', 'rework.created'], applicabilitySignals: ['scrap', 'waste', 'rework', 'recycling'] },
]

export const masterDataTemplates: MasterDataTemplate[] = [
  { id: 'products', names: ['product', 'products', 'service', 'services'], layer: 'business-model', capabilityIds: ['commerce.products'], coreFields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Active', 'Archived'] }], optionalFields: [{ id: 'sku', label: 'SKU', type: 'text', evidenceSignals: ['sku', 'catalog', 'physical product'] }, { id: 'unit', label: 'Unit of measure', type: 'text', evidenceSignals: ['unit', 'weight', 'volume', 'pack'] }, { id: 'specification', label: 'Specification', type: 'long-text', evidenceSignals: ['specification', 'quality'] }], events: ['product.created', 'product.changed'] },
  { id: 'machines', names: ['machine', 'machines', 'equipment', 'asset', 'assets'], layer: 'industry', capabilityIds: ['maintenance.assets', 'service.assets'], coreFields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Available', 'In use', 'Maintenance', 'Unavailable'] }], optionalFields: [{ id: 'assetNumber', label: 'Asset number', type: 'text' }, { id: 'criticality', label: 'Criticality', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'], evidenceSignals: ['critical', 'downtime', 'breakdown'] }, { id: 'nextMaintenance', label: 'Next maintenance', type: 'date', evidenceSignals: ['maintenance'] }], events: ['asset.created', 'asset.status-changed'] },
  { id: 'people', names: ['employee', 'employees', 'team', 'staff', 'crew'], layer: 'universal', capabilityIds: ['people.directory'], coreFields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'role', label: 'Role', type: 'text' }, { id: 'status', label: 'Status', type: 'select', options: ['Active', 'On leave', 'Departed'] }], optionalFields: [{ id: 'skills', label: 'Skills', type: 'long-text', evidenceSignals: ['skill', 'certification', 'training'] }, { id: 'manager', label: 'Manager', type: 'text', evidenceSignals: ['manager', 'supervisor'] }], events: ['employee.created', 'employee.changed'] },
  { id: 'materials', names: ['material', 'materials', 'raw materials', 'stock item', 'stock items'], layer: 'industry', capabilityIds: ['inventory.stock', 'manufacturing.bom'], coreFields: [{ id: 'name', label: 'Material', type: 'text', required: true }, { id: 'quantity', label: 'Quantity', type: 'number' }, { id: 'status', label: 'Status', type: 'select', options: ['Available', 'Low stock', 'Unavailable'] }], optionalFields: [{ id: 'lot', label: 'Lot or batch', type: 'text', evidenceSignals: ['lot', 'batch', 'traceability'] }, { id: 'reorderPoint', label: 'Reorder point', type: 'number', evidenceSignals: ['reorder', 'minimum stock', 'shortage'] }], events: ['inventory.changed', 'inventory.low'] },
  { id: 'spares', names: ['spare', 'spares', 'spare part', 'spare parts'], layer: 'industry', capabilityIds: ['maintenance.assets', 'inventory.stock'], coreFields: [{ id: 'name', label: 'Spare part', type: 'text', required: true }, { id: 'quantity', label: 'Quantity', type: 'number' }], optionalFields: [{ id: 'criticality', label: 'Criticality', type: 'select', options: ['Routine', 'Important', 'Critical'] }, { id: 'leadTimeDays', label: 'Lead time (days)', type: 'number' }], events: ['spare.changed', 'spare.low'] },
  { id: 'indirect-costs', names: ['indirect cost', 'indirect costs', 'overhead', 'overheads'], layer: 'universal', capabilityIds: ['finance.expenses', 'finance.budgets'], coreFields: [{ id: 'description', label: 'Cost', type: 'text', required: true }, { id: 'amount', label: 'Amount', type: 'currency' }], optionalFields: [{ id: 'costType', label: 'Cost type', type: 'select', options: ['Fixed', 'Variable'] }, { id: 'effectiveDate', label: 'Effective date', type: 'date' }], events: ['cost.created', 'cost.changed'] },
  { id: 'warehouses', names: ['warehouse', 'warehouses', 'storage location', 'storage locations'], layer: 'business-model', capabilityIds: ['inventory.warehouses'], coreFields: [{ id: 'name', label: 'Warehouse', type: 'text', required: true }, { id: 'location', label: 'Location', type: 'text' }], optionalFields: [{ id: 'capacity', label: 'Capacity', type: 'number', evidenceSignals: ['capacity', 'space'] }, { id: 'status', label: 'Status', type: 'select', options: ['Active', 'Restricted', 'Closed'] }], events: ['warehouse.created', 'warehouse.capacity-changed'] },
  { id: 'quality-specifications', names: ['quality check', 'quality checks', 'inspection', 'inspections', 'quality specification', 'quality specifications'], layer: 'industry', capabilityIds: ['quality.inspections'], coreFields: [{ id: 'name', label: 'Check', type: 'text', required: true }, { id: 'status', label: 'Result', type: 'select', options: ['Pending', 'Pass', 'Fail'] }], optionalFields: [{ id: 'lowerLimit', label: 'Lower limit', type: 'number', evidenceSignals: ['limit', 'tolerance', 'spc'] }, { id: 'upperLimit', label: 'Upper limit', type: 'number', evidenceSignals: ['limit', 'tolerance', 'spc'] }, { id: 'evidence', label: 'Evidence', type: 'file' }], events: ['inspection.completed', 'inspection.failed'] },
  { id: 'logistics', names: ['shipment', 'shipments', 'delivery', 'deliveries', 'route', 'routes'], layer: 'business-model', capabilityIds: ['logistics.shipping'], coreFields: [{ id: 'reference', label: 'Reference', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Planned', 'Dispatched', 'Delivered', 'Exception'] }], optionalFields: [{ id: 'scheduledDate', label: 'Scheduled date', type: 'date' }, { id: 'deliveryEvidence', label: 'Delivery evidence', type: 'file', evidenceSignals: ['proof of delivery', 'signature', 'photo'] }], events: ['shipment.created', 'delivery.completed'] },
  { id: 'customers', names: ['customer', 'customers', 'client', 'clients', 'account', 'accounts'], layer: 'universal', capabilityIds: ['crm.contacts'], coreFields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Lead', 'Active', 'Inactive'] }], optionalFields: [{ id: 'paymentTerms', label: 'Payment terms', type: 'text', evidenceSignals: ['credit', 'payment terms', 'invoice'] }, { id: 'riskLevel', label: 'Risk level', type: 'select', options: ['Low', 'Medium', 'High'], evidenceSignals: ['credit risk', 'late payment'] }], events: ['customer.created', 'customer.changed'] },
  { id: 'suppliers', names: ['supplier', 'suppliers', 'vendor', 'vendors'], layer: 'universal', capabilityIds: ['procurement.suppliers'], coreFields: [{ id: 'name', label: 'Supplier', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Candidate', 'Approved', 'Blocked'] }], optionalFields: [{ id: 'leadTimeDays', label: 'Lead time (days)', type: 'number', evidenceSignals: ['lead time', 'delivery time'] }, { id: 'certifications', label: 'Certifications', type: 'long-text', evidenceSignals: ['certification', 'compliance'] }, { id: 'riskLevel', label: 'Risk level', type: 'select', options: ['Low', 'Medium', 'High'], evidenceSignals: ['supplier risk', 'single source', 'dependency'] }], events: ['supplier.created', 'supplier.approved', 'supplier.blocked'] },
  { id: 'audits', names: ['audit', 'audits', 'control', 'controls'], layer: 'universal', capabilityIds: ['compliance.controls'], coreFields: [{ id: 'name', label: 'Audit', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Planned', 'Open', 'Complete'] }], optionalFields: [{ id: 'dueDate', label: 'Due date', type: 'date' }, { id: 'evidence', label: 'Evidence', type: 'file' }, { id: 'finding', label: 'Finding', type: 'long-text' }], events: ['audit.started', 'finding.created', 'audit.closed'] },
  { id: 'projects', names: ['project', 'projects', 'job', 'jobs', 'engagement', 'engagements'], layer: 'business-model', capabilityIds: ['work.projects'], coreFields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Planned', 'Active', 'Blocked', 'Complete'] }], optionalFields: [{ id: 'budget', label: 'Budget', type: 'currency', evidenceSignals: ['budget', 'cost'] }, { id: 'dueDate', label: 'Due date', type: 'date' }, { id: 'risk', label: 'Risk', type: 'long-text', evidenceSignals: ['risk', 'blocked'] }], events: ['project.created', 'project.blocked', 'project.completed'] },
]

export const automationPatterns: AutomationPattern[] = [
  { id: 'commitment-escalation', name: 'Commitment monitoring and escalation', layer: 'universal', pattern: ['trigger', 'context', 'condition', 'action', 'monitoring', 'escalation', 'audit'], capabilityIds: ['work.tasks', 'analytics.reporting'], humanControl: 'exception' },
  { id: 'approval-threshold', name: 'Policy threshold approval', layer: 'universal', pattern: ['trigger', 'context', 'condition', 'decision', 'approval', 'action', 'audit'], capabilityIds: ['documents.approvals'], humanControl: 'approval-required' },
  { id: 'external-confirmation', name: 'External confirmation with timeout', layer: 'universal', pattern: ['trigger', 'action', 'monitoring', 'escalation', 'audit'], capabilityIds: ['procurement.purchasing', 'sales.orders'], humanControl: 'exception' },
  { id: 'constraint-release', name: 'Constraint-based release gate', layer: 'business-model', pattern: ['trigger', 'context', 'condition', 'decision', 'approval', 'action', 'audit'], capabilityIds: ['sales.orders', 'manufacturing.production'], humanControl: 'exception' },
  { id: 'inventory-replenishment', name: 'Demand-based replenishment', layer: 'business-model', pattern: ['trigger', 'context', 'condition', 'decision', 'action', 'monitoring'], capabilityIds: ['inventory.stock', 'procurement.purchasing'], humanControl: 'exception' },
  { id: 'quality-exception', name: 'Quality exception and containment', layer: 'industry', pattern: ['trigger', 'context', 'condition', 'action', 'approval', 'monitoring', 'escalation', 'audit'], capabilityIds: ['quality.inspections'], humanControl: 'approval-required' },
  { id: 'asset-lock-release', name: 'Asset lock and controlled release', layer: 'industry', pattern: ['trigger', 'condition', 'action', 'approval', 'monitoring', 'audit'], capabilityIds: ['maintenance.assets'], humanControl: 'approval-required' },
  { id: 'delivery-proof', name: 'Delivery proof and exception handling', layer: 'business-model', pattern: ['trigger', 'context', 'action', 'monitoring', 'escalation', 'audit'], capabilityIds: ['logistics.shipping'], humanControl: 'exception' },
  { id: 'collections-escalation', name: 'Receivables reminder and escalation', layer: 'universal', pattern: ['trigger', 'context', 'condition', 'action', 'monitoring', 'escalation', 'audit'], capabilityIds: ['finance.invoicing', 'finance.payments'], humanControl: 'exception' },
  { id: 'complaint-resolution', name: 'Complaint evidence, decision and resolution', layer: 'universal', pattern: ['trigger', 'context', 'condition', 'decision', 'approval', 'action', 'monitoring', 'audit'], capabilityIds: ['support.tickets', 'commerce.returns'], humanControl: 'approval-required' },
  { id: 'preventive-schedule', name: 'Preventive work scheduling', layer: 'industry', pattern: ['trigger', 'context', 'condition', 'action', 'monitoring', 'escalation'], capabilityIds: ['maintenance.assets'], humanControl: 'exception' },
  { id: 'employee-lifecycle', name: 'Employee onboarding or offboarding checklist', layer: 'universal', pattern: ['trigger', 'context', 'action', 'monitoring', 'escalation', 'audit'], capabilityIds: ['people.directory', 'people.recruiting', 'work.tasks'], humanControl: 'approval-required' },
  { id: 'period-close', name: 'Period close checklist and lock', layer: 'universal', pattern: ['trigger', 'context', 'condition', 'approval', 'action', 'monitoring', 'escalation', 'audit'], capabilityIds: ['accounting.ledger', 'analytics.reporting'], humanControl: 'approval-required' },
]

export const kpiPatterns: KpiPattern[] = [
  { id: 'revenue-vs-plan', name: 'Revenue versus plan', layer: 'universal', purpose: 'Detect commercial underperformance early.', operation: 'variance', capabilityIds: ['finance.budgets', 'finance.invoicing'] },
  { id: 'cash-position', name: 'Cash position', layer: 'universal', purpose: 'Understand near-term liquidity.', operation: 'trend', capabilityIds: ['finance.payments'] },
  { id: 'days-to-collect', name: 'Days to collect', layer: 'universal', purpose: 'Measure how quickly invoiced revenue becomes cash.', operation: 'duration', capabilityIds: ['finance.invoicing', 'finance.payments'] },
  { id: 'margin', name: 'Commercial margin', layer: 'universal', purpose: 'Protect profitable growth.', operation: 'ratio', capabilityIds: ['finance.invoicing', 'finance.expenses'] },
  { id: 'commitment-reliability', name: 'Commitment reliability', layer: 'universal', purpose: 'Measure whether owned actions close when promised.', operation: 'ratio', capabilityIds: ['work.tasks'] },
  { id: 'customer-complaints', name: 'Customer complaints', layer: 'universal', purpose: 'Monitor service and quality failures.', operation: 'count', capabilityIds: ['support.tickets'] },
  { id: 'supplier-reliability', name: 'Supplier reliability', layer: 'business-model', purpose: 'Expose supply continuity risk.', operation: 'ratio', capabilityIds: ['procurement.suppliers', 'procurement.purchasing'] },
  { id: 'inventory-accuracy', name: 'Inventory accuracy', layer: 'business-model', purpose: 'Measure trust in available-stock data.', operation: 'ratio', capabilityIds: ['inventory.stock'] },
  { id: 'stockouts', name: 'Stockouts', layer: 'business-model', purpose: 'Identify preventable service or production interruptions.', operation: 'count', capabilityIds: ['inventory.stock'] },
  { id: 'on-time-delivery', name: 'On-time delivery', layer: 'business-model', purpose: 'Measure delivery promise reliability.', operation: 'ratio', capabilityIds: ['logistics.shipping'] },
  { id: 'project-delivery', name: 'Projects delivered on time', layer: 'business-model', purpose: 'Measure execution reliability.', operation: 'ratio', capabilityIds: ['work.projects'] },
  { id: 'time-to-hire', name: 'Time to hire', layer: 'universal', purpose: 'Measure workforce replenishment speed.', operation: 'duration', capabilityIds: ['people.recruiting'] },
  { id: 'employee-turnover', name: 'Employee turnover', layer: 'universal', purpose: 'Expose workforce stability risk without calculating payroll.', operation: 'ratio', capabilityIds: ['people.directory'] },
  { id: 'training-completion', name: 'Training completion', layer: 'universal', purpose: 'Measure readiness against required skills.', operation: 'ratio', capabilityIds: ['people.directory'] },
  { id: 'production-effectiveness', name: 'Production effectiveness', layer: 'industry', purpose: 'Measure useful output against available production capacity.', operation: 'ratio', capabilityIds: ['manufacturing.production'] },
  { id: 'quality-conformance', name: 'Quality conformance', layer: 'industry', purpose: 'Measure output meeting specification.', operation: 'ratio', capabilityIds: ['quality.inspections'] },
  { id: 'waste-rate', name: 'Waste rate', layer: 'industry', purpose: 'Measure input lost to scrap or rework.', operation: 'ratio', capabilityIds: ['manufacturing.production', 'quality.inspections'] },
  { id: 'asset-availability', name: 'Asset availability', layer: 'industry', purpose: 'Measure whether critical equipment is ready when needed.', operation: 'ratio', capabilityIds: ['maintenance.assets'] },
  { id: 'maintenance-duration', name: 'Maintenance duration', layer: 'industry', purpose: 'Measure recovery speed after asset failure.', operation: 'duration', capabilityIds: ['maintenance.assets'] },
  { id: 'period-close-duration', name: 'Period close duration', layer: 'universal', purpose: 'Measure financial information readiness.', operation: 'duration', capabilityIds: ['accounting.ledger'] },
]

export const knowledgeRequirementSpecs: KnowledgeRequirementSpec[] = [
  { id: 'value-flow', domain: 'operations', objective: 'Understand how a customer request becomes completed value and where responsibility changes.', priority: 'critical', appliesWhen: [], resolvedBy: ['from lead to', 'from order to', 'first', 'then', 'after', 'process', 'workflow', 'job runs'], capabilityIds: ['crm.contacts'] },
  { id: 'revenue-and-collection', domain: 'finance', objective: 'Understand when revenue is earned, invoiced, collected and considered at risk.', priority: 'critical', appliesWhen: [], resolvedBy: ['invoice', 'subscription', 'retainer', 'upfront', 'deposit', 'paid', 'payment terms', 'cash'], capabilityIds: ['finance.invoicing', 'finance.payments'] },
  { id: 'ownership-and-access', domain: 'organization', objective: 'Understand who owns work, who approves it and what information must be restricted.', priority: 'high', appliesWhen: ['team', 'employees', 'staff', 'department', 'manager'], resolvedBy: ['responsible', 'owner', 'approve', 'permission', 'manager', 'supervisor'], capabilityIds: ['people.directory', 'documents.approvals'] },
  { id: 'supply-continuity', domain: 'supply', objective: 'Understand critical suppliers, purchased inputs, lead times and single-source dependencies.', priority: 'high', appliesWhen: ['supplier', 'vendor', 'material', 'parts', 'stock'], resolvedBy: ['lead time', 'critical supplier', 'single source', 'alternative supplier', 'purchase order'], capabilityIds: ['procurement.suppliers', 'procurement.purchasing'] },
  { id: 'inventory-control', domain: 'inventory', objective: 'Understand where stock is held, how it is identified and what causes replenishment.', priority: 'high', appliesWhen: ['stock', 'inventory', 'warehouse', 'materials', 'physical products'], resolvedBy: ['warehouse', 'reorder', 'minimum stock', 'batch', 'lot', 'barcode', 'van stock'], capabilityIds: ['inventory.stock', 'inventory.warehouses', 'inventory.traceability'] },
  { id: 'planning-and-capacity', domain: 'planning', objective: 'Understand what is scheduled, which constraints limit delivery and how priorities are decided.', priority: 'high', appliesWhen: ['schedule', 'project', 'appointment', 'production', 'delivery', 'capacity'], resolvedBy: ['capacity', 'priority', 'deadline', 'schedule', 'availability', 'constraint'], capabilityIds: ['work.scheduling', 'work.projects', 'manufacturing.production'] },
  { id: 'quality-and-exceptions', domain: 'quality', objective: 'Understand what can go wrong, how it is detected, who decides and what evidence is retained.', priority: 'high', appliesWhen: ['quality', 'complaint', 'return', 'regulated', 'manufacturing', 'inspection'], resolvedBy: ['inspection', 'complaint', 'return', 'defect', 'evidence', 'quality check'], capabilityIds: ['quality.inspections', 'support.tickets', 'commerce.returns'] },
  { id: 'asset-continuity', domain: 'assets', objective: 'Understand which assets can stop delivery and how maintenance is planned and released.', priority: 'high', appliesWhen: ['machine', 'equipment', 'vehicle', 'asset', 'fleet'], resolvedBy: ['maintenance', 'breakdown', 'service interval', 'critical equipment', 'downtime'], capabilityIds: ['maintenance.assets', 'service.assets', 'logistics.fleet'] },
  { id: 'performance-and-goals', domain: 'management', objective: 'Understand which outcomes matter, who owns them and what threshold requires action.', priority: 'medium', appliesWhen: [], resolvedBy: ['goal', 'target', 'kpi', 'measure', 'margin', 'growth', 'on time'], capabilityIds: ['analytics.reporting'] },
  { id: 'systems-and-source-of-truth', domain: 'data', objective: 'Understand where operational truth lives today and which systems must remain authoritative.', priority: 'medium', appliesWhen: ['spreadsheet', 'software', 'system', 'quickbooks', 'xero', 'shopify', 'stripe'], resolvedBy: ['currently use', 'system of record', 'source of truth', 'integrate', 'sync'], capabilityIds: [] },
]

export const gapRules: GapRule[] = [
  { id: 'supplier-control', title: 'Supplier continuity is not yet represented', rationale: 'Purchased inputs create delivery risk unless suppliers and commitments are connected.', layer: 'business-model', appliesWhen: ['supplier', 'vendor', 'materials', 'parts'], recommendCapabilityIds: ['procurement.suppliers', 'procurement.purchasing'], severity: 'important' },
  { id: 'collection-control', title: 'Collections need an operating loop', rationale: 'Issuing invoices without tracking payment and overdue follow-up leaves cash risk invisible.', layer: 'universal', appliesWhen: ['invoice', 'credit terms', 'late payment', 'accounts receivable'], recommendCapabilityIds: ['finance.invoicing', 'finance.payments'], severity: 'important' },
  { id: 'inventory-location', title: 'Inventory locations are not yet explicit', rationale: 'Stock held in multiple places needs location ownership and replenishment visibility.', layer: 'business-model', appliesWhen: ['warehouse', 'multiple locations', 'van stock', 'stockroom'], recommendCapabilityIds: ['inventory.stock', 'inventory.warehouses'], severity: 'important' },
  { id: 'traceability', title: 'Traceability may be required', rationale: 'Lots, batches, regulated goods or expiry dates require movement history beyond quantity on hand.', layer: 'industry', appliesWhen: ['lot', 'batch', 'expiry', 'regulated product', 'serial number'], recommendCapabilityIds: ['inventory.traceability'], severity: 'important' },
  { id: 'quality-loop', title: 'Quality exceptions need a closed loop', rationale: 'Inspection or complaint evidence should connect detection, disposition and corrective action.', layer: 'industry', appliesWhen: ['inspection', 'defect', 'quality', 'nonconforming'], recommendCapabilityIds: ['quality.inspections'], severity: 'important' },
  { id: 'asset-maintenance', title: 'Operational assets need continuity controls', rationale: 'Delivery depends on assets whose condition and maintenance are not yet represented.', layer: 'industry', appliesWhen: ['machine', 'critical equipment', 'fleet', 'breakdown'], recommendCapabilityIds: ['maintenance.assets'], severity: 'important' },
  { id: 'delivery-evidence', title: 'Delivery completion needs evidence', rationale: 'Physical fulfilment is not complete until status and proof reach the customer record.', layer: 'business-model', appliesWhen: ['ship', 'delivery', 'courier', 'route'], recommendCapabilityIds: ['logistics.shipping'], severity: 'watch' },
  { id: 'approval-control', title: 'Approval decisions are not yet modeled', rationale: 'Material commitments need explicit owners, limits and audit history.', layer: 'universal', appliesWhen: ['approval', 'sign off', 'spending limit', 'authorization'], recommendCapabilityIds: ['documents.approvals'], severity: 'important' },
  { id: 'operational-reporting', title: 'Management outcomes are not yet connected to data', rationale: 'Targets only become actionable when their source, owner and review cadence are defined.', layer: 'universal', appliesWhen: ['kpi', 'target', 'performance review', 'dashboard'], recommendCapabilityIds: ['analytics.reporting'], severity: 'watch' },
]

export const capabilityKnowledgeOverrides: Record<string, Partial<CapabilityKnowledge>> = {
  'finance.tax': { layer: 'jurisdiction', source: 'platform', jurisdiction: 'configurable', executable: true },
  'people.payroll': { layer: 'jurisdiction', source: 'platform', jurisdiction: 'configurable; Dominican calculations excluded', executable: false },
  'manufacturing.bom': { layer: 'industry', source: 'mixed', processIds: ['production-planning', 'production'] },
  'manufacturing.production': { layer: 'industry', source: 'mixed', processIds: ['production-planning', 'production', 'finished-output-handoff', 'waste-recovery'] },
  'quality.inspections': { layer: 'industry', source: 'mixed', processIds: ['quality-control', 'nonconformance'] },
  'maintenance.assets': { layer: 'industry', source: 'mixed', processIds: ['corrective-maintenance', 'preventive-maintenance'] },
  'inventory.traceability': { layer: 'industry', source: 'mixed', processIds: ['finished-output-handoff', 'finished-goods-warehouse'] },
}
