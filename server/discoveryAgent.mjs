import { MODEL, conversationText, reasoningAvailable, refusal, textOf, wireSchema, withFallbacks } from './anthropic.mjs'
import { GEMINI_MODEL, geminiAvailable, runGeminiJson } from './gemini.mjs'

/**
 * Which model runs the interview.
 *
 * Anthropic first when both are configured — it is the one BO's research pass also uses, so a
 * deployment that pays for a key gets one model's judgement rather than two. Gemini is what makes the
 * intelligent interview the default rather than a paid upgrade: its free tier costs nothing and needs
 * no card, so the fixed question bank stops being what most people see.
 *
 * `BO_INTERVIEW_PROVIDER` forces one, for a deployment that holds both keys and has a preference.
 */
/**
 * A key that cannot be used, remembered so the next question does not wait on it too.
 *
 * "Your credit balance is too low to access the Anthropic API" arrives as a 400, and it is not a
 * request BO can repair by asking differently: the account is out of credit until somebody pays. A
 * revoked or mistyped key is the same shape. Parked for half an hour rather than for the life of the
 * process, because topping up an account is exactly the sort of thing that happens while BO is
 * running, and a deployment that had to be restarted to notice would be its own small trap.
 */
const parkedProviders = new Map()
const providerUsable = name => (parkedProviders.get(name) ?? 0) < Date.now()

export function parkProvider(name, reason, milliseconds = 30 * 60 * 1000) {
  parkedProviders.set(name, Date.now() + milliseconds)
  console.warn(`BO parked the ${name} interview provider for ${Math.round(milliseconds / 60000)} minutes: ${reason}`)
}

/**
 * Whether a failure means the key itself is unusable, rather than this one request being wrong.
 *
 * The two need opposite responses: a bad schema should surface as a bug to fix, while an exhausted
 * account should quietly move to the other provider. Matched on what the provider actually says — a
 * 401 or 403 is unambiguous, and a 400 counts only when it talks about credit or billing, so a
 * genuine 400 about the request is never swallowed as a billing problem.
 */
export function unusableKey(error) {
  const status = Number(error?.status)
  if (status === 401 || status === 403) return true
  const said = String(error?.message ?? '').toLowerCase()
  return status === 400 && /credit balance|billing|insufficient|payment required|quota/.test(said)
}

/**
 * Every provider this deployment could use, best first.
 *
 * Anthropic leads when both are configured — it is the one BO's research pass also uses, so a
 * deployment paying for a key gets one model's judgement rather than two. Gemini is what makes the
 * intelligent interview the default rather than a paid upgrade: its free tier costs nothing and
 * needs no card.
 *
 * A list rather than a single answer, because holding two keys and stopping at the first is the
 * whole problem this exists to prevent: an operator with a working free Gemini key and an Anthropic
 * account out of credit was told the interview could not continue, while the key that would have
 * answered sat unused. BO already moves between Gemini models when one runs dry; this is the same
 * idea one level up.
 *
 * `BO_INTERVIEW_PROVIDER` still forces one, for a deployment that holds both and has a preference.
 */
export function interviewProviders({ includeParked = false } = {}) {
  const forced = String(process.env.BO_INTERVIEW_PROVIDER || '').toLowerCase()
  const configured = [
    ...(reasoningAvailable() ? ['anthropic'] : []),
    ...(geminiAvailable() ? ['gemini'] : []),
  ]
  const preferred = forced === 'gemini' || forced === 'anthropic'
    ? configured.filter(name => name === forced)
    : configured
  if (includeParked) return preferred
  const live = preferred.filter(providerUsable)
  // Everything parked means trying the whole list again rather than refusing on a note BO wrote to
  // itself half an hour ago: a slow interview beats an interview that will not run.
  return live.length ? live : preferred
}

export function interviewProvider() { return interviewProviders()[0] ?? null }

export function interviewAvailable() { return interviewProviders({ includeParked: true }).length > 0 }

export function interviewModel() {
  const provider = interviewProvider()
  return provider === 'gemini' ? GEMINI_MODEL : provider === 'anthropic' ? MODEL : ''
}

/**
 * The interview itself, run on the server.
 *
 * BO's in-browser model made the product private and free, and made the first minute terrible: a
 * one-gigabyte download, WebGPU required, and a 0.5B model that can only be trusted with tightly
 * railed questions. What came out was a questionnaire — "What does your company sell or deliver?" —
 * asked of someone who had just written "we run a plumbing company".
 *
 * A frontier model already knows what a plumbing company is, so it can behave like a consultant
 * instead: skip everything it can infer, and spend its few questions on what it genuinely cannot know
 * about *this* company. The browser model stays as the fallback when no key is configured.
 */

