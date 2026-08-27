import type { ModuleId } from '../engine/blueprint'
import type { FieldType } from '../engine/workspaceSchema'

/**
 * What Odoo's record types mean in a company, and what they become in Wesify.
 *
 * Only the standard half is curated here. The parts of an ERP that are specific to one company —
 * the `x_studio_` fields somebody paid a consultant to add, the custom models — are carried across
 * wholesale by `erpBlueprint`, because they are exactly what makes the rebuilt workspace theirs
 * rather than a template with their name on it. This table's job is narrower: to land the ordinary
 * things on the entity ids the rest of Wesify already knows how to reason about, so an imported
 * purchase order gets the same alerts, metrics and coverage treatment a built one would.
 *
 * `capabilityIds` is what a populated model *proves*. It is only ever applied when the model holds
 * records — an installed module with nothing in it says nothing about the company.
 */

export interface ErpFieldMapping {
  /** The Odoo field name. */
  from: string
  /** The Wesify field id it becomes. */
  to: string
  label: string
  kind: FieldType
}

export interface ErpModelMapping {
  model: string
  entityId: string
  label: string
  pluralLabel: string
  module: ModuleId
  /** What this company demonstrably does, given records exist here. */
  capabilityIds: string[]
  /** Operating models this model's presence evidences, for the completeness check. */
  archetypes: string[]
  /** The Odoo field whose value names the record. */
  primary: string
  fields: ErpFieldMapping[]
  /** How this record type is described back to the operator. */
  purpose: string
}

const field = (from: string, to: string, label: string, kind: FieldType): ErpFieldMapping => ({ from, to, label, kind })

