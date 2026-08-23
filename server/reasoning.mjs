import { MODEL, conversationText, citedSources, refusal, reasoningAvailable, textOf, wireSchema, withFallbacks } from './anthropic.mjs'

/**
 * BO's frontier researcher.
 *
 * The local research engine reasons over an operating-model ontology and never leaves the browser.
 * This module is the upgrade path: a real model that searches the open web for how this kind of
 * company actually operates, then compiles what it learned into the same evidence-carrying shape the
 * rest of BO already consumes. It runs server-side so the API key never reaches a browser.
 *
 * Two passes on purpose. The first pass researches and is allowed to be discursive; the second pass
 * compiles that brief into strict JSON with no tools. A single prompt that researches, decides, and
 * emits schema-valid output at the same time does all three worse.
 *
 * The model client, the paused-loop resume, the beta fallback and refusal handling are shared with
 * the interview consultant and live in anthropic.mjs.
 */

export { reasoningAvailable }

const researchSystem = `You are BO's business researcher. BO builds a custom Business Command Center for one company, and you decide what that company actually needs to run itself.

Research the company and its operating model using web search and web fetch. Look for how this kind of business actually operates: what it sells, who buys, how money arrives and when, how work reaches the customer, what it must buy in to deliver, who does the work, what regulation or contract obligations gate it, and what commonly goes wrong operationally. If the company is named and has a public presence, research that specific company. Otherwise research the industry and operating model.

Produce a business-facing research brief. For every operational conclusion, state the evidence and where it came from: the operator's own words, or a source you found. Separate what you established from what you are assuming. Do not invent facts about this company, do not invent metrics, and do not report a conclusion you could not source.

End the brief with: the operating model you concluded, the business systems that follow from it, the systems this company explicitly does not need, and the single most valuable thing you still do not know.`

const compileSystem = `You are BO's architecture compiler. You are given a research brief about one company and BO's hidden capability catalog. Convert the brief into strict JSON.

Rules:
- Every finding must trace to the brief. Never introduce a conclusion the brief did not reach.
- basis is "stated" when the operator said it, "researched" when it came from a source, "inferred" when the brief reasoned to it.
- sourceUrl carries the URL the finding came from, or an empty string when the finding came from the operator or from reasoning.
- capabilityIds selects only capabilities the brief justifies. excludedCapabilityIds carries capabilities the brief explicitly ruled out.
- openQuestion is the one unresolved thing that would most change what gets built, phrased for a business operator, with short contextual answers.
- Return JSON only. Never expose private reasoning.`

const finding = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conclusion: { type: 'string' },
    because: { type: 'string' },
    implication: { type: 'string' },
    basis: { type: 'string', enum: ['stated', 'researched', 'inferred'] },
    confidence: { type: 'number' },
    sourceUrl: { type: 'string' },
    capabilityIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['conclusion', 'because', 'implication', 'basis', 'confidence', 'sourceUrl', 'capabilityIds'],
}

function compileSchema(capabilityIds) {
  const capability = { type: 'string', enum: capabilityIds }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      archetype: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, label: { type: 'string' }, confidence: { type: 'number' } }, required: ['id', 'label', 'confidence'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: { ...finding, properties: { ...finding.properties, capabilityIds: { type: 'array', items: capability } } } },
      capabilityIds: { type: 'array', items: capability },
      excludedCapabilityIds: { type: 'array', items: capability },
      openQuestion: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, reason: { type: 'string' }, suggestedAnswers: { type: 'array', items: { type: 'string' } } }, required: ['text', 'reason', 'suggestedAnswers'] },
      sources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] } },
    },
    required: ['archetype', 'summary', 'findings', 'capabilityIds', 'excludedCapabilityIds', 'openQuestion', 'sources'],
  }
}

export async function researchCompany({ description, conversation = [], catalog = '', capabilityIds = [] }) {
  if (!capabilityIds.length) throw Object.assign(new Error('The capability catalog is required.'), { status: 400 })

  const brief = await withFallbacks(
    {
      model: MODEL,
      max_tokens: 16000,
      system: researchSystem,
      thinking: { type: 'adaptive' },
      /**
       * Tuned for the person waiting, not for the best possible answer.
       *
       * This is the slowest thing BO does — every search and fetch is a round trip to the open web,
       * and an operator sits watching a progress stage while it happens. Eight searches produced
       * marginally better sourcing than five and took noticeably longer to get there.
       *
       * The cost of trimming it is carried once: the first company in an industry pays for the
       * research and every later one inherits it from the shared knowledge store.
       */
      output_config: { effort: 'medium' },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
      ],
    },
    [{ role: 'user', content: `The operator described their company as:\n"""${description}"""\n\nWhat they have told BO so far:\n${conversationText(conversation) || '(nothing yet)'}\n\nResearch this company and produce the brief.` }],
  )
  const briefRefusal = refusal(brief.message, 'BO continued with its built-in researcher.')
  if (briefRefusal) throw briefRefusal
  const briefText = textOf(brief.message)
  if (!briefText) throw Object.assign(new Error('The researcher returned an empty brief.'), { status: 502 })

  const compiled = await withFallbacks(
    {
      model: MODEL,
      max_tokens: 8000,
      system: compileSystem,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: wireSchema(compileSchema(capabilityIds)) } },
    },
    [{ role: 'user', content: `Research brief:\n"""${briefText}"""\n\nBO capability catalog (id=label):\n${catalog}\n\nCompile the brief into JSON.` }],
  )
  const compiledRefusal = refusal(compiled.message, 'BO continued with its built-in researcher.')
  if (compiledRefusal) throw compiledRefusal

  let result
  try { result = JSON.parse(textOf(compiled.message)) }
  catch { throw Object.assign(new Error('The researcher returned output BO could not read.'), { status: 502 }) }

  const allowed = new Set(capabilityIds)
  const searched = citedSources(brief.message)
  return {
    model: compiled.message.model ?? MODEL,
    brief: briefText,
    archetype: result.archetype ?? null,
    summary: String(result.summary ?? ''),
    findings: (result.findings ?? []).map(item => ({
      conclusion: String(item.conclusion ?? ''),
      because: String(item.because ?? ''),
      implication: String(item.implication ?? ''),
      basis: ['stated', 'researched', 'inferred'].includes(item.basis) ? item.basis : 'inferred',
      confidence: Number(item.confidence ?? 0.5),
      sourceUrl: String(item.sourceUrl ?? ''),
      capabilityIds: (item.capabilityIds ?? []).filter(id => allowed.has(id)),
    })).filter(item => item.conclusion),
    capabilityIds: (result.capabilityIds ?? []).filter(id => allowed.has(id)),
    excludedCapabilityIds: (result.excludedCapabilityIds ?? []).filter(id => allowed.has(id)),
    openQuestion: result.openQuestion?.text
      ? { text: String(result.openQuestion.text), reason: String(result.openQuestion.reason ?? ''), suggestedAnswers: (result.openQuestion.suggestedAnswers ?? []).map(String).slice(0, 5) }
      : null,
    sources: [...(result.sources ?? []).map(item => ({ title: String(item.title ?? ''), url: String(item.url ?? '') })), ...searched]
      .filter(item => /^https?:\/\//.test(item.url))
      .filter((item, index, items) => items.findIndex(candidate => candidate.url === item.url) === index)
      .slice(0, 12),
  }
}
