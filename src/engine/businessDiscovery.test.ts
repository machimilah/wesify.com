import { describe, expect, it } from 'vitest'
import {
  applyAgentResponse,
  createDiscoverySession,
  emptyArchitecture,
  isDuplicateQuestion,
  parseDiscoveryResponse,
  type BusinessState,
} from './businessDiscovery'
import { LocalBusinessDiscoveryModel, resilientArchitecture } from './discoveryModel'

const state: BusinessState = {
  companySummary: 'A construction company renovating offices', industry: 'Construction',
  facts: [{ topic: 'billing', value: 'Customers pay in progress stages', status: 'explicit', confidence: 1 }],
  businessModel: ['Project-based services'], productsOrServices: ['Office renovations'], customers: ['Commercial clients'],
  revenueModel: ['Progress invoices'], team: ['18 employees'], operations: ['Concurrent renovation projects'], resources: ['Materials', 'Subcontractors'], locations: [], currentTools: [], painPoints: ['Project visibility'], goals: ['Control project costs'], knownEntities: ['Clients', 'Projects', 'Materials'], knownWorkflows: ['Quote to project to staged invoice'], uncertainties: ['How materials are stocked'], assumptions: [], softwareImplications: ['Project costing', 'Procurement'],
}

describe('AI business discovery contract', () => {
  it('completes a usable architecture from confirmed facts when model architecture is incomplete', () => {
    const architecture = resilientArchitecture(state, emptyArchitecture())
    expect(architecture.title).toContain('Construction')
    expect(architecture.capabilityIds).toEqual(expect.arrayContaining(['work.projects', 'vertical.construction-controls', 'finance.invoicing']))
    expect(architecture.pages.length).toBeGreaterThan(3)
    expect(architecture.entities.length).toBeGreaterThan(3)
  })

  it('accepts a contextual model question and commits it atomically', () => {
    const session = createDiscoverySession('workspace-1234', 'I run a construction company.')
    const response = parseDiscoveryResponse({
      businessState: state, decision: 'ASK_QUESTION', acknowledgment: 'Understood.',
      nextQuestion: { text: 'Do you keep common materials in stock, or buy them for each project?', reason: 'This determines inventory and purchasing.', suggestedAnswers: ['Keep stock', 'Buy per project', 'A mix'] },
      architectureContext: emptyArchitecture(),
    })
    const next = applyAgentResponse(session, response)
    expect(next.phase).toBe('DISCOVERING')
    expect(next.currentQuestion?.text).toContain('materials')
    expect(next.businessState.knownEntities).toContain('Projects')
    expect(next.metrics.questionsAsked).toBe(1)
  })

  it('lets the model stop without a fixed question count', () => {
    const session = createDiscoverySession('workspace-1234', 'A complete company description')
    const architecture = { ...emptyArchitecture(), title: 'Construction Command Center', summary: 'Run jobs and costs.', explanation: 'Projects connect clients, materials, work, costs and invoices.', modules: ['customers', 'projects', 'finance', 'inventory'] as const, startView: 'projects' as const, pages: ['Dashboard', 'Clients', 'Projects', 'Materials', 'Invoices'], capabilities: ['Project costing'], entities: [{ name: 'Projects', module: 'projects' as const, purpose: 'Manage delivery' }], workflows: ['Project to staged invoice'], metrics: ['Project margin'] }
    const response = parseDiscoveryResponse({ businessState: state, decision: 'READY_TO_ARCHITECT', acknowledgment: 'I have a good picture of the operation.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext: architecture })
    const next = applyAgentResponse(session, response)
    expect(next.phase).toBe('AWAITING_APPROVAL')
    expect(next.metrics.questionsAsked).toBe(0)
    expect(next.architecture?.pages).toContain('Materials')
  })

  it('accepts a ready discovery decision before the dedicated architecture pass', () => {
    const response = parseDiscoveryResponse({ businessState: state, decision: 'READY_TO_ARCHITECT', acknowledgment: 'Ready to design.', nextQuestion: { text: '', reason: '', suggestedAnswers: [] }, architectureContext: emptyArchitecture() })
    expect(response.decision).toBe('READY_TO_ARCHITECT')
    expect(response.architectureContext.pages).toEqual([])
  })

  it('rejects malformed model output and detects resolved duplicate questions', () => {
    expect(() => parseDiscoveryResponse({ decision: 'ASK_QUESTION' })).toThrow('Invalid business state')
    const base = createDiscoverySession('workspace-1234', 'Clients pay us monthly.')
    const withFact = { ...base, businessState: { ...base.businessState, facts: [{ topic: 'client payment cadence', value: 'Clients pay monthly', status: 'explicit' as const, confidence: 1 }] } }
    expect(isDuplicateQuestion('How do clients normally pay you each month?', withFact)).toBe(true)
  })

  it('continues with the highest-information research question when local AI is unavailable', async () => {
    const session = createDiscoverySession('workspace-1234', 'I run a marketing agency.')
    const response = await new LocalBusinessDiscoveryModel().generate({ session, mode: 'DISCOVER' })
    expect(response.decision).toBe('ASK_QUESTION')
    // The question is chosen by unresolved capability decisions, not by a fixed script, so it must
    // be one of the dimensions BO still cannot infer for an agency, with contextual answers offered.
    expect(response.nextQuestion.text).toMatch(/handles the work|customers normally pay|buys from or is served|buy materials/i)
    expect(response.nextQuestion.reason).toMatch(/decides \d+ capability choices/)
    expect(response.nextQuestion.suggestedAnswers.length).toBeGreaterThan(1)
    expect(response.acknowledgment).toContain('without the local AI model')
  })
})
