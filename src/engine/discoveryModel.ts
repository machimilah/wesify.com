import type { ChatCompletionMessageParam, InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import { moduleIds } from './blueprint'
import {
  emptyArchitecture,
  hasUsableArchitecture,
  isDuplicateQuestion,
  parseDiscoveryResponse,
  type ArchitectureContext,
  type BusinessState,
  type DiscoveryAgentResponse,
  type DiscoverySession,
  awaitingClarification,
} from './businessDiscovery'
import { capabilityCatalogPrompt, capabilityIds, planCapabilities } from './capabilityCatalog'
import { researchBusiness, type BusinessResearch } from './businessResearch'
import { lastInterviewIssue, lastInterviewModel, requestDiscoveryTurn, serverInterviewAvailable } from './discoveryTurnClient'
import { evaluateOperatingKnowledge, knowledgeRequirementsFor } from './knowledgeEngine'

const MODEL_F16 = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
const MODEL_F32 = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC'
const MODULES = [...moduleIds]
let enginePromise: Promise<MLCEngineInterface> | null = null
const progressListeners = new Set<(value: string) => void>()
let lastProgress = ''

export interface DiscoveryModelRequest {
  mode: 'DISCOVER' | 'ARCHITECT' | 'REVIEW_ARCHITECTURE'
  session: DiscoverySession
  forceArchitecture?: boolean
  repairInstruction?: string
}

export interface DiscoveryStreamHandlers {
  onText?: (text: string) => void
  onActivity?: (text: string) => void
  /** Told when BO had to fall back, and why. Falling back is silent otherwise, which reads as broken. */
  onNotice?: (title: string, body: string) => void
  /** Names what produced this turn: a model id, or empty for BO’s own built-in questions. */
  onSource?: (model: string) => void
}

export interface BusinessDiscoveryModel {
  generate(request: DiscoveryModelRequest, stream?: DiscoveryStreamHandlers): Promise<DiscoveryAgentResponse>
}

declare global {
  interface Window {
    __BO_DISCOVERY_MODEL_MOCK__?: (request: DiscoveryModelRequest, stream?: DiscoveryStreamHandlers) => Promise<DiscoveryAgentResponse>
  }
}

const responseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    businessState: {
      type: 'object', additionalProperties: false,
      properties: {
        companySummary: { type: 'string', maxLength: 280 }, industry: { type: 'string', maxLength: 80 },
        facts: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 160 }, status: { type: 'string', enum: ['explicit', 'inferred', 'unknown', 'irrelevant'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'string', maxLength: 180 }, basis: { type: 'string', enum: ['user', 'inference', 'research'] } }, required: ['topic', 'value', 'status', 'confidence'] } },
        businessModel: list(), productsOrServices: list(), customers: list(), revenueModel: list(), team: list(), operations: list(), resources: list(), locations: list(), currentTools: list(), painPoints: list(), goals: list(), knownEntities: list(), knownWorkflows: list(), uncertainties: list(), assumptions: list(), softwareImplications: list(),
      },
      required: ['companySummary', 'industry', 'facts', 'businessModel', 'productsOrServices', 'customers', 'revenueModel', 'team', 'operations', 'resources', 'locations', 'currentTools', 'painPoints', 'goals', 'knownEntities', 'knownWorkflows', 'uncertainties', 'assumptions', 'softwareImplications'],
    },
    decision: { type: 'string', enum: ['ASK_QUESTION', 'READY_TO_ARCHITECT'] },
    acknowledgment: { type: 'string', maxLength: 160 },
    nextQuestion: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', maxLength: 220 }, reason: { type: 'string', maxLength: 180 }, suggestedAnswers: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 70 } } }, required: ['text', 'reason', 'suggestedAnswers'] },
    architectureContext: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: 80 }, summary: { type: 'string', maxLength: 240 }, explanation: { type: 'string', maxLength: 360 },
        modules: { type: 'array', maxItems: 24, items: { type: 'string', enum: MODULES } }, startView: { type: 'string', enum: ['overview', ...MODULES] },
        capabilities: list(60), capabilityIds: { type: 'array', maxItems: 60, items: { type: 'string', enum: capabilityIds } }, excludedCapabilityIds: { type: 'array', maxItems: 60, items: { type: 'string', enum: capabilityIds } }, pages: list(60),
        entities: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 60 }, module: { type: 'string', enum: MODULES }, purpose: { type: 'string', maxLength: 140 } }, required: ['name', 'module', 'purpose'] } },
        workflows: list(40), metrics: list(30), processStages: list(14), pipelineStages: list(14), billingCadence: { type: 'string', maxLength: 100 },
      },
      required: ['title', 'summary', 'explanation', 'modules', 'startView', 'capabilities', 'capabilityIds', 'excludedCapabilityIds', 'pages', 'entities', 'workflows', 'metrics', 'processStages', 'pipelineStages', 'billingCadence'],
    },
  },
  required: ['businessState', 'decision', 'acknowledgment', 'nextQuestion', 'architectureContext'],
}

