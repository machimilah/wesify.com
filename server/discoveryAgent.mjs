import { MODEL, conversationText, refusal, textOf, withFallbacks } from './anthropic.mjs'

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

Name pages and entities in the company's own language — not BO's, and not another vendor's. Include the modules, workflows, metrics, process stages, sales stages where relevant, and billing cadence that follow from this company. Return READY_TO_ARCHITECT, an empty nextQuestion, and only schema-valid JSON.`

const stringList = (maxItems = 12, maxLength = 160) => ({ type: 'array', maxItems, items: { type: 'string', maxLength } })

/**
 * Built from the ids the client holds rather than a copy kept here.
 *
 * The catalog changes often. A second hand-maintained list on the server would drift from it, and the
 * drift would show up as the model being unable to select a capability that exists.
 */
export function discoverySchema(capabilityIds, modules) {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      businessState: {
        type: 'object', additionalProperties: false,
        properties: {
          companySummary: { type: 'string', maxLength: 280 }, industry: { type: 'string', maxLength: 80 },
          facts: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 160 }, status: { type: 'string', enum: ['explicit', 'inferred', 'unknown', 'irrelevant'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['topic', 'value', 'status', 'confidence'] } },
          businessModel: stringList(), productsOrServices: stringList(), customers: stringList(), revenueModel: stringList(), team: stringList(), operations: stringList(), resources: stringList(), locations: stringList(), currentTools: stringList(), painPoints: stringList(), goals: stringList(), knownEntities: stringList(), knownWorkflows: stringList(), uncertainties: stringList(), assumptions: stringList(), softwareImplications: stringList(),
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
          modules: { type: 'array', maxItems: 24, items: { type: 'string', enum: modules } }, startView: { type: 'string', enum: ['overview', ...modules] },
          capabilities: stringList(60), capabilityIds: { type: 'array', maxItems: 60, items: { type: 'string', enum: capabilityIds } }, excludedCapabilityIds: { type: 'array', maxItems: 60, items: { type: 'string', enum: capabilityIds } }, pages: stringList(60),
          entities: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 60 }, module: { type: 'string', enum: modules }, purpose: { type: 'string', maxLength: 140 } }, required: ['name', 'module', 'purpose'] } },
          workflows: stringList(40), metrics: stringList(30), processStages: stringList(14), pipelineStages: stringList(14), billingCadence: { type: 'string', maxLength: 100 },
        },
        required: ['title', 'summary', 'explanation', 'modules', 'startView', 'capabilities', 'capabilityIds', 'excludedCapabilityIds', 'pages', 'entities', 'workflows', 'metrics', 'processStages', 'pipelineStages', 'billingCadence'],
      },
    },
    required: ['businessState', 'decision', 'acknowledgment', 'nextQuestion', 'architectureContext'],
  }
}

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
      output_config: { effort: architecting ? 'medium' : 'low', format: { type: 'json_schema', schema: discoverySchema(capabilityIds, modules) } },
    },
    [{ role: 'user', content: instruction }],
  )
  const declined = refusal(message, 'BO continued the interview with its built-in questions.')
  if (declined) throw declined

  try { return { ...JSON.parse(textOf(message)), model: message.model ?? MODEL } }
  catch { throw Object.assign(new Error('The consultant returned output BO could not read.'), { status: 502 }) }
}
