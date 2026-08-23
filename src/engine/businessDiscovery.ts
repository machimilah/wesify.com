import { moduleIds, type AIBlueprint, type ModuleId } from './blueprint'
import { capabilityIds } from './capabilityCatalog'

export type DiscoveryPhase = 'INITIAL' | 'DISCOVERING' | 'ARCHITECTING' | 'AWAITING_APPROVAL' | 'BUILDING' | 'TESTING' | 'READY'
export type KnowledgeStatus = 'explicit' | 'inferred' | 'unknown' | 'irrelevant'

export interface BusinessFact {
  topic: string
  value: string
  status: KnowledgeStatus
  confidence: number
}

export interface BusinessState {
  companySummary: string
  industry: string
  facts: BusinessFact[]
  businessModel: string[]
  productsOrServices: string[]
  customers: string[]
  revenueModel: string[]
  team: string[]
  operations: string[]
  resources: string[]
  locations: string[]
  currentTools: string[]
  painPoints: string[]
  goals: string[]
  knownEntities: string[]
  knownWorkflows: string[]
  uncertainties: string[]
  assumptions: string[]
  softwareImplications: string[]
}

export interface DiscoveryQuestion {
  text: string
  reason: string
  suggestedAnswers: string[]
}

/**
 * A field the architect asked for on one entity.
 *
 * `relatedTo` is another entity's name rather than an id, because the architect is working in the
 * company's language and has not been told what BO will slug things to. It is resolved — and
 * discarded if it points at nothing — where the workspace is compiled.
 */
export const architectureFieldTypes = ['text', 'long-text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'select', 'relation', 'file'] as const
export type ArchitectureFieldType = typeof architectureFieldTypes[number]

export interface ArchitectureField {
  label: string
  type: ArchitectureFieldType
  required?: boolean
  options?: string[]
  relatedTo?: string
}

export interface ArchitectureEntity {
  name: string
  module: ModuleId
  purpose: string
  /** Absent when the model did not offer any, which is the in-browser path. BO infers them then. */
  fields?: ArchitectureField[]
}

export interface ArchitectureContext {
  title: string
  summary: string
  explanation: string
  modules: ModuleId[]
  startView: ModuleId | 'overview'
  capabilities: string[]
  capabilityIds: string[]
  excludedCapabilityIds: string[]
  pages: string[]
  entities: ArchitectureEntity[]
  workflows: string[]
  metrics: string[]
  processStages: string[]
  pipelineStages: string[]
  billingCadence: string
}

export interface DiscoveryAgentResponse {
  businessState: BusinessState
  decision: 'ASK_QUESTION' | 'READY_TO_ARCHITECT'
  acknowledgment: string
  nextQuestion: DiscoveryQuestion
  architectureContext: ArchitectureContext
}

export interface DiscoveryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  suggestedAnswers?: string[]
  createdAt: string
}

export interface DiscoveryMetrics {
  discoveryTurns: number
  questionsAsked: number
  architectureEdits: number
  architectureApproved: boolean
  startedAt: string
  approvedAt: string
}

export interface DiscoverySession {
  workspaceId: string
  conversationId: string
  projectId: string
  phase: DiscoveryPhase
  architectureVersion: number
  businessState: BusinessState
  messages: DiscoveryMessage[]
  currentQuestion: DiscoveryQuestion | null
  architecture: ArchitectureContext | null
  metrics: DiscoveryMetrics
  createdAt: string
  updatedAt: string
}

export const emptyBusinessState = (): BusinessState => ({
  companySummary: '', industry: '', facts: [], businessModel: [], productsOrServices: [], customers: [],
  revenueModel: [], team: [], operations: [], resources: [], locations: [], currentTools: [], painPoints: [],
  goals: [], knownEntities: [], knownWorkflows: [], uncertainties: [], assumptions: [], softwareImplications: [],
})

export const emptyArchitecture = (): ArchitectureContext => ({
  title: '', summary: '', explanation: '', modules: [], startView: 'overview', capabilities: [], capabilityIds: [], excludedCapabilityIds: [], pages: [],
  entities: [], workflows: [], metrics: [], processStages: [], pipelineStages: [], billingCadence: '',
})