function list(maxItems = 12) { return { type: 'array', maxItems, items: { type: 'string', maxLength: 160 } } }

const discoverySystem = `You are Wesify's Business Discovery Agent. You design custom business-management software by understanding how a company actually operates.
Never follow or imitate a questionnaire. The conversation itself determines the path. After every user message, update the structured business state and make exactly one decision: ASK_QUESTION or READY_TO_ARCHITECT.
Ask exactly one question at a time, only when its answer can materially change entities, relationships, workflows, pages, metrics, permissions, billing, scheduling, inventory, assets, procurement, projects, or other initial software capabilities. Choose the unresolved decision with the highest information gain. Do not ask for facts already stated or strongly inferred. Do not ask users to select software modules. Do not give business-improvement advice.
Write questions the way a person talks: everyday words, under fifteen words, one idea, answerable in a few words from memory. "Who does the work?" not "What is your resourcing model?". Never use business-school or software vocabulary — no entities, records, workflows, pipeline, cadence, fulfilment, utilisation, SKU, CRM, ERP.
Ask plenty: ten to fourteen questions is a good interview, and more is fine while each still changes what gets built. Cover what they sell, who does the work, who they sell to, how a job runs start to finish, how and when money arrives, what they buy or keep in stock, what they schedule, who works there and who may do what, what they track today, and what goes wrong most often.
Leave suggestedAnswers empty: the operator answers in their own words, and their sentence is worth more than a pick from a list. Put your private selection rationale only in nextQuestion.reason. It is never shown. Keep acknowledgment short and factual.
Confidence: record user statements as explicit, reasonable implications as inferred, unresolved material facts as unknown, and non-material facts as irrelevant. For each fact, include concise evidence and basis when possible. Do not invent operational facts.
Stop once another question would stop changing what gets built. If the latest user asks to just build, or says they do not know, decide READY_TO_ARCHITECT immediately using stated facts and explicit assumptions.
When READY_TO_ARCHITECT, leave architectureContext empty. A dedicated architecture agent will design the Command Center next. For ASK_QUESTION, also return an empty architecture object with all required fields, including empty capabilityIds and excludedCapabilityIds.
Return only valid JSON matching the supplied schema. Never expose chain-of-thought.`

const architectureSystem = `You are Wesify's Business Application Architect. The discovery agent has finished. Translate the complete structured business state and conversation into the smallest useful custom Business Command Center.
Wesify has a hidden universal capability registry. Select capabilityIds that are required now. Put explicitly unnecessary capabilities in excludedCapabilityIds. Never expose the whole catalog to the user and never make the user choose software modules. Include a short business-facing capability label in capabilities for each selected capability. Respect dependencies but do not select adjacent features without evidence. Pages and entities must cover the selected capabilities using the company's own language.
Hidden capability registry:\n${capabilityCatalogPrompt()}
Return READY_TO_ARCHITECT and a complete architectureContext. It must include justified modules, business-facing pages, concrete business entities assigned to modules, core workflows, useful metrics, process stages where relevant, sales stages only when relevant, and billing cadence when known. Derive everything from this company and its answers. Preserve the supplied business state. nextQuestion must be empty. Return only schema-valid JSON and never expose private reasoning.`

const criticSystem = `You are Wesify's architecture critic. Review the proposed Business Command Center only against the discovered structured business state and conversation. Validate capabilityIds against the hidden catalog, move unnecessary selections to excludedCapabilityIds, add only major missing operational capabilities, preserve required dependencies, and simplify where possible. Keep pages limited to selected capabilities and use the company's language. Return READY_TO_ARCHITECT with a refined architecture. Return only schema-valid JSON. Do not expose private reasoning.`

