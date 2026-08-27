import type { Answers } from '../types'
import type { AIBlueprint, ModuleId } from './blueprint'
import type { ArchitectureContext, ArchitectureField, ArchitectureLifecycle, ArchitectureProcess, BusinessState } from './businessDiscovery'
import { planCapabilities, type CatalogEntity } from './capabilityCatalog'
import { selectCompanyTemplate } from './companyTemplates'
import { slug } from './shared'
import { resolveIndustry } from './industryResolver'
import { planConnections, type WorkspaceConnection } from './connections'
import { createBusinessModelV2, type BusinessModelV2 } from './businessModel'
import { enrichEntityFieldsFromKnowledge } from './knowledgeEngine'
import { generateKpiDefinitions, type GeneratedKpiDefinition } from './kpiEngine'
import { refreshWorkspaceIntelligence } from './operatingArchitecture'
import type { CompiledBusinessAgent } from './agentArchitecture'
import type { BusinessGraph } from './businessGraph'
import type { EventArchitecture } from './eventArchitecture'
import type { GeneratedInterfaceArchitecture } from './interfaceArchitecture'
import type { GovernanceArchitecture } from './governanceArchitecture'
import { connectOperationalEntities } from './operatingSuite'
import { compileOperatingCoverage, type OperatingCoverage } from './operatingCoverage'
import { archetypesFromLabels, detectArchetypes, mergeArchetypes } from './archetypes'

export type FieldType = 'text' | 'long-text' | 'number' | 'currency' | 'date' | 'boolean' | 'email' | 'phone' | 'select' | 'relation' | 'file'
export type ViewType = 'table' | 'kanban' | 'cards' | 'calendar' | 'timeline'
export type WorkspaceRoleId = 'owner' | 'admin' | 'manager' | 'employee' | 'accountant'

export interface BusinessProfile {
  companyName: string
  /** A data URL, given during onboarding. Absent in every workspace built before it was asked for. */
  logo?: string
  description: string
  archetype: string
  industry: string
  businessModel: string
  revenueModel: string
  teamStructure: string
  customers: string
  productsAndServices: string
  operatingProcesses: string[]
  suppliers: string
  locations: string
  goals: string[]
  terminology: Record<string, string>
}

export interface FieldDefinition {
  id: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  relationEntityId?: string
}

export interface EntityDefinition {
  id: string
  label: string
  pluralLabel: string
  module: string
  primaryField: string
  fields: FieldDefinition[]
  /** Which capability brought this entity, so the page can tell whether another app owns it. */
  capabilityId?: string
}

export interface ViewDefinition {
  id: string
  label: string
  entityId: string
  type: ViewType
  groupBy?: string
  dateField?: string
  columns?: string[]
}

export interface MetricDefinition {
  id: string
  label: string
  entityId: string
  operation: 'count' | 'sum'
  field?: string
  filter?: { field: string; equals?: string; notEquals?: string }
  roles: WorkspaceRoleId[]
  format: 'number' | 'currency'
}

export interface NavigationDefinition {
  id: string
  label: string
  /** 'automations' and 'assistant' only appear in workspaces built before those sections moved; see normalizeNavigation. */
  kind: 'home' | 'today' | 'entity' | 'analytics' | 'links' | 'automations' | 'control' | 'assistant' | 'settings'
  viewId?: string
  module?: string
}

/**
 * Section ids the workspace shell owns, and the entity sections that must not take them.
 *
 * A business section is named after its module — `customers`, `inventory` — and `analytics` is both
 * a module a company can genuinely have and one of the shell's own sections. A workspace holding an
 * analytics module therefore built two navigation entries with the same id: React rendered them with
 * the same key and warned that one of them may be silently dropped, and any link to that section was
 * ambiguous. Suffixing the business one keeps both, and keeps the shell's section where people
 * expect to find it.
 */
const RESERVED_NAVIGATION_IDS = new Set(['home', 'today', 'analytics', 'links', 'automations', 'control', 'assistant', 'settings'])
export const navigationId = (id: string) => RESERVED_NAVIGATION_IDS.has(id) ? `${id}-records` : id

export interface WorkflowDefinition {
  id: string
  name: string
  enabled: boolean
  trigger: { entityId: string; event: 'created' | 'updated'; field?: string; equals?: string }
  action: { type: 'create_record' | 'notify'; entityId?: string; message: string }
}

export interface RoleDefinition {
  id: WorkspaceRoleId
  label: string
  permissions: Array<'view' | 'create' | 'edit' | 'delete' | 'approve' | 'financial' | 'people' | 'admin'>
}

export interface WorkspaceConfiguration {
  version: 1
  id: string
  profile: BusinessProfile
  modules: string[]
  capabilities?: string[]
  capabilityPlan?: { packId: string; excluded: string[]; reasons: Record<string, string> }
  entities: EntityDefinition[]
  views: ViewDefinition[]
  navigation: NavigationDefinition[]
  metrics: MetricDefinition[]
  /** Rich KPI specifications generated from the selected operating model. */
  kpis?: GeneratedKpiDefinition[]
  agents?: CompiledBusinessAgent[]
  businessGraph?: BusinessGraph
  eventArchitecture?: EventArchitecture
  interfaceArchitecture?: GeneratedInterfaceArchitecture
  governanceArchitecture?: GovernanceArchitecture
  workflows: WorkflowDefinition[]
  roles: RoleDefinition[]
  /** Capabilities another app owns. Wesify shows these pages but does not hold the records. */
  connections?: WorkspaceConnection[]
  /** Where this company sits in the industry taxonomy, so Wesify can learn per industry. */
  industrySubsector?: string
  industryLabel?: string
  /** Additive operating intelligence. Version-1 workspaces remain valid without this field. */
  businessModel?: BusinessModelV2
  /**
   * What this company must be able to do, and whether the build carries it.
   *
   * Kept on the configuration rather than recomputed on demand because it is the record of what was
   * checked at the moment this version was built: which processes were ruled out and why, which
   * regulatory subjects nobody has verified yet, and which events the workspace had no answer for.
   * A later version can be compared against it; a recomputed one can only describe today.
   */
  coverage?: OperatingCoverage
}

const field = (id: string, label: string, type: FieldType, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ id, label, type, ...extra })
const statuses = (...options: string[]) => field('status', 'Status', 'select', { options })

