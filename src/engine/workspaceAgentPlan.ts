import { createCapabilityActivation } from './capabilityActions'
import { capabilityById } from './capabilityCatalog'
import { slug } from './shared'
import { navigationId } from './workspaceSchema'
import type { AgentPlan, AgentPlanField } from './workspaceAgentClient'
import type { WorkspaceAction } from './workspaceActions'
import type { EntityDefinition, FieldDefinition, FieldType, MetricDefinition, NavigationDefinition, ViewDefinition, WorkflowDefinition, WorkspaceConfiguration, WorkspaceRoleId } from './workspaceSchema'

/**
 * A plan from the agent, turned into the one action the workspace already knows how to apply.
 *
 * The agent describes a change the way the architect describes a build — record types in the
 * company's own words, their fields, what they connect to, what goes wrong. This compiles that into
 * an `activate_module`, which is the same action the capability installer produces, so everything
 * downstream is untouched: the role check, the approval, the versioned build that is tested before
 * it is promoted, and rollback.
 *
 * Nothing here trusts the model. A relation pointing at a record type that does not exist is
 * dropped rather than built as a dead dropdown; a select with nothing in it becomes a text box; an
 * id that collides with something already in the workspace loses to what is already there. What
 * survives is a change an operator would recognise as the thing they asked for.
 */