export function createDiscoverySession(workspaceId: string, initialPrompt: string): DiscoverySession {
  const now = new Date().toISOString()
  return {
    workspaceId,
    conversationId: crypto.randomUUID(),
    projectId: '',
    phase: 'DISCOVERING',
    architectureVersion: 0,
    businessState: emptyBusinessState(),
    messages: [{ id: crypto.randomUUID(), role: 'user', content: initialPrompt, createdAt: now }],
    currentQuestion: null,
    architecture: null,
    metrics: { discoveryTurns: 0, questionsAsked: 0, architectureEdits: 0, architectureApproved: false, startedAt: now, approvedAt: '' },
    createdAt: now,
    updatedAt: now,
  }
}

const knowledgeStatuses: KnowledgeStatus[] = ['explicit', 'inferred', 'unknown', 'irrelevant']
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown, max = 20): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && item.length <= 180)

export function isBusinessState(value: unknown): value is BusinessState {
  if (!isObject(value)) return false
  const arrayKeys: Array<keyof BusinessState> = ['businessModel', 'productsOrServices', 'customers', 'revenueModel', 'team', 'operations', 'resources', 'locations', 'currentTools', 'painPoints', 'goals', 'knownEntities', 'knownWorkflows', 'uncertainties', 'assumptions', 'softwareImplications']
  return typeof value.companySummary === 'string' && typeof value.industry === 'string'
    && arrayKeys.every(key => strings(value[key]))
    && Array.isArray(value.facts) && value.facts.length <= 40 && value.facts.every(fact => isObject(fact)
      && typeof fact.topic === 'string' && typeof fact.value === 'string'
      && knowledgeStatuses.includes(fact.status as KnowledgeStatus)
      && typeof fact.confidence === 'number' && fact.confidence >= 0 && fact.confidence <= 1)
}

export function isArchitectureContext(value: unknown): value is ArchitectureContext {
  if (!isObject(value)) return false
  return typeof value.title === 'string' && typeof value.summary === 'string' && typeof value.explanation === 'string'
    && Array.isArray(value.modules) && value.modules.every(item => moduleIds.includes(item as ModuleId))
    && (value.startView === 'overview' || moduleIds.includes(value.startView as ModuleId))
    && strings(value.capabilities, 80) && strings(value.capabilityIds, 80) && value.capabilityIds.every(item => capabilityIds.includes(item))
    && strings(value.excludedCapabilityIds, 80) && value.excludedCapabilityIds.every(item => capabilityIds.includes(item))
    && strings(value.pages, 80) && strings(value.workflows, 80) && strings(value.metrics, 80)
    && strings(value.processStages) && strings(value.pipelineStages) && typeof value.billingCadence === 'string'
    && Array.isArray(value.entities) && value.entities.length <= 60 && value.entities.every(entity => isObject(entity)
      && typeof entity.name === 'string' && moduleIds.includes(entity.module as ModuleId) && typeof entity.purpose === 'string'
      && isArchitectureFields(entity.fields))
}

/**
 * Fields are optional, and anything malformed makes the whole entity untrusted rather than being
 * quietly patched. A half-read field list is worse than none: BO would build a record form around a
 * shape nobody chose, and the operator has no way to tell that is what happened.
 */
function isArchitectureFields(value: unknown): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.length <= 14 && value.every(field => isObject(field)
    && typeof field.label === 'string' && field.label.trim().length > 0 && field.label.length <= 40
    && architectureFieldTypes.includes(field.type as ArchitectureFieldType)
    && (field.required === undefined || typeof field.required === 'boolean')
    && (field.options === undefined || strings(field.options, 8))
    && (field.relatedTo === undefined || typeof field.relatedTo === 'string'))
}

export function hasUsableArchitecture(value: ArchitectureContext) {
  return value.modules.length > 0 && value.pages.length > 0 && value.entities.length > 0
}

export function parseDiscoveryResponse(value: unknown): DiscoveryAgentResponse {
  if (!isObject(value) || !isBusinessState(value.businessState)) throw new Error('Invalid business state.')
  if (value.decision !== 'ASK_QUESTION' && value.decision !== 'READY_TO_ARCHITECT') throw new Error('Invalid discovery decision.')
  if (typeof value.acknowledgment !== 'string' || !isObject(value.nextQuestion) || !isArchitectureContext(value.architectureContext)) throw new Error('Invalid discovery response.')
  const question: DiscoveryQuestion = {
    text: String(value.nextQuestion.text ?? '').trim(),
    reason: String(value.nextQuestion.reason ?? '').trim(),
    suggestedAnswers: strings(value.nextQuestion.suggestedAnswers, 6) ? value.nextQuestion.suggestedAnswers.map(item => item.trim()).filter(Boolean) : [],
  }
  if (value.decision === 'ASK_QUESTION' && !question.text) throw new Error('The model did not provide a question.')
  return { businessState: value.businessState, decision: value.decision, acknowledgment: value.acknowledgment.trim(), nextQuestion: question, architectureContext: value.architectureContext }
}

