import { MODEL, refusal, textOf, wireSchema, withFallbacks } from './anthropic.mjs'
import { runGeminiJson } from './gemini.mjs'
import { interviewProviders, parkProvider, unusableKey } from './discoveryAgent.mjs'
import { validateWorkflowGraph } from './workflowGraph.mjs'

const operatorValues = new Set(['equals', 'not-equals', 'contains', 'greater-than', 'less-than', 'is-empty', 'is-not-empty'])

const outputSchema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'summary', 'risk', 'humanControl', 'nodes', 'edges'],
  properties: {
    name: { type: 'string' },
    summary: { type: 'string' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    humanControl: { type: 'string', enum: ['none', 'exception', 'approval-required'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'type', 'x', 'y', 'entityId', 'event', 'cadence', 'time', 'timezone', 'weekday', 'field', 'operator', 'value', 'actionType', 'message', 'connectorId', 'targetEntityId', 'assignments'],
        properties: {
          id: { type: 'string' }, type: { type: 'string', enum: ['trigger', 'condition', 'action'] },
          x: { type: 'number' }, y: { type: 'number' }, entityId: { type: 'string' }, event: { type: 'string' },
          cadence: { type: 'string' }, time: { type: 'string' }, timezone: { type: 'string' }, weekday: { type: 'number' },
          field: { type: 'string' }, operator: { type: 'string' }, value: { type: 'string' },
          actionType: { type: 'string' }, message: { type: 'string' }, connectorId: { type: 'string' }, targetEntityId: { type: 'string' },
          assignments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fieldId', 'value'], properties: { fieldId: { type: 'string' }, value: { type: 'string' } } } },
        },
      },
    },
    edges: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'source', 'target', 'branch'], properties: { id: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' }, branch: { type: 'string', enum: ['', 'true', 'false'] } } },
    },
  },
}

const system = `You are Wesify's workflow architect. Convert one operator instruction into a small executable workflow graph.

Rules:
- Use only entity IDs, field IDs, event names, connector IDs, and action types supplied in the context.
- Build a connected acyclic graph with one trigger and at least one action.
- Triggers may use a supplied business event, created, updated, or scheduled. A scheduled trigger must include cadence (hourly, daily, or weekly), 24-hour HH:mm time, IANA timezone, and weekday 1-7 for weekly schedules.
- Use a condition only when the instruction names a real criterion.
- Supported actions are notification, approval, webhook, create-record, and update-record.
- create-record assignments must include every required field of the target entity.
- update-record may only target the same entity as the trigger.
- Use {{record.fieldId}} to carry source values into messages or field assignments. Use {{record.id}} for a relation to the triggering record.
- Never invent credentials, people, amounts, legal decisions, or record IDs.
- Keep high-consequence changes behind an approval action. The server will enforce this again.
- Return only schema-valid JSON. Do not expose private reasoning.`

function compactContext(manifest, state, currentGraph) {
  return {
    company: manifest.specification?.profile?.companyName ?? '',
    entities: (manifest.entities ?? []).map(entity => ({
      id: entity.id, label: entity.label, pluralLabel: entity.pluralLabel, module: entity.module, primaryField: entity.primaryField,
      fields: (entity.fields ?? []).map(field => ({ id: field.id, label: field.label, type: field.type, required: Boolean(field.required), options: field.options ?? [], relationEntityId: field.relationEntityId ?? '' })),
    })),
    events: [
      ...(manifest.specification?.eventArchitecture?.definitions ?? []).map(event => ({ type: event.type, sourceEntityIds: event.sourceEntityIds ?? [] })),
      { type: 'scheduled', sourceEntityIds: (manifest.entities ?? []).map(entity => entity.id) },
    ],
    connectors: state.connectors.map(item => ({ id: item.id, name: item.name, type: item.type })),
    actions: ['notification', 'approval', 'webhook', 'create-record', 'update-record'],
    currentGraph: currentGraph ?? null,
  }
}

