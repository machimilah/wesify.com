import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  addEdge, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react'
import {
  Bell, Check, ChevronRight, CirclePlay, Clock3, GitBranch, History, Plus, Plug,
  FilePlus2, PencilLine, RotateCcw, Save, Search, ShieldCheck, Sparkles, Trash2, Webhook, Workflow, X, Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import {
  createAutomationConnector, createManagedAutomation, deleteAutomationConnector, deleteManagedAutomation,
  planManagedAutomation, respondToAutomationApproval, retryAutomationRun, testManagedAutomation, updateManagedAutomation,
  type AutomationRun, type AutomationWorkspace, type ConnectorType, type ManagedAutomation,
  type ManagedAutomationAction, type WorkflowConditionOperator, type WorkflowEdge, type WorkflowFieldValue,
  type WorkflowGraph, type WorkflowNode, type WorkflowSchedule,
} from '../engine/automationClient'
import type { GeneratedProjectManifest } from '../engine/projectClient'
import type { WorkspaceConfiguration } from '../engine/workspaceSchema'
import { humanize } from '../engine/shared'

interface WorkflowStudioProps {
  config: WorkspaceConfiguration
  manifest: GeneratedProjectManifest | null
  workspace: AutomationWorkspace
  refresh: () => Promise<void>
}

interface CanvasNodeData extends Record<string, unknown> {
  nodeType: WorkflowNode['type']
  config: WorkflowNode['config']
  title: string
  detail: string
  onAppend: (nodeId: string, sourceHandle?: 'true' | 'false') => void
}

type CanvasNode = Node<CanvasNodeData, 'workflow'>
type CanvasEdge = Edge<Record<string, never>, 'smoothstep'>
type LibraryItem = { type: WorkflowNode['type']; title: string; detail: string; config: WorkflowNode['config']; testId?: string }

const conditionOperators: Array<{ value: WorkflowConditionOperator; label: string }> = [
  { value: 'equals', label: 'Equals' },
  { value: 'not-equals', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'greater-than', label: 'Greater than' },
  { value: 'less-than', label: 'Less than' },
  { value: 'is-empty', label: 'Is empty' },
  { value: 'is-not-empty', label: 'Is not empty' },
]

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function defaultSchedule(): WorkflowSchedule {
  return { cadence: 'daily', time: '09:00', timezone: localTimezone() }
}

function nodeIcon(data: CanvasNodeData) {
  if (data.nodeType === 'trigger') return (data.config as Extract<WorkflowNode, { type: 'trigger' }>['config']).event === 'scheduled' ? Clock3 : Zap
  if (data.nodeType === 'condition') return GitBranch
  const action = data.config as ManagedAutomationAction
  if (action.type === 'notification') return Bell
  if (action.type === 'approval') return ShieldCheck
  if (action.type === 'create-record') return FilePlus2
  if (action.type === 'update-record') return PencilLine
  return Webhook
}

function WorkflowNodeCard({ id, data, selected }: NodeProps<CanvasNode>) {
  const Icon = nodeIcon(data)
  const isCondition = data.nodeType === 'condition'
  return <article className={`bo-workflow-node ${data.nodeType}${selected ? ' selected' : ''}`} data-testid={data.nodeType === 'trigger' ? 'link-trigger-node' : data.nodeType === 'action' ? 'link-action-node' : 'link-condition-node'}>
    {data.nodeType !== 'trigger' ? <Handle type="target" position={Position.Left}/> : null}
    <header><span><Icon size={16}/></span><small>{data.nodeType === 'action' ? humanize((data.config as ManagedAutomationAction).type) : humanize(data.nodeType)}</small></header>
    <strong>{data.title}</strong>
    <em>{data.detail}</em>
    {isCondition ? <>
      <span className="bo-workflow-branch true">Yes</span>
      <Handle id="true" type="source" position={Position.Right} style={{ top: '42%' }}/>
      <button className="bo-node-append nodrag true" onClick={() => data.onAppend(id, 'true')} aria-label="Add step to yes branch" title="Add step to yes branch"><Plus size={12}/></button>
      <span className="bo-workflow-branch false">No</span>
      <Handle id="false" type="source" position={Position.Right} style={{ top: '75%' }}/>
      <button className="bo-node-append nodrag false" onClick={() => data.onAppend(id, 'false')} aria-label="Add step to no branch" title="Add step to no branch"><Plus size={12}/></button>
    </> : <>
      <Handle type="source" position={Position.Right}/>
      <button className="bo-node-append nodrag" onClick={() => data.onAppend(id)} aria-label="Add next step" title="Add next step"><Plus size={12}/></button>
    </>}
  </article>
}

const nodeTypes = { workflow: WorkflowNodeCard }

function legacyGraph(automation: ManagedAutomation): WorkflowGraph {
  const condition = automation.trigger.field
    ? [{ id: 'condition-1', type: 'condition' as const, position: { x: 350, y: 220 }, config: { field: automation.trigger.field, operator: 'equals' as const, value: automation.trigger.equals ?? '' } }]
    : []
  const actionX = condition.length ? 620 : 350
  return {
    version: 1,
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 220 }, config: { entityId: automation.trigger.entityId, event: automation.trigger.event, ...(automation.trigger.schedule ? { schedule: automation.trigger.schedule } : {}) } },
      ...condition,
      { id: 'action-1', type: 'action', position: { x: actionX, y: 220 }, config: automation.action },
    ],
    edges: condition.length
      ? [{ id: 'trigger-condition', source: 'trigger-1', target: 'condition-1' }, { id: 'condition-action', source: 'condition-1', target: 'action-1', sourceHandle: 'true' }]
      : [{ id: 'trigger-action', source: 'trigger-1', target: 'action-1' }],
  }
}