const entityLibrary: Record<string, EntityDefinition[]> = {
  customers: [{ id: 'customers', label: 'Client', pluralLabel: 'Clients', module: 'customers', primaryField: 'name', fields: [field('name', 'Name', 'text', { required: true }), field('company', 'Company', 'text'), field('email', 'Email', 'email'), field('phone', 'Phone', 'phone'), statuses('Active', 'Lead', 'Inactive'), field('lastInteraction', 'Last interaction', 'date'), field('notes', 'Notes', 'long-text')] }],
  sales: [{ id: 'opportunities', label: 'Opportunity', pluralLabel: 'Sales', module: 'sales', primaryField: 'name', fields: [field('name', 'Opportunity', 'text', { required: true }), field('customer', 'Client', 'relation', { relationEntityId: 'customers' }), field('value', 'Value', 'currency'), statuses('Lead', 'Qualified', 'Proposal', 'Won', 'Lost'), field('nextStep', 'Next step', 'text'), field('closeDate', 'Expected close', 'date')] }],
  projects: [
    { id: 'projects', label: 'Project', pluralLabel: 'Projects', module: 'projects', primaryField: 'name', fields: [field('name', 'Project name', 'text', { required: true }), field('customer', 'Client', 'relation', { relationEntityId: 'customers' }), statuses('Planned', 'Active', 'At risk', 'Complete'), field('budget', 'Budget', 'currency'), field('startDate', 'Start date', 'date'), field('deadline', 'Deadline', 'date')] },
    { id: 'tasks', label: 'Task', pluralLabel: 'Tasks', module: 'projects', primaryField: 'title', fields: [field('title', 'Task', 'text', { required: true }), field('project', 'Project', 'relation', { relationEntityId: 'projects' }), statuses('To do', 'In progress', 'Blocked', 'Done'), field('assignee', 'Assignee', 'relation', { relationEntityId: 'employees' }), field('dueDate', 'Due date', 'date')] },
  ],
  finance: [
    { id: 'invoices', label: 'Invoice', pluralLabel: 'Invoices', module: 'finance', primaryField: 'number', fields: [field('number', 'Invoice number', 'text', { required: true }), field('customer', 'Client', 'relation', { relationEntityId: 'customers' }), field('amount', 'Amount', 'currency'), statuses('Draft', 'Sent', 'Paid', 'Overdue'), field('issueDate', 'Issue date', 'date'), field('dueDate', 'Due date', 'date')] },
    { id: 'expenses', label: 'Expense', pluralLabel: 'Expenses', module: 'finance', primaryField: 'description', fields: [field('description', 'Description', 'text', { required: true }), field('amount', 'Amount', 'currency'), field('category', 'Category', 'select', { options: ['Operations', 'People', 'Software', 'Marketing', 'Travel', 'Other'] }), field('date', 'Date', 'date'), field('receipt', 'Receipt', 'file')] },
  ],
  team: [{ id: 'employees', label: 'Team member', pluralLabel: 'Team', module: 'team', primaryField: 'name', fields: [field('name', 'Name', 'text', { required: true }), field('role', 'Role', 'text'), field('email', 'Email', 'email'), statuses('Active', 'On leave', 'Contractor'), field('capacity', 'Weekly capacity', 'number')] }],
  inventory: [
    { id: 'products', label: 'Product', pluralLabel: 'Products', module: 'inventory', primaryField: 'name', fields: [field('name', 'Product', 'text', { required: true }), field('sku', 'SKU', 'text'), field('stock', 'Stock', 'number'), field('reorderPoint', 'Reorder point', 'number'), field('unitCost', 'Unit cost', 'currency'), field('supplier', 'Supplier', 'relation', { relationEntityId: 'suppliers' })] },
    { id: 'suppliers', label: 'Supplier', pluralLabel: 'Suppliers', module: 'inventory', primaryField: 'name', fields: [field('name', 'Supplier', 'text', { required: true }), field('contact', 'Contact', 'text'), field('email', 'Email', 'email'), field('paymentTerms', 'Payment terms', 'text'), field('reliability', 'Delivery reliability', 'number')] },
  ],
  support: [{ id: 'requests', label: 'Support request', pluralLabel: 'Support', module: 'support', primaryField: 'subject', fields: [field('subject', 'Subject', 'text', { required: true }), field('customer', 'Client', 'relation', { relationEntityId: 'customers' }), statuses('New', 'In progress', 'Waiting', 'Resolved'), field('owner', 'Owner', 'relation', { relationEntityId: 'employees' }), field('createdAt', 'Created', 'date')] }],
  processes: [],
}

const roles: RoleDefinition[] = [
  { id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'financial', 'people', 'admin'] },
  { id: 'admin', label: 'Admin', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'people', 'admin'] },
  { id: 'manager', label: 'Manager', permissions: ['view', 'create', 'edit', 'approve', 'people'] },
  { id: 'employee', label: 'Employee', permissions: ['view', 'create', 'edit'] },
  { id: 'accountant', label: 'Accountant', permissions: ['view', 'create', 'edit', 'approve', 'financial'] },
]

