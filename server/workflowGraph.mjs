const NODE_ID = /^[a-zA-Z0-9_-]{1,80}$/
const CONDITION_OPERATORS = new Set(['equals', 'not-equals', 'contains', 'greater-than', 'less-than', 'is-empty', 'is-not-empty'])
const SCHEDULE_CADENCES = new Set(['hourly', 'daily', 'weekly'])

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 })
}

function positionOf(value) {
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) invalid('Every workflow node needs a valid canvas position.')
  return { x: Math.max(-10_000, Math.min(10_000, x)), y: Math.max(-10_000, Math.min(10_000, y)) }
}

function text(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum)
}

function recordFields(value, entity, partial) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Record actions need one or more field values.')
  const definitions = new Map((entity?.fields ?? []).map(field => [field.id, field]))
  const fields = {}
  for (const [fieldId, raw] of Object.entries(value).slice(0, 40)) {
    if (!definitions.has(fieldId)) invalid(`${entity?.label ?? 'The selected record type'} has no field named ${fieldId}.`)
    if (!['string', 'number', 'boolean'].includes(typeof raw)) invalid('Workflow record values must be text, numbers, booleans, or {{record.field}} references.')
    fields[fieldId] = typeof raw === 'string' ? raw.slice(0, 1000) : raw
  }
  if (!Object.keys(fields).length) invalid('Record actions need at least one field value.')
  if (!partial) for (const field of (entity?.fields ?? []).filter(item => item.required)) {
    if (fields[field.id] === undefined || fields[field.id] === '') invalid(`${field.label} is required when this workflow creates ${entity.label.toLowerCase()}.`)
  }
  return fields
}

export function createWorkflowGraph({ entityId, event, schedule, action, field, equals }) {
  const hasCondition = Boolean(field)
  const trigger = { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 220 }, config: { entityId, event, ...(schedule ? { schedule } : {}) } }
  const condition = hasCondition
    ? [{ id: 'condition-1', type: 'condition', position: { x: 350, y: 220 }, config: { field, operator: 'equals', value: equals ?? '' } }]
    : []
  const actionNode = { id: 'action-1', type: 'action', position: { x: hasCondition ? 620 : 350, y: 220 }, config: action }
  const edges = hasCondition
    ? [
        { id: 'trigger-1-condition-1', source: 'trigger-1', target: 'condition-1' },
        { id: 'condition-1-action-1', source: 'condition-1', target: 'action-1', sourceHandle: 'true' },
      ]
    : [{ id: 'trigger-1-action-1', source: 'trigger-1', target: 'action-1' }]
  return { version: 1, nodes: [trigger, ...condition, actionNode], edges }
}

export function workflowGraphFor(automation, useDraft = false) {
  if (useDraft && automation?.draftGraph) return automation.draftGraph
  if (automation?.graph) return automation.graph
  return createWorkflowGraph({
    entityId: automation?.trigger?.entityId,
    event: automation?.trigger?.event,
    schedule: automation?.trigger?.schedule,
    field: automation?.trigger?.field,
    equals: automation?.trigger?.equals,
    action: automation?.action,
  })
}

