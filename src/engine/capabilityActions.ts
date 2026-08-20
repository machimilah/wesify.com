import { capabilityById, type CapabilityDefinition, type CatalogEntity } from './capabilityCatalog'
import type { WorkspaceAction } from './workspaceActions'
import type { EntityDefinition, MetricDefinition, NavigationDefinition, ViewDefinition, WorkflowDefinition, WorkspaceConfiguration, WorkspaceRoleId } from './workspaceSchema'

function compileEntity(definition: CatalogEntity, module: string): EntityDefinition {
  return { id: definition.id, label: definition.label, pluralLabel: definition.pluralLabel, module, primaryField: definition.primaryField, fields: definition.fields.map(item => ({ ...item, ...(item.options ? { options: [...item.options] } : {}) })) }
}

function dependencyOrder(capabilityId: string, active: Set<string>, output: CapabilityDefinition[], visiting = new Set<string>()) {
  if (active.has(capabilityId) || visiting.has(capabilityId)) return
  const definition = capabilityById.get(capabilityId)
  if (!definition) return
  visiting.add(capabilityId)
  for (const dependency of definition.dependencies) dependencyOrder(dependency, active, output, visiting)
  visiting.delete(capabilityId)
  if (!active.has(capabilityId) && !output.some(item => item.id === capabilityId)) output.push(definition)
}

export function createCapabilityActivation(config: WorkspaceConfiguration, capabilityId: string): WorkspaceAction | undefined {
  const definitions: CapabilityDefinition[] = []
  dependencyOrder(capabilityId, new Set(config.capabilities ?? []), definitions)
  const target = capabilityById.get(capabilityId)
  if (!target || !definitions.length) return undefined
  const compiled = new Map<string, EntityDefinition>()
  for (const definition of definitions) for (const catalogEntity of definition.entities) {
    const candidate = compileEntity(catalogEntity, definition.module)
    const existing = compiled.get(candidate.id)
    if (!existing) compiled.set(candidate.id, candidate)
    else for (const field of candidate.fields) if (!existing.fields.some(item => item.id === field.id)) existing.fields.push(field)
  }
  const entityUpdates = [...compiled.values()].flatMap(candidate => {
    const existing = config.entities.find(item => item.id === candidate.id)
    if (!existing) return []
    const fields = candidate.fields.filter(field => !existing.fields.some(item => item.id === field.id))
    return fields.length ? [{ entityId: existing.id, fields }] : []
  })
  const entities = [...compiled.values()].filter(candidate => !config.entities.some(item => item.id === candidate.id))
  const allEntities = [...config.entities, ...entities]
  const views: ViewDefinition[] = []
  const navigation: NavigationDefinition[] = []
  const occupiedNavigation = new Set(config.navigation.map(item => item.id))
  const occupiedModules = new Set(config.navigation.map(item => item.module).filter(Boolean))
  for (const definition of definitions) for (const page of definition.pages) {
    const entity = allEntities.find(item => item.id === page.entityId)
    if (!entity) continue
    const catalog = definition.entities.find(item => item.id === page.entityId)
    const type = page.view ?? catalog?.view ?? 'table'
    const viewId = `${entity.id}-${type}`
    if (!config.views.some(item => item.id === viewId) && !views.some(item => item.id === viewId)) views.push({ id: viewId, label: entity.pluralLabel, entityId: entity.id, type, groupBy: type === 'kanban' ? catalog?.groupBy ?? 'status' : undefined, dateField: type === 'calendar' ? catalog?.dateField : undefined, columns: entity.fields.slice(0, 5).map(item => item.id) })
    if (config.navigation.some(item => item.viewId === viewId) || navigation.some(item => item.viewId === viewId)) continue
    let id = occupiedModules.has(definition.module) ? page.id : definition.module
    if (occupiedNavigation.has(id)) id = page.id
    if (occupiedNavigation.has(id)) id = `${page.id}-${definition.id.split('.').at(-1)}`
    occupiedNavigation.add(id); occupiedModules.add(definition.module)
    navigation.push({ id, label: page.label, kind: 'entity', viewId, module: definition.module })
  }
  const financialRoles: WorkspaceRoleId[] = ['owner', 'admin', 'accountant']
  const operationalRoles: WorkspaceRoleId[] = ['owner', 'admin', 'manager', 'employee', 'accountant']
  const metrics: MetricDefinition[] = definitions.flatMap(item => item.metrics ?? []).filter(item => !config.metrics.some(existing => existing.id === item.id)).map(item => ({ id: item.id, label: item.label, entityId: item.entityId, operation: item.operation, ...(item.field ? { field: item.field } : {}), ...(item.statusNotEquals ? { filter: { field: 'status', notEquals: item.statusNotEquals } } : {}), roles: item.format === 'currency' ? financialRoles : operationalRoles, format: item.format ?? 'number' }))
  const workflows: WorkflowDefinition[] = definitions.flatMap(item => item.workflows ?? []).filter(item => !config.workflows.some(existing => existing.id === item.id)).map(item => ({ id: item.id, name: item.name, enabled: true, trigger: { entityId: item.entityId, event: item.event, ...(item.field ? { field: item.field, equals: item.equals } : {}) }, action: { type: 'notify', message: item.message } }))
  return { type: 'activate_module', module: target.module, capabilityId, capabilityLabel: target.label, capabilityIds: definitions.map(item => item.id), entities, entityUpdates, views, navigation, metrics, workflows }
}

export function createCapabilityRemoval(config: WorkspaceConfiguration, capabilityId: string): WorkspaceAction | undefined {
  const target = capabilityById.get(capabilityId)
  if (!target || !(config.capabilities ?? []).includes(capabilityId)) return undefined
  const activeOthers = (config.capabilities ?? []).filter(id => id !== capabilityId).map(id => capabilityById.get(id)).filter(Boolean) as CapabilityDefinition[]
  if (activeOthers.some(item => item.dependencies.includes(capabilityId))) return undefined
  const sharedEntityIds = new Set(activeOthers.flatMap(item => item.entities.map(entity => entity.id)))
  return { type: 'deactivate_capability', capabilityId, capabilityLabel: target.label, entityIds: target.entities.map(item => item.id).filter(id => !sharedEntityIds.has(id)), metricIds: (target.metrics ?? []).map(item => item.id), workflowIds: (target.workflows ?? []).map(item => item.id) }
}