function reportProgress(report: InitProgressReport) {
  const percent = Math.round(report.progress * 100)
  const label = percent < 100 ? `Preparing Wesify ${percent}%` : 'Wesify is ready'
  lastProgress = label
  progressListeners.forEach(listener => listener(label))
}

async function preferredModel() {
  const gpu = navigator.gpu
  const adapter = await gpu.requestAdapter()
  return adapter?.features.has('shader-f16') ? MODEL_F16 : MODEL_F32
}

function getEngine() {
  if (!('gpu' in navigator)) throw new Error('Wesify needs WebGPU for its private local AI. Open Wesify in a current version of Chrome or Edge with hardware acceleration enabled.')
  enginePromise ??= Promise.all([import('@mlc-ai/web-llm'), preferredModel()]).then(([{ CreateWebWorkerMLCEngine }, model]) => CreateWebWorkerMLCEngine(
      new Worker(new URL('./local-ai.worker.ts', import.meta.url), { type: 'module' }),
      model,
      { initProgressCallback: reportProgress },
    )).catch(error => { enginePromise = null; throw error })
  return enginePromise
}

async function withTimeout<T>(engine: MLCEngineInterface, task: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([task, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { engine.interruptGenerate(); reject(new Error('The local AI took too long. Close other GPU-heavy tabs and retry.')) }, milliseconds)
  })]).finally(() => clearTimeout(timer))
}

async function loadEngineWithTimeout() {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    getEngine(),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The local AI download stalled. Check your connection and retry.')), 180_000) }),
  ]).finally(() => clearTimeout(timer))
}

export async function prepareBusinessDiscoveryModel(onProgress?: (value: string) => void) {
  if (window.__BO_DISCOVERY_MODEL_MOCK__) return
  // A gigabyte nobody is going to use. When the server runs the interview, the browser model is only
  // ever reached if that fails, and paying for it up front is the whole reason the first minute of BO
  // used to be slow.
  if (await serverInterviewAvailable()) return
  if (onProgress) { progressListeners.add(onProgress); if (lastProgress) onProgress(lastProgress) }
  try { await loadEngineWithTimeout() }
  finally { if (onProgress) progressListeners.delete(onProgress) }
}

function conversationForModel(session: DiscoverySession) {
  return session.messages.slice(-14).map(message => ({ role: message.role, content: message.content }))
}

function partialJsonString(source: string, parent: string, key: string) {
  const parentIndex = source.indexOf(`"${parent}"`)
  if (parentIndex < 0) return ''
  const keyIndex = source.indexOf(`"${key}"`, parentIndex)
  if (keyIndex < 0) return ''
  const colon = source.indexOf(':', keyIndex)
  const quote = source.indexOf('"', colon + 1)
  if (quote < 0) return ''
  let output = ''
  let escaped = false
  for (let index = quote + 1; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) { output += char === 'n' ? '\n' : char; escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') break
    output += char
  }
  return output
}

function parseJsonContent(content: string) {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model returned incomplete structured output.')
  return JSON.parse(content.slice(start, end + 1)) as unknown
}

export async function generateLocalStructuredJson<T>({ messages, schema, maxTokens = 700, temperature = 0.1, onActivity }: { messages: ChatCompletionMessageParam[]; schema: Record<string, unknown>; maxTokens?: number; temperature?: number; onActivity?: (text: string) => void }): Promise<T> {
  if (onActivity) { progressListeners.add(onActivity); if (lastProgress) onActivity(lastProgress) }
  const engine = await loadEngineWithTimeout().finally(() => { if (onActivity) progressListeners.delete(onActivity) })
  const chunks = await engine.chat.completions.create({ messages, response_format: { type: 'json_object', schema: JSON.stringify(schema) }, temperature, max_tokens: maxTokens, stream: true })
  const content = await withTimeout(engine, (async () => {
    let value = ''
    for await (const chunk of chunks) value += chunk.choices[0]?.delta.content ?? ''
    return value
  })(), 60_000)
  return parseJsonContent(content) as T
}

