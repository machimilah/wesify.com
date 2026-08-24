import { capabilityById } from './capabilityCatalog'
import type { WorkspaceAction } from './workspaceActions'
import type { WorkspaceConfiguration } from './workspaceSchema'

export interface WorkspaceMutationPlan {
  actionType: WorkspaceAction['type']
  structural: boolean
  reversible: boolean
  retainsExistingData: boolean
  affected: {
    entityIds: string[]
    relationshipIds: string[]
    viewIds: string[]
    navigationIds: string[]
    workflowIds: string[]
    metricIds: string[]
    kpiIds: string[]
    agentIds: string[]
    eventTypes: string[]
    integrationIds: string[]
  }
  dependencyChanges: Array<{ capabilityId: string; reason: string }>
  steps: string[]
  warnings: string[]
}

const unique = (values: string[]) => [...new Set(values)]

export function planWorkspaceMutation(config: WorkspaceConfiguration, action: WorkspaceAction): WorkspaceMutationPlan {
  const directEntityIds = 'entityId' in action ? [action.entityId]
    : action.type === 'activate_module' ? action.entities.map(entity => entity.id)
      : action.type === 'deactivate_module' ? config.entities.filter(entity => entity.module === action.module).map(entity => entity.id)
        : action.type === 'deactivate_capability' ? action.entityIds
          : action.type === 'create_workflow' ? [action.workflow.trigger.entityId] : []
  const relatedEntityIds = config.entities.filter(entity => entity.fields.some(field => field.relationEntityId && directEntityIds.includes(field.relationEntityId))).map(entity => entity.id)
  const entityIds = unique([...directEntityIds, ...relatedEntityIds])
  const capabilityIds = action.type === 'activate_module' ? unique([...(action.capabilityIds ?? []), ...(action.capabilityId ? [action.capabilityId] : [])])
    : action.type === 'deactivate_capability' ? [action.capabilityId] : []
  const dependents = (config.capabilities ?? []).filter(id => capabilityById.get(id)?.dependencies.some(dependency => capabilityIds.includes(dependency)))
  const structural = ['add_field', 'activate_module', 'deactivate_module', 'deactivate_capability', 'create_workflow'].includes(action.type)
  const removing = action.type === 'deactivate_module' || action.type === 'deactivate_capability'
  const relationshipIds = config.businessGraph?.edges.filter(edge => entityIds.some(id => edge.from === `entity:${id}` || edge.to === `entity:${id}`)).map(edge => edge.id) ?? []
  const addedRelationshipIds = action.type === 'activate_module' ? action.entities.flatMap(entity => entity.fields.filter(field => field.relationEntityId).map(field => `entity:${entity.id}:${field.id}:entity:${field.relationEntityId}`)) : []
  const addedViewIds = action.type === 'activate_module' ? action.views.map(view => view.id) : []
  const addedNavigationIds = action.type === 'activate_module' ? action.navigation.map(item => item.id) : []
  const addedWorkflowIds = action.type === 'activate_module' ? (action.workflows ?? []).map(workflow => workflow.id) : []
  const addedMetricIds = action.type === 'activate_module' ? (action.metrics ?? []).map(metric => metric.id) : []
  return {
    actionType: action.type,
    structural,
    reversible: structural || action.type === 'delete_record',
    retainsExistingData: removing,
    affected: {
      entityIds,
      relationshipIds: unique([...relationshipIds, ...addedRelationshipIds]),
      viewIds: unique([...config.views.filter(view => entityIds.includes(view.entityId)).map(view => view.id), ...addedViewIds]),
      navigationIds: unique([...config.navigation.filter(item => item.viewId && config.views.some(view => view.id === item.viewId && entityIds.includes(view.entityId))).map(item => item.id), ...addedNavigationIds]),
      workflowIds: unique([...(action.type === 'create_workflow' ? [action.workflow.id] : []), ...config.workflows.filter(workflow => entityIds.includes(workflow.trigger.entityId)).map(workflow => workflow.id), ...addedWorkflowIds]),
      metricIds: unique([...config.metrics.filter(metric => entityIds.includes(metric.entityId)).map(metric => metric.id), ...addedMetricIds]),
      kpiIds: (config.kpis ?? []).filter(kpi => kpi.dataSources.some(source => entityIds.includes(source.entityId))).map(kpi => kpi.id),
      agentIds: config.agents?.filter(agent => agent.accessibleEntityIds.some(id => entityIds.includes(id))).map(agent => agent.id) ?? [],
      eventTypes: config.eventArchitecture?.definitions.filter(event => event.sourceEntityIds.some(id => entityIds.includes(id))).map(event => event.type) ?? [],
      integrationIds: (config.connections ?? []).filter(connection => capabilityIds.includes(connection.capabilityId)).map(connection => `${connection.providerId}:${connection.capabilityId}`),
    },
    dependencyChanges: [...capabilityIds.map(capabilityId => ({ capabilityId, reason: action.type === 'activate_module' ? 'Installed with its declared dependencies.' : 'Removed from the active operating model.' })), ...dependents.map(capabilityId => ({ capabilityId, reason: 'Depends on a capability affected by this change.' }))],
    steps: structural ? ['Validate dependencies and permissions', 'Compile data and relationship changes', 'Regenerate interfaces, workflows, KPIs, agents and events', 'Build and test a versioned preview', 'Apply only after required approval'] : ['Validate permissions and record identity', 'Execute through the authoritative record API', 'Emit events and refresh dependent views'],
    warnings: [...(dependents.length ? [`${dependents.length} active capabilities depend on this change.`] : []), ...(removing ? ['Visible interfaces are removed, but existing record data remains retained for recovery.'] : [])],
  }
}
