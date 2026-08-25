import './noSpend.mjs'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

/**
 * A bad minute on the free tier costs a bounded wait, not the sum of every model in the cascade.
 *
 * This is the failure as it reached an operator: "The interview model answered 504.
 * gemini-3-flash-preview did not answer within 9s." Two things are wrong with that sentence and
 * neither is the model it names. They had waited far longer than nine seconds — every model in the
 * cascade had been given its own nine before that one was reached — and the model blamed is the last
 * and least capable in the list, one they never chose and have no reason to recognise. The wait was
 * the failure; the message made it look like an obscure model being broken.
 *
 * So: the deadline for one model is capped by what is left of a budget for the whole cascade, and
 * running out of budget is reported as what it is.
 */

const port = 8961
let requests = 0

// A server that accepts the connection and then never answers, which is what a saturated free tier
// looks like from the client — not a refusal, just silence.
const stalled = createServer(() => { requests += 1 })
await new Promise(resolve => stalled.listen(port, '127.0.0.1', resolve))

process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`
process.env.GEMINI_API_KEY = 'gemini-mock-key'

const { runGeminiJson } = await import('../server/gemini.mjs')

const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] }

try {
  const timeoutMs = 700
  const budgetMs = 1800
  const startedAt = Date.now()
  let failure
  try {
    await runGeminiJson({ system: 'You answer in JSON.', prompt: 'Anything.', schema, timeoutMs, budgetMs })
    assert.fail('A server that never answers must not look like a successful turn.')
  } catch (error) {
    failure = error
  }
  const elapsed = Date.now() - startedAt

  // The whole point: five models at the per-model deadline would be 3500ms, and the budget is 1800.
  assert.ok(elapsed < budgetMs + 900, `BO spent ${elapsed}ms against a ${budgetMs}ms budget, so the cascade is still unbounded.`)
  assert.ok(elapsed >= timeoutMs, `BO gave up after ${elapsed}ms without giving even one model its deadline.`)

  // More than one model was tried, so the operator is told that rather than being handed the name of
  // whichever one happened to be last.
  assert.ok(requests > 1, 'Only one model was tried, so this proves nothing about the cascade.')
  assert.match(failure.message, /No free model answered/, `The failure still blames a single model: ${failure.message}`)
  assert.match(failure.message, /BO tried .+,/, `The failure does not say what was tried: ${failure.message}`)
  assert.equal(failure.status, 504)

  console.log(`Gemini budget test passed: a free tier that never answers costs ${elapsed}ms against a ${budgetMs}ms budget rather than the whole cascade, and the operator is told no model answered and which ones were tried, instead of the name of the last one in the list.`)
} finally {
  stalled.close()
  stalled.closeAllConnections?.()
}