function modelMessages(request: DiscoveryModelRequest): ChatCompletionMessageParam[] {
  const instruction = request.mode === 'REVIEW_ARCHITECTURE' ? criticSystem : request.mode === 'ARCHITECT' ? architectureSystem : discoverySystem
  const conversation = conversationForModel(request.session)
  const knowledgeText = [
    ...conversation.filter(message => message.role === 'user').map(message => message.content),
    request.session.businessState.companySummary,
    request.session.businessState.industry,
    ...request.session.businessState.operations,
    ...request.session.businessState.resources,
  ].join(' ')
  const operatingKnowledge = evaluateOperatingKnowledge(knowledgeText, request.session.architecture?.capabilityIds ?? [])
  const context = {
    mode: request.mode,
    forceArchitecture: Boolean(request.forceArchitecture),
    businessState: request.session.businessState,
    conversation,
    priorQuestions: request.session.messages.filter(message => message.role === 'assistant' && message.content.includes('?')).map(message => message.content),
    unresolvedOperatingKnowledge: knowledgeRequirementsFor(knowledgeText, request.session.architecture?.capabilityIds ?? []),
    businessGapCandidates: operatingKnowledge.gaps,
    proposedArchitecture: request.mode === 'REVIEW_ARCHITECTURE' ? request.session.architecture : undefined,
    repairInstruction: request.repairInstruction || undefined,
  }
  return [{ role: 'system', content: instruction }, { role: 'user', content: `Analyze this complete discovery context. JSON only.\n${JSON.stringify(context)}` }]
}

function schemaForMode(mode: DiscoveryModelRequest['mode']) {
  const schema = JSON.parse(JSON.stringify(responseSchema)) as {
    properties: {
      decision: { enum: string[] }
      nextQuestion: { properties: { text: Record<string, unknown> } }
      architectureContext: { properties: { modules: Record<string, unknown>; capabilityIds: Record<string, unknown>; pages: Record<string, unknown>; entities: Record<string, unknown> } }
    }
  }
  if (mode !== 'DISCOVER') {
    schema.properties.decision.enum = ['READY_TO_ARCHITECT']
    schema.properties.architectureContext.properties.modules.minItems = 1
    schema.properties.architectureContext.properties.capabilityIds.minItems = 1
    schema.properties.architectureContext.properties.pages.minItems = 2
    schema.properties.architectureContext.properties.entities.minItems = 1
  }
  return schema
}

function fallbackArchitecture(state: BusinessState): ArchitectureContext {
  const initial = emptyArchitecture()
  const plan = planCapabilities(state, initial)
  const selected = plan.selected
  const modules = [...new Set(selected.map(item => item.module))]
  const pages = [...new Set(['Dashboard', ...selected.flatMap(item => item.pages.map(page => page.label))])]
  const entities = selected.flatMap(item => item.entities.map(entity => ({ name: entity.pluralLabel, module: item.module, purpose: `${item.label}: ${item.description}` })))
    .filter((entity, index, collection) => collection.findIndex(candidate => candidate.name === entity.name) === index)
    .slice(0, 60)
  const capabilities = selected.map(item => item.label)
  const industry = state.industry || 'Business'
  const operation = state.operations.slice(0, 3).join(', ') || state.knownWorkflows.slice(0, 2).join(', ') || 'the core operating flow'
  const revenue = state.revenueModel.join(', ') || 'the confirmed billing process'
  const conclusions = plan.research.findings.slice(0, 3).map(finding => finding.conclusion.replace(/^This company /, '').replace(/^The company /, ''))
  return {
    title: `${industry} Command Center`,
    summary: `Run ${operation} and ${revenue} from one connected workspace.`,
    explanation: `${conclusions.length ? `Wesify concluded this company ${conclusions.join('; ')}. ` : ''}That points to ${capabilities.slice(0, 6).join(', ')}${capabilities.length > 6 ? ', and the operating controls they depend on' : ''}. Capabilities without evidence in what you described stay hidden.`,
    modules,
    startView: modules.includes('projects') ? 'projects' : modules.includes('sales') ? 'sales' : modules[0] ?? 'overview',
    capabilities,
    capabilityIds: selected.map(item => item.id),
    excludedCapabilityIds: plan.excluded,
    pages,
    entities,
    workflows: [...new Set(selected.flatMap(item => (item.workflows ?? []).map(workflow => workflow.name)))].slice(0, 40),
    metrics: [...new Set(selected.flatMap(item => (item.metrics ?? []).map(metric => metric.label)))].slice(0, 30),
    processStages: state.operations.length ? state.operations.slice(0, 14) : ['New', 'Planned', 'In progress', 'Complete'],
    pipelineStages: selected.some(item => item.id === 'crm.pipeline') ? ['New', 'Qualified', 'Proposal', 'Won', 'Lost'] : [],
    billingCadence: state.revenueModel.join(', '),
  }
}