export function validateWorkflowGraph(value, context) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) invalid('Workflow graph is required.')
  if (value.nodes.length < 2 || value.nodes.length > 100) invalid('A workflow needs between 2 and 100 nodes.')
  if (value.edges.length > 200) invalid('A workflow can contain at most 200 connections.')

  const entityIds = new Set(context.entityIds ?? [])
  const entityById = new Map((context.entities ?? []).map(entity => [entity.id, entity]))
  const connectorIds = new Set(context.connectorIds ?? [])
  const eventDefinitions = context.eventDefinitions ?? []
  const ids = new Set()
  const nodes = value.nodes.map(raw => {
    const id = text(raw?.id, 80)
    if (!NODE_ID.test(id) || ids.has(id)) invalid('Workflow node IDs must be unique letters, numbers, dashes, or underscores.')
    ids.add(id)
    const position = positionOf(raw.position)

    if (raw.type === 'trigger') {
      const entityId = text(raw.config?.entityId, 100)
      const event = text(raw.config?.event, 100)
      const compiledEvent = eventDefinitions.some(definition => definition.type === event && definition.sourceEntityIds?.includes(entityId))
      if (!entityIds.has(entityId) || (!['created', 'updated', 'scheduled'].includes(event) && !compiledEvent)) invalid('Choose a valid record type and trigger event.')
      if (event === 'scheduled') {
        const cadence = text(raw.config?.schedule?.cadence, 20)
        const time = text(raw.config?.schedule?.time, 5)
        const timezone = text(raw.config?.schedule?.timezone, 80) || 'UTC'
        const weekday = Math.max(1, Math.min(7, Number(raw.config?.schedule?.weekday ?? 1)))
        const timeMatch = time.match(/^(\d{2}):(\d{2})$/)
        if (!SCHEDULE_CADENCES.has(cadence) || !timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) invalid('Scheduled triggers need an hourly, daily, or weekly cadence and a valid time.')
        try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date()) } catch { invalid('Choose a valid IANA time zone for this schedule.') }
        return { id, type: 'trigger', position, config: { entityId, event, schedule: { cadence, time, timezone, ...(cadence === 'weekly' ? { weekday } : {}) } } }
      }
      return { id, type: 'trigger', position, config: { entityId, event } }
    }

    if (raw.type === 'condition') {
      const field = text(raw.config?.field, 100)
      const operator = text(raw.config?.operator, 40)
      if (!field || !CONDITION_OPERATORS.has(operator)) invalid('Every condition needs a field and supported comparison.')
      return { id, type: 'condition', position, config: { field, operator, value: text(raw.config?.value, 500) } }
    }

    if (raw.type === 'action') {
      const type = text(raw.config?.type, 40)
      if (type === 'webhook') {
        const connectorId = text(raw.config?.connectorId, 100)
        if (!connectorIds.has(connectorId)) invalid('Choose a connected webhook for every webhook action.')
        return { id, type: 'action', position, config: { type, connectorId } }
      }
      if (type === 'notification' || type === 'approval') {
        const message = text(raw.config?.message, 500)
        if (!message) invalid(`Every ${type} action needs a message.`)
        return { id, type: 'action', position, config: { type, message } }
      }
      if (type === 'create-record' || type === 'update-record') {
        const entityId = text(raw.config?.entityId, 100)
        const entity = entityById.get(entityId)
        if (!entityIds.has(entityId) || !entity) invalid('Choose a valid record type for every record action.')
        const fields = recordFields(raw.config?.fields, entity, type === 'update-record')
        return { id, type: 'action', position, config: { type, entityId, fields } }
      }
      invalid('Choose a supported workflow action.')
    }
    invalid('Workflow nodes must be triggers, conditions, or actions.')
  })

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const edgeKeys = new Set()
  const edgeIds = new Set()
  const edges = value.edges.map((raw, index) => {
    const source = text(raw?.source, 80)
    const target = text(raw?.target, 80)
    if (!nodeById.has(source) || !nodeById.has(target) || source === target) invalid('Every connection must join two different workflow nodes.')
    if (nodeById.get(target).type === 'trigger') invalid('Trigger nodes cannot receive a connection.')
    const sourceNode = nodeById.get(source)
    const sourceHandle = raw?.sourceHandle == null ? undefined : text(raw.sourceHandle, 20)
    if (sourceNode.type === 'condition' && !['true', 'false'].includes(sourceHandle)) invalid('Condition connections must use the true or false branch.')
    if (sourceNode.type !== 'condition' && sourceHandle) invalid('Only condition nodes can use named branches.')
    const key = `${source}:${sourceHandle ?? ''}:${target}`
    if (edgeKeys.has(key)) invalid('Duplicate workflow connections are not allowed.')
    edgeKeys.add(key)
    const id = NODE_ID.test(text(raw?.id, 80)) ? text(raw.id, 80) : `edge-${index + 1}`
    if (edgeIds.has(id)) invalid('Workflow connection IDs must be unique.')
    edgeIds.add(id)
    return { id, source, target, ...(sourceHandle ? { sourceHandle } : {}) }
  })

  const triggers = nodes.filter(node => node.type === 'trigger')
  if (!triggers.length) invalid('A workflow needs at least one trigger.')
  if (!nodes.some(node => node.type === 'action')) invalid('A workflow needs at least one action.')
  const triggerEntityIds = new Set(triggers.map(node => node.config.entityId))
  for (const node of nodes.filter(candidate => candidate.type === 'action' && candidate.config.type === 'update-record')) {
    if (!triggerEntityIds.has(node.config.entityId)) invalid('An update-record action can only update the record that triggered this workflow.')
  }

  const incoming = new Map(nodes.map(node => [node.id, 0]))
  const outgoing = new Map(nodes.map(node => [node.id, []]))
  for (const edge of edges) {
    incoming.set(edge.target, incoming.get(edge.target) + 1)
    outgoing.get(edge.source).push(edge.target)
  }
  for (const node of nodes) {
    if (node.type !== 'trigger' && incoming.get(node.id) === 0) invalid('Every non-trigger node must be connected to the workflow.')
  }

  const reachable = new Set(triggers.map(node => node.id))
  const queue = [...reachable]
  while (queue.length) {
    for (const target of outgoing.get(queue.shift()) ?? []) {
      if (!reachable.has(target)) { reachable.add(target); queue.push(target) }
    }
  }
  if (reachable.size !== nodes.length) invalid('Every workflow node must be reachable from a trigger.')

  const remainingIncoming = new Map(incoming)
  const acyclicQueue = nodes.filter(node => remainingIncoming.get(node.id) === 0).map(node => node.id)
  let visited = 0
  while (acyclicQueue.length) {
    const nodeId = acyclicQueue.shift()
    visited += 1
    for (const target of outgoing.get(nodeId) ?? []) {
      const next = remainingIncoming.get(target) - 1
      remainingIncoming.set(target, next)
      if (next === 0) acyclicQueue.push(target)
    }
  }
  if (visited !== nodes.length) invalid('Loops are not supported yet. Remove the circular connection.')

  return { version: 1, nodes, edges }
}

export function workflowMetadata(graph) {
  const triggerNode = graph.nodes.find(node => node.type === 'trigger')
  const actionNode = graph.nodes.find(node => node.type === 'action')
  return {
    trigger: { entityId: triggerNode.config.entityId, event: triggerNode.config.event, ...(triggerNode.config.schedule ? { schedule: triggerNode.config.schedule } : {}) },
    action: actionNode.config,
  }
}

export function workflowTriggerMatches(automation, event, entityId) {
  return workflowGraphFor(automation).nodes.some(node => node.type === 'trigger' && node.config.event === event && node.config.entityId === entityId)
}