const consultantSystem = `You are BO's business consultant. You interview one operator about their company so BO can build them a custom Business Command Center — the software they will run their business in.

Behave like an experienced consultant who already knows this industry, not like a form.

- Use what you know. If they say "plumbing company" you already know there are jobs, technicians, callouts, parts and invoices. Never ask them to confirm the obvious.
- Ask only what changes the software. A question is worth asking when its answer adds or removes records, workflows, pages or permissions. Nothing else is.
- Ask about their operation specifically, in their own words. "Do your technicians carry stock in their vans?" — not "What resources does your company use?"
- One question at a time. Short. No preamble, no compliments, no advice about how to run their business.

Write the way a person talks. This is the rule that matters most, because an operator who does not understand a question gives a vague answer, and a vague answer builds the wrong software.
- Everyday words only. "Who does the work?" not "What is your resourcing model?". "How do people pay you?" not "What is your revenue recognition cadence?".
- Never use business-school or software vocabulary: no entities, records, workflows, pipeline, cadence, stakeholders, onboarding, fulfilment, utilisation, SKU, CRM, ERP.
- Under fifteen words where you can. One idea per question.
- It must be answerable in a few words, from what they already know off the top of their head. Never ask for a number they would have to look up.
- If a question could be misread, ask the simpler half of it first.

Ask plenty. Ten to fourteen questions is a good interview, and more is fine while each one still changes something. A short interview is a cheap-feeling product and a workspace full of guesses, and an operator who answers twelve easy questions understands their new software better than one who answered four hard ones. Cover the ground you actually need: what they sell, who does the work, who they sell to, how a job or order runs from start to finish, how money comes in and when, what they buy or keep in stock, what they schedule, who works there and who is allowed to do what, what they track today and in what, and what goes wrong most often.
- Stop when more questions would stop changing what gets built, then decide READY_TO_ARCHITECT.
- If they ask you to just build it, or say they do not know, stop asking immediately and build with stated assumptions.
- Leave suggestedAnswers empty. The operator answers in their own words; offering choices teaches them BO wants a pick rather than a sentence, and their sentence is worth more.

Record what you learn in businessState: what the operator said is explicit, what you reasonably concluded is inferred, what is still open is unknown. Include concise evidence and a basis of user or inference for each fact when possible. Never invent facts about this company — no customer names, no numbers, no volumes.

While the decision is ASK_QUESTION, return an empty architectureContext with every required field present. Return only schema-valid JSON. Never expose private reasoning.`

const architectSystem = `You are BO's Business Application Architect. The interview is finished. Turn what is known about this company into the smallest Command Center that actually runs it.

Select the capabilityIds this company needs now from the supplied catalog, and put deliberately rejected ones in excludedCapabilityIds. Respect dependencies. Never add an adjacent capability without evidence from what the operator said: an unused page is worse than a missing one, because it is the exact failure that makes every other business suite feel wrong.

Give every entity its fields, in the company's own words. This is the part that makes the workspace theirs rather than a generic one with their name on it: a plumber's work order has a service address and a technician, a law firm's matter has a court date and a responsible partner, and nothing about the word "job" or "case" should decide that. Choose what the operator actually needs to see and type on that record — usually five to ten fields, the ones they would put on paper. Use relatedTo to point at another entity in this same list where a record genuinely belongs to another. Do not add fields nobody mentioned and nobody would fill in: an empty column is the thing that makes software feel like somebody else's.

Name pages and entities in the company's own language — not BO's, and not another vendor's. Include the modules, workflows, metrics, process stages, sales stages where relevant, and billing cadence that follow from this company. Return READY_TO_ARCHITECT, an empty nextQuestion, and only schema-valid JSON.`

/**
 * A list, without a length cap on the wire.
 *
 * The Messages API refuses `maxItems` inside a structured-output schema — "For 'array' type,
 * property 'maxItems' is not supported" — and refuses the whole request with a 400, so a schema
 * carrying one never reaches the model at all. Length limits live where they always did anyway, in
 * the validators that parse the response: `isArchitectureContext` and `isBusinessState` cap every
 * one of these, and a model that overruns is rejected there rather than trusted.
 */
const stringList = (_maxItems = 12, maxLength = 160) => ({ type: 'array', items: { type: 'string', maxLength } })