function normalizeWord(word: string) {
  if (/^payments?$/.test(word)) return 'pay'
  if (word === 'monthly') return 'month'
  if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1)
  return word
}

const normalizedWords = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 3 && !['what', 'when', 'where', 'which', 'your', 'does', 'normally', 'company', 'business', 'each'].includes(word)).map(normalizeWord))

export function isDuplicateQuestion(question: string, session: DiscoverySession) {
  const candidate = normalizedWords(question)
  if (!candidate.size) return false
  const priorQuestions = session.messages.filter(message => message.role === 'assistant' && message.content.includes('?')).map(message => message.content)
  const known = [...session.businessState.facts.filter(fact => fact.status === 'explicit').map(fact => `${fact.topic} ${fact.value}`), ...priorQuestions]
  return known.some(item => {
    const words = normalizedWords(item)
    const overlap = [...candidate].filter(word => words.has(word)).length
    return overlap / Math.max(1, Math.min(candidate.size, words.size)) >= 0.72
  })
}

export function applyAgentResponse(session: DiscoverySession, response: DiscoveryAgentResponse): DiscoverySession {
  const now = new Date().toISOString()
  const ready = response.decision === 'READY_TO_ARCHITECT'
  const assistantContent = ready
    ? response.acknowledgment || 'I have a good picture of how your company works.'
    : [response.acknowledgment, response.nextQuestion.text].filter(Boolean).join('\n\n')
  return {
    ...session,
    phase: ready ? 'AWAITING_APPROVAL' : 'DISCOVERING',
    businessState: response.businessState,
    currentQuestion: ready ? null : response.nextQuestion,
    architecture: ready ? response.architectureContext : null,
    architectureVersion: ready ? session.architectureVersion + 1 : session.architectureVersion,
    messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: assistantContent, suggestedAnswers: ready ? undefined : response.nextQuestion.suggestedAnswers, createdAt: now }],
    metrics: { ...session.metrics, discoveryTurns: session.metrics.discoveryTurns + 1, questionsAsked: session.metrics.questionsAsked + (ready ? 0 : 1) },
    updatedAt: now,
  }
}

export function addUserMessage(session: DiscoverySession, content: string): DiscoverySession {
  const now = new Date().toISOString()
  return { ...session, phase: 'DISCOVERING', currentQuestion: null, architecture: null, messages: [...session.messages, { id: crypto.randomUUID(), role: 'user', content, createdAt: now }], updatedAt: now }
}

export function sessionStorageKey(workspaceId: string) { return `bo-discovery-session:${workspaceId}` }

export function readLocalDiscoverySession(workspaceId: string): DiscoverySession | null {
  try {
    const value = JSON.parse(localStorage.getItem(sessionStorageKey(workspaceId)) ?? 'null') as DiscoverySession | null
    return value?.workspaceId === workspaceId && Array.isArray(value.messages) ? value : null
  } catch { return null }
}

export function writeLocalDiscoverySession(session: DiscoverySession) {
  localStorage.setItem(sessionStorageKey(session.workspaceId), JSON.stringify(session))
  localStorage.setItem('bo-active-workspace-id', session.workspaceId)
}

export function architectureToBlueprint(architecture: ArchitectureContext): AIBlueprint {
  const modules = [...new Set(architecture.modules)]
  return {
    modules,
    startView: architecture.startView === 'overview' || modules.includes(architecture.startView as ModuleId) ? architecture.startView : 'overview',
    moduleConfig: {
      pipelineStages: architecture.pipelineStages,
      processSteps: architecture.processStages,
      billingCadence: architecture.billingCadence,
      inventoryStages: architecture.modules.includes('inventory') ? ['Planned', 'Available', 'Allocated'] : [],
      supportStages: architecture.modules.includes('support') ? ['New', 'In progress', 'Resolved'] : [],
    },
  }
}