function answer(answers: Answers, id: string) {
  const value = answers[id]
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

function createProfile(answers: Answers, blueprint: AIBlueprint, useIndustryTemplate = true): BusinessProfile {
  const description = answer(answers, 'companyDescription')
  const selected = useIndustryTemplate ? selectCompanyTemplate(description) : { id: 'ai-designed', label: 'Custom business' }
  return {
    companyName: answer(answers, 'companyName') || 'Workspace',
    description,
    archetype: selected.id,
    industry: selected.label,
    businessModel: answer(answers, 'offerCustomization') || selected.label,
    revenueModel: [answer(answers, 'chargeModel'), answer(answers, 'paymentTiming')].filter(Boolean).join(' · ') || blueprint.moduleConfig.billingCadence,
    teamStructure: [answer(answers, 'dayToDayWork'), answer(answers, 'workDistribution')].filter(Boolean).join(' · '),
    customers: answer(answers, 'customerLocation'),
    productsAndServices: answer(answers, 'finalDeliverable'),
    operatingProcesses: blueprint.moduleConfig.processSteps,
    suppliers: answer(answers, 'suppliers'),
    locations: answer(answers, 'customerLocation'),
    goals: [answer(answers, 'financialGoals')].filter(Boolean),
    terminology: selected.id === 'healthcare' ? { customers: 'Patients' } : selected.id === 'construction' ? { projects: 'Jobs' } : {},
  }
}

export function generateWorkspaceConfiguration(answers: Answers, blueprint: AIBlueprint, useIndustryTemplate = true): WorkspaceConfiguration {
  const profile = createProfile(answers, blueprint, useIndustryTemplate)
  const modules = [...new Set(blueprint.modules)]
  let entities: EntityDefinition[] = modules.flatMap(module => entityLibrary[module] ?? []).map(item => ({ ...item, fields: item.fields.map(itemField => ({ ...itemField, ...(itemField.options ? { options: [...itemField.options] } : {}) })) }))
  if (profile.archetype === 'agency') entities.splice(Math.max(0, entities.findIndex(item => item.id === 'projects')), 0,
    { id: 'campaigns', label: 'Campaign', pluralLabel: 'Campaigns', module: 'projects', primaryField: 'name', fields: [field('name', 'Campaign', 'text', { required: true }), field('customer', 'Client', 'relation', { relationEntityId: 'customers' }), statuses('Planned', 'Live', 'Review', 'Complete'), field('channel', 'Channel', 'text'), field('budget', 'Budget', 'currency'), field('startDate', 'Start date', 'date'), field('endDate', 'End date', 'date')] })
  if (profile.archetype === 'field-service') entities.push(
    { id: 'vehicles', label: 'Vehicle', pluralLabel: 'Vehicles', module: 'inventory', primaryField: 'name', fields: [field('name', 'Vehicle', 'text', { required: true }), field('registration', 'Registration', 'text'), statuses('Available', 'Assigned', 'Maintenance'), field('assignedTo', 'Assigned to', 'relation', { relationEntityId: 'employees' }), field('mileage', 'Mileage', 'number')] },
    { id: 'equipment', label: 'Equipment', pluralLabel: 'Equipment', module: 'inventory', primaryField: 'name', fields: [field('name', 'Equipment', 'text', { required: true }), field('assetNumber', 'Asset number', 'text'), statuses('Available', 'In use', 'Maintenance'), field('nextService', 'Next service', 'date'), field('assignedTo', 'Assigned to', 'relation', { relationEntityId: 'employees' })] },
  )
  if (profile.archetype === 'construction') {
    const materials = entities.find(item => item.id === 'products')
    if (materials) { materials.label = 'Material'; materials.pluralLabel = 'Materials' }
    entities.push({ id: 'project-costs', label: 'Project cost', pluralLabel: 'Project Costs', module: 'finance', primaryField: 'description', fields: [field('description', 'Description', 'text', { required: true }), field('project', 'Project', 'relation', { relationEntityId: 'projects' }), field('type', 'Cost type', 'select', { options: ['Material', 'Contractor', 'Labor', 'Equipment', 'Other'] }), field('amount', 'Amount', 'currency'), field('date', 'Date', 'date')] })
  }
  entities = connectOperationalEntities(entities)
  const views: ViewDefinition[] = entities.map(item => ({
    id: `${item.id}-${item.id === 'opportunities' || item.id === 'projects' || item.id === 'tasks' ? 'kanban' : 'table'}`,
    label: item.pluralLabel,
    entityId: item.id,
    type: item.id === 'opportunities' || item.id === 'projects' || item.id === 'tasks' ? 'kanban' : 'table',
    groupBy: item.fields.some(itemField => itemField.id === 'status') ? 'status' : undefined,
    columns: item.fields.slice(0, 5).map(itemField => itemField.id),
  }))
  const navigation: NavigationDefinition[] = [
    { id: 'home', label: 'Home', kind: 'home' },
    { id: 'today', label: 'Today', kind: 'today' },
    ...modules.flatMap(module => {
      const moduleViews = views.filter(view => entities.find(entity => entity.id === view.entityId)?.module === module)
      return moduleViews.map((view, index) => ({ id: navigationId(index === 0 ? module : view.entityId === module ? `${view.entityId}-list` : view.entityId), label: view.label, kind: 'entity' as const, viewId: view.id, module }))
    }),
    { id: 'analytics', label: 'Reporting', kind: 'analytics' },
    { id: 'links', label: 'Automations', kind: 'links' },
    { id: 'control', label: 'Access & control', kind: 'control' },
    { id: 'settings', label: 'Settings', kind: 'settings' },
  ]
  const metricRoles: WorkspaceRoleId[] = ['owner', 'admin', 'manager', 'accountant']
  const metrics: MetricDefinition[] = [
    ...(entities.some(item => item.id === 'customers') ? [{ id: 'active-customers', label: 'Active clients', entityId: 'customers', operation: 'count' as const, filter: { field: 'status', notEquals: 'Inactive' }, roles: metricRoles, format: 'number' as const }] : []),
    ...(entities.some(item => item.id === 'projects') ? [{ id: 'active-projects', label: 'Active projects', entityId: 'projects', operation: 'count' as const, filter: { field: 'status', notEquals: 'Complete' }, roles: metricRoles, format: 'number' as const }] : []),
    ...(entities.some(item => item.id === 'invoices') ? [{ id: 'outstanding-invoices', label: 'Outstanding invoices', entityId: 'invoices', operation: 'sum' as const, field: 'amount', filter: { field: 'status', notEquals: 'Paid' }, roles: ['owner', 'admin', 'accountant'] as WorkspaceRoleId[], format: 'currency' as const }] : []),
    ...(entities.some(item => item.id === 'expenses') ? [{ id: 'expenses', label: 'Expenses', entityId: 'expenses', operation: 'sum' as const, field: 'amount', roles: ['owner', 'admin', 'accountant'] as WorkspaceRoleId[], format: 'currency' as const }] : []),
    ...(entities.some(item => item.id === 'tasks') ? [{ id: 'open-tasks', label: 'Open tasks', entityId: 'tasks', operation: 'count' as const, filter: { field: 'status', notEquals: 'Done' }, roles: ['owner', 'admin', 'manager', 'employee'] as WorkspaceRoleId[], format: 'number' as const }] : []),
    ...(entities.some(item => item.id === 'project-costs') ? [{ id: 'project-costs', label: 'Project costs', entityId: 'project-costs', operation: 'sum' as const, field: 'amount', roles: ['owner', 'admin', 'manager', 'accountant'] as WorkspaceRoleId[], format: 'currency' as const }] : []),
  ]
  const compiled = refreshWorkspaceIntelligence({ version: 1, id: crypto.randomUUID(), profile, modules, entities, views, navigation, metrics, workflows: [], roles })
  const coverageText = [profile.description, profile.industry, profile.businessModel, profile.productsAndServices, profile.suppliers, ...profile.operatingProcesses].filter(Boolean).join(' ')
  return { ...compiled, coverage: compileOperatingCoverage(compiled, { text: coverageText, capabilityIds: compiled.capabilities ?? [] }) }
}

export function isWorkspaceConfiguration(value: unknown): value is WorkspaceConfiguration {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkspaceConfiguration>
  return candidate.version === 1 && Array.isArray(candidate.entities) && Array.isArray(candidate.navigation) && Array.isArray(candidate.views)
}

function inferredStatuses(name: string, architecture: ArchitectureContext) {
  const lower = name.toLowerCase()
  if (/lead|opportunit|deal|prospect/.test(lower)) return architecture.pipelineStages.length ? architecture.pipelineStages : ['New', 'Qualified', 'Proposal', 'Won', 'Lost']
  if (/invoice/.test(lower)) return ['Draft', 'Sent', 'Paid', 'Overdue']
  if (/contract|subscription/.test(lower)) return ['Draft', 'Active', 'Paused', 'Ended']
  if (/visit|job|project|task|appointment|booking|order|campaign|work/.test(lower)) return architecture.processStages.length ? architecture.processStages : ['Planned', 'Assigned', 'In progress', 'Completed']
  if (/expense|purchase|cost/.test(lower)) return ['Logged', 'Approved', 'Paid']
  if (/employee|staff|team|contractor|crew/.test(lower)) return ['Active', 'On leave', 'Contractor']
  if (/stock|supply|material|inventory|product|part/.test(lower)) return ['Available', 'Low stock', 'Out of stock']
  return ['Active', 'Paused', 'Archived']
}

/**
 * The fields the architect asked for, turned into a record shape Wesify will actually build.
 *
 * Nothing here trusts the model. Labels become ids by the same slug every other id uses; a relation
 * whose target does not exist is dropped rather than pointed at nothing; a select with no options is
 * demoted to text rather than rendering an empty dropdown; duplicates collapse. What survives is
 * whatever a company would recognise as their own form.
 */
function architectedFields(proposed: ArchitectureField[], entityIds: string[], selfId: string): FieldDefinition[] {
  const fields: FieldDefinition[] = []
  for (const item of proposed) {
    const id = slug(item.label)
    if (!id || fields.some(existing => existing.id === id)) continue

    if (item.type === 'relation') {
      // The architect names the other entity in the company's words; this is where those words have
      // to resolve to something real. "Related work" pointing at an entity nobody built is a form
      // field that can never be filled in.
      const target = slug(item.relatedTo ?? '')
      const resolved = entityIds.find(candidate => candidate === target)
        ?? entityIds.find(candidate => candidate === `${target}s`)
        ?? entityIds.find(candidate => `${candidate}s` === target)
      if (!resolved || resolved === selfId) continue
      fields.push({ id, label: item.label, type: 'relation', relationEntityId: resolved, ...(item.required ? { required: true } : {}) })
      continue
    }

    const options = (item.options ?? []).map(option => option.trim()).filter(Boolean)
    // A dropdown with nothing in it is worse than a text box: it looks like a decision Wesify made and
    // then failed to follow through on.
    const type = item.type === 'select' && options.length < 2 ? 'text' : item.type
    fields.push({ id, label: item.label, type, ...(type === 'select' ? { options } : {}), ...(item.required ? { required: true } : {}) })
  }
  return fields
}

function customEntity(name: string, module: string, purpose: string, architecture: ArchitectureContext, entityIds: string[], proposed?: ArchitectureField[]): EntityDefinition {
  const id = slug(name)

  /**
   * When the architect described the record, that description is the record.
   *
   * Everything below this is the older inference: match the entity's name against a list of patterns
   * and attach whatever those patterns imply. It is why two companies in the same trade used to get
   * identical forms however differently they answered — the model chose the noun and hand-written
   * rules chose the substance. It is still here because the in-browser model does not return fields,
   * and a workspace built with no key has to be built from something.
   */
  const architected = proposed?.length ? architectedFields(proposed, entityIds, id) : []
  if (architected.length >= 3) {
    const singularName = name.replace(/s$/i, '') || name
    const primary = architected.find(item => item.required && item.type === 'text') ?? architected.find(item => item.type === 'text') ?? architected[0]
    // Every record needs somewhere to put the thing that did not fit a field, and a status is what
    // every board, filter and workflow in Wesify groups by.
    const withStatus = architected.some(item => item.id === 'status') ? architected : [...architected, statuses(...inferredStatuses(name, architecture))]
    const withNotes = withStatus.some(item => item.type === 'long-text') ? withStatus : [...withStatus, field('notes', 'Notes', 'long-text')]
    return { id, label: singularName, pluralLabel: name, module, primaryField: primary.id, fields: withNotes }
  }
  const lower = `${name} ${purpose}`.toLowerCase()
  const primaryField = /invoice/.test(lower) ? 'number' : /task/.test(lower) ? 'title' : /expense|cost/.test(lower) ? 'description' : 'name'
  const primaryLabel = primaryField === 'number' ? 'Invoice number' : primaryField === 'title' ? 'Task' : primaryField === 'description' ? 'Description' : name.replace(/s$/i, '') || 'Name'
  const fields: FieldDefinition[] = [field(primaryField, primaryLabel, 'text', { required: true }), statuses(...inferredStatuses(name, architecture))]
  const push = (definition: FieldDefinition) => { if (!fields.some(existing => existing.id === definition.id)) fields.push(definition) }
  const clientId = entityIds.find(candidate => /^(customers|clients|accounts|patients)$/.test(candidate))
  const teamId = entityIds.find(candidate => /^(employees|team|staff|crew|contractors)$/.test(candidate))
  const projectId = entityIds.find(candidate => /^(projects|jobs|engagements|campaigns|contracts)$/.test(candidate))
  const supplierId = entityIds.find(candidate => /^(suppliers|vendors|manufacturers)$/.test(candidate))

  if (clientId && clientId !== id && /project|job|engagement|booking|contract|order|invoice|visit|appointment|campaign|ticket|subscription/.test(lower)) push(field('customer', 'Client', 'relation', { relationEntityId: clientId }))
  if (teamId && teamId !== id && /project|job|task|visit|appointment|booking|campaign|shift|work|assignment/.test(lower)) push(field('assignee', 'Assigned to', 'relation', { relationEntityId: teamId }))
  if (projectId && projectId !== id && /task|cost|expense|material|visit|time|invoice|deliverable|assignment/.test(lower)) push(field('project', 'Related work', 'relation', { relationEntityId: projectId }))
  if (supplierId && supplierId !== id && /stock|supply|material|inventory|product|part|purchase/.test(lower)) push(field('supplier', 'Supplier', 'relation', { relationEntityId: supplierId }))
  if (/cost|expense|payment|invoice|order|booking|contract|deal|lead|opportunit|purchase|revenue|subscription/.test(lower)) push(field('amount', /lead|opportunit|deal/.test(lower) ? 'Estimated value' : 'Amount', 'currency'))
  if (/stock|supply|material|inventory|product|part/.test(lower)) { push(field('quantity', 'Quantity', 'number')); push(field('reorderPoint', 'Reorder point', 'number')); push(field('unitCost', 'Unit cost', 'currency')) }
  if (/contract|subscription/.test(lower)) { push(field('startDate', 'Start date', 'date')); push(field('endDate', 'End date', 'date')); push(field('billingCadence', 'Billing cadence', 'text')) }
  if (/task|project|job|booking|maintenance|contract|order|appointment|visit|campaign|shift|delivery/.test(lower)) push(field('dueDate', /visit|appointment|booking|shift/.test(lower) ? 'Scheduled date' : 'Due date', 'date'))
  if (/customer|client|account|lead|prospect|patient|supplier|vendor|employee|staff|team/.test(lower)) { push(field('email', 'Email', 'email')); push(field('phone', 'Phone', 'phone')) }
  if (/location|site|property|customer|client|visit|appointment|job/.test(lower)) push(field('address', 'Address', 'text'))
  if (/document|contract|receipt|proposal|asset|file/.test(lower)) push(field('file', 'File', 'file'))
  push(field('notes', 'Notes', 'long-text'))
  const singular = name.replace(/s$/i, '') || name
  return { id, label: singular, pluralLabel: name, module, primaryField, fields }
}

/**
 * The states the architect said this company's records move through, applied over the guessed ones.
 *
 * Statuses used to be chosen by matching a record's *name* against patterns: anything with "job" in
 * it got Planned, Assigned, In progress, Completed, whoever described it and whatever they called
 * the middle of it. Every board, filter, alert and workflow in a workspace is built from these, so
 * that guess decided how a company saw its own work — a bakery's order sitting in "Assigned" when
 * everyone there calls it "proving".
 *
 * Applied last, over catalog records as well as architected ones, because a capability's invoice
 * arrives with Draft/Sent/Paid/Overdue and this company may bill in four different steps of its own.
 */
function applyLifecycles(entities: EntityDefinition[], lifecycles: ArchitectureLifecycle[] = []): EntityDefinition[] {
  if (!lifecycles.length) return entities
  const claimed = new Set<string>()
  const assignments = new Map<string, string[]>()
  for (const lifecycle of lifecycles) {
    const entity = matchEntity(entities, lifecycle.entity)
    if (!entity || claimed.has(entity.id)) continue
    claimed.add(entity.id)
    assignments.set(entity.id, lifecycle.states)
  }
  return entities.map(entity => {
    const states = assignments.get(entity.id)
    if (!states) return entity
    const existing = entity.fields.find(item => item.id === 'status')
    if (existing) return { ...entity, fields: entity.fields.map(item => item.id === 'status' ? { ...item, type: 'select' as FieldType, options: states } : item) }
    return { ...entity, fields: [...entity.fields, statuses(...states)] }
  })
}

/**
 * The things the architect said go wrong, turned into the alerts that say they have.
 *
 * A process that had to name its exceptions is the only place in the whole pipeline that knows what
 * failure looks like in this particular trade — "the cold store goes above five degrees", "the
 * container is held at the port". Without this they were prose in a proposal nobody reads twice;
 * here each one becomes a workflow that fires when the record it belongs to reaches the state the
 * exception names, or on any change to that record when it names no state.
 */
function exceptionWorkflows(processes: ArchitectureProcess[] = [], entities: EntityDefinition[], existing: WorkflowDefinition[]): WorkflowDefinition[] {
  const created: WorkflowDefinition[] = []
  for (const item of processes) {
    const entity = (item.entity ? matchEntity(entities, item.entity) : undefined) ?? matchEntity(entities, item.name)
    if (!entity) continue
    for (const exception of item.exceptions ?? []) {
      const id = `exception-${slug(item.name)}-${slug(exception)}`.slice(0, 60)
      if (existing.some(candidate => candidate.id === id) || created.some(candidate => candidate.id === id)) continue
      const options = entity.fields.find(field => field.id === 'status')?.options ?? []
      const state = options.find(option => exception.toLowerCase().includes(option.toLowerCase()))
      created.push({
        id,
        name: exception,
        enabled: true,
        trigger: { entityId: entity.id, event: 'updated', ...(state ? { field: 'status', equals: state } : {}) },
        action: { type: 'notify', message: exception },
      })
      if (created.length >= 12) return created
    }
  }
  return created
}

function matchEntity(entities: EntityDefinition[], text: string) {
  const normalized = slug(text)
  return entities.find(entity => normalized === entity.id || normalized === slug(entity.label) || normalized === slug(entity.pluralLabel))
    ?? entities.find(entity => normalized.includes(entity.id) || entity.id.includes(normalized))
    ?? entities.find(entity => text.toLowerCase().split(/\s+/).some(word => word.length > 4 && `${entity.label} ${entity.pluralLabel}`.toLowerCase().includes(word)))
}

function catalogEntity(definition: CatalogEntity, module: string, capabilityId: string): EntityDefinition {
  return { id: definition.id, label: definition.label, pluralLabel: definition.pluralLabel, module, primaryField: definition.primaryField, capabilityId, fields: definition.fields.map(item => ({ ...item, ...(item.options ? { options: [...item.options] } : {}) })) }
}

function mergeEntity(base: EntityDefinition, addition: EntityDefinition, preferAddition = true): EntityDefinition {
  const fields = [...base.fields]
  for (const candidate of addition.fields) {
    const index = fields.findIndex(item => item.id === candidate.id)
    const semanticIndex = index >= 0 ? index : fields.findIndex(item => slug(item.label) === slug(candidate.label) && item.type === candidate.type)
    if (semanticIndex < 0) fields.push(candidate)
    else {
      const existing = fields[semanticIndex]
      const merged = preferAddition ? { ...existing, ...candidate } : { ...candidate, ...existing }
      fields[semanticIndex] = {
        ...merged,
        id: existing.id,
        required: Boolean(existing.required || candidate.required),
        options: preferAddition ? candidate.options ?? existing.options : existing.options ?? candidate.options,
      }
    }
  }
  return { ...base, label: base.label || addition.label, pluralLabel: base.pluralLabel || addition.pluralLabel, fields }
}

function semanticEntityMatch(entities: EntityDefinition[], name: string, purpose: string) {
  const exact = matchEntity(entities, name)
  if (exact) return exact
  const text = `${name} ${purpose}`.toLowerCase()
  const patterns: Array<[RegExp, string[]]> = [
    [/visit|appointment|booking|schedule/, ['appointments']],
    [/team|staff|employee|crew|cleaner|technician/, ['employees']],
    [/supply|material|stock|inventory/, ['stock-items']],
    [/work order|service job|field job/, ['work-orders']],
    [/product|service catalog|offer|item/, ['products']],
  ]
  for (const [pattern, ids] of patterns) if (pattern.test(text)) {
    const candidate = entities.find(item => ids.includes(item.id))
    if (candidate) return candidate
  }
  return undefined
}

export function generateWorkspaceConfigurationFromDiscovery(answers: Answers, blueprint: AIBlueprint, businessState: BusinessState, architecture: ArchitectureContext): WorkspaceConfiguration {
  const explicitName = businessState.facts.find(item => /company name|business name|name of/i.test(item.topic) && item.status === 'explicit')?.value
  const profile: BusinessProfile = {
    companyName: explicitName || answer(answers, 'companyName') || businessState.industry || 'My company',
    description: answer(answers, 'companyDescription') || businessState.companySummary,
    archetype: 'ai-designed',
    industry: businessState.industry || 'Custom business',
    businessModel: businessState.businessModel.join(' · '),
    revenueModel: businessState.revenueModel.join(' · ') || architecture.billingCadence,
    teamStructure: businessState.team.join(' · '),
    customers: businessState.customers.join(' · '),
    productsAndServices: businessState.productsOrServices.join(' · '),
    operatingProcesses: businessState.knownWorkflows.length ? businessState.knownWorkflows : architecture.processStages,
    suppliers: businessState.resources.filter(item => /supplier|vendor|manufacturer/i.test(item)).join(' · '),
    locations: businessState.locations.join(' · '),
    goals: businessState.goals,
    terminology: {},
  }
  const capabilityPlan = planCapabilities(businessState, architecture)
  /** Capabilities that arrived behind something else. Their records are plumbing until a page asks for them. */
  const supportingCapabilities = new Set(capabilityPlan.supporting)
  /** Entities the architect named itself, in the company's own words. These are never plumbing. */
  const namedByArchitect = new Set<string>()
  const catalogEntityMetadata = new Map<string, CatalogEntity>()
  let entities: EntityDefinition[] = []
  for (const selected of capabilityPlan.selected) for (const definition of selected.entities) {
    catalogEntityMetadata.set(definition.id, definition)
    const compiled = catalogEntity(definition, selected.module, selected.id)
    const existing = entities.find(item => item.id === compiled.id)
    if (existing) entities = entities.map(item => item.id === compiled.id ? mergeEntity(item, compiled) : item)
    else entities.push(compiled)
  }
  const uniqueArchitectureEntities = architecture.entities.filter((item, index, items) => slug(item.name) && items.findIndex(candidate => slug(candidate.name) === slug(item.name)) === index)
  const entityIds = [...new Set([...entities.map(item => item.id), ...uniqueArchitectureEntities.map(item => slug(item.name))])]

  /** Catalog records the architect asked for by page name, so they are not offered up to be renamed. */
  const pagedCatalogEntities = new Set(architecture.pages.map(label => matchEntity(entities, label)?.id).filter(Boolean) as string[])
  const chosenCapabilities = new Set(architecture.capabilityIds ?? [])

  /**
   * The catalog record this architect record is really a rename of.
   *
   * A capability arrives with the catalog's noun on it — Tasks — and the architect describes the same
   * thing in the company's own noun: Assignments, Matters, Jobs, Tickets. Nothing spelled alike, so
   * the two used to be built side by side, and the sidebar carried the company's word next to
   * Wesify's word for the same record. Adopting is narrow on purpose: the same module, a capability
   * somebody actually chose, and a record the architect did not separately ask for a page of. Where
   * any of that is untrue the architect's record is built in its own right.
   */
  const adoptable = (proposed: { name: string; module: string }) => entities.find(item =>
    item.capabilityId
    && chosenCapabilities.has(item.capabilityId)
    && item.module === proposed.module
    && !namedByArchitect.has(item.id)
    && !pagedCatalogEntities.has(item.id)
    && !uniqueArchitectureEntities.some(candidate => slug(candidate.name) === item.id))

  for (const proposed of uniqueArchitectureEntities) {
    const compiled = customEntity(proposed.name, proposed.module, proposed.purpose, architecture, entityIds, proposed.fields)
    const existing = semanticEntityMatch(entities, proposed.name, proposed.purpose) ?? adoptable(proposed)
    if (existing) {
      const singular = proposed.name.replace(/s$/i, '') || proposed.name
      const architected = Boolean(proposed.fields && proposed.fields.length >= 3)
      /**
       * A described record replaces the catalog's, rather than being added to it.
       *
       * Merging the two looked generous and read as somebody else's form. The catalog's task carries
       * a project, a priority and an assignee because that is what a task is in an agency; a student
       * who described an assignment as a title, a class, a due date and a grade got all four of
       * theirs plus all three of those, two of them pointing at records their workspace does not
       * show. The architect read the interview and listed the fields; a field it did not list is a
       * field this company said nothing about. Only where it described nothing does the catalog's
       * shape stand, which is what the merge below is still for.
       */
      entities = entities.map(item => item.id === existing.id
        ? architected
          ? { ...compiled, id: existing.id, module: existing.module, ...(item.capabilityId ? { capabilityId: item.capabilityId } : {}), label: singular, pluralLabel: proposed.name }
          : { ...mergeEntity(item, { ...compiled, id: existing.id, module: existing.module }, false), label: singular, pluralLabel: proposed.name }
        : item)
      namedByArchitect.add(existing.id)
    }
    else { entities.push(compiled); namedByArchitect.add(compiled.id) }
  }
  const knowledgeText = [
    businessState.companySummary,
    businessState.industry,
    ...businessState.businessModel,
    ...businessState.productsOrServices,
    ...businessState.operations,
    ...businessState.resources,
    ...businessState.knownEntities,
    ...businessState.knownWorkflows,
    ...businessState.facts.map(item => `${item.topic} ${item.value}`),
  ].join(' ')
  entities = enrichEntityFieldsFromKnowledge(entities, knowledgeText, capabilityPlan.selected.map(item => item.id))
  entities = connectOperationalEntities(entities)
  entities = applyLifecycles(entities, architecture.lifecycles)
  const views: ViewDefinition[] = entities.map(entity => {
    const preferred = catalogEntityMetadata.get(entity.id)
    const type = preferred?.view ?? (entity.fields.some(item => item.id === 'status') && /project|task|job|deal|lead|order|booking|campaign|production|ticket/i.test(entity.id) ? 'kanban' : 'table')
    return { id: `${entity.id}-${type}`, label: entity.pluralLabel, entityId: entity.id, type, groupBy: preferred?.groupBy ?? (type === 'kanban' && entity.fields.some(item => item.id === 'status') ? 'status' : undefined), dateField: preferred?.dateField, columns: entity.fields.slice(0, 5).map(item => item.id) }
  })
  const schedulingEntity = entities.find(entity => /visit|appointment|booking|shift|job|task|project|delivery/.test(entity.id) && entity.fields.some(item => item.type === 'date'))
  if (schedulingEntity) views.push({ id: `${schedulingEntity.id}-calendar`, label: 'Schedule', entityId: schedulingEntity.id, type: 'calendar', dateField: schedulingEntity.fields.find(item => item.type === 'date')?.id })

  /**
   * A record that is here to hold a field, not to be a section in the sidebar.
   *
   * Nothing the architect named is ever plumbing, and neither is anything from a capability somebody
   * actually chose. This is only the third kind: an entity that exists because a chosen capability
   * declares a dependency on it. A task record relates to a project and an assignee, so choosing
   * tasks drags in projects, the team directory and the client list behind it — and a person keeping
   * track of their homework then opens their new workspace and finds Clients, Projects and Team in
   * the sidebar. They asked for none of those. They get a page only if a page asks for them.
   */
  const plumbing = (entity: EntityDefinition) => Boolean(entity.capabilityId) && supportingCapabilities.has(entity.capabilityId!) && !namedByArchitect.has(entity.id)

  const seenModules = new Set<string>()
  const usedEntities = new Set<string>()
  const businessNavigation: NavigationDefinition[] = []
  const capabilityPages = capabilityPlan.selected.filter(item => !supportingCapabilities.has(item.id)).flatMap(item => item.pages.map(page => ({ ...page, module: item.module })))
  const pageCandidates = [...architecture.pages.map(label => ({ label })), ...capabilityPages]
  for (const page of pageCandidates) {
    const label = String(page.label)
    if (/^(dashboard|home|command center)$/i.test(label)) continue
    const explicitEntityId = 'entityId' in page ? page.entityId : undefined
    const schedule = /schedule|calendar/i.test(label) ? schedulingEntity : undefined
    const entity = entities.find(item => item.id === explicitEntityId) ?? schedule ?? matchEntity(entities, label)
    if (!entity) continue
    const requestedView = 'view' in page ? page.view : undefined
    const view = views.find(item => item.entityId === entity.id && (!requestedView || item.type === requestedView)) ?? views.find(item => item.entityId === entity.id)
    if (businessNavigation.some(item => item.viewId === view?.id)) continue
    const firstInModule = !seenModules.has(entity.module)
    seenModules.add(entity.module); usedEntities.add(entity.id)
    const preferredId = 'id' in page ? String(page.id) : slug(label)
    const id = navigationId(firstInModule ? entity.module : preferredId)
    if (businessNavigation.some(item => item.id === id)) continue
    businessNavigation.push({ id, label, kind: 'entity', viewId: view?.id, module: entity.module })
  }
  for (const entity of entities.filter(item => !usedEntities.has(item.id) && !plumbing(item))) {
    const firstInModule = !seenModules.has(entity.module)
    seenModules.add(entity.module)
    const id = navigationId(firstInModule ? entity.module : entity.id)
    if (!businessNavigation.some(item => item.id === id)) { usedEntities.add(entity.id); businessNavigation.push({ id, label: entity.pluralLabel, kind: 'entity', viewId: views.find(view => view.entityId === entity.id && view.type !== 'calendar')?.id, module: entity.module }) }
  }

  /**
   * The records this company actually opens, as opposed to the ones holding its fields together.
   *
   * Everything downstream that describes the workspace to a person — the metrics on the dashboard,
   * the automations, the domain headings the shell puts above them — is built from this rather than
   * from every entity in the file. A client list that exists only because a project record has a
   * client field on it should not put CRM in the sidebar, produce an "Active clients" number nobody
   * can act on, or make a homework tracker claim to be a business with customers.
   */
  const navigableEntityIds = new Set(businessNavigation.map(item => views.find(view => view.id === item.viewId)?.entityId).filter(Boolean) as string[])

  /**
   * A picker onto a page that does not exist is worse than no field at all.
   *
   * The catalog's records point at each other — a task at a project and an assignee, a shipment at
   * an order — and the lineage pass adds more of the same. Where the other side of one of those
   * relationships is plumbing rather than a section, the field renders as a dropdown a person can
   * neither fill nor add to: they cannot reach the list, so it stays empty forever. Taken off the
   * forms people actually open; what is already hidden keeps its wiring, since nobody sees it.
   */
  entities = entities.map(entity => {
    if (!navigableEntityIds.has(entity.id)) return entity
    const fields = entity.fields.filter(item => item.type !== 'relation' || (item.relationEntityId && navigableEntityIds.has(item.relationEntityId)))
    if (fields.length === entity.fields.length) return entity
    const kept = new Set(fields.map(item => item.id))
    for (const view of views) if (view.entityId === entity.id && view.columns) view.columns = fields.slice(0, 5).map(item => item.id).filter(id => kept.has(id))
    return { ...entity, fields }
  })
  // Sections first, plumbing last: several surfaces reach for the first entity when they need one to
  // start with, and starting a workspace on a record that has no page is a dead end for the person
  // who clicked. Stable, so the order the architecture asked for survives within each group.
  entities = [...entities.filter(entity => navigableEntityIds.has(entity.id)), ...entities.filter(entity => !navigableEntityIds.has(entity.id))]

  const navigation: NavigationDefinition[] = [
    { id: 'home', label: 'Home', kind: 'home' },
    { id: 'today', label: 'Today', kind: 'today' },
    ...businessNavigation,
    { id: 'analytics', label: 'Reporting', kind: 'analytics' },
    { id: 'links', label: 'Automations', kind: 'links' },
    { id: 'control', label: 'Access & control', kind: 'control' },
    { id: 'settings', label: 'Settings', kind: 'settings' },
  ]
  const financialRoles: WorkspaceRoleId[] = ['owner', 'admin', 'accountant']
  const operationalRoles: WorkspaceRoleId[] = ['owner', 'admin', 'manager', 'employee', 'accountant']
  const metrics = capabilityPlan.selected.flatMap(item => item.metrics ?? []).filter(item => navigableEntityIds.has(item.entityId)).filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index).map<MetricDefinition>(item => {
    const entity = entities.find(candidate => candidate.id === item.entityId)
    const financial = item.format === 'currency' || Boolean(entity?.fields.find(candidate => candidate.id === item.field && candidate.type === 'currency'))
    return { id: item.id, label: item.label, entityId: item.entityId, operation: item.operation, ...(item.field ? { field: item.field } : {}), ...(item.statusNotEquals ? { filter: { field: 'status', notEquals: item.statusNotEquals } } : {}), roles: financial ? financialRoles : operationalRoles, format: item.format ?? (financial ? 'currency' : 'number') }
  })
  architecture.metrics.forEach((label, index) => {
    if (metrics.some(item => item.id === slug(label))) return
    const entity = matchEntity(entities, label) ?? (/invoice|receivable|cash/i.test(label) ? entities.find(item => /invoice|payment/.test(item.id)) : undefined) ?? (/cost|expense|margin/i.test(label) ? entities.find(item => /expense|cost/.test(item.id)) : undefined) ?? entities[index % Math.max(entities.length, 1)]
    if (!entity) return
    const amountField = entity.fields.find(item => item.type === 'currency')
    const financial = Boolean(amountField) && /revenue|value|cost|expense|invoice|payment|margin|cash|runway/i.test(label)
    const statusField = entity.fields.find(item => item.id === 'status')
    const filter = /outstanding|unpaid|overdue/i.test(label) && statusField ? { field: 'status', notEquals: 'Paid' } : /active|open/i.test(label) && statusField ? { field: 'status', notEquals: statusField.options?.at(-1) ?? 'Archived' } : undefined
    metrics.push({ id: slug(label) || `metric-${index + 1}`, label, entityId: entity.id, operation: financial ? 'sum' : 'count', ...(financial && amountField ? { field: amountField.id } : {}), ...(filter ? { filter } : {}), roles: financial ? financialRoles : operationalRoles, format: financial ? 'currency' : 'number' })
  })
  if (!metrics.length) entities.slice(0, 4).forEach(entity => metrics.push({ id: `${entity.id}-count`, label: entity.pluralLabel, entityId: entity.id, operation: 'count', roles: operationalRoles, format: 'number' }))

  const workflows = capabilityPlan.selected.flatMap(item => item.workflows ?? []).filter(item => navigableEntityIds.has(item.entityId)).filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index).map<WorkflowDefinition>(item => ({ id: item.id, name: item.name, enabled: true, trigger: { entityId: item.entityId, event: item.event, ...(item.field ? { field: item.field, equals: item.equals } : {}) }, action: { type: 'notify', message: item.message } }))
  architecture.workflows.forEach((name, index) => {
    const entity = matchEntity(entities, name) ?? entities.find(item => /invoice/.test(name.toLowerCase()) && /invoice/.test(item.id)) ?? entities.find(item => /visit|job|task|project/.test(name.toLowerCase()) && /visit|job|task|project/.test(item.id))
    if (!entity) return
    const statusOptions = entity.fields.find(item => item.id === 'status')?.options ?? []
    const desiredStatus = statusOptions.find(option => name.toLowerCase().includes(option.toLowerCase()))
    const id = `${slug(name)}-${index + 1}`
    if (!workflows.some(item => item.id === id || item.name.toLowerCase() === name.toLowerCase())) workflows.push({ id, name, enabled: true, trigger: { entityId: entity.id, event: 'updated', ...(desiredStatus ? { field: 'status', equals: desiredStatus } : {}) }, action: { type: 'notify', message: name } })
  })
  // Only against records somebody can open: an alert about a table with no page is a notification
  // whose "go and look" leads nowhere.
  workflows.push(...exceptionWorkflows(architecture.processes, entities.filter(item => navigableEntityIds.has(item.id)), workflows))

  /**
   * What was built, rather than what was considered.
   *
   * `modules` and `capabilities` are read by the workspace shell to decide which of Wesify's domains
   * a company has — the Inventory heading, the Accounting heading. A capability whose records were
   * all dropped above is not part of this business, and listing it here would put the heading back
   * over an empty room.
   */
  const built = capabilityPlan.selected.filter(item => !item.entities.length || item.entities.some(entity => navigableEntityIds.has(entity.id)))
  const modules = [...new Set([...built.map(item => item.module), ...architecture.modules, ...blueprint.modules])].filter(module => entities.some(entity => entity.module === module))
  const connections = planConnections(built.map(item => item.id), [...businessState.currentTools, ...businessState.softwareImplications, businessState.companySummary].join(' '))
  const industry = resolveIndustry([businessState.companySummary, businessState.industry, ...businessState.productsOrServices].filter(Boolean).join('. '))
  const capabilities = built.map(item => item.id)
  const kpis = generateKpiDefinitions({ capabilityIds: capabilities, entities, metrics, goals: businessState.goals })
  const config: WorkspaceConfiguration = { version: 1, id: crypto.randomUUID(), profile, modules, capabilities, capabilityPlan: { packId: capabilityPlan.pack?.id ?? 'custom', excluded: capabilityPlan.excluded, reasons: capabilityPlan.reasons }, entities, views, navigation, metrics, kpis, workflows, roles, connections, industrySubsector: industry?.subsector, industryLabel: industry?.subsectorTitle }
  config.businessModel = createBusinessModelV2({ config, state: businessState, architecture, research: capabilityPlan.research })
  /**
   * The completeness check, run on the finished workspace rather than on the plan.
   *
   * It has to be last. Half of what it looks for — whether anything reacts when a record goes wrong,
   * whether the impact of a late delivery reaches a number somebody watches — only exists after the
   * workflows, metrics, KPIs and agents are compiled, and a check run before that would report gaps
   * the next line of this function closes.
   */
  const compiled = refreshWorkspaceIntelligence(config)
  const coverageText = [profile.description, businessState.companySummary, knowledgeText, architecture.summary, architecture.explanation].filter(Boolean).join(' ')
  // The architect's own conclusion about what kind of company this is leads, because it read the
  // whole interview; detection fills in the operating models it did not think to name.
  const archetypes = mergeArchetypes(archetypesFromLabels(architecture.archetypes ?? []), detectArchetypes(coverageText, capabilities))
  return { ...compiled, coverage: compileOperatingCoverage(compiled, { text: coverageText, capabilityIds: capabilities, archetypes, unknowns: architecture.unknowns }) }
}