function graphFor(automation: ManagedAutomation) {
  return automation.draftGraph ?? automation.graph ?? legacyGraph(automation)
}

function runTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function starterRecordFields(target: WorkspaceConfiguration['entities'][number], source?: WorkspaceConfiguration['entities'][number]) {
  const fields: Record<string, WorkflowFieldValue> = {}
  for (const field of target.fields) {
    if (source && field.type === 'relation' && field.relationEntityId === source.id) fields[field.id] = '{{record.id}}'
    else if (source && field.type === 'relation') {
      const inherited = source.fields.find(item => item.type === 'relation' && item.relationEntityId === field.relationEntityId)
      if (inherited) fields[field.id] = `{{record.${inherited.id}}}`
    }
  }
  for (const field of target.fields.filter(item => item.required)) {
    if (fields[field.id] !== undefined) continue
    if (field.type === 'select') fields[field.id] = field.options?.[0] ?? 'New'
    else if (field.type === 'boolean') fields[field.id] = false
    else if (field.type === 'number' || field.type === 'currency') fields[field.id] = 0
    else fields[field.id] = `${target.label} from {{record.${source?.primaryField ?? 'id'}}}`
  }
  return fields
}

export function WorkflowStudio(props: WorkflowStudioProps) {
  return <ReactFlowProvider><WorkflowStudioInner {...props}/></ReactFlowProvider>
}