/** Business-state fields the interview no longer asks for, because nothing in BO reads them. */
const UNREAD_STATE_FIELDS = ['painPoints', 'uncertainties', 'assumptions']

/**
 * Built from the ids the client holds rather than a copy kept here.
 *
 * The catalog changes often. A second hand-maintained list on the server would drift from it, and the
 * drift would show up as the model being unable to select a capability that exists.
 */
export function discoverySchema(capabilityIds, modules, { architecting = true } = {}) {
  const full = {
    type: 'object', additionalProperties: false,
    properties: {
      businessState: {
        type: 'object', additionalProperties: false,
        properties: {
          companySummary: { type: 'string', maxLength: 280 }, industry: { type: 'string', maxLength: 80 },
          facts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 160 }, status: { type: 'string', enum: ['explicit', 'inferred', 'unknown', 'irrelevant'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'string', maxLength: 180 }, basis: { type: 'string', enum: ['user', 'inference', 'research'] } }, required: ['topic', 'value', 'status', 'confidence'] } },
          businessModel: stringList(), productsOrServices: stringList(), customers: stringList(), revenueModel: stringList(), team: stringList(), operations: stringList(), resources: stringList(), locations: stringList(), currentTools: stringList(), painPoints: stringList(), goals: stringList(), knownEntities: stringList(), knownWorkflows: stringList(), uncertainties: stringList(), assumptions: stringList(), softwareImplications: stringList(),
        },
        required: ['companySummary', 'industry', 'facts', 'businessModel', 'productsOrServices', 'customers', 'revenueModel', 'team', 'operations', 'resources', 'locations', 'currentTools', 'painPoints', 'goals', 'knownEntities', 'knownWorkflows', 'uncertainties', 'assumptions', 'softwareImplications'],
      },
      decision: { type: 'string', enum: ['ASK_QUESTION', 'READY_TO_ARCHITECT'] },
      acknowledgment: { type: 'string', maxLength: 160 },
      nextQuestion: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', maxLength: 220 }, reason: { type: 'string', maxLength: 180 }, suggestedAnswers: { type: 'array', items: { type: 'string', maxLength: 70 } } }, required: ['text', 'reason', 'suggestedAnswers'] },
      architectureContext: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 80 }, summary: { type: 'string', maxLength: 240 }, explanation: { type: 'string', maxLength: 360 },
          modules: { type: 'array', items: { type: 'string', enum: modules } }, startView: { type: 'string', enum: ['overview', ...modules] },
          capabilities: stringList(60), capabilityIds: stringList(60, 80), excludedCapabilityIds: stringList(60, 80), pages: stringList(60),
          /**
           * An entity now arrives with its own fields.
           *
           * Until this, the architect supplied a noun and BO decided what was inside it by matching
           * the noun against a list of patterns — an entity called anything with "invoice" in it got
           * a number field, anything with "job" got a customer relation. That is why two companies in
           * the same trade got identical record shapes however differently they answered: the model
           * was choosing labels while hand-written rules chose the substance.
           *
           * Fields are optional. When the model omits them BO falls back to the same inference it
           * always used, which is what keeps the no-API-key path working.
           */
          entities: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', maxLength: 60 },
                module: { type: 'string', enum: modules },
                purpose: { type: 'string', maxLength: 140 },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      label: { type: 'string', maxLength: 40 },
                      type: { type: 'string', enum: ['text', 'long-text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'select', 'relation', 'file'] },
                      required: { type: 'boolean' },
                      // Only read for select fields, and only ever offered as a starting point: an
                      // operator can edit these afterwards like any other part of the workspace.
                      options: { type: 'array', items: { type: 'string', maxLength: 40 } },
                      // The name of another entity in this same list. Validated against it, because a
                      // relation to something that does not exist is a broken record form.
                      relatedTo: { type: 'string', maxLength: 60 },
                    },
                    required: ['label', 'type'],
                  },
                },
              },
              required: ['name', 'module', 'purpose'],
            },
          },
          workflows: stringList(40), metrics: stringList(30), processStages: stringList(14), pipelineStages: stringList(14), billingCadence: { type: 'string', maxLength: 100 },
        },
        required: ['title', 'summary', 'explanation', 'modules', 'startView', 'capabilities', 'capabilityIds', 'excludedCapabilityIds', 'pages', 'entities', 'workflows', 'metrics', 'processStages', 'pipelineStages', 'billingCadence'],
      },
    },
    required: ['businessState', 'decision', 'acknowledgment', 'nextQuestion', 'architectureContext'],
  }

  const keep = architecting
    ? ['decision', 'acknowledgment', 'nextQuestion', 'architectureContext']
    : ['businessState', 'decision', 'acknowledgment', 'nextQuestion']
  const kept = Object.fromEntries(keep.map(key => [key, full.properties[key]]))

  /**
   * Three fields nobody has ever read, no longer written.
   *
   * `painPoints`, `uncertainties` and `assumptions` were generated on every single turn — three more
   * lists of sentences for the model to compose — and grepping the whole product finds not one place
   * that displays, stores or reasons over any of them. Every one of those tokens was time an operator
   * spent watching a spinner. They are filled back in as empty arrays where the reply is parsed, so
   * the shape the client validates against is unchanged.
   */
  if (!architecting) {
    const state = kept.businessState
    kept.businessState = {
      ...state,
      properties: Object.fromEntries(Object.entries(state.properties).filter(([key]) => !UNREAD_STATE_FIELDS.includes(key))),
      required: state.required.filter(key => !UNREAD_STATE_FIELDS.includes(key)),
    }
  }

  return { type: 'object', additionalProperties: false, properties: kept, required: keep }
}

