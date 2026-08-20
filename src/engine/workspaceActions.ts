import type { EntityDefinition, FieldDefinition, MetricDefinition, NavigationDefinition, ViewDefinition, WorkflowDefinition, WorkspaceConfiguration } from './workspaceSchema'

export type BusinessRecord = Record<string, string | number | boolean> & { id: string; createdAt: string; updatedAt: string }
export type WorkspaceRecords = Record<string, BusinessRecord[]>
export type CommandIntent = 'BUSINESS_QUERY' | 'BUSINESS_ACTION' | 'WORKSPACE_CHANGE' | 'WORKFLOW_CHANGE' | 'REPORT_REQUEST' | 'INTEGRATION_REQUEST' | 'GENERAL_ADVICE'

export function classifyWorkspaceIntent(command: string): CommandIntent {
  const normalized = command.toLowerCase()
  if (/\b(connect|integrate|sync)\b/.test(normalized)) return 'INTEGRATION_REQUEST'
  if (/\b(whenever|when|remind|alert|automation)\b/.test(normalized)) return 'WORKFLOW_CHANGE'
  if (/\b(add (?:a )?(?:section|field)|start tracking|keep track|management|remove (?:the )?(?:section|module))\b/.test(normalized)) return 'WORKSPACE_CHANGE'
  if (/\b(report|brief|summary)\b/.test(normalized)) return 'REPORT_REQUEST'
  // "How many clients do we have" is the most ordinary way to ask a counting question, and it used to
  // fall through to general advice because only "how much" was listed.
  if (/^(show|open|find|list|count|how many|how much|which|what|who)\b/.test(normalized)) return 'BUSINESS_QUERY'
  if (/^(create|add|update|mark|delete|remove)\b/.test(normalized)) return 'BUSINESS_ACTION'
  return 'GENERAL_ADVICE'
}

export type WorkspaceAction =
  | { type: 'create_record'; entityId: string; values: Record<string, string | number | boolean> }
  | { type: 'update_record'; entityId: string; recordId: string; values: Record<string, string | number | boolean> }
  | { type: 'delete_record'; entityId: string; recordId: string }
  | { type: 'add_field'; entityId: string; field: FieldDefinition }
  | { type: 'activate_module'; module: string; capabilityId?: string; capabilityLabel?: string; capabilityIds?: string[]; entities: EntityDefinition[]; views: ViewDefinition[]; navigation: NavigationDefinition[]; entityUpdates?: Array<{ entityId: string; fields: FieldDefinition[] }>; metrics?: MetricDefinition[]; workflows?: WorkflowDefinition[] }
  | { type: 'deactivate_module'; module: string }
  | { type: 'deactivate_capability'; capabilityId: string; capabilityLabel?: string; entityIds: string[]; metricIds: string[]; workflowIds: string[] }
  | { type: 'create_workflow'; workflow: WorkflowDefinition }
  | { type: 'navigate'; navigationId: string }
  | { type: 'query_business_data'; entityId: string }

export interface ActionResult {
  config: WorkspaceConfiguration
  records: WorkspaceRecords
  message: string
  navigationId?: string
}

/**
 * Field values with the record's identity stripped out.
 *
 * These values arrive from a model deciding what the operator meant. Spreading them over a record
 * let a supplied `id` become the record's id: a create could collide with a row that already exists,
 * and an update could rename a record's identity so every later edit and delete hit the wrong one.
 * Identity belongs to BO, never to the request.
 */
function fieldValues(values: Record<string, unknown>) {
  const { id, createdAt, updatedAt, ...rest } = values
  return rest as Record<string, string | number | boolean>
}

