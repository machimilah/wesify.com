import { describe, expect, it } from 'vitest'

// These suites run in Node. BO reaches for the mock through `window`, so there has to be one.
if (typeof window === 'undefined') (globalThis as unknown as { window: unknown }).window = globalThis
import { applyAgentResponse, createDiscoverySession, emptyArchitecture, type DiscoveryAgentResponse, type DiscoverySession } from './businessDiscovery'
import { MAX_INTERVIEW_QUESTIONS, businessDiscoveryModel, type DiscoveryModelRequest } from './discoveryModel'

/**
 * The interview reaches a workspace.
 *
 * This is the failure as an operator met it: BO asked questions and went on asking them, and the
 * only way out was to type "just build it" or close the tab. It needs two things to happen at once,
 * and both were true. A model reading a transcript has no sense of how long it has been going, so it
 * weighs one more question against nothing; and BO pushed back every time the model did try to
 * finish, because a keyword-scored readiness heuristic said the operating model was not settled yet.
 * Neither side counted, so nothing ended the loop.
 *
 * The model here is the worst case rather than a typical one: it never volunteers to stop. If the
 * interview terminates against a model that will not stop on its own, it terminates.
 */

/**
 * A model that never runs out of new things to ask.
 *
 * The words are nonsense on purpose. BO refuses a question that overlaps one it already asked, and
 * a mock working from a fixed list of topics eventually trips that instead — which would fail this
 * test for the wrong reason and hide whether the interview actually ends.
 */
const question = (index: number) => `Tell me about subject${index}, matter${index} and detail${index}?`

function neverStops(request: DiscoveryModelRequest): DiscoveryAgentResponse {
  const asked = request.session.metrics.questionsAsked
  const finish = request.forceArchitecture === true
  return {
    businessState: { ...request.session.businessState, companySummary: 'A wholesaler' },
    decision: finish ? 'READY_TO_ARCHITECT' : 'ASK_QUESTION',
    acknowledgment: 'Understood.',
    nextQuestion: finish
      ? { text: '', reason: '', suggestedAnswers: [] }
      : { text: question(asked), reason: 'Shapes the build.', suggestedAnswers: [] },
    architectureContext: finish ? { ...emptyArchitecture(), summary: 'Built from what was answered.' } : emptyArchitecture(),
  }
}

describe('the interview ends', () => {
  it('stops asking and builds, against a model that would ask forever', async () => {
    (window as unknown as { __BO_DISCOVERY_MODEL_MOCK__?: unknown }).__BO_DISCOVERY_MODEL_MOCK__ = neverStops

    let session: DiscoverySession = createDiscoverySession('ceiling', 'We import food from Uruguay and sell it to shops in Spain.')
    let turns = 0
    // Generous enough that a real ceiling passes and an absent one still terminates the test.
    const patience = MAX_INTERVIEW_QUESTIONS * 3

    while (session.phase === 'DISCOVERING' && turns < patience) {
      turns += 1
      const response = await businessDiscoveryModel.generate({ mode: 'DISCOVER', session })
      session = applyAgentResponse(session, response)
      if (session.phase === 'DISCOVERING' && session.currentQuestion) {
        session = {
          ...session,
          currentQuestion: null,
          messages: [...session.messages, { id: `a${turns}`, role: 'user', content: 'We handle that ourselves, in a spreadsheet.', createdAt: new Date().toISOString() }],
        }
      }
    }

    delete (window as unknown as { __BO_DISCOVERY_MODEL_MOCK__?: unknown }).__BO_DISCOVERY_MODEL_MOCK__

    expect(session.phase, `BO was still asking after ${turns} turns and ${session.metrics.questionsAsked} questions`).not.toBe('DISCOVERING')
    expect(session.metrics.questionsAsked).toBeLessThanOrEqual(MAX_INTERVIEW_QUESTIONS)
    // An interview that ends by asking nothing is the opposite failure and just as bad a product.
    expect(session.metrics.questionsAsked).toBeGreaterThan(5)
  })
})
