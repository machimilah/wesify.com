import { processPatterns } from '../data/operatingKnowledge'
import { capabilityById } from './capabilityCatalog'
import type { CompiledBusinessAgent } from './agentArchitecture'
import type { EventArchitecture } from './eventArchitecture'
import type { WorkspaceConfiguration } from './workspaceSchema'

export type BusinessGraphNodeType = 'entity' | 'capability' | 'process' | 'kpi' | 'agent' | 'event'
export type BusinessGraphStorage = 'relational' | 'graph' | 'event' | 'vector'

export interface BusinessGraphNode {
  id: string
  type: BusinessGraphNodeType
  label: string
  storage: BusinessGraphStorage[]
  referenceId: string
}

export interface BusinessGraphEdge {
  id: string
  from: string
  to: string
  relationship: string
  storage: 'relational' | 'graph' | 'event'
  sourceField?: string
}

export interface BusinessGraph {
  version: 1
  nodes: BusinessGraphNode[]
  edges: BusinessGraphEdge[]
  vectorKnowledge: Array<{ id: string; sourceType: 'company-profile' | 'entity-schema'; sourceId: string; textFields: string[] }>
  storageArchitecture: {
    relational: string
    graph: string
    events: string
    vector: string
  }
}

const nodeId = (type: BusinessGraphNodeType, id: string) => `${type}:${id}`

function edge(from: string, relationship: string, to: string, storage: BusinessGraphEdge['storage'], sourceField?: string): BusinessGraphEdge {
  return { id: `${from}:${relationship}:${to}`.replace(/[^a-z0-9:.-]+/gi, '-').toLowerCase(), from, to, relationship, storage, sourceField }
}

