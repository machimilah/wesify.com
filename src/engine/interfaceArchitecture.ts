import type { CompiledBusinessAgent } from './agentArchitecture'
import type { NavigationDefinition, WorkspaceConfiguration, WorkspaceRoleId } from './workspaceSchema'

export interface GeneratedInterfacePage {
  id: string
  label: string
  kind: NavigationDefinition['kind']
  module: string
  viewId?: string
  entityId?: string
  capabilityIds: string[]
  roleIds: WorkspaceRoleId[]
  actions: Array<'view' | 'create' | 'edit' | 'delete' | 'approve'>
  metricIds: string[]
  kpiIds: string[]
  workflowIds: string[]
  agentIds: string[]
}

export interface GeneratedInterfaceArchitecture {
  version: 1
  startPageId: string
  navigationGroups: Array<{ id: string; label: string; pageIds: string[] }>
  pages: GeneratedInterfacePage[]
  dashboard: { metricIds: string[]; kpiIds: string[]; attentionEventTypes: string[] }
  propagation: Array<'data-model' | 'views' | 'navigation' | 'permissions' | 'workflows' | 'kpis' | 'agents' | 'events'>
}

function rolesFor(module: string, config: WorkspaceConfiguration) {
  if (module === 'control') return config.roles.filter(role => role.id === 'owner' || role.id === 'admin').map(role => role.id)
  const sensitivePermission = /finance|accounting|payroll/.test(module) ? 'financial' : /people|team|hr/.test(module) ? 'people' : null
  return config.roles.filter(role => role.permissions.includes('view') && (!sensitivePermission || role.permissions.includes(sensitivePermission) || role.permissions.includes('admin'))).map(role => role.id)
}

function actionsFor(roleIds: WorkspaceRoleId[], config: WorkspaceConfiguration): GeneratedInterfacePage['actions'] {
  const roles = config.roles.filter(role => roleIds.includes(role.id))
  const actions: GeneratedInterfacePage['actions'] = ['view']
  if (roles.some(role => role.permissions.includes('create') || role.permissions.includes('admin'))) actions.push('create')
  if (roles.some(role => role.permissions.includes('edit') || role.permissions.includes('admin'))) actions.push('edit')
  if (roles.some(role => role.permissions.includes('delete') || role.permissions.includes('admin'))) actions.push('delete')
  if (roles.some(role => role.permissions.includes('approve') || role.permissions.includes('admin'))) actions.push('approve')
  return actions
}

export function compileInterfaceArchitecture(config: WorkspaceConfiguration, agents: CompiledBusinessAgent[]): GeneratedInterfaceArchitecture {
  const pages = config.navigation.map<GeneratedInterfacePage>(navigation => {
    const view = config.views.find(item => item.id === navigation.viewId)
    const entity = config.entities.find(item => item.id === view?.entityId)
    const module = navigation.module ?? entity?.module ?? navigation.kind
    const roleIds = rolesFor(module, config)
    const capabilityIds = entity?.capabilityId ? [entity.capabilityId] : (config.capabilities ?? []).filter(id => id.split('.')[0] === module)
    return {
      id: navigation.id,
      label: navigation.label,
      kind: navigation.kind,
      module,
      ...(view ? { viewId: view.id, entityId: view.entityId } : {}),
      capabilityIds,
      roleIds,
      actions: actionsFor(roleIds, config),
      metricIds: config.metrics.filter(metric => !entity || metric.entityId === entity.id).map(metric => metric.id),
      kpiIds: (config.kpis ?? []).filter(kpi => !entity || kpi.dataSources.some(source => source.entityId === entity.id)).map(kpi => kpi.id),
      workflowIds: config.workflows.filter(workflow => !entity || workflow.trigger.entityId === entity.id).map(workflow => workflow.id),
      agentIds: agents.filter(agent => !entity || agent.accessibleEntityIds.includes(entity.id)).map(agent => agent.id),
    }
  })
  const groups = new Map<string, string[]>()
  for (const page of pages) groups.set(page.module, [...(groups.get(page.module) ?? []), page.id])
  return {
    version: 1,
    startPageId: pages.find(page => page.kind === 'home')?.id ?? pages[0]?.id ?? 'home',
    navigationGroups: [...groups].map(([id, pageIds]) => ({ id, label: config.navigation.find(item => (item.module ?? item.kind) === id)?.label ?? id, pageIds })),
    pages,
    dashboard: {
      metricIds: config.metrics.map(metric => metric.id),
      kpiIds: (config.kpis ?? []).map(kpi => kpi.id),
      attentionEventTypes: config.eventArchitecture?.definitions.filter(event => event.severity !== 'informational').map(event => event.type) ?? [],
    },
    propagation: ['data-model', 'views', 'navigation', 'permissions', 'workflows', 'kpis', 'agents', 'events'],
  }
}
