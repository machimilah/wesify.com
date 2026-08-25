import { describe, expect, it } from 'vitest'
if (typeof window === 'undefined') (globalThis as unknown as { window: unknown }).window = globalThis
import { applyAgentResponse, asksForClarification, createDiscoverySession, emptyArchitecture, isDuplicateQuestion, type DiscoveryAgentResponse, type DiscoverySession } from './businessDiscovery'
import { businessDiscoveryModel, type DiscoveryModelRequest } from './discoveryModel'

/**
 * Saying "what do you mean?" gets an answer, not a different question.
 *
 * Every message the operator sent was read as an answer, which is what a form does and not what a
 * conversation does. Somebody who said plainly that they did not understand got no reply and a new
 * subject, because the question Wesify wanted to repeat is by definition a duplicate of the one it had
 * just asked — so the guard that stops Wesify asking the same thing twice also stopped it ever asking
 * again in plainer words.
 */

const question = 'Do you hold stock in a warehouse, or ship straight from the supplier?'
// A real re-ask stays close to the original — which is precisely what the duplicate guard blocked.
const plainer = 'Do you keep stock in a warehouse, or does it ship straight from the supplier?'

const asked = (session: DiscoverySession) => session.messages.filter(message => message.role === 'assistant' && message.content.includes('?'))

function sessionAfterConfusion(said: string): DiscoverySession {
  const base = createDiscoverySession('clarify', 'We import food from Uruguay and sell it to shops in Spain.')
  return {
    ...base,
    messages: [
      ...base.messages,
      { id: 'q1', role: 'assistant', content: question, createdAt: new Date().toISOString() },
      { id: 'a1', role: 'user', content: said, createdAt: new Date().toISOString() },
    ],
    metrics: { ...base.metrics, questionsAsked: 1 },
  }
}

describe('asking Wesify a question back', () => {
  it('tells an answer from a question back', () => {
    for (const said of ['What do you mean?', 'I do not understand', "I don't understand that", 'Can you explain?', 'Why do you need that?', 'what do you mean by warehouse']) {
      expect(asksForClarification(said), `"${said}" should read as a question back`).toBe(true)
    }
    // An answer is still an answer, even an uncertain one that ends in a question mark.
    for (const said of ['We keep everything in a warehouse in Madrid and ship from there ourselves', 'About two hundred products, I think?', 'Yes', 'No, straight from the supplier']) {
      expect(asksForClarification(said), `"${said}" should read as an answer`).toBe(false)
    }
  })

  it('lets Wesify ask the same thing again in easier words', async () => {
    const session = sessionAfterConfusion('What do you mean?')
    // The premise: the re-ask is a duplicate, which is exactly why Wesify used to be unable to send it.
    expect(isDuplicateQuestion(plainer, session)).toBe(true)

    const mock = (request: DiscoveryModelRequest): DiscoveryAgentResponse => ({
      businessState: { ...request.session.businessState, companySummary: 'An importer' },
      decision: 'ASK_QUESTION',
      acknowledgment: 'Sorry — I mean whether the food sits in a place you rent before a shop gets it.',
      nextQuestion: { text: plainer, reason: 'Decides whether stock is tracked.', suggestedAnswers: [] },
      architectureContext: emptyArchitecture(),
    })
    ;(window as unknown as { __BO_DISCOVERY_MODEL_MOCK__?: unknown }).__BO_DISCOVERY_MODEL_MOCK__ = mock
    const response = await businessDiscoveryModel.generate({ mode: 'DISCOVER', session })
    delete (window as unknown as { __BO_DISCOVERY_MODEL_MOCK__?: unknown }).__BO_DISCOVERY_MODEL_MOCK__

    expect(response.decision).toBe('ASK_QUESTION')
    expect(response.nextQuestion.text).toBe(plainer)

    const next = applyAgentResponse(session, response)
    // They are told what Wesify meant, in the same turn as the question.
    expect(asked(next).at(-1)?.content).toContain('Sorry')
    expect(asked(next).at(-1)?.content).toContain(plainer)
    // And a misunderstanding does not spend one of the questions the interview is allowed.
    expect(next.metrics.questionsAsked).toBe(session.metrics.questionsAsked)
  })

  it('still refuses to repeat itself when it was answered', async () => {
    const base = createDiscoverySession('repeat', 'We import food from Uruguay and sell it to shops in Spain.')
    const session: DiscoverySession = {
      ...base,
      messages: [
        ...base.messages,
        { id: 'q1', role: 'assistant', content: question, createdAt: new Date().toISOString() },
        { id: 'a1', role: 'user', content: 'We keep everything in a warehouse in Madrid and ship from there ourselves', createdAt: new Date().toISOString() },
      ],
      metrics: { ...base.metrics, questionsAsked: 1 },
    }
    const mock = (request: DiscoveryModelRequest): DiscoveryAgentResponse => ({
      businessState: request.session.businessState,
      decision: 'ASK_QUESTION',
      acknowledgment: 'Understood.',
      nextQuestion: { text: question, reason: 'Asking again.', suggestedAnswers: [] },
      architectureContext: emptyArchitecture(),
    })
    ;(window as unknown as { __BO_DISCOVERY_MODEL_MOCK__?: unknown }).__BO_DISCOVERY_MODEL_MOCK__ = mock
    await expect(businessDiscoveryModel.generate({ mode: 'DISCOVER', session })).rejects.toThrow()
    delete (window as unknown as { __BO_DISCOVERY_MODEL_MOCK__?: unknown }).__BO_DISCOVERY_MODEL_MOCK__
  })
})