export function compileBusinessGraph(config: WorkspaceConfiguration, agents: CompiledBusinessAgent[], events: EventArchitecture): BusinessGraph {
  const active = new Set(config.capabilities ?? [])
  const relevantProcesses = processPatterns.filter(process => process.capabilityIds.some(id => active.has(id)))
  const nodes: BusinessGraphNode[] = [
    ...config.entities.map(entity => ({ id: nodeId('entity', entity.id), type: 'entity' as const, label: entity.pluralLabel, storage: ['relational', 'graph'] as BusinessGraphStorage[], referenceId: entity.id })),
    ...(config.capabilities ?? []).map(id => ({ id: nodeId('capability', id), type: 'capability' as const, label: capabilityById.get(id)?.label ?? id, storage: ['graph'] as BusinessGraphStorage[], referenceId: id })),
    ...relevantProcesses.map(process => ({ id: nodeId('process', process.id), type: 'process' as const, label: process.name, storage: ['graph'] as BusinessGraphStorage[], referenceId: process.id })),
    ...(config.kpis ?? []).map(kpi => ({ id: nodeId('kpi', kpi.id), type: 'kpi' as const, label: kpi.name, storage: ['relational', 'graph'] as BusinessGraphStorage[], referenceId: kpi.id })),
    ...agents.map(agent => ({ id: nodeId('agent', agent.id), type: 'agent' as const, label: agent.label, storage: ['graph'] as BusinessGraphStorage[], referenceId: agent.id })),
    ...events.definitions.map(event => ({ id: nodeId('event', event.type), type: 'event' as const, label: event.label, storage: ['event', 'graph'] as BusinessGraphStorage[], referenceId: event.type })),
  ]

  const edges: BusinessGraphEdge[] = []
  for (const entity of config.entities) for (const field of entity.fields.filter(field => field.type === 'relation' && field.relationEntityId)) {
    if (config.entities.some(candidate => candidate.id === field.relationEntityId)) edges.push(edge(nodeId('entity', entity.id), field.label.toLowerCase(), nodeId('entity', field.relationEntityId!), 'relational', field.id))
  }
  for (const capabilityId of config.capabilities ?? []) {
    const definition = capabilityById.get(capabilityId)
    for (const entity of definition?.entities ?? []) if (config.entities.some(item => item.id === entity.id)) edges.push(edge(nodeId('capability', capabilityId), 'owns schema', nodeId('entity', entity.id), 'graph'))
    for (const process of relevantProcesses.filter(item => item.capabilityIds.includes(capabilityId))) edges.push(edge(nodeId('capability', capabilityId), 'enables', nodeId('process', process.id), 'graph'))
  }
  for (const kpi of config.kpis ?? []) {
    for (const source of kpi.dataSources) if (config.entities.some(entity => entity.id === source.entityId)) edges.push(edge(nodeId('entity', source.entityId), 'measured by', nodeId('kpi', kpi.id), 'graph'))
    if (kpi.associatedProcess && relevantProcesses.some(process => process.id === kpi.associatedProcess)) edges.push(edge(nodeId('process', kpi.associatedProcess), 'measured by', nodeId('kpi', kpi.id), 'graph'))
  }
  for (const agent of agents) {
    agent.accessibleEntityIds.forEach(entityId => edges.push(edge(nodeId('agent', agent.id), 'operates on', nodeId('entity', entityId), 'graph')))
    agent.kpiIds.forEach(kpiId => edges.push(edge(nodeId('agent', agent.id), 'monitors', nodeId('kpi', kpiId), 'graph')))
  }
  for (const definition of events.definitions) {
    definition.sourceEntityIds.forEach(entityId => edges.push(edge(nodeId('entity', entityId), 'emits', nodeId('event', definition.type), 'event')))
    const route = events.routes.find(item => item.eventType === definition.type)
    route?.targets.find(target => target.kind === 'agent')?.ids.forEach(agentId => edges.push(edge(nodeId('event', definition.type), 'activates', nodeId('agent', agentId), 'event')))
  }

  const uniqueEdges = edges.filter((candidate, index, items) => items.findIndex(item => item.id === candidate.id) === index)
  const vectorKnowledge = [
    { id: 'company-profile', sourceType: 'company-profile' as const, sourceId: config.id, textFields: ['profile.description', 'profile.industry', 'profile.goals', 'profile.terminology'] },
    ...config.entities.filter(entity => entity.fields.some(field => field.type === 'long-text' || field.type === 'file')).map(entity => ({ id: `entity-schema:${entity.id}`, sourceType: 'entity-schema' as const, sourceId: entity.id, textFields: entity.fields.filter(field => ['text', 'long-text', 'file'].includes(field.type)).map(field => field.id) })),
  ]
  return {
    version: 1,
    nodes,
    edges: uniqueEdges,
    vectorKnowledge,
    storageArchitecture: {
      relational: 'Authoritative records, foreign keys, permissions and transactions remain in the relational workspace store.',
      graph: 'Typed schema relationships, process dependencies, KPI lineage and impact paths are projected for traversal.',
      events: 'Immutable business facts and delivery metadata flow through the event architecture and audit log.',
      vector: 'Approved narrative fields and document content are indexed for semantic retrieval; vectors never become the source of truth.',
    },
  }
}

export function traverseBusinessGraph(graph: BusinessGraph, startId: string, options: { direction?: 'outgoing' | 'incoming' | 'both'; maxDepth?: number; relationships?: string[] } = {}) {
  const direction = options.direction ?? 'both'
  const maxDepth = Math.max(0, Math.min(options.maxDepth ?? 4, 8))
  const allowed = options.relationships ? new Set(options.relationships) : null
  const visited = new Set([startId])
  const paths: Array<{ nodeId: string; depth: number; via: BusinessGraphEdge | null }> = [{ nodeId: startId, depth: 0, via: null }]
  for (let index = 0; index < paths.length; index += 1) {
    const current = paths[index]
    if (current.depth >= maxDepth) continue
    const candidates = graph.edges.filter(item => (!allowed || allowed.has(item.relationship)) && ((direction !== 'incoming' && item.from === current.nodeId) || (direction !== 'outgoing' && item.to === current.nodeId)))
    for (const candidate of candidates) {
      const next = candidate.from === current.nodeId ? candidate.to : candidate.from
      if (visited.has(next)) continue
      visited.add(next)
      paths.push({ nodeId: next, depth: current.depth + 1, via: candidate })
    }
  }
  return paths.map(item => ({ ...item, node: graph.nodes.find(node => node.id === item.nodeId) })).filter(item => item.node)
}