function WorkflowStudioInner({ config, manifest, workspace, refresh }: WorkflowStudioProps) {
  const { fitView, screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>()
  const [nodes, setNodes, applyNodesChange] = useNodesState<CanvasNode>([])
  const [edges, setEdges, applyEdgesChange] = useEdgesState<CanvasEdge>([])
  const nodesInitialized = useNodesInitialized()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled workflow')
  const [tab, setTab] = useState<'editor' | 'executions'>('editor')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [appendFrom, setAppendFrom] = useState<{ source: string; sourceHandle?: 'true' | 'false' } | null>(null)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiSafeguards, setAiSafeguards] = useState<string[]>([])
  const [connectorName, setConnectorName] = useState('Make')
  const [connectorType, setConnectorType] = useState<ConnectorType>('make-webhook')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loadedAt, setLoadedAt] = useState('')
  const [narrowCanvas, setNarrowCanvas] = useState(() => typeof window !== 'undefined' && window.innerWidth < 700)
  const [frameRequest, setFrameRequest] = useState({ revision: 0, focusId: '' })
  const [framedRevision, setFramedRevision] = useState(0)
  const initialised = useRef(false)
  const nodeSequence = useRef(0)
  const frameSequence = useRef(0)
  const framingRevision = useRef(0)

  const requestAppend = useCallback((source: string, sourceHandle?: 'true' | 'false') => {
    setAppendFrom({ source, sourceHandle })
    setLibraryOpen(true)
  }, [])

  const describe = useCallback((nodeType: WorkflowNode['type'], nodeConfig: WorkflowNode['config']) => {
    if (nodeType === 'trigger') {
      const trigger = nodeConfig as Extract<WorkflowNode, { type: 'trigger' }>['config']
      const entity = config.entities.find(item => item.id === trigger.entityId)
      if (trigger.event === 'scheduled' && trigger.schedule) {
        const cadence = trigger.schedule.cadence === 'hourly' ? `Every hour at :${trigger.schedule.time.slice(3)}` : `${humanize(trigger.schedule.cadence)} at ${trigger.schedule.time}`
        return { title: entity?.pluralLabel ?? entity?.label ?? humanize(trigger.entityId), detail: cadence }
      }
      return { title: entity?.label ?? humanize(trigger.entityId), detail: `Record ${humanize(trigger.event)}` }
    }
    if (nodeType === 'condition') {
      const condition = nodeConfig as Extract<WorkflowNode, { type: 'condition' }>['config']
      return { title: humanize(condition.field), detail: conditionOperators.find(item => item.value === condition.operator)?.label ?? humanize(condition.operator) }
    }
    const action = nodeConfig as ManagedAutomationAction
    if (action.type === 'webhook') {
      const connector = workspace.connectors.find(item => item.id === action.connectorId)
      return { title: connector?.name ?? 'Webhook', detail: connector?.endpointHost ?? 'Connection required' }
    }
    if (action.type === 'create-record' || action.type === 'update-record') {
      const entity = config.entities.find(item => item.id === action.entityId)
      return { title: `${action.type === 'create-record' ? 'Create' : 'Update'} ${entity?.label ?? humanize(action.entityId)}`, detail: `${Object.keys(action.fields).length} mapped field${Object.keys(action.fields).length === 1 ? '' : 's'}` }
    }
    if (action.type === 'approval' || action.type === 'notification') return { title: action.type === 'approval' ? 'Request approval' : 'Create notification', detail: action.message }
    return { title: 'Workflow action', detail: 'Review configuration' }
  }, [config.entities, workspace.connectors])

  const canvasData = useCallback((nodeType: WorkflowNode['type'], nodeConfig: WorkflowNode['config']): CanvasNodeData => ({
    nodeType, config: nodeConfig, ...describe(nodeType, nodeConfig), onAppend: requestAppend,
  }), [describe, requestAppend])

  const loadAutomation = useCallback((automation: ManagedAutomation) => {
    const graph = graphFor(automation)
    setNodes(graph.nodes.map(node => ({ id: node.id, type: 'workflow', position: node.position, width: 218, height: node.type === 'condition' ? 132 : 112, data: canvasData(node.type, node.config) })))
    setEdges(graph.edges.map(edge => ({ ...edge, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } })))
    setSelectedId(automation.id)
    setSelectedNodeId(null)
    setName(automation.name)
    setLoadedAt(automation.updatedAt)
    setDirty(false)
    const firstTrigger = graph.nodes.find(node => node.type === 'trigger')
    setFrameRequest({ revision: ++frameSequence.current, focusId: firstTrigger?.id ?? graph.nodes[0]?.id ?? '' })
  }, [canvasData, setEdges, setNodes])

  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      const first = workspace.automations[0]
      if (first) loadAutomation(first)
      else setLibraryOpen(true)
      return
    }
    const current = workspace.automations.find(item => item.id === selectedId)
    if (current && !dirty && current.updatedAt !== loadedAt) loadAutomation(current)
  }, [dirty, loadAutomation, loadedAt, selectedId, workspace.automations])

  useEffect(() => {
    const measure = () => setNarrowCanvas(window.innerWidth < 700)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    if (!nodesInitialized || !frameRequest.revision || framedRevision === frameRequest.revision || framingRevision.current === frameRequest.revision) return
    const focus = nodes.find(node => node.id === frameRequest.focusId) ?? nodes[0]
    if (!focus) return
    framingRevision.current = frameRequest.revision
    const framing = narrowCanvas
      ? fitView({ nodes: [focus], padding: 0.2, minZoom: 0.62, maxZoom: 0.62, duration: 250 })
      : fitView({ padding: 0.2, duration: 250, maxZoom: 0.85 })
    void framing.then(() => { setFramedRevision(frameRequest.revision); if (framingRevision.current === frameRequest.revision) framingRevision.current = 0 })
  }, [fitView, frameRequest, framedRevision, narrowCanvas, nodes, nodesInitialized])

  const workflowGraph = useCallback((): WorkflowGraph => ({
    version: 1,
    nodes: nodes.map(node => ({ id: node.id, type: node.data.nodeType, position: node.position, config: node.data.config } as WorkflowNode)),
    edges: edges.map((edge, index) => ({
      id: edge.id || `edge-${index + 1}`, source: edge.source, target: edge.target,
      ...(edge.sourceHandle === 'true' || edge.sourceHandle === 'false' ? { sourceHandle: edge.sourceHandle } : {}),
    } as WorkflowEdge)),
  }), [edges, nodes])

  const newWorkflow = () => {
    setSelectedId(null); setSelectedNodeId(null); setName('Untitled workflow'); setNodes([]); setEdges([])
    setDirty(false); setLoadedAt(''); setTab('editor'); setMessage(''); setAppendFrom(null); setLibraryOpen(true)
  }

  const withAction = async (operation: () => Promise<void>) => {
    if (working) return
    setWorking(true); setMessage('')
    try { await operation() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The workflow could not be updated.') }
    finally { setWorking(false) }
  }

  const persistDraft = async () => {
    if (!manifest) throw new Error('The workspace is still loading.')
    const graph = workflowGraph()
    const automation = selectedId
      ? await updateManagedAutomation(manifest.workspaceId, selectedId, { name: name.trim() || 'Untitled workflow', draftGraph: graph })
      : await createManagedAutomation(manifest.workspaceId, { name: name.trim() || 'Untitled workflow', graph })
    loadAutomation(automation)
    return automation
  }

  const saveDraft = () => void withAction(async () => {
    const isNew = !selectedId
    await persistDraft(); await refresh()
    setMessage(isNew ? 'Automation saved in paused mode.' : 'Draft saved. The active version is unchanged.')
  })

  const publishDraft = () => void withAction(async () => {
    if (!manifest) throw new Error('The workspace is still loading.')
    const saved = await persistDraft()
    const published = await updateManagedAutomation(manifest.workspaceId, saved.id, { name: name.trim() || 'Untitled workflow', draftGraph: workflowGraph(), publish: true })
    loadAutomation(published); await refresh(); setMessage(`Version ${published.version ?? 1} published.`)
  })

  const toggleActive = (next: boolean) => void withAction(async () => {
    if (!manifest) throw new Error('The workspace is still loading.')
    const saved = await persistDraft()
    const updated = await updateManagedAutomation(manifest.workspaceId, saved.id, { name: name.trim() || 'Untitled workflow', draftGraph: workflowGraph(), publish: dirty || Boolean(saved.hasUnpublishedChanges), enabled: next })
    loadAutomation(updated); await refresh(); setMessage(next ? 'Workflow is active.' : 'Workflow paused.')
  })

  const runWorkflow = () => void withAction(async () => {
    if (!manifest) throw new Error('The workspace is still loading.')
    const saved = await persistDraft()
    const run = await testManagedAutomation(manifest.workspaceId, saved.id)
    setSelectedRunId(run.id); setTab('executions'); await refresh(); setMessage('Simulation passed. No external data was sent.')
  })

  const buildWithAi = (event: FormEvent) => {
    event.preventDefault()
    void withAction(async () => {
      if (!manifest) throw new Error('The workspace is still loading.')
      const instruction = aiInstruction.trim()
      if (instruction.length < 8) throw new Error('Describe the trigger and the outcome you need.')
      const result = await planManagedAutomation(manifest.workspaceId, {
        instruction,
        ...(selectedId ? { automationId: selectedId } : {}),
        ...(nodes.length ? { currentGraph: workflowGraph() } : {}),
      })
      loadAutomation(result.automation)
      setAiSafeguards(result.safeguards)
      setAiInstruction('')
      setAiOpen(false)
      await refresh()
      setMessage(`${result.source === 'ai' ? `AI draft built with ${result.model}` : 'Validated workflow draft built'}${result.safeguards.length ? ` · ${result.safeguards.length} safeguard${result.safeguards.length === 1 ? '' : 's'} added` : ''}. Review, test, then publish.`)
    })
  }

  const removeWorkflow = () => void withAction(async () => {
    if (!manifest || !selectedId) return
    const automation = workspace.automations.find(item => item.id === selectedId)
    if (automation?.origin === 'generated') throw new Error('Generated workflows can be paused or edited, but not deleted.')
    if (!window.confirm(`Delete ${automation?.name ?? 'this workflow'}?`)) return
    await deleteManagedAutomation(manifest.workspaceId, selectedId); await refresh(); newWorkflow(); setMessage('Workflow deleted.')
  })

  const addNode = useCallback((item: LibraryItem, position?: { x: number; y: number }) => {
    const id = `${item.type}-${Date.now()}-${++nodeSequence.current}`
    const sourceNode = appendFrom ? nodes.find(node => node.id === appendFrom.source) : undefined
    const nextPosition = position ?? (sourceNode
      ? { x: sourceNode.position.x + 270, y: sourceNode.position.y + (appendFrom?.sourceHandle === 'false' ? 170 : 0) }
      : { x: 100 + nodes.length * 45, y: 170 + (nodes.length % 3) * 90 })
    setNodes(current => [...current, { id, type: 'workflow', position: nextPosition, width: 218, height: item.type === 'condition' ? 132 : 112, data: canvasData(item.type, item.config) }])
    if (appendFrom) setEdges(current => addEdge({ id: `edge-${appendFrom.source}-${id}-${Date.now()}`, source: appendFrom.source, target: id, sourceHandle: appendFrom.sourceHandle }, current))
    setSelectedNodeId(appendFrom ? null : id); setDirty(true); setLibraryOpen(false); setAppendFrom(null); setLibrarySearch('')
    setFrameRequest({ revision: ++frameSequence.current, focusId: id })
  }, [appendFrom, canvasData, nodes, setEdges, setNodes])

  const removeNode = (nodeId: string) => {
    setNodes(current => current.filter(node => node.id !== nodeId))
    setEdges(current => current.filter(edge => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId(null); setDirty(true)
  }

  const updateNodeConfig = (nodeId: string, nodeConfig: WorkflowNode['config']) => {
    setNodes(current => current.map(node => node.id === nodeId ? { ...node, data: canvasData(node.data.nodeType, nodeConfig) } : node))
    setDirty(true)
  }

  const onNodesChange = (changes: NodeChange<CanvasNode>[]) => {
    applyNodesChange(changes)
    if (changes.some(change => change.type === 'remove' || (change.type === 'position' && change.dragging))) setDirty(true)
  }

  const onEdgesChange = (changes: EdgeChange<CanvasEdge>[]) => {
    applyEdgesChange(changes)
    if (changes.some(change => change.type === 'remove')) setDirty(true)
  }

  const onConnect = (connection: Connection) => {
    const target = nodes.find(node => node.id === connection.target)
    if (!target || target.data.nodeType === 'trigger') return
    setEdges(current => addEdge({ ...connection, id: `edge-${connection.source}-${connection.target}-${Date.now()}`, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, current))
    setDirty(true)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData('application/x-wesify-workflow')
    if (!raw) return
    try { addNode(JSON.parse(raw) as LibraryItem, screenToFlowPosition({ x: event.clientX, y: event.clientY })) } catch { /* Ignore malformed drag data. */ }
  }

  const dragItem = (event: DragEvent, item: LibraryItem) => {
    event.dataTransfer.setData('application/x-wesify-workflow', JSON.stringify(item))
    event.dataTransfer.effectAllowed = 'move'
  }

  const triggerNode = nodes.find(node => node.data.nodeType === 'trigger')
  const triggerConfig = triggerNode?.data.config as Extract<WorkflowNode, { type: 'trigger' }>['config'] | undefined
  const conditionEntity = config.entities.find(entity => entity.id === triggerConfig?.entityId) ?? config.entities[0]
  const defaultField = conditionEntity?.primaryField ?? conditionEntity?.fields[0]?.id ?? 'status'
  const createTarget = config.entities.find(entity => entity.id !== conditionEntity?.id && /task|project|order|case|appointment|request/i.test(`${entity.id} ${entity.label}`)) ?? config.entities.find(entity => entity.id !== conditionEntity?.id) ?? conditionEntity
  const createFields = createTarget ? starterRecordFields(createTarget, conditionEntity) : {}
  const updateField = conditionEntity?.fields.find(field => field.id === 'status' && field.options?.length) ?? conditionEntity?.fields.find(field => field.type === 'select' && field.options?.length)
  const recordActions: LibraryItem[] = [
    ...(createTarget ? [{ type: 'action' as const, title: `Create ${createTarget.label.toLowerCase()}`, detail: 'Create a connected business record', config: { type: 'create-record' as const, entityId: createTarget.id, fields: createFields } }] : []),
    ...(conditionEntity && updateField ? [{ type: 'action' as const, title: `Update ${conditionEntity.label.toLowerCase()}`, detail: 'Change the triggering record', config: { type: 'update-record' as const, entityId: conditionEntity.id, fields: { [updateField.id]: updateField.options?.[0] ?? '' } } }] : []),
  ]
  const scheduledTrigger: LibraryItem = {
    type: 'trigger', title: 'Scheduled scan', detail: 'Run across records on a timetable',
    config: { entityId: conditionEntity?.id ?? config.entities[0]?.id ?? '', event: 'scheduled', schedule: defaultSchedule() },
  }
  const library: Array<{ label: string; items: LibraryItem[] }> = [
    { label: 'Triggers', items: [scheduledTrigger, ...config.entities.map(entity => ({ type: 'trigger' as const, title: entity.label, detail: 'Record created or updated', config: { entityId: entity.id, event: 'created' }, testId: `link-trigger-source-${entity.id}` }))] },
    { label: 'Flow', items: [{ type: 'condition', title: 'If condition', detail: 'Split into yes and no branches', config: { field: defaultField, operator: 'equals', value: '' } }] },
    { label: 'Wesify actions', items: [
      { type: 'action', title: 'Create notification', detail: 'Notify people inside Wesify', config: { type: 'notification', message: 'A workflow needs your attention.' } },
      { type: 'action', title: 'Request approval', detail: 'Pause until a person decides', config: { type: 'approval', message: 'Review and approve this record.' } },
      ...recordActions,
    ] },
    { label: 'Connected tools', items: workspace.connectors.map(connector => ({ type: 'action', title: connector.name, detail: connector.endpointHost, config: { type: 'webhook', connectorId: connector.id }, testId: 'link-action-source' })) },
  ]
  const search = librarySearch.trim().toLowerCase()
  const filteredLibrary = library.map(group => ({ ...group, items: group.items.filter(item => !search || `${item.title} ${item.detail}`.toLowerCase().includes(search)) })).filter(group => group.items.length)
  const selectedNode = nodes.find(node => node.id === selectedNodeId)
  const selectedAutomation = workspace.automations.find(item => item.id === selectedId)
  const selectedRuns = workspace.runs.filter(run => !selectedId || run.automationId === selectedId)
  const selectedRun = selectedRuns.find(run => run.id === selectedRunId) ?? selectedRuns[0]
  const pendingApprovals = workspace.approvals.filter(item => item.status === 'pending' && (!selectedId || item.automationId === selectedId))
  const hasRunnableGraph = nodes.some(node => node.data.nodeType === 'trigger') && nodes.some(node => node.data.nodeType === 'action')

  const addConnector = (event: FormEvent) => {
    event.preventDefault()
    void withAction(async () => {
      if (!manifest) throw new Error('The workspace is still loading.')
      await createAutomationConnector(manifest.workspaceId, { name: connectorName.trim(), type: connectorType, endpointUrl: endpointUrl.trim() })
      setEndpointUrl(''); await refresh(); setMessage('Connection saved. Its secret URL remains hidden.')
    })
  }

  return <section className="bo-workflow-studio" data-testid="workflow-studio" data-frame-ready={Boolean(frameRequest.revision && frameRequest.revision === framedRevision)}>
    <header className="bo-workflow-topbar">
      <div className="bo-workflow-title"><Workflow size={18}/><input value={name} onChange={event => { setName(event.target.value); setDirty(true) }} aria-label="Workflow name" data-testid="link-name"/><span>{dirty ? 'Unsaved' : selectedAutomation?.hasUnpublishedChanges ? 'Draft saved' : selectedId ? 'Saved' : 'New'}</span></div>
      <div className="bo-workflow-tabs" role="tablist"><button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')} role="tab"><Workflow size={14}/> Editor</button><button className={tab === 'executions' ? 'active' : ''} onClick={() => setTab('executions')} role="tab"><History size={14}/> Executions <span>{selectedRuns.length}</span></button></div>
      <div className="bo-workflow-actions">
        <button className="bo-workflow-ai" onClick={() => setAiOpen(true)} title="Build with AI"><Sparkles size={15}/> Build with AI</button>
        <button onClick={() => setConnectionsOpen(true)} title="Connections"><Plug size={15}/> Connections</button>
        <button onClick={newWorkflow} title="New workflow"><Plus size={15}/> New</button>
        <button onClick={saveDraft} disabled={working || !hasRunnableGraph} aria-label="Save automation"><Save size={15}/> Save draft</button>
        <button className="primary" onClick={publishDraft} disabled={working || !hasRunnableGraph}><Check size={15}/> Publish</button>
        <label className="bo-workflow-switch"><span>{selectedAutomation?.enabled ? 'Active' : 'Inactive'}</span><button role="switch" aria-checked={Boolean(selectedAutomation?.enabled)} className={selectedAutomation?.enabled ? 'on' : ''} onClick={() => toggleActive(!selectedAutomation?.enabled)} disabled={working || !hasRunnableGraph}><i/></button></label>
        <button className="bo-workflow-test" onClick={runWorkflow} disabled={working || !hasRunnableGraph}><CirclePlay size={15}/> Test workflow</button>
      </div>
    </header>
    {message ? <div className="bo-workflow-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss"><X size={13}/></button></div> : null}
    {aiSafeguards.length ? <div className="bo-ai-safeguards"><ShieldCheck size={14}/><span>{aiSafeguards.join(' ')}</span><button onClick={() => setAiSafeguards([])} aria-label="Dismiss safeguards"><X size={13}/></button></div> : null}
    <div className="bo-workflow-body">
      <aside className="bo-workflow-list">
        <header><strong>Workflows</strong><button onClick={newWorkflow} aria-label="New workflow" title="New workflow"><Plus size={14}/></button></header>
        <div>{workspace.automations.map(automation => <button key={automation.id} className={automation.id === selectedId ? 'active' : ''} onClick={() => { loadAutomation(automation); setTab('editor') }} data-testid="saved-link" data-trigger={automation.trigger.entityId}>
          <span className={automation.enabled ? 'live' : ''}><Workflow size={14}/></span><span><strong>{automation.name}</strong><small>{automation.hasUnpublishedChanges ? 'Draft changes' : automation.origin === 'generated' ? 'Generated' : `v${automation.version ?? 1}`} · {automation.enabled ? 'Active' : 'Paused'}</small></span><ChevronRight size={13}/>
        </button>)}</div>
      </aside>

      {tab === 'editor' ? <main className="bo-workflow-editor">
        <div className="bo-workflow-canvas" data-testid="links-canvas">
          <ReactFlow<CanvasNode, CanvasEdge>
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)} onPaneClick={() => setSelectedNodeId(null)} onDrop={onDrop} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
            minZoom={narrowCanvas ? 0.62 : 0.3} maxZoom={1.8} snapToGrid snapGrid={[20, 20]} deleteKeyCode={['Backspace', 'Delete']}
            defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
          >
            <Background gap={20} size={1}/><Controls showInteractive={false}/>
            <button className="bo-canvas-add" onClick={() => { setAppendFrom(null); setLibraryOpen(true) }}><Plus size={15}/> Add step</button>
            {!nodes.length ? <div className="bo-workflow-empty"><Workflow size={22}/><strong>No steps yet</strong><button onClick={() => setLibraryOpen(true)}><Plus size={14}/> Add step</button></div> : null}
          </ReactFlow>
        </div>

        {libraryOpen ? <aside className="bo-node-library" data-testid="node-library">
          <header><strong>Add a step</strong><button onClick={() => { setLibraryOpen(false); setAppendFrom(null) }} aria-label="Close"><X size={15}/></button></header>
          <label><Search size={14}/><input value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search steps" autoFocus/></label>
          <div>{filteredLibrary.map(group => <section key={group.label}><small>{group.label}</small>{group.items.map((item, index) => { const Icon = nodeIcon({ nodeType: item.type, config: item.config } as CanvasNodeData); return <button key={`${group.label}-${item.title}-${index}`} draggable onDragStart={event => dragItem(event, item)} onClick={() => addNode(item)} data-testid={item.testId}><span><Icon size={15}/></span><span><strong>{item.title}</strong><em>{item.detail}</em></span><Plus size={13}/></button> })}</section>)}{!filteredLibrary.length ? <p>No matching steps.</p> : null}</div>
          {!workspace.connectors.length ? <button className="bo-library-connect" onClick={() => setConnectionsOpen(true)}><Plug size={14}/> Add a connection</button> : null}
        </aside> : null}

        {selectedNode ? <NodeInspector node={selectedNode} config={config} connectors={workspace.connectors} triggerEntityId={triggerConfig?.entityId} update={nodeConfig => updateNodeConfig(selectedNode.id, nodeConfig)} remove={() => removeNode(selectedNode.id)} close={() => setSelectedNodeId(null)}/> : null}
      </main> : <ExecutionView runs={selectedRuns} selected={selectedRun} select={setSelectedRunId} rerun={runWorkflow} retry={runId => void withAction(async () => { if (!manifest) return; const run = await retryAutomationRun(manifest.workspaceId, runId); setSelectedRunId(run.id); await refresh(); setMessage(`Execution retried · ${humanize(run.status)}.`) })} approvals={pendingApprovals} respond={(approvalId, decision) => void withAction(async () => { if (!manifest) return; await respondToAutomationApproval(manifest.workspaceId, approvalId, decision); await refresh(); setMessage(decision === 'approved' ? 'Approved. The workflow continued from the decision point.' : 'Rejected. The workflow stopped without running downstream actions.') })}/>} 
    </div>

    {aiOpen ? <div className="bo-workflow-modal bo-ai-workflow-modal" role="dialog" aria-modal="true" aria-label="Build workflow with AI" onMouseDown={event => { if (event.target === event.currentTarget) setAiOpen(false) }}>
      <section>
        <header><div><small>WESIFY AI</small><h2>{selectedId ? 'Revise this workflow' : 'Build a workflow'}</h2></div><button onClick={() => setAiOpen(false)} aria-label="Close"><X size={16}/></button></header>
        <form onSubmit={buildWithAi}>
          <label className="wide bo-ai-workflow-prompt"><span>Describe the trigger, conditions, and outcome</span><textarea value={aiInstruction} onChange={event => setAiInstruction(event.target.value)} placeholder="When a quote is accepted, create a project, copy the client, and notify operations." autoFocus rows={6}/></label>
          <div className="bo-ai-workflow-examples">
            {[
              'Every day at 08:00, scan overdue invoices and notify finance.',
              'When an invoice becomes overdue, notify finance.',
              'When a purchase order awaits approval, request approval before continuing.',
              'When an opportunity is won, create a project and copy the client.',
            ].map(example => <button type="button" key={example} onClick={() => setAiInstruction(example)}>{example}</button>)}
          </div>
          <footer><button type="button" onClick={() => setAiOpen(false)}>Cancel</button><button className="primary" disabled={working || aiInstruction.trim().length < 8}><Sparkles size={15}/>{working ? 'Building…' : 'Build draft'}</button></footer>
        </form>
      </section>
    </div> : null}

    {connectionsOpen ? <div className="bo-workflow-modal" role="dialog" aria-modal="true" aria-label="Workflow connections" onMouseDown={event => { if (event.target === event.currentTarget) setConnectionsOpen(false) }}>
      <section>
        <header><div><small>CONNECTIONS</small><h2>Connect a webhook</h2></div><button onClick={() => setConnectionsOpen(false)} aria-label="Close"><X size={16}/></button></header>
        <div className="bo-connection-rows">{workspace.connectors.map(connector => <article key={connector.id}><span><Webhook size={16}/></span><div><strong>{connector.name}</strong><small>{connector.endpointHost}</small></div><em>Connected</em><button type="button" onClick={() => void withAction(async () => { if (!manifest) return; await deleteAutomationConnector(manifest.workspaceId, connector.id); await refresh(); setMessage(`${connector.name} disconnected.`) })} aria-label={`Disconnect ${connector.name}`} title={`Disconnect ${connector.name}`}><Trash2 size={13}/></button></article>)}{!workspace.connectors.length ? <p>No webhook connections yet.</p> : null}</div>
        <form onSubmit={addConnector}>
          <label><span>Name</span><input value={connectorName} onChange={event => setConnectorName(event.target.value)} required data-testid="connector-name"/></label>
          <label><span>Type</span><select value={connectorType} onChange={event => setConnectorType(event.target.value as ConnectorType)}><option value="make-webhook">Make custom webhook</option><option value="n8n-webhook">n8n webhook</option><option value="generic-webhook">Other HTTPS webhook</option></select></label>
          <label className="wide"><span>Webhook URL</span><input type="url" value={endpointUrl} onChange={event => setEndpointUrl(event.target.value)} placeholder="https://hook.eu2.make.com/..." required data-testid="connector-url"/></label>
          <button className="primary" disabled={working}><Plus size={15}/> Save connection</button>
        </form>
      </section>
    </div> : null}
  </section>
}

function NodeInspector({ node, config, connectors, triggerEntityId, update, remove, close }: { node: CanvasNode; config: WorkspaceConfiguration; connectors: AutomationWorkspace['connectors']; triggerEntityId?: string; update: (config: WorkflowNode['config']) => void; remove: () => void; close: () => void }) {
  const nodeConfig = node.data.config
  const activeTriggerEntityId = node.data.nodeType === 'trigger' ? (nodeConfig as Extract<WorkflowNode, { type: 'trigger' }>['config']).entityId : triggerEntityId
  const entity = config.entities.find(item => item.id === activeTriggerEntityId) ?? config.entities[0]
  return <aside className="bo-node-inspector">
    <header><div><small>{humanize(node.data.nodeType)}</small><strong>{node.data.title}</strong></div><button onClick={close} aria-label="Close"><X size={15}/></button></header>
    {node.data.nodeType === 'trigger' ? (() => { const trigger = nodeConfig as Extract<WorkflowNode, { type: 'trigger' }>['config']; const schedule = trigger.schedule ?? defaultSchedule(); return <div className="bo-inspector-fields">
      <label><span>Record type</span><select value={trigger.entityId} onChange={event => update({ ...trigger, entityId: event.target.value })}>{config.entities.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Event</span><select value={trigger.event} onChange={event => { const next = event.target.value; if (next === 'scheduled') update({ ...trigger, event: next, schedule }); else { const { schedule: unused, ...rest } = trigger; void unused; update({ ...rest, event: next }) } }} data-testid="link-event"><option value="created">Created</option><option value="updated">Updated</option><option value="scheduled">Scheduled scan</option></select></label>
      {trigger.event === 'scheduled' ? <>
        <label><span>Frequency</span><select value={schedule.cadence} onChange={event => update({ ...trigger, schedule: { ...schedule, cadence: event.target.value as typeof schedule.cadence, ...(event.target.value === 'weekly' ? { weekday: schedule.weekday ?? 1 } : {}) } })}><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
        {schedule.cadence === 'weekly' ? <label><span>Day</span><select value={schedule.weekday ?? 1} onChange={event => update({ ...trigger, schedule: { ...schedule, weekday: Number(event.target.value) } })}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label> : null}
        <label><span>{schedule.cadence === 'hourly' ? 'Minute of hour' : 'Run at'}</span>{schedule.cadence === 'hourly'
          ? <input type="number" min="0" max="59" value={Number(schedule.time.slice(3))} onChange={event => update({ ...trigger, schedule: { ...schedule, time: `00:${String(Math.max(0, Math.min(59, Number(event.target.value) || 0))).padStart(2, '0')}` } })}/>
          : <input type="time" value={schedule.time} onChange={event => update({ ...trigger, schedule: { ...schedule, time: event.target.value } })}/>}</label>
        <label><span>Timezone</span><input value={schedule.timezone} onChange={event => update({ ...trigger, schedule: { ...schedule, timezone: event.target.value } })} placeholder="Europe/Madrid"/><small className="bo-template-hint">IANA timezone, for example Europe/Madrid.</small></label>
      </> : null}
    </div> })() : null}
    {node.data.nodeType === 'condition' ? (() => { const condition = nodeConfig as Extract<WorkflowNode, { type: 'condition' }>['config']; const noValue = condition.operator === 'is-empty' || condition.operator === 'is-not-empty'; return <div className="bo-inspector-fields">
      <label><span>Field</span><select value={condition.field} onChange={event => update({ ...condition, field: event.target.value })}>{entity?.fields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
      <label><span>Comparison</span><select value={condition.operator} onChange={event => update({ ...condition, operator: event.target.value as WorkflowConditionOperator })}>{conditionOperators.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {!noValue ? <label><span>Value</span><input value={condition.value} onChange={event => update({ ...condition, value: event.target.value })}/></label> : null}
    </div> })() : null}
    {node.data.nodeType === 'action' ? (() => {
      const action = nodeConfig as ManagedAutomationAction
      const chooseAction = (type: ManagedAutomationAction['type']) => {
        if (type === 'webhook') return update({ type, connectorId: connectors[0]?.id ?? '' })
        if (type === 'notification' || type === 'approval') return update({ type, message: type === 'approval' ? 'Review and approve this record.' : 'A workflow needs your attention.' })
        const target = type === 'update-record' ? entity : config.entities.find(item => item.id !== entity?.id) ?? entity
        if (!target) return
        if (type === 'create-record') return update({ type, entityId: target.id, fields: starterRecordFields(target, entity) })
        const field = target.fields.find(item => item.id === 'status' && item.options?.length) ?? target.fields.find(item => item.type === 'select' && item.options?.length) ?? target.fields[0]
        update({ type, entityId: target.id, fields: field ? { [field.id]: field.options?.[0] ?? `{{record.${field.id}}}` } : {} })
      }
      const recordAction = action.type === 'create-record' || action.type === 'update-record' ? action : null
      const target = recordAction ? config.entities.find(item => item.id === recordAction.entityId) : null
      return <div className="bo-inspector-fields">
        <label><span>Action</span><select value={action.type} onChange={event => chooseAction(event.target.value as ManagedAutomationAction['type'])}><option value="notification">Create notification</option><option value="approval">Request approval</option><option value="create-record">Create record</option><option value="update-record">Update triggering record</option><option value="webhook" disabled={!connectors.length}>Send webhook</option></select></label>
        {action.type === 'webhook' ? <label><span>Connection</span><select value={action.connectorId} onChange={event => update({ ...action, connectorId: event.target.value })}>{connectors.map(connector => <option key={connector.id} value={connector.id}>{connector.name}</option>)}</select></label> : null}
        {action.type === 'notification' || action.type === 'approval' ? <label><span>Message</span><textarea value={action.message} onChange={event => update({ ...action, message: event.target.value })} rows={4}/><small className="bo-template-hint">Use {'{{record.field}}'} for live values.</small></label> : null}
        {recordAction ? <>
          <label><span>Record type</span><select value={recordAction.entityId} disabled={recordAction.type === 'update-record'} onChange={event => { const next = config.entities.find(item => item.id === event.target.value); if (next) update({ ...recordAction, entityId: next.id, fields: starterRecordFields(next, entity) }) }}>{config.entities.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div className="bo-record-field-mapping"><small>FIELDS TO SET</small>{target?.fields.map(field => {
            const included = Object.hasOwn(recordAction.fields, field.id)
            const locked = recordAction.type === 'create-record' && Boolean(field.required)
            const listId = `${node.id}-${field.id}-options`
            return <div key={field.id} className={included ? 'included' : ''}>
              <label><input type="checkbox" checked={included} disabled={locked} onChange={event => { const fields = { ...recordAction.fields }; if (event.target.checked) fields[field.id] = field.options?.[0] ?? (field.type === 'boolean' ? false : ''); else delete fields[field.id]; update({ ...recordAction, fields }) }}/><span>{field.label}{field.required ? ' *' : ''}</span></label>
              {included ? <><input list={field.options?.length ? listId : undefined} value={String(recordAction.fields[field.id] ?? '')} onChange={event => update({ ...recordAction, fields: { ...recordAction.fields, [field.id]: event.target.value } })} placeholder={`{{record.${field.id}}}`}/>{field.options?.length ? <datalist id={listId}>{field.options.map(option => <option key={option} value={option}/>)}</datalist> : null}</> : null}
            </div>
          })}</div>
          <small className="bo-template-hint">Map source data with {'{{record.field}}'}.</small>
        </> : null}
      </div>
    })() : null}
    <footer><button className="danger" onClick={remove}><Trash2 size={14}/> Delete step</button></footer>
  </aside>
}

function ExecutionView({ runs, selected, select, rerun, retry, approvals, respond }: { runs: AutomationRun[]; selected?: AutomationRun; select: (id: string) => void; rerun: () => void; retry: (id: string) => void; approvals: AutomationWorkspace['approvals']; respond: (id: string, decision: 'approved' | 'rejected') => void }) {
  return <main className="bo-execution-view">
    <section className="bo-execution-list"><header><div><strong>Executions</strong><small>{runs.length} runs</small></div><button onClick={rerun}><CirclePlay size={14}/> Run draft</button></header>
      <div>{runs.map(run => <button key={run.id} className={selected?.id === run.id ? 'active' : ''} onClick={() => select(run.id)}><span className={run.status}>{run.status === 'failed' || run.status === 'cancelled' ? <X size={13}/> : run.status === 'waiting' ? <Clock3 size={13}/> : <Check size={13}/>}</span><span><strong>{humanize(run.status)}</strong><small>{runTime(run.finishedAt)} · v{run.workflowVersion ?? 1}{run.attempt && run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}</small></span><ChevronRight size={13}/></button>)}{!runs.length ? <p>No executions yet.</p> : null}</div>
    </section>
    <section className="bo-execution-detail">{selected ? <><header><div><small>EXECUTION</small><h2>{humanize(selected.status)}</h2></div><span className={selected.status}>{selected.status}</span></header>
      <dl><div><dt>Started</dt><dd>{runTime(selected.startedAt)}</dd></div><div><dt>Event</dt><dd>{humanize(selected.event)}</dd></div><div><dt>Record</dt><dd>{selected.recordId || 'No record'}</dd></div></dl>
      {selected.error ? <p className="bo-run-error">{selected.error}</p> : null}
      <div className="bo-node-runs">{selected.nodeRuns?.map((nodeRun, index) => <article key={`${nodeRun.nodeId}-${index}`}><span className={nodeRun.status}>{nodeRun.status === 'failed' ? <X size={13}/> : nodeRun.status === 'waiting' ? <Clock3 size={13}/> : <Check size={13}/>}</span><div><strong>{humanize(nodeRun.nodeType)}</strong><small>{nodeRun.output?.summary ?? nodeRun.error ?? humanize(nodeRun.status)}</small></div><em>{index + 1}</em></article>)}{!selected.nodeRuns?.length ? <p>Node details were not recorded for this earlier run.</p> : null}</div>
      {selected.status === 'failed' || selected.status === 'cancelled' ? <button className="bo-retry-run" onClick={() => retry(selected.id)}><RotateCcw size={14}/> Retry with current workflow</button> : null}
    </> : <div className="bo-execution-empty"><History size={22}/><strong>Select an execution</strong></div>}</section>
    {approvals.length ? <aside className="bo-execution-approvals"><header><strong>Pending approvals</strong><span>{approvals.length}</span></header>{approvals.map(approval => <article key={approval.id}><ShieldCheck size={15}/><div><strong>{approval.automationName}</strong><small>{approval.message}</small></div><button onClick={() => respond(approval.id, 'rejected')}>Reject</button><button className="primary" onClick={() => respond(approval.id, 'approved')}>Approve</button></article>)}</aside> : null}
  </main>
}
