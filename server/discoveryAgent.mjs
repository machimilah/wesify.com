import { MODEL, conversationText, refusal, textOf, wireSchema, withFallbacks } from './anthropic.mjs'

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

Record what you learn in businessState: what the operator said is explicit, what you reasonably concluded is inferred, what is still open is unknown. Never invent facts about this company — no customer names, no numbers, no volumes.

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
          facts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 160 }, status: { type: 'string', enum: ['explicit', 'inferred', 'unknown', 'irrelevant'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['topic', 'value', 'status', 'confidence'] } },
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
  return {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(keep.map(key => [key, full.properties[key]])),
    required: keep,
  }
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
export async function runDiscoveryTurn({ mode, conversation = [], businessState = null, capabilityIds = [], modules = [], catalog = '', forceArchitecture = false, industry = '' }) {
  if (!capabilityIds.length || !modules.length) throw Object.assign(new Error('The capability catalog is required.'), { status: 400 })
  const architecting = mode !== 'DISCOVER'

  const known = businessState ? `What BO has recorded about this company so far:\n${JSON.stringify(businessState)}` : 'BO has recorded nothing about this company yet.'
  const said = conversationText(conversation) || '(nothing yet)'
  const industryLine = industry ? `\n\nBO classified this company as: ${industry}. Treat that as a hint, not a fact.` : ''
  const instruction = architecting
    ? `${known}\n\nThe conversation:\n${said}${industryLine}\n\nBO capability catalog (id = label):\n${catalog}\n\nDesign the Command Center.`
    : `${known}\n\nThe conversation so far:\n${said}${industryLine}\n\n${forceArchitecture ? 'The operator wants to stop answering questions. Decide READY_TO_ARCHITECT now and record your assumptions.' : 'Take the next turn.'}`

  const { message } = await withFallbacks(
    {
      model: MODEL,
      max_tokens: architecting ? 8000 : 3000,
      system: architecting ? architectSystem : consultantSystem,
      output_config: { effort: architecting ? 'medium' : 'low', format: { type: 'json_schema', schema: wireSchema(discoverySchema(capabilityIds, modules, { architecting })) } },
    },
    [{ role: 'user', content: instruction }],
  )
  const declined = refusal(message, 'BO continued the interview with its built-in questions.')
  if (declined) throw declined

  let parsed
  try { parsed = JSON.parse(textOf(message)) }
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
  if (architecting) parsed.businessState ??= businessState ?? undefined
  else parsed.architectureContext ??= emptyArchitecture()

  const allowed = new Set(capabilityIds)
  const architecture = parsed.architectureContext
  if (architecture && typeof architecture === 'object') {
    for (const key of ['capabilityIds', 'excludedCapabilityIds']) {
      if (Array.isArray(architecture[key])) architecture[key] = architecture[key].filter(id => allowed.has(id))
    }
  }
  return { ...parsed, model: message.model ?? MODEL }
}