function compileModelGraph(value) {
  const nodes = (value.nodes ?? []).map(raw => {
    const base = { id: String(raw.id ?? ''), type: raw.type, position: { x: Number(raw.x), y: Number(raw.y) } }
    if (raw.type === 'trigger') {
      const event = String(raw.event ?? '')
      return { ...base, config: {
        entityId: String(raw.entityId ?? ''), event,
        ...(event === 'scheduled' ? { schedule: { cadence: String(raw.cadence ?? ''), time: String(raw.time ?? ''), timezone: String(raw.timezone ?? '') || 'UTC', weekday: Number(raw.weekday ?? 1) } } : {}),
      } }
    }
    if (raw.type === 'condition') return { ...base, config: { field: String(raw.field ?? ''), operator: operatorValues.has(raw.operator) ? raw.operator : 'equals', value: String(raw.value ?? '') } }
    const actionType = String(raw.actionType ?? '')
    if (actionType === 'notification' || actionType === 'approval') return { ...base, config: { type: actionType, message: String(raw.message ?? '') } }
    if (actionType === 'webhook') return { ...base, config: { type: actionType, connectorId: String(raw.connectorId ?? '') } }
    return { ...base, config: { type: actionType, entityId: String(raw.targetEntityId ?? ''), fields: Object.fromEntries((raw.assignments ?? []).map(item => [String(item.fieldId ?? ''), item.value])) } }
  })
  const edges = (value.edges ?? []).map((raw, index) => ({
    id: String(raw.id || `edge-${index + 1}`), source: String(raw.source ?? ''), target: String(raw.target ?? ''),
    ...(raw.branch === 'true' || raw.branch === 'false' ? { sourceHandle: raw.branch } : {}),
  }))
  return { version: 1, nodes, edges }
}