export function resilientArchitecture(state: BusinessState, proposed?: ArchitectureContext | null) {
  return proposed && hasUsableArchitecture(proposed) ? proposed : fallbackArchitecture(state)
}

function fallbackArchitectureResponse(request: DiscoveryModelRequest): DiscoveryAgentResponse {
  const architectureContext = resilientArchitecture(request.session.businessState, request.session.architecture)
  return {
    businessState: request.session.businessState,
    decision: 'READY_TO_ARCHITECT',
    acknowledgment: 'I have enough operational detail to assemble the first Command Center.',
    nextQuestion: { text: '', reason: '', suggestedAnswers: [] },
    architectureContext,
  }
}

/** Everything the company has said, plus everything BO has already asked, in one research corpus. */
function researchInput(session: DiscoverySession, state: BusinessState = session.businessState) {
  const spoken = session.messages.filter(message => message.role === 'user').map(message => message.content)
  const text = [
    ...spoken, state.companySummary, state.industry,
    ...state.businessModel, ...state.productsOrServices, ...state.customers, ...state.revenueModel, ...state.team,
    ...state.operations, ...state.resources, ...state.locations, ...state.goals, ...state.knownEntities, ...state.knownWorkflows,
    ...state.facts.filter(fact => fact.status === 'explicit' || fact.status === 'inferred').map(fact => `${fact.topic}: ${fact.value}`),
  ].filter(Boolean).join('. ')
  const asked = session.messages.filter(message => message.role === 'assistant' && message.content.includes('?')).map(message => message.content)
  return { text, asked }
}

/** The operating model BO has established so far, with the evidence behind each conclusion. */
export function researchSession(session: DiscoverySession, state: BusinessState = session.businessState): BusinessResearch {
  return researchBusiness(researchInput(session, state))
}

/**
 * The interview ends, whatever the model thinks.
 *
 * BO asked questions forever. Two things had to be true at once for that, and both were: the model
 * is never told how long it has been going, so it weighs one more question against nothing and one
 * more question always wins; and BO pushes back whenever the model tries to finish before the
 * readiness heuristic is satisfied. Neither has a counter, so between them the interview had no end
 * that did not depend on the operator giving up or typing "just build it".
 *
 * Fourteen is the top of the range BO's own prompt already calls a good interview, so this is a
 * ceiling on what was intended rather than a new limit. Reaching it is the same as the operator
 * asking to stop: the architect is told to build from what it has and write down the rest as
 * assumptions, which is what it does for "just build it" today. The server prompt counts down to the
 * same number so the model normally arrives here on its own — this is what happens when it does not.
 */
export const MAX_INTERVIEW_QUESTIONS = 14

export function interviewIsOver(session: DiscoverySession) {
  return session.metrics.questionsAsked >= MAX_INTERVIEW_QUESTIONS
}

/** Past the ceiling, a discovery turn is a request to finish — the same one "just build it" makes. */
function withInterviewCeiling(request: DiscoveryModelRequest): DiscoveryModelRequest {
  if (request.mode !== 'DISCOVER' || request.forceArchitecture || !interviewIsOver(request.session)) return request
  return { ...request, forceArchitecture: true }
}

export interface DiscoveryReadiness {
  ready: boolean
  coverage: number
  unresolvedCritical: Array<{ id: string; objective: string }>
}

/** A model may end the interview only after the operating flow and revenue path are resolved. */
export function assessDiscoveryReadiness(session: DiscoverySession, state: BusinessState = session.businessState): DiscoveryReadiness {
  const research = researchSession(session, state)
  const unresolvedCritical = research.knowledgeRequirements
    .filter(item => item.priority === 'critical')
    .map(item => ({ id: item.id, objective: item.objective }))
  return { ready: unresolvedCritical.length === 0 && research.coverage >= 0.35, coverage: research.coverage, unresolvedCritical }
}