export function executeWorkspaceAction(config: WorkspaceConfiguration, records: WorkspaceRecords, action: WorkspaceAction): ActionResult {
  if (action.type === 'create_record') {
    const now = new Date().toISOString()
    const record: BusinessRecord = { ...fieldValues(action.values), id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    return { config, records: { ...records, [action.entityId]: [...(records[action.entityId] ?? []), record] }, message: 'Record created.' }
  }
  if (action.type === 'update_record') {
    return { config, records: { ...records, [action.entityId]: (records[action.entityId] ?? []).map(record => record.id === action.recordId ? { ...record, ...fieldValues(action.values), updatedAt: new Date().toISOString() } : record) }, message: 'Record updated.' }
  }
  if (action.type === 'delete_record') {
    return { config, records: { ...records, [action.entityId]: (records[action.entityId] ?? []).filter(record => record.id !== action.recordId) }, message: 'Record deleted.' }
  }
  if (action.type === 'add_field') {
    return { config: { ...config, entities: config.entities.map(entity => entity.id === action.entityId ? { ...entity, fields: [...entity.fields, action.field] } : entity) }, records, message: `${action.field.label} added.` }
  }
  if (action.type === 'activate_module') {
    const updatedEntities = config.entities.map(entity => {
      const update = action.entityUpdates?.find(item => item.entityId === entity.id)
      return update ? { ...entity, fields: [...entity.fields, ...update.fields.filter(newField => !entity.fields.some(existing => existing.id === newField.id))] } : entity
    })
    const utilityIndex = config.navigation.findIndex(item => ['analytics', 'links', 'automations', 'assistant', 'settings'].includes(item.kind))
    const insertionIndex = utilityIndex < 0 ? config.navigation.length : utilityIndex
    const capabilityIds = [...(action.capabilityIds ?? []), ...(action.capabilityId ? [action.capabilityId] : [])]
    const capabilityPlan = config.capabilityPlan && capabilityIds.length ? { ...config.capabilityPlan, excluded: config.capabilityPlan.excluded.filter(id => !capabilityIds.includes(id)), reasons: { ...config.capabilityPlan.reasons, ...Object.fromEntries(capabilityIds.map(id => [id, 'Added later through BO'])) } } : config.capabilityPlan
    return { config: { ...config, capabilityPlan, modules: [...new Set([...config.modules, action.module, ...action.entities.map(entity => entity.module)])], capabilities: capabilityIds.length ? [...new Set([...(config.capabilities ?? []), ...capabilityIds])] : config.capabilities, entities: [...updatedEntities, ...action.entities.filter(entity => !updatedEntities.some(existing => existing.id === entity.id))], views: [...config.views, ...action.views.filter(view => !config.views.some(existing => existing.id === view.id))], navigation: [...config.navigation.slice(0, insertionIndex), ...action.navigation.filter(item => !config.navigation.some(existing => existing.id === item.id)), ...config.navigation.slice(insertionIndex)], metrics: [...config.metrics, ...(action.metrics ?? []).filter(metric => !config.metrics.some(existing => existing.id === metric.id))], workflows: [...config.workflows, ...(action.workflows ?? []).filter(workflow => !config.workflows.some(existing => existing.id === workflow.id))] }, records, message: `${action.capabilityLabel ?? action.capabilityId ?? action.module} added to the workspace.` }
  }
  if (action.type === 'deactivate_module') {
    return { config: { ...config, modules: config.modules.filter(module => module !== action.module), entities: config.entities.filter(entity => entity.module !== action.module), views: config.views.filter(view => config.entities.find(entity => entity.id === view.entityId)?.module !== action.module), navigation: config.navigation.filter(item => item.module !== action.module) }, records, message: `${action.module} removed from the workspace.` }
  }
  if (action.type === 'deactivate_capability') {
    const remainingEntities = config.entities.filter(entity => !action.entityIds.includes(entity.id))
    const remainingEntityIds = new Set(remainingEntities.map(entity => entity.id))
    const remainingViews = config.views.filter(view => remainingEntityIds.has(view.entityId))
    const remainingViewIds = new Set(remainingViews.map(view => view.id))
    const remainingCapabilities = (config.capabilities ?? []).filter(id => id !== action.capabilityId)
    const remainingModules = config.modules.filter(module => remainingEntities.some(entity => entity.module === module))
    const capabilityPlan = config.capabilityPlan ? { ...config.capabilityPlan, excluded: [...new Set([...config.capabilityPlan.excluded, action.capabilityId])], reasons: { ...config.capabilityPlan.reasons, [action.capabilityId]: 'Removed later through BO' } } : config.capabilityPlan
    return { config: { ...config, capabilityPlan, capabilities: remainingCapabilities, modules: remainingModules, entities: remainingEntities, views: remainingViews, navigation: config.navigation.filter(item => !item.viewId || remainingViewIds.has(item.viewId)), metrics: config.metrics.filter(item => !action.metricIds.includes(item.id) && remainingEntityIds.has(item.entityId)), workflows: config.workflows.filter(item => !action.workflowIds.includes(item.id) && remainingEntityIds.has(item.trigger.entityId)) }, records, message: `${action.capabilityLabel ?? action.capabilityId} removed from the workspace. Existing record data is preserved for recovery.` }
  }
  if (action.type === 'create_workflow') return { config: { ...config, workflows: [...config.workflows, action.workflow] }, records, message: 'Automation created.' }
  if (action.type === 'navigate') return { config, records, message: '', navigationId: action.navigationId }
  return { config, records, message: `${records[action.entityId]?.length ?? 0} records found.`, navigationId: config.navigation.find(item => config.views.find(view => view.id === item.viewId)?.entityId === action.entityId)?.id }
}

function entityMatch(config: WorkspaceConfiguration, words: string) {
  const normalized = words.toLowerCase()
  return config.entities.find(entity => normalized.includes(entity.id.toLowerCase()) || normalized.includes(entity.label.toLowerCase()) || normalized.includes(entity.pluralLabel.toLowerCase()))
}

export function interpretWorkspaceCommand(command: string, config: WorkspaceConfiguration, records: WorkspaceRecords = {}): { action?: WorkspaceAction; message?: string; needsPreview?: boolean } {
  const clean = command.trim()
  const normalized = clean.toLowerCase()
  if (!clean) return { message: 'Tell BO what you want to do.' }

  const entity = entityMatch(config, normalized)
  if (/^(show|open|go to|list|find)\b/.test(normalized) && entity) return { action: { type: 'query_business_data', entityId: entity.id } }

  if (/^(create|add)\b/.test(normalized) && entity) {
    const primary = entity.primaryField
    const patterns = [/(?:called|named)\s+(.+)$/i, /(?:new\s+)?[^ ]+\s+(.+)$/i]
    const value = patterns.map(pattern => clean.match(pattern)?.[1]?.trim()).find(Boolean)
    if (!value) return { message: `What should the ${entity.label.toLowerCase()} be called?` }
    return { action: { type: 'create_record', entityId: entity.id, values: { [primary]: value, ...(entity.fields.some(item => item.id === 'status') ? { status: entity.fields.find(item => item.id === 'status')?.options?.[0] ?? 'Active' } : {}) } } }
  }

  if (/^(update|mark)\b/.test(normalized) && entity) {
    const target = (records[entity.id] ?? []).find(record => normalized.includes(String(record[entity.primaryField] ?? '').toLowerCase()))
    const statusField = entity.fields.find(item => item.id === 'status')
    const status = statusField?.options?.find(option => normalized.includes(option.toLowerCase()))
    if (target && status) return { action: { type: 'update_record', entityId: entity.id, recordId: target.id, values: { status } } }
    return { message: `Tell BO which ${entity.label.toLowerCase()} and status to update.` }
  }

  if (/^(delete|remove)\b/.test(normalized) && entity) {
    const target = (records[entity.id] ?? []).find(record => normalized.includes(String(record[entity.primaryField] ?? '').toLowerCase()))
    if (target) return { action: { type: 'delete_record', entityId: entity.id, recordId: target.id }, needsPreview: true }
    return { message: `I could not find that ${entity.label.toLowerCase()}.` }
  }

  const fieldMatch = clean.match(/(?:track|add (?:a )?field (?:for|to))\s+(.+?)\s+(?:for|to)\s+(.+)$/i)
  if (fieldMatch) {
    const target = entityMatch(config, fieldMatch[2])
    if (target) return { action: { type: 'add_field', entityId: target.id, field: { id: fieldMatch[1].toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, next: string) => next.toUpperCase()), label: fieldMatch[1], type: 'text' } }, needsPreview: true }
  }

  if (normalized.includes('equipment') && (normalized.includes('add') || normalized.includes('track') || normalized.includes('section')) && !config.entities.some(item => item.id === 'equipment')) {
    const equipment: EntityDefinition = { id: 'equipment', label: 'Equipment', pluralLabel: 'Equipment', module: 'equipment', primaryField: 'name', fields: [{ id: 'name', label: 'Equipment', type: 'text', required: true }, { id: 'assetNumber', label: 'Asset number', type: 'text' }, { id: 'status', label: 'Status', type: 'select', options: ['Available', 'Assigned', 'Maintenance'] }, { id: 'hourlyCost', label: 'Hourly cost', type: 'currency' }, { id: 'nextMaintenance', label: 'Next maintenance', type: 'date' }] }
    const assignments: EntityDefinition = { id: 'equipment-assignments', label: 'Equipment assignment', pluralLabel: 'Equipment Assignments', module: 'equipment', primaryField: 'equipment', fields: [{ id: 'equipment', label: 'Equipment', type: 'relation', relationEntityId: 'equipment', required: true }, { id: 'project', label: 'Project', type: 'relation', relationEntityId: 'projects', required: true }, { id: 'startDate', label: 'Start date', type: 'date' }, { id: 'endDate', label: 'End date', type: 'date' }, { id: 'hours', label: 'Hours', type: 'number' }] }
    const maintenance: EntityDefinition = { id: 'maintenance', label: 'Maintenance record', pluralLabel: 'Maintenance', module: 'equipment', primaryField: 'description', fields: [{ id: 'description', label: 'Maintenance', type: 'text', required: true }, { id: 'equipment', label: 'Equipment', type: 'relation', relationEntityId: 'equipment', required: true }, { id: 'project', label: 'Project', type: 'relation', relationEntityId: 'projects' }, { id: 'status', label: 'Status', type: 'select', options: ['Scheduled', 'Due', 'Complete'] }, { id: 'dueDate', label: 'Due date', type: 'date' }, { id: 'cost', label: 'Cost', type: 'currency' }] }
    const entities = [equipment, assignments, maintenance]
    const views: ViewDefinition[] = entities.map(item => ({ id: `${item.id}-table`, label: item.pluralLabel, entityId: item.id, type: 'table', columns: item.fields.slice(0, 5).map(field => field.id) }))
    const navigation: NavigationDefinition[] = views.map((view, index) => ({ id: index === 0 ? 'equipment' : view.entityId, label: view.label, kind: 'entity', viewId: view.id, module: 'equipment' }))
    const equipmentCostField: FieldDefinition = { id: 'equipment', label: 'Equipment', type: 'relation', relationEntityId: 'equipment' }
    return { action: { type: 'activate_module', module: 'equipment', entities, views, navigation, entityUpdates: config.entities.some(item => item.id === 'project-costs') ? [{ entityId: 'project-costs', fields: [equipmentCostField] }] : [], metrics: [{ id: 'equipment-costs', label: 'Equipment costs', entityId: 'maintenance', operation: 'sum', field: 'cost', roles: ['owner', 'admin', 'manager', 'accountant'], format: 'currency' }] }, needsPreview: true }
  }

  if ((/\b(whenever|when)\b/.test(normalized) || normalized.includes('remind')) && (entity || normalized.includes('maintenance'))) {
    const workflowEntity = normalized.includes('maintenance') && config.entities.some(item => item.id === 'maintenance') ? config.entities.find(item => item.id === 'maintenance')! : entity!
    const overdue = normalized.includes('overdue')
    const maintenance = workflowEntity.id === 'maintenance'
    return { action: { type: 'create_workflow', workflow: { id: crypto.randomUUID(), name: clean, enabled: true, trigger: { entityId: workflowEntity.id, event: 'updated', ...(overdue ? { field: 'status', equals: 'Overdue' } : maintenance ? { field: 'status', equals: 'Due' } : {}) }, action: { type: 'notify', message: clean } } }, needsPreview: true }
  }

  const customMatch = clean.match(/(?:keep track of|start tracking|track)(?: all)?(?: our)?\s+([a-z][a-z -]{1,40})$/i) ?? clean.match(/add\s+([a-z][a-z -]{1,40})\s+management$/i)
  if (customMatch) {
    const pluralLabel = customMatch[1].trim().replace(/^the\s+/i, '')
    const id = pluralLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const singular = pluralLabel.replace(/s$/i, '')
    const customEntity: EntityDefinition = { id, label: singular[0].toUpperCase() + singular.slice(1), pluralLabel: pluralLabel[0].toUpperCase() + pluralLabel.slice(1), module: id, primaryField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] }, { id: 'notes', label: 'Notes', type: 'long-text' }] }
    const customView: ViewDefinition = { id: `${id}-table`, label: customEntity.pluralLabel, entityId: id, type: 'table', columns: ['name', 'status', 'notes'] }
    return { action: { type: 'activate_module', module: id, entities: [customEntity], views: [customView], navigation: [{ id, label: customEntity.pluralLabel, kind: 'entity', viewId: customView.id, module: id }] }, needsPreview: true }
  }

  if (normalized.includes('what needs') || normalized.includes('worry about') || normalized.includes('today')) return { action: { type: 'navigate', navigationId: 'today' } }
  return { message: 'I can create records, open business data, add fields, and show what needs attention. More command tools will be added as the workspace engine expands.' }
}