export const erpModelMap: ErpModelMapping[] = [
  {
    model: 'res.partner', entityId: 'customers', label: 'Customer', pluralLabel: 'Customers', module: 'customers',
    capabilityIds: ['crm.contacts'], archetypes: [], primary: 'name', purpose: 'The people and companies you sell to',
    fields: [
      field('name', 'name', 'Name', 'text'),
      field('email', 'email', 'Email', 'email'),
      field('phone', 'phone', 'Phone', 'phone'),
      field('city', 'address', 'City', 'text'),
    ],
  },
  {
    model: 'product.product', entityId: 'products', label: 'Product', pluralLabel: 'Products', module: 'commerce',
    capabilityIds: ['commerce.products'], archetypes: [], primary: 'name', purpose: 'What you sell',
    fields: [
      field('name', 'name', 'Product', 'text'),
      field('default_code', 'sku', 'Reference', 'text'),
      field('list_price', 'price', 'Sales price', 'currency'),
      field('standard_price', 'unitCost', 'Cost', 'currency'),
    ],
  },
  {
    model: 'sale.order', entityId: 'orders', label: 'Order', pluralLabel: 'Orders', module: 'sales',
    capabilityIds: ['sales.orders'], archetypes: [], primary: 'name', purpose: 'What a customer has ordered',
    fields: [
      field('name', 'number', 'Order number', 'text'),
      field('partner_id', 'customer', 'Customer', 'text'),
      field('state', 'status', 'Status', 'select'),
      field('amount_total', 'amount', 'Total', 'currency'),
      field('date_order', 'dueDate', 'Order date', 'date'),
    ],
  },
  {
    model: 'crm.lead', entityId: 'opportunities', label: 'Opportunity', pluralLabel: 'Pipeline', module: 'sales',
    capabilityIds: ['crm.pipeline'], archetypes: [], primary: 'name', purpose: 'Work you are trying to win',
    fields: [
      field('name', 'name', 'Opportunity', 'text'),
      field('partner_id', 'customer', 'Customer', 'text'),
      field('stage_id', 'status', 'Stage', 'select'),
      field('expected_revenue', 'amount', 'Expected value', 'currency'),
      field('date_deadline', 'dueDate', 'Expected close', 'date'),
    ],
  },
  {
    model: 'purchase.order', entityId: 'purchase-orders', label: 'Purchase order', pluralLabel: 'Purchase orders', module: 'procurement',
    capabilityIds: ['procurement.purchasing', 'procurement.suppliers'], archetypes: [], primary: 'name',
    purpose: 'What you have ordered from a supplier',
    fields: [
      field('name', 'number', 'PO number', 'text'),
      field('partner_id', 'supplier', 'Supplier', 'text'),
      field('state', 'status', 'Status', 'select'),
      field('amount_total', 'amount', 'Total', 'currency'),
      field('date_planned', 'dueDate', 'Expected', 'date'),
    ],
  },
  {
    model: 'stock.quant', entityId: 'stock-items', label: 'Stock item', pluralLabel: 'Stock', module: 'inventory',
    capabilityIds: ['inventory.stock'], archetypes: [], primary: 'product_id', purpose: 'What you have on hand',
    fields: [
      field('product_id', 'name', 'Product', 'text'),
      field('quantity', 'quantity', 'On hand', 'number'),
      field('reserved_quantity', 'allocated', 'Allocated', 'number'),
      field('location_id', 'location', 'Location', 'text'),
    ],
  },
  {
    model: 'stock.picking', entityId: 'shipments', label: 'Delivery', pluralLabel: 'Deliveries', module: 'logistics',
    capabilityIds: ['logistics.shipping'], archetypes: [], primary: 'name', purpose: 'Goods moving in or out',
    fields: [
      field('name', 'reference', 'Reference', 'text'),
      field('partner_id', 'customer', 'Party', 'text'),
      field('state', 'status', 'Status', 'select'),
      field('scheduled_date', 'dueDate', 'Scheduled', 'date'),
    ],
  },
  {
    model: 'account.move', entityId: 'invoices', label: 'Invoice', pluralLabel: 'Invoices', module: 'finance',
    capabilityIds: ['finance.invoicing', 'accounting.ledger'], archetypes: [], primary: 'name',
    purpose: 'What you have billed and what you owe',
    fields: [
      field('name', 'number', 'Invoice number', 'text'),
      field('partner_id', 'customer', 'Party', 'text'),
      field('state', 'status', 'Status', 'select'),
      field('amount_total', 'amount', 'Amount', 'currency'),
      field('invoice_date_due', 'dueDate', 'Due date', 'date'),
    ],
  },
  {
    model: 'account.payment', entityId: 'payments', label: 'Payment', pluralLabel: 'Payments', module: 'finance',
    capabilityIds: ['finance.payments'], archetypes: [], primary: 'name', purpose: 'Money in and out',
    fields: [
      field('name', 'reference', 'Reference', 'text'),
      field('partner_id', 'customer', 'Party', 'text'),
      field('amount', 'amount', 'Amount', 'currency'),
      field('date', 'date', 'Date', 'date'),
    ],
  },
  {
    model: 'mrp.production', entityId: 'production-orders', label: 'Production order', pluralLabel: 'Production', module: 'manufacturing',
    capabilityIds: ['manufacturing.production'], archetypes: ['manufacturer'], primary: 'name',
    purpose: 'What is being made',
    fields: [
      field('name', 'number', 'Reference', 'text'),
      field('product_id', 'product', 'Product', 'text'),
      field('state', 'status', 'Status', 'select'),
      field('product_qty', 'quantity', 'Quantity', 'number'),
      field('date_planned_start', 'dueDate', 'Planned', 'date'),
    ],
  },
  {
    model: 'mrp.bom', entityId: 'bills-of-materials', label: 'Bill of materials', pluralLabel: 'Bills of materials', module: 'manufacturing',
    capabilityIds: ['manufacturing.bom'], archetypes: ['manufacturer'], primary: 'code', purpose: 'What goes into what you make',
    fields: [
      field('code', 'reference', 'Reference', 'text'),
      field('product_tmpl_id', 'product', 'Product', 'text'),
      field('product_qty', 'quantity', 'Quantity', 'number'),
    ],
  },
  {
    model: 'quality.check', entityId: 'quality-checks', label: 'Quality check', pluralLabel: 'Quality', module: 'quality',
    capabilityIds: ['quality.inspections'], archetypes: [], primary: 'name', purpose: 'Whether output passed',
    fields: [
      field('name', 'reference', 'Reference', 'text'),
      field('product_id', 'product', 'Product', 'text'),
      field('quality_state', 'status', 'Result', 'select'),
    ],
  },
  {
    model: 'maintenance.request', entityId: 'maintenance-orders', label: 'Maintenance request', pluralLabel: 'Maintenance', module: 'maintenance',
    capabilityIds: ['maintenance.assets'], archetypes: [], primary: 'name', purpose: 'Equipment that needs attention',
    fields: [
      field('name', 'name', 'Request', 'text'),
      field('equipment_id', 'asset', 'Equipment', 'text'),
      field('stage_id', 'status', 'Stage', 'select'),
      field('schedule_date', 'dueDate', 'Scheduled', 'date'),
    ],
  },
  {
    model: 'project.project', entityId: 'projects', label: 'Project', pluralLabel: 'Projects', module: 'projects',
    capabilityIds: ['work.projects'], archetypes: ['project-based'], primary: 'name', purpose: 'Work you are delivering',
    fields: [
      field('name', 'name', 'Project', 'text'),
      field('partner_id', 'customer', 'Customer', 'text'),
      field('date_start', 'startDate', 'Start', 'date'),
      field('date', 'dueDate', 'Deadline', 'date'),
    ],
  },
  {
    model: 'project.task', entityId: 'tasks', label: 'Task', pluralLabel: 'Tasks', module: 'projects',
    capabilityIds: ['work.tasks'], archetypes: [], primary: 'name', purpose: 'The steps inside the work',
    fields: [
      field('name', 'title', 'Task', 'text'),
      field('project_id', 'project', 'Project', 'text'),
      field('stage_id', 'status', 'Stage', 'select'),
      field('date_deadline', 'dueDate', 'Due', 'date'),
    ],
  },
  {
    model: 'hr.employee', entityId: 'employees', label: 'Team member', pluralLabel: 'Team', module: 'team',
    capabilityIds: ['people.directory'], archetypes: [], primary: 'name', purpose: 'Who works here',
    fields: [
      field('name', 'name', 'Name', 'text'),
      field('work_email', 'email', 'Email', 'email'),
      field('job_title', 'role', 'Role', 'text'),
    ],
  },
  {
    model: 'fleet.vehicle', entityId: 'vehicles', label: 'Vehicle', pluralLabel: 'Vehicles', module: 'logistics',
    capabilityIds: ['logistics.fleet'], archetypes: ['logistics'], primary: 'name', purpose: 'What you drive',
    fields: [
      field('name', 'name', 'Vehicle', 'text'),
      field('license_plate', 'registration', 'Registration', 'text'),
      field('odometer', 'mileage', 'Odometer', 'number'),
    ],
  },
  {
    model: 'helpdesk.ticket', entityId: 'tickets', label: 'Support request', pluralLabel: 'Support', module: 'support',
    capabilityIds: ['support.tickets'], archetypes: [], primary: 'name', purpose: 'What customers have asked for help with',
    fields: [
      field('name', 'subject', 'Subject', 'text'),
      field('partner_id', 'customer', 'Customer', 'text'),
      field('stage_id', 'status', 'Stage', 'select'),
    ],
  },
]