async function generateOnce(request: DiscoveryModelRequest, stream: DiscoveryStreamHandlers = {}) {
  if (window.__BO_DISCOVERY_MODEL_MOCK__) return window.__BO_DISCOVERY_MODEL_MOCK__(request, stream)
  stream.onActivity?.(request.mode === 'REVIEW_ARCHITECTURE' ? 'Reviewing the Command Center' : request.mode === 'ARCHITECT' ? 'Designing your Command Center' : 'Understanding your business')
  if (stream.onActivity) progressListeners.add(stream.onActivity)
  const engine = await loadEngineWithTimeout().finally(() => { if (stream.onActivity) progressListeners.delete(stream.onActivity) })
  const chunks = await engine.chat.completions.create({
    messages: modelMessages(request),
    response_format: { type: 'json_object', schema: JSON.stringify(schemaForMode(request.mode)) },
    temperature: request.mode === 'DISCOVER' ? 0.25 : 0.1,
    max_tokens: request.mode === 'DISCOVER' ? 760 : 1900,
    stream: true,
  })
  const content = await withTimeout(engine, (async () => {
    let value = ''
    let visible = ''
    for await (const chunk of chunks) {
      value += chunk.choices[0]?.delta.content ?? ''
      const nextVisible = partialJsonString(value, 'nextQuestion', 'text') || partialJsonString(value, 'architectureContext', 'summary')
      if (nextVisible && nextVisible !== visible) { visible = nextVisible; stream.onText?.(visible) }
    }
    return value
  })(), 75_000)
  return parseDiscoveryResponse(parseJsonContent(content))
}

export class LocalBusinessDiscoveryModel implements BusinessDiscoveryModel {
  async generate(input: DiscoveryModelRequest, stream: DiscoveryStreamHandlers = {}): Promise<DiscoveryAgentResponse> {
    const request = withInterviewCeiling(input)
    let repairInstruction = request.repairInstruction ?? ''
    let lastError: unknown
    /**
     * The last turn rejected only for finishing early, kept rather than thrown away.
     *
     * BO pushes back on an interview that ends before the critical operating decisions are settled —
     * that is the point of the readiness check. What it must not do is push back forever: readiness
     * is a heuristic scored over the conversation, and the model has read that same conversation. If
     * it says twice that it has what it needs, the honest move is to defer, because the alternative
     * is an interview that can never end and an operator staring at "retry" on a question BO will
     * refuse to accept an answer to.
     */
    let heldBack: DiscoveryAgentResponse | null = null
    const maxAttempts = request.mode === 'DISCOVER' ? 2 : 3
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await generateOnce({ ...request, repairInstruction }, stream)
        // Unless BO was asked what it meant, in which case asking again is the whole point.
        if (request.mode === 'DISCOVER' && result.decision === 'ASK_QUESTION' && !awaitingClarification(request.session) && isDuplicateQuestion(result.nextQuestion.text, request.session)) {
          throw new Error('The proposed question repeats information already resolved.')
        }
        if (request.mode === 'DISCOVER' && result.decision === 'READY_TO_ARCHITECT' && !request.forceArchitecture) {
          const readiness = assessDiscoveryReadiness(request.session, result.businessState)
          if (!readiness.ready) {
            heldBack = result
            throw new Error(`The interview ended before these critical operating decisions were resolved: ${readiness.unresolvedCritical.map(item => item.objective).join('; ') || `operating-model coverage is ${Math.round(readiness.coverage * 100)}%`}. Ask one natural high-value question instead.`)
          }
        }
        if (request.mode !== 'DISCOVER' && !hasUsableArchitecture(result.architectureContext)) throw new Error('The architecture is incomplete.')
        console.info('[BO discovery]', { workspaceId: request.session.workspaceId, turn: request.session.metrics.discoveryTurns + 1, decision: result.decision, question: result.decision === 'ASK_QUESTION' ? result.nextQuestion.text : undefined, stateFacts: result.businessState.facts.length, architecturePages: result.architectureContext.pages.length })
        return result
      } catch (error) {
        lastError = error
        repairInstruction = `Your previous response was invalid: ${error instanceof Error ? error.message : 'schema failure'}. Preserve the business facts, return every required field, and choose a different non-duplicate question if asking.`
        stream.onActivity?.('Checking the response')
      }
    }
    if (request.mode !== 'DISCOVER') {
      stream.onActivity?.('Completing the operating architecture')
      return fallbackArchitectureResponse(request)
    }
    // Asked again and told the same thing: the model keeps its answer. See `heldBack` above.
    if (heldBack) return heldBack
    /**
     * No question unless a model wrote it.
     *
     * BO used to answer a failed turn with the next unresolved item from a hand-written list — which
     * is how somebody who had just written "we sell Uruguayan and Argentinian products to Spain" got
     * asked what their company sells. A canned question is not a cheaper version of the interview; it
     * is a different product, and a worse one, wearing the same screen. Failing here is honest, the
     * error carries a Retry, and nothing about the conversation is lost.
     */
    throw lastError instanceof Error
      ? lastError
      : new Error('Wesify could not reach a model to write the next question. Nothing was lost — retry, or set a free GEMINI_API_KEY if this keeps happening.')
  }
}