function words(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function entityScore(entity, instruction) {
  const haystack = ` ${words(instruction)} `
  return [entity.id, entity.label, entity.pluralLabel]
    .map(words)
    .filter(Boolean)
    .reduce((score, candidate) => score + (haystack.includes(` ${candidate} `) ? candidate.length + 5 : 0), 0)
}

function findEntity(entities, instruction, excludedId = '') {
  return entities
    .filter(item => item.id !== excludedId)
    .map(item => ({ item, score: entityScore(item, instruction) }))
    .sort((left, right) => right.score - left.score)[0]?.score > 0
    ? entities.filter(item => item.id !== excludedId).map(item => ({ item, score: entityScore(item, instruction) })).sort((left, right) => right.score - left.score)[0].item
    : null
}

function optionMention(entity, instruction) {
  const haystack = words(instruction)
  for (const field of entity?.fields ?? []) for (const option of field.options ?? []) {
    if (haystack.includes(words(option))) return { field, option }
  }
  return null
}

function defaultCreateFields(target, source) {
  const fields = {}
  for (const field of target.fields ?? []) {
    if (field.type === 'relation' && field.relationEntityId === source.id) fields[field.id] = '{{record.id}}'
    else if (field.type === 'relation') {
      const inherited = source.fields?.find(item => item.type === 'relation' && item.relationEntityId === field.relationEntityId)
      if (inherited) fields[field.id] = `{{record.${inherited.id}}}`
    }
  }
  for (const field of (target.fields ?? []).filter(item => item.required)) {
    if (fields[field.id] !== undefined) continue
    if (field.type === 'select' && field.options?.length) fields[field.id] = field.options[0]
    else if (field.type === 'boolean') fields[field.id] = false
    else if (field.type === 'number' || field.type === 'currency') fields[field.id] = 0
    else fields[field.id] = `${target.label} from {{record.${source.primaryField}}}`
  }
  return fields
}

function scheduleFromInstruction(instruction) {
  if (!/\b(hourly|daily|weekly|every\s+(?:hour|day|week|morning)|each\s+(?:hour|day|week|morning))\b/i.test(instruction)) return null
  const cadence = /\b(hourly|every\s+hour|each\s+hour)\b/i.test(instruction)
    ? 'hourly'
    : /\b(weekly|every\s+week|each\s+week)\b/i.test(instruction) ? 'weekly' : 'daily'
  const timeMatch = instruction.match(/\b(?:at\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/i)
  let hour = timeMatch ? Number(timeMatch[1]) : (cadence === 'hourly' ? 0 : 9)
  if (timeMatch?.[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12
  if (timeMatch?.[3]?.toLowerCase() === 'am' && hour === 12) hour = 0
  const minute = timeMatch?.[2] ? Number(timeMatch[2]) : 0
  const weekdayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const weekday = Math.max(1, weekdayNames.findIndex(day => new RegExp(`\\b${day}\\b`, 'i').test(instruction)) + 1 || 1)
  return { cadence, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timezone: 'UTC', ...(cadence === 'weekly' ? { weekday } : {}) }
}

function deterministicPlan(instruction, manifest, state) {
  const entities = manifest.entities ?? []
  const triggerPhrase = String(instruction).split(/\b(?:then|create|open|add|generate|notify|alert|send|request approval|approve)\b/i)[0]
  const source = findEntity(entities, triggerPhrase) ?? findEntity(entities, instruction) ?? entities[0]
  if (!source) throw Object.assign(new Error('This workspace has no record types to automate yet.'), { status: 409 })
  const mentionedOption = optionMention(source, instruction)
  const schedule = scheduleFromInstruction(instruction)
  const event = schedule ? 'scheduled' : /\b(created|added|new|received|submitted|booked)\b/i.test(instruction) && !mentionedOption ? 'created' : 'updated'
  const nodes = [{ id: 'trigger-1', type: 'trigger', position: { x: 80, y: 220 }, config: { entityId: source.id, event, ...(schedule ? { schedule } : {}) } }]
  const edges = []
  let previous = 'trigger-1'
  if (mentionedOption) {
    nodes.push({ id: 'condition-1', type: 'condition', position: { x: 350, y: 220 }, config: { field: mentionedOption.field.id, operator: 'equals', value: mentionedOption.option } })
    edges.push({ id: 'trigger-condition', source: previous, target: 'condition-1' })
    previous = 'condition-1'
  }
  const actionNodes = []
  const afterCreate = instruction.match(/\b(?:create|open|add|generate)\s+(?:a|an|the)?\s*([^,.]+?)(?:\s+(?:and|then|when|with)\b|[,.]|$)/i)?.[1] ?? ''
  const target = findEntity(entities, afterCreate || instruction, source.id)
  if (/\b(create|open|add|generate)\b/i.test(instruction) && target) actionNodes.push({ type: 'create-record', entityId: target.id, fields: defaultCreateFields(target, source) })
  if (/\b(set|mark|change|update)\b/i.test(instruction)) {
    const desiredText = String(instruction).split(/\b(?:set|mark|change|update)\b/i).at(-1) ?? instruction
    const desired = optionMention(source, desiredText)
    if (desired) actionNodes.push({ type: 'update-record', entityId: source.id, fields: { [desired.field.id]: desired.option } })
  }
  if (/\b(approv|review|sign[ -]?off|authori[sz])\w*/i.test(instruction)) actionNodes.unshift({ type: 'approval', message: `Review ${source.label.toLowerCase()} {{record.${source.primaryField}}}.` })
  const connector = state.connectors.find(item => words(instruction).includes(words(item.name))) ?? (/\bwebhook\b/i.test(instruction) ? state.connectors[0] : null)
  if (connector) actionNodes.push({ type: 'webhook', connectorId: connector.id })
  if (/\b(notify|alert|remind|tell|message)\b/i.test(instruction) || !actionNodes.length) actionNodes.push({ type: 'notification', message: `${source.label} {{record.${source.primaryField}}} needs attention.` })
  actionNodes.forEach((config, index) => {
    const id = `action-${index + 1}`
    nodes.push({ id, type: 'action', position: { x: 620 + index * 270, y: 220 }, config })
    edges.push({ id: `edge-${previous}-${id}`, source: previous, target: id, ...(previous === 'condition-1' ? { sourceHandle: 'true' } : {}) })
    previous = id
  })
  const name = String(instruction).trim().replace(/[.!?]+$/, '').slice(0, 74) || `${source.label} workflow`
  const summary = schedule
    ? `Scans ${source.pluralLabel.toLowerCase()} ${schedule.cadence} at ${schedule.time} ${schedule.timezone}.`
    : `Runs when ${source.pluralLabel.toLowerCase()} are ${event}.`
  return { name: name.charAt(0).toUpperCase() + name.slice(1), summary, risk: 'medium', humanControl: actionNodes.some(item => item.type === 'approval') ? 'approval-required' : 'exception', graph: { version: 1, nodes, edges } }
}

function graphAncestors(graph, nodeId) {
  const incoming = new Map(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) incoming.get(edge.target)?.push(edge.source)
  const found = new Set()
  const queue = [...(incoming.get(nodeId) ?? [])]
  while (queue.length) {
    const id = queue.shift()
    if (found.has(id)) continue
    found.add(id)
    queue.push(...(incoming.get(id) ?? []))
  }
  return found
}

function consequential(node, manifest) {
  if (node.type !== 'action' || !['create-record', 'update-record'].includes(node.config.type)) return false
  const entity = manifest.entities.find(item => item.id === node.config.entityId)
  if (/finance|account|payroll|people|team|hr|legal|compliance/i.test(`${entity?.module ?? ''} ${entity?.id ?? ''}`)) return true
  return Object.entries(node.config.fields ?? {}).some(([field, value]) => /amount|balance|debit|credit|payment|salary|wage|status/i.test(field) && /paid|posted|approved|terminated|closed|void/i.test(String(value)))
}

function enforceSafeguards(plan, manifest) {
  let graph = structuredClone(plan.graph)
  const safeguards = []
  let highConsequence = false
  for (const action of graph.nodes.filter(node => consequential(node, manifest))) {
    highConsequence = true
    const ancestors = graphAncestors(graph, action.id)
    if (graph.nodes.some(node => ancestors.has(node.id) && node.type === 'action' && node.config.type === 'approval')) {
      safeguards.push(`Human approval verified before ${manifest.entities.find(item => item.id === action.config.entityId)?.label ?? 'record'} changes.`)
      continue
    }
    const incoming = graph.edges.filter(edge => edge.target === action.id)
    const gateId = `approval-${action.id}`.slice(0, 80)
    const gate = { id: gateId, type: 'action', position: { x: action.position.x - 250, y: action.position.y }, config: { type: 'approval', message: 'Review this consequential business change before it runs.' } }
    graph.nodes.push(gate)
    graph.edges = [
      ...graph.edges.filter(edge => edge.target !== action.id),
      ...incoming.map((edge, index) => ({ ...edge, id: `${edge.id}-gate-${index + 1}`.slice(0, 80), target: gateId })),
      { id: `gate-${action.id}`.slice(0, 80), source: gateId, target: action.id },
    ]
    safeguards.push(`Human approval added before ${manifest.entities.find(item => item.id === action.config.entityId)?.label ?? 'record'} changes.`)
  }
  if (highConsequence) plan = { ...plan, risk: 'high', humanControl: 'approval-required' }
  return { ...plan, graph, safeguards }
}

async function modelPlan(instruction, manifest, state, currentGraph) {
  const context = compactContext(manifest, state, currentGraph)
  const prompt = `Operator instruction:\n${instruction}\n\nLive workflow context:\n${JSON.stringify(context)}\n\nBuild the executable workflow.`
  const providers = interviewProviders()
  let lastError
  for (const provider of providers) {
    try {
      let raw
      let model
      if (provider === 'gemini') {
        const result = await runGeminiJson({ system, prompt, schema: outputSchema, maxTokens: 5000, thinkingBudget: 1024, temperature: 0.15, timeoutMs: 25_000, budgetMs: 45_000 })
        raw = result.text; model = result.model
      } else {
        const { message } = await withFallbacks({ model: MODEL, max_tokens: 5000, system, output_config: { effort: 'medium', format: { type: 'json_schema', schema: wireSchema(outputSchema) } } }, [{ role: 'user', content: prompt }])
        const declined = refusal(message, 'Wesify used its deterministic workflow planner instead.')
        if (declined) throw declined
        raw = textOf(message); model = message.model ?? MODEL
      }
      const value = JSON.parse(raw)
      return { name: String(value.name ?? '').trim().slice(0, 120), summary: String(value.summary ?? '').trim().slice(0, 500), risk: value.risk, humanControl: value.humanControl, graph: compileModelGraph(value), model }
    } catch (error) {
      lastError = error
      if (unusableKey(error)) parkProvider(provider, error?.message ?? 'the key was refused')
    }
  }
  if (providers.length && lastError) console.warn(`Wesify automation planner fell back to rules: ${lastError?.message ?? lastError}`)
  return null
}

export async function planAutomation({ instruction, manifest, state, currentGraph }) {
  const request = String(instruction ?? '').trim().slice(0, 3000)
  if (request.length < 8) throw Object.assign(new Error('Describe what should trigger the workflow and what should happen.'), { status: 400 })
  const context = { entityIds: manifest.entities.map(item => item.id), entities: manifest.entities, connectorIds: state.connectors.map(item => item.id), eventDefinitions: manifest.specification?.eventArchitecture?.definitions ?? [] }
  let generated = await modelPlan(request, manifest, state, currentGraph)
  let source = generated ? 'ai' : 'rules'
  let secured
  let graph
  try {
    secured = enforceSafeguards(generated ?? { ...deterministicPlan(request, manifest, state), model: 'Wesify rules' }, manifest)
    graph = validateWorkflowGraph(secured.graph, context)
  } catch (error) {
    if (!generated) throw error
    console.warn(`Wesify rejected an invalid model workflow and rebuilt it with rules: ${error?.message ?? error}`)
    generated = null
    source = 'rules'
    secured = enforceSafeguards({ ...deterministicPlan(request, manifest, state), model: 'Wesify rules' }, manifest)
    secured.safeguards.unshift('The AI draft failed validation, so Wesify rebuilt it from verified workspace rules.')
    graph = validateWorkflowGraph(secured.graph, context)
  }
  return {
    name: secured.name || 'AI-built workflow', summary: secured.summary || request.slice(0, 240),
    risk: secured.risk ?? 'medium', humanControl: secured.humanControl ?? 'exception',
    graph, model: secured.model ?? 'Wesify rules', source, safeguards: secured.safeguards,
  }
}
