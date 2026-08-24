import { compileBusinessAgents } from './agentArchitecture'
import { compileBusinessGraph } from './businessGraph'
import { compileEventArchitecture } from './eventArchitecture'
import { compileGovernanceArchitecture } from './governanceArchitecture'
import { compileInterfaceArchitecture } from './interfaceArchitecture'
import { refreshWorkspaceKpis } from './kpiEngine'
import type { WorkspaceConfiguration } from './workspaceSchema'

export function refreshWorkspaceIntelligence(config: WorkspaceConfiguration): WorkspaceConfiguration {
  const withKpis = refreshWorkspaceKpis(config)
  const agents = compileBusinessAgents(withKpis)
  const eventArchitecture = compileEventArchitecture(withKpis, agents)
  const businessGraph = compileBusinessGraph(withKpis, agents, eventArchitecture)
  const governanceArchitecture = compileGovernanceArchitecture()
  const interfaceArchitecture = compileInterfaceArchitecture({ ...withKpis, agents, eventArchitecture }, agents)
  const businessModel = withKpis.businessModel ? {
    ...withKpis.businessModel,
    coordination: {
      agentIds: agents.map(item => item.id),
      sharedCompanyState: `workspace:${withKpis.id}:company-state`,
      graphNodeCount: businessGraph.nodes.length,
      graphEdgeCount: businessGraph.edges.length,
      eventTypes: eventArchitecture.definitions.map(item => item.type),
    },
  } : undefined
  return { ...withKpis, agents, eventArchitecture, businessGraph, interfaceArchitecture, governanceArchitecture, businessModel }
}