/**
 * The interview BO actually runs.
 *
 * Server first when a frontier model is configured: it answers in seconds, works in every browser,
 * and asks about the company instead of asking the company to define itself. The browser model is
 * the fallback, and it is a real one — BO stays usable with no key, no network and no WebGPU, only
 * with blunter questions.
 */
/**
 * Says out loud that the server turn was dropped, and what BO is doing instead.
 *
 * The fallback chain is deliberate and must stay silent in the sense of never stopping — but the
 * operator still deserves to know, because the two paths ask visibly different questions. Without
 * this, a spent free-tier quota looks exactly like BO having got worse at its job.
 */
function notice(stream: DiscoveryStreamHandlers, turn: DiscoveryAgentResponse | null) {
  const issue = lastInterviewIssue()
  if (turn && !issue) return
  stream.onNotice?.(
    'Falling back to Wesify’s built-in questions',
    `${issue || 'The interview model kept repeating a question Wesify had already asked.'} Wesify is continuing with its own reasoning, so the questions are blunter until the model is reachable again.`,
  )
}

class ServerFirstDiscoveryModel implements BusinessDiscoveryModel {
  private readonly local = new LocalBusinessDiscoveryModel()

  async generate(input: DiscoveryModelRequest, stream: DiscoveryStreamHandlers = {}): Promise<DiscoveryAgentResponse> {
    const request = withInterviewCeiling(input)
    // A mock stands in for the model, not for the pipeline around it: it falls through to the local
    // path so the repair loop and the question BO insists on asking still apply to it.
    if (!window.__BO_DISCOVERY_MODEL_MOCK__ && await serverInterviewAvailable()) {
      /**
       * The critic pass is skipped on this path, and it costs nothing to skip.
       *
       * It was written for the 0.5B model in the browser, where a second opinion genuinely repaired
       * bad output. On the server there is no separate critic prompt: `runDiscoveryTurn` treats every
       * non-DISCOVER turn as an architecture turn, so this re-ran the *identical* architect prompt
       * over the same inputs and waited another seven seconds to be told roughly the same thing.
       * That was half of the wait at the end of an interview, spent re-deriving an answer BO had.
       */
      if (request.mode === 'REVIEW_ARCHITECTURE') {
        return {
          businessState: request.session.businessState,
          decision: 'READY_TO_ARCHITECT',
          acknowledgment: '',
          nextQuestion: { text: '', reason: '', suggestedAnswers: [] },
          architectureContext: request.session.architecture ?? emptyArchitecture(),
        }
      }
      stream.onActivity?.(request.mode === 'DISCOVER' ? 'Understanding your business' : 'Designing your Command Center')
      /**
       * A repeat is asked again, not given up on.
       *
       * A duplicate question is worse than a blunt one: it tells the operator BO was not listening.
       * But dropping to the local path over one is worse still — the fallback is a fixed question
       * bank, so BO answers a repeated question by asking the same repeated question forever. The
       * second attempt is told what went wrong, and only then does the browser model take over.
       */
      // A repeat is a fault unless BO was asked to repeat itself, which is what a question back is.
      const repeats = (turn: DiscoveryAgentResponse | null) => Boolean(turn && request.mode === 'DISCOVER' && turn.decision === 'ASK_QUESTION' && !awaitingClarification(request.session) && isDuplicateQuestion(turn.nextQuestion.text, request.session))
      const premature = (turn: DiscoveryAgentResponse | null) => Boolean(turn && request.mode === 'DISCOVER' && turn.decision === 'READY_TO_ARCHITECT' && !request.forceArchitecture && !assessDiscoveryReadiness(request.session, turn.businessState).ready)
      const usable = (turn: DiscoveryAgentResponse | null) => Boolean(turn && !repeats(turn) && !premature(turn) && (request.mode === 'DISCOVER' || hasUsableArchitecture(turn.architectureContext)))

      const first = await requestDiscoveryTurn(request, request.session.businessState.industry)
      if (usable(first)) { stream.onSource?.(lastInterviewModel()); return first as DiscoveryAgentResponse }
      if (repeats(first)) {
        stream.onActivity?.('Checking Wesify has not already asked this')
        const second = await requestDiscoveryTurn(
          { ...request, session: { ...request.session, businessState: first?.businessState ?? request.session.businessState } },
          request.session.businessState.industry,
          `You just proposed "${first?.nextQuestion.text}", which repeats something already asked or already answered. Ask about a different part of how this company runs, or decide READY_TO_ARCHITECT if nothing left to ask would change what gets built.`,
        )
        if (usable(second)) { stream.onSource?.(lastInterviewModel()); return second as DiscoveryAgentResponse }
      }
      if (premature(first)) {
        stream.onActivity?.('Checking the operating model is complete')
        const readiness = assessDiscoveryReadiness(request.session, first?.businessState ?? request.session.businessState)
        const second = await requestDiscoveryTurn(
          { ...request, session: { ...request.session, businessState: first?.businessState ?? request.session.businessState } },
          request.session.businessState.industry,
          `You tried to finish before the operating model was ready. Unresolved critical objectives: ${readiness.unresolvedCritical.map(item => item.objective).join('; ') || `coverage is ${Math.round(readiness.coverage * 100)}%`}. Ask one short natural question that resolves the highest-value objective. Do not return READY_TO_ARCHITECT yet.`,
        )
        if (usable(second)) { stream.onSource?.(lastInterviewModel()); return second as DiscoveryAgentResponse }
        /**
         * Pushed back once; now deferred to.
         *
         * Readiness is BO's own score over the conversation, and the model has read that same
         * conversation. Insisting past this point does not produce a better interview — it produces
         * one that cannot end, because the next turn disagrees exactly as this one did, and the
         * operator is left retrying a question BO will not accept an answer to.
         */
        const settled = second ?? first
        if (settled && !repeats(settled)) { stream.onSource?.(lastInterviewModel()); return settled }
      }
      notice(stream, first)
      stream.onSource?.('')
      /**
       * The interview stops rather than being faked.
       *
       * Not the browser model either: it is a gigabyte that has never been downloaded on this machine
       * — the server path exists precisely so it is not — and starting that download under someone
       * waiting on a question means minutes of progress bar. The architecture pass still has a
       * structural fallback, because it is assembled from capabilities the operator's own answers
       * selected; a question has no such honest substitute.
       */
      if (request.mode !== 'DISCOVER') return fallbackArchitectureResponse(request)
      throw new Error(`${lastInterviewIssue() || 'The interview model could not be reached.'} Retry when you are ready — your answers are saved.`)
    } else if (!window.__BO_DISCOVERY_MODEL_MOCK__) {
      stream.onNotice?.(
        'Running the interview in your browser',
        'The server has no model key, so Wesify is loading its own small model into this browser — private and free, but a large first download and blunter questions. Set GEMINI_API_KEY — free, from aistudio.google.com/apikey — and restart the server for the fast path: the check runs once when the page loads.',
      )
      stream.onSource?.('Wesify’s in-browser model')
    }
    return this.local.generate(request, stream)
  }
}

export const businessDiscoveryModel: BusinessDiscoveryModel = new ServerFirstDiscoveryModel()

export function architecturePlaceholder() { return emptyArchitecture() }