const fieldTypes: FieldType[] = ['text', 'long-text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'select', 'relation', 'file']

const financialRoles: WorkspaceRoleId[] = ['owner', 'admin', 'accountant']
const operationalRoles: WorkspaceRoleId[] = ['owner', 'admin', 'manager', 'employee', 'accountant']

/** The entity a name refers to, whether it is an id, a label, a plural, or one of this plan's own. */
function resolveEntityId(name: string, known: Map<string, string>) {
  const key = slug(name)
  if (!key) return ''
  return known.get(key) ?? known.get(`${key}s`) ?? known.get(key.replace(/s$/, '')) ?? ''
}

function compileFields(proposed: AgentPlanField[], known: Map<string, string>, selfId: string, existing: FieldDefinition[] = []): FieldDefinition[] {
  const fields: FieldDefinition[] = []
  for (const item of proposed) {
    const id = slug(item.label ?? '')
    const type = fieldTypes.includes(item.type as FieldType) ? item.type as FieldType : 'text'
    // Matched on the label as well as the id, because the field the workspace calls `name` is
    // labelled "Product" on a products record — and a second field called Product beside it is the
    // same duplicate as a second Products table, one row further down.
    if (!id || fields.some(field => field.id === id) || existing.some(field => field.id === id || slug(field.label) === id)) continue

    if (type === 'relation') {
      const target = resolveEntityId(item.relatedTo ?? '', known)
      // A picker onto a record type nobody built is a field that can never be filled in.
      if (!target || target === selfId) continue
      fields.push({ id, label: item.label, type, relationEntityId: target, ...(item.required ? { required: true } : {}) })
      continue
    }

    const options = (item.options ?? []).map(option => String(option).trim()).filter(Boolean)
    const resolved: FieldType = type === 'select' && options.length < 2 ? 'text' : type
    fields.push({ id, label: item.label, type: resolved, ...(resolved === 'select' ? { options } : {}), ...(item.required ? { required: true } : {}) })
  }
  return fields
}

/**
 * Every record type this plan will produce, before any of them are compiled.
 *
 * Built first because the fields reference each other: a Purchase Order relates to a Supplier that
 * this same plan is creating, and resolving that needs both names known before either is compiled.
 */
function knownEntities(config: WorkspaceConfiguration, plan: AgentPlan, capabilityEntities: EntityDefinition[]) {
  const known = new Map<string, string>()
  for (const entity of [...config.entities, ...capabilityEntities]) {
    known.set(entity.id, entity.id)
    known.set(slug(entity.label), entity.id)
    known.set(slug(entity.pluralLabel), entity.id)
  }
  for (const proposed of plan.entities ?? []) {
    const id = slug(proposed.name ?? '')
    if (id && !known.has(id)) known.set(id, id)
  }
  return known
}

/** The capabilities the plan named, compiled and merged into one change. */
function fromCapabilities(config: WorkspaceConfiguration, capabilityIds: string[]) {
  const merged = {
    module: '',
    capabilityIds: [] as string[],
    entities: [] as EntityDefinition[],
    entityUpdates: [] as Array<{ entityId: string; fields: FieldDefinition[] }>,
    views: [] as ViewDefinition[],
    navigation: [] as NavigationDefinition[],
    metrics: [] as MetricDefinition[],
    workflows: [] as WorkflowDefinition[],
  }
  const active = new Set(config.capabilities ?? [])
  for (const capabilityId of capabilityIds) {
    if (!capabilityById.has(capabilityId) || active.has(capabilityId)) continue
    // Compiled against the config plus everything already merged, so two capabilities that share a
    // record type produce one of it rather than two.
    const running: WorkspaceConfiguration = {
      ...config,
      capabilities: [...(config.capabilities ?? []), ...merged.capabilityIds],
      entities: [...config.entities, ...merged.entities],
      views: [...config.views, ...merged.views],
      navigation: [...config.navigation, ...merged.navigation],
      metrics: [...config.metrics, ...merged.metrics],
      workflows: [...config.workflows, ...merged.workflows],
    }
    const action = createCapabilityActivation(running, capabilityId)
    if (!action || action.type !== 'activate_module') continue
    merged.module ||= action.module
    merged.capabilityIds.push(...(action.capabilityIds ?? [action.capabilityId ?? capabilityId].filter(Boolean) as string[]))
    merged.entities.push(...action.entities)
    merged.entityUpdates.push(...(action.entityUpdates ?? []))
    merged.views.push(...action.views)
    merged.navigation.push(...action.navigation)
    merged.metrics.push(...(action.metrics ?? []))
    merged.workflows.push(...(action.workflows ?? []))
  }
  return merged
}

export function planToWorkspaceAction(plan: AgentPlan, config: WorkspaceConfiguration): WorkspaceAction | undefined {
  const capability = fromCapabilities(config, plan.capabilityIds ?? [])
  const module = slug(plan.module ?? '') || capability.module || slug(plan.label ?? '') || 'operations'
  const known = knownEntities(config, plan, capability.entities)

  const entities: EntityDefinition[] = [...capability.entities]
  const entityUpdates = [...capability.entityUpdates]
  const views: ViewDefinition[] = [...capability.views]
  const navigation: NavigationDefinition[] = [...capability.navigation]
  const takenNavigation = new Set([...config.navigation.map(item => item.id), ...navigation.map(item => item.id)])
  const takenModules = new Set([...config.navigation.map(item => item.module).filter(Boolean), ...navigation.map(item => item.module).filter(Boolean)])

  for (const proposed of plan.entities ?? []) {
    const id = slug(proposed.name ?? '')
    if (!id) continue
    const existing = config.entities.find(entity => entity.id === id) ?? entities.find(entity => entity.id === id)
    const compiled = compileFields(proposed.fields ?? [], known, id, existing?.fields ?? [])

    /**
     * A record type the workspace already has is extended, never built again.
     *
     * Two Suppliers tables is the worst outcome of an agent that builds: both look right, records
     * land in whichever one the person happened to open, and no page shows the whole picture.
     */
    if (existing) {
      if (compiled.length) entityUpdates.push({ entityId: existing.id, fields: compiled })
      continue
    }
    if (!compiled.length) continue

    const states = (proposed.states ?? []).map(state => String(state).trim()).filter(Boolean)
    const withStatus = compiled.some(field => field.id === 'status')
      ? compiled
      : [...compiled, { id: 'status', label: 'Status', type: 'select' as FieldType, options: states.length >= 2 ? states : ['Active', 'Paused', 'Done'] }]
    const fields = withStatus.some(field => field.type === 'long-text') ? withStatus : [...withStatus, { id: 'notes', label: 'Notes', type: 'long-text' as FieldType }]
    const primary = fields.find(field => field.required && field.type === 'text') ?? fields.find(field => field.type === 'text') ?? fields[0]
    const pluralLabel = proposed.name.trim()
    entities.push({ id, label: pluralLabel.replace(/s$/i, '') || pluralLabel, pluralLabel, module, primaryField: primary.id, fields })

    const type = states.length >= 3 ? 'kanban' as const : 'table' as const
    const viewId = `${id}-${type}`
    views.push({ id: viewId, label: pluralLabel, entityId: id, type, ...(type === 'kanban' ? { groupBy: 'status' } : {}), columns: fields.slice(0, 5).map(field => field.id) })
    let navId = navigationId(takenModules.has(module) ? id : module)
    if (takenNavigation.has(navId)) navId = navigationId(id)
    if (takenNavigation.has(navId)) continue
    takenNavigation.add(navId); takenModules.add(module)
    navigation.push({ id: navId, label: pluralLabel, kind: 'entity', viewId, module })
  }

  const allEntities = [...config.entities, ...entities]
  const entityById = new Map(allEntities.map(entity => [entity.id, entity]))
  for (const entity of entities) known.set(entity.id, entity.id)

  // An update to a record type nobody has is nothing; so is a field that is already on it.
  for (const update of plan.entityUpdates ?? []) {
    const target = entityById.get(resolveEntityId(update.entityId ?? '', known))
    if (!target || entities.some(entity => entity.id === target.id)) continue
    const fields = compileFields(update.fields ?? [], known, target.id, target.fields)
    if (fields.length) entityUpdates.push({ entityId: target.id, fields })
  }

  const metrics: MetricDefinition[] = [...capability.metrics]
  for (const proposed of plan.metrics ?? []) {
    const entity = entityById.get(resolveEntityId(proposed.entity ?? '', known))
    const id = slug(proposed.label ?? '')
    if (!entity || !id || metrics.some(item => item.id === id) || config.metrics.some(item => item.id === id)) continue
    const field = proposed.operation === 'sum' ? entity.fields.find(item => item.id === slug(proposed.field ?? '')) ?? entity.fields.find(item => item.type === 'currency') : undefined
    // A sum with nothing to add up would report zero forever.
    if (proposed.operation === 'sum' && !field) continue
    const statusOptions = entity.fields.find(item => item.id === 'status')?.options ?? []
    const notEquals = statusOptions.find(option => option.toLowerCase() === String(proposed.statusNotEquals ?? '').toLowerCase())
    metrics.push({
      id, label: proposed.label, entityId: entity.id, operation: proposed.operation === 'sum' ? 'sum' : 'count',
      ...(field ? { field: field.id } : {}),
      ...(notEquals ? { filter: { field: 'status', notEquals } } : {}),
      roles: field?.type === 'currency' ? financialRoles : operationalRoles,
      format: field?.type === 'currency' ? 'currency' : 'number',
    })
  }

  const workflows: WorkflowDefinition[] = [...capability.workflows]
  for (const proposed of plan.workflows ?? []) {
    const entity = entityById.get(resolveEntityId(proposed.entity ?? '', known))
    if (!entity || !proposed.name || !proposed.message) continue
    const conditionField = entity.fields.find(item => item.id === slug(proposed.conditionField ?? ''))
    const equals = conditionField?.options?.find(option => option.toLowerCase() === String(proposed.conditionEquals ?? '').toLowerCase())
    const id = `agent-${slug(proposed.name)}`.slice(0, 60)
    if (workflows.some(item => item.id === id) || config.workflows.some(item => item.id === id)) continue
    workflows.push({
      id, name: proposed.name, enabled: true,
      trigger: { entityId: entity.id, event: proposed.event === 'created' ? 'created' : 'updated', ...(conditionField && equals ? { field: conditionField.id, equals } : {}) },
      action: { type: 'notify', message: proposed.message },
    })
  }

  if (!entities.length && !entityUpdates.length && !workflows.length && !metrics.length) return undefined

  return {
    type: 'activate_module',
    module,
    ...(capability.capabilityIds.length ? { capabilityIds: [...new Set(capability.capabilityIds)] } : {}),
    capabilityLabel: plan.label || undefined,
    entities,
    entityUpdates,
    views,
    navigation,
    metrics,
    workflows,
  }
}