/** What a turn returns for the half it was not asked to produce. */
const emptyArchitecture = () => ({
  title: '', summary: '', explanation: '', modules: [], startView: 'overview',
  capabilities: [], capabilityIds: [], excludedCapabilityIds: [], pages: [], entities: [],
  workflows: [], metrics: [], processStages: [], pipelineStages: [], billingCadence: '',
})

/**
 * One interview turn.
 *
 * No web tools and no second pass. A question the operator is sitting and waiting for has to come
 * back in seconds; researching the industry is a separate, slower call that runs alongside it.
 */
export async function runDiscoveryTurn({ mode, conversation = [], businessState = null, capabilityIds = [], modules = [], catalog = '', forceArchitecture = false, industry = '', repair = '', knowledgeRequirements = [], businessGaps = [] }) {
  if (!capabilityIds.length || !modules.length) throw Object.assign(new Error('The capability catalog is required.'), { status: 400 })
  const architecting = mode !== 'DISCOVER'

  const known = businessState ? `What BO has recorded about this company so far:\n${JSON.stringify(businessState)}` : 'BO has recorded nothing about this company yet.'
  const said = conversationText(conversation) || '(nothing yet)'
  /**
   * The questions already asked, listed on their own rather than left inside the transcript.
   *
   * A model reading a transcript treats its own earlier turns as scenery; it will ask what it asked
   * four turns ago in slightly different words, and to the operator that reads as BO not having
   * listened — the worst thing an interview can do. Pulled out and named, it is an instruction
   * rather than something to notice.
   */
  const asked = conversation.filter(item => item.role === 'assistant' && item.content.includes('?')).map(item => item.content.trim())
  const askedLine = asked.length ? [
    '',
    '',
    'Questions you have already asked. Never ask any of these again, in any wording, and never ask for anything the operator has already answered:',
    ...asked.map(item => `- ${item}`),
  ].join('\n') : ''
  const repairLine = repair ? `\n\n${repair}` : ''
  const industryLine = industry ? `\n\nBO classified this company as: ${industry}. Treat that as a hint, not a fact.` : ''
  const knowledgeLine = knowledgeRequirements.length ? `\n\nUnresolved operating knowledge objectives, highest value first:\n${knowledgeRequirements.map(item => `- [${item.priority}] ${item.objective}${item.informationNeeded?.length ? ` Relevant information may include: ${item.informationNeeded.join(', ')}.` : ''}`).join('\n')}\nThese are decision objectives, not a questionnaire. Use only objectives relevant to this company, translate one into a short natural question only when its answer changes the software, and never ask for an objective already answered in the conversation.` : ''
  const gapLine = businessGaps.length ? `\n\nContextual operating-gap candidates:\n${businessGaps.map(item => `- [${item.classification}, confidence ${item.confidence}] ${item.title}: ${item.rationale} Candidate capabilities: ${item.capabilityIds.join(', ') || 'none'}.`).join('\n')}\nThese are advisory candidates, not automatic features. Reject candidates unsupported by the operator's evidence. During discovery, use a candidate only to choose a high-value question. During architecture, select its capability only when the conversation supports it.` : ''
  const instruction = architecting
    ? `${known}\n\nThe conversation:\n${said}${industryLine}${knowledgeLine}${gapLine}\n\nBO capability catalog (id = label):\n${catalog}\n\nDesign the Command Center.`
    : `${known}\n\nThe conversation so far:\n${said}${industryLine}${askedLine}${repairLine}${knowledgeLine}${gapLine}\n\n${forceArchitecture ? 'The operator wants to stop answering questions. Decide READY_TO_ARCHITECT now and record your assumptions.' : 'Take the next turn.'}`

  const schema = discoverySchema(capabilityIds, modules, { architecting })
  const system = architecting ? architectSystem : consultantSystem
  const providers = interviewProviders()
  if (!providers.length) throw Object.assign(new Error('BO has no interview model configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.'), { status: 503 })

  const askProvider = async provider => {
    if (provider === 'gemini') {
      // The architecture pass is worth thinking about; a question the operator is sitting and waiting
      // for is not. The interview also runs warmer than the architect: two operators who describe the
      // same trade differently should not be asked the same twelve questions in the same order.
      const result = await runGeminiJson({
        system,
        prompt: instruction,
        schema,
        maxTokens: architecting ? 8000 : 3000,
        thinkingBudget: architecting ? 2048 : 0,
        temperature: architecting ? 0.2 : 0.6,
        // A question is something a person is sitting and waiting for, so BO gives up on a slow model
        // quickly and asks a faster one. The architecture pass is the one long wait BO is allowed, and
        // it produces far more text, so it gets real patience instead.
        timeoutMs: architecting ? 40000 : 9000,
      })
      return { raw: result.text, usedModel: result.model }
    }
    const { message } = await withFallbacks(
      {
        model: MODEL,
        max_tokens: architecting ? 8000 : 3000,
        system,
        output_config: { effort: architecting ? 'medium' : 'low', format: { type: 'json_schema', schema: wireSchema(schema) } },
      },
      [{ role: 'user', content: instruction }],
    )
    const declined = refusal(message, 'BO continued the interview with its built-in questions.')
    if (declined) throw declined
    return { raw: textOf(message), usedModel: message.model ?? MODEL }
  }

  /**
   * Asked of each configured provider in turn, but only moved on for the right reason.
   *
   * A key that cannot be used at all — out of credit, revoked, mistyped — is not a reason to stop
   * when another key is configured and working. Anything else is: a schema the model rejected or a
   * safety refusal will fail identically on the second provider, and trying it again only doubles
   * the wait before telling the operator the same thing.
   */
  let raw
  let usedModel
  let lastError
  for (const provider of providers) {
    try {
      ({ raw, usedModel } = await askProvider(provider))
      break
    } catch (error) {
      lastError = error
      if (!unusableKey(error) || provider === providers.at(-1)) throw error
      parkProvider(provider, error?.message ?? 'the key was refused')
    }
  }
  if (raw === undefined) throw lastError ?? Object.assign(new Error('No interview provider answered.'), { status: 502 })

  let parsed
  try { parsed = JSON.parse(raw) }
  catch { throw Object.assign(new Error('The consultant returned output BO could not read.'), { status: 502 }) }

  /**
   * Capability ids are checked here rather than constrained on the wire.
   *
   * They used to be an `enum` of every id in the catalog, twice over, which the API compiles into a
   * grammar — and with a catalog this size it refused the request outright: "The compiled grammar is
   * too large". The catalog already reaches the model as text in the prompt, so the enum was buying
   * nothing it did not already know.
   *
   * Filtered rather than rejected. An invented id is one bad line in an otherwise good architecture,
   * and throwing the whole thing away over it would drop the operator back to the built-in questions
   * for no gain.
   */
  // The half this turn was not asked for, filled from what BO already holds. The architect echoing
  // back a business state it never changed was pure output tokens; the interview describing an
  // architecture it was told to leave empty was the same waste in the other direction.
  if (architecting) {
    parsed.businessState ??= businessState ?? undefined
  } else {
    parsed.architectureContext ??= emptyArchitecture()
    // Put back what the schema stopped asking for, so the client validates the same shape as always.
    if (parsed.businessState) for (const key of UNREAD_STATE_FIELDS) parsed.businessState[key] ??= []
  }

  const allowed = new Set(capabilityIds)
  const architecture = parsed.architectureContext
  if (architecture && typeof architecture === 'object') {
    for (const key of ['capabilityIds', 'excludedCapabilityIds']) {
      if (Array.isArray(architecture[key])) architecture[key] = architecture[key].filter(id => allowed.has(id))
    }
  }
  return { ...parsed, model: usedModel }
}