export const erpModelFor = (model: string) => erpModelMap.find(item => item.model === model)

/**
 * Odoo's field types, in Wesify's vocabulary.
 *
 * `many2one` becomes text rather than a relation: Odoo hands it back as a display name, and turning
 * that into a local record id needs a second pass over data that has not been imported yet. A name
 * somebody can read beats a dropdown pointing at nothing.
 */
export const erpFieldType = (ttype: string): FieldType => ({
  char: 'text', text: 'long-text', html: 'long-text',
  integer: 'number', float: 'number', monetary: 'currency',
  date: 'date', datetime: 'date',
  boolean: 'boolean', selection: 'select',
  many2one: 'text',
}[ttype] ?? 'text') as FieldType

/**
 * What kind of company a record type proves this is, keyed by its Odoo model prefix.
 *
 * Keyed on the model rather than on the installed module, and that is the whole point: a module is
 * something somebody bought, a model with records in it is something the company does. Keying this
 * on `ir.module.module` handed "manufacturer" to a bakery that had the Manufacturing module sitting
 * untouched since the day their consultant installed it.
 */
export const erpPrefixArchetypes: Record<string, string[]> = {
  mrp: ['manufacturer'],
  pos: ['retailer', 'b2c'],
  repair: ['field-service'],
  fleet: ['logistics'],
  project: ['project-based'],
}
