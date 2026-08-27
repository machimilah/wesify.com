import { MODEL, refusal, textOf, wireSchema, withFallbacks } from './anthropic.mjs'
import { GEMINI_MODEL, runGeminiJson } from './gemini.mjs'
import { interviewProviders, parkProvider, unusableKey } from './discoveryAgent.mjs'

/**
 * The agent inside a built workspace, moved off the browser model.
 *
 * Wesify's interview was rescued from the in-browser 0.5B model a long time ago; the agent living
 * inside the finished Command Center never was. It asked a 0.5B model to emit a nested action
 * against a live schema, in 520 tokens, and everything it could not do was read as the product not
 * being able to do it — when in fact the actions, the permissions, the preview, the versioned build
 * and the rollback were all already there, waiting for something competent to drive them.
 *
 * Two modes, because two very different things are being asked for:
 *
 * - **command** — "mark the Acme invoice paid", "show me overdue jobs". One action, small budget,
 *   fast, because somebody is watching the cursor blink.
 * - **build** — "set up supplier management", "start tracking which engineer did each job". A whole
 *   change to the workspace: records, fields, relations, a page, an alert. This is the same class of
 *   work the architect does at build time, so it gets the same class of budget and the same model.
 *
 * `BO_AGENT_MODEL` raises the model for a deployment that wants more than the default behind the
 * building half. The interview is deliberately untouched by any of this.
 */

export const AGENT_MODEL = process.env.BO_AGENT_MODEL || MODEL

export function agentAvailable() { return interviewProviders({ includeParked: true }).length > 0 }

export function agentModel() {
  const provider = interviewProviders()[0]
  return provider === 'gemini' ? GEMINI_MODEL : provider === 'anthropic' ? AGENT_MODEL : ''
}

const fieldTypes = ['text', 'long-text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'select', 'relation', 'file']
const actionKinds = ['none', 'create_record', 'update_record', 'delete_record', 'add_field', 'add_collection', 'add_capability', 'remove_capability', 'create_workflow', 'navigate', 'query']

/** One action against records that already exist. The shape the workspace has always executed. */
const commandSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['EXECUTE', 'PREVIEW', 'ANSWER', 'CLARIFY'] },
    message: { type: 'string', maxLength: 300 },
    action: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: actionKinds },
        entityId: { type: 'string', maxLength: 60 }, recordId: { type: 'string', maxLength: 80 },
        navigationId: { type: 'string', maxLength: 60 }, collectionName: { type: 'string', maxLength: 60 },
        capabilityId: { type: 'string', maxLength: 80 },
        values: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { field: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 240 } }, required: ['field', 'value'] } },
        field: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', maxLength: 60 }, label: { type: 'string', maxLength: 80 }, type: { type: 'string', enum: fieldTypes }, required: { type: 'boolean' } }, required: ['id', 'label', 'type', 'required'] },
        workflow: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 120 }, entityId: { type: 'string', maxLength: 60 }, event: { type: 'string', enum: ['created', 'updated'] }, conditionField: { type: 'string', maxLength: 60 }, conditionEquals: { type: 'string', maxLength: 80 }, message: { type: 'string', maxLength: 180 } }, required: ['name', 'entityId', 'event', 'conditionField', 'conditionEquals', 'message'] },
      },
      required: ['kind', 'entityId', 'recordId', 'navigationId', 'collectionName', 'capabilityId', 'values', 'field', 'workflow'],
    },
  },
  required: ['decision', 'message', 'action'],
}

const planField = {
  type: 'object', additionalProperties: false,
  properties: {
    label: { type: 'string', maxLength: 40 },
    type: { type: 'string', enum: fieldTypes },
    required: { type: 'boolean' },
    options: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
    relatedTo: { type: 'string', maxLength: 60, description: 'The name or id of another record type, either already in this workspace or created by this same plan.' },
  },
  required: ['label', 'type'],
}

/**
 * A whole change to the workspace, in one answer.
 *
 * The old single-action shape is what made the assistant feel incapable: "set up supplier
 * management" is a record type, eight fields, two relations, a page, a low-stock alert and a metric,
 * and no model builds that one action at a time. What comes back here is compiled into the same
 * `activate_module` action the capability installer already produces, so everything downstream —
 * approval, the versioned build, the test, promote, rollback — is untouched.
 */
const planSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['PLAN', 'CLARIFY'] },
    message: { type: 'string', maxLength: 400, description: 'What this change adds, in the operator words. No software vocabulary.' },
    question: { type: 'string', maxLength: 200, description: 'Set only when decision is CLARIFY.' },
    plan: {
      type: 'object', additionalProperties: false,
      properties: {
        label: { type: 'string', maxLength: 60 },
        module: { type: 'string', maxLength: 40, description: 'A short lowercase id for the area this belongs to, or an existing module of this workspace.' },
        capabilityIds: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 80 }, description: 'Catalog capabilities that already cover this request. Prefer these over inventing record types.' },
        entities: {
          type: 'array', maxItems: 6,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              name: { type: 'string', maxLength: 60, description: 'Plural, in the company own words.' },
              purpose: { type: 'string', maxLength: 140 },
              fields: { type: 'array', maxItems: 14, items: planField },
              states: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 }, description: 'The states one of these moves through, in the company own words.' },
            },
            required: ['name', 'purpose', 'fields'],
          },
        },
        entityUpdates: {
          type: 'array', maxItems: 6,
          items: {
            type: 'object', additionalProperties: false,
            properties: { entityId: { type: 'string', maxLength: 60 }, fields: { type: 'array', maxItems: 10, items: planField } },
            required: ['entityId', 'fields'],
          },
        },
        workflows: {
          type: 'array', maxItems: 6,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              name: { type: 'string', maxLength: 120 },
              entity: { type: 'string', maxLength: 60, description: 'The record type this watches, by id or by a name used in this plan.' },
              event: { type: 'string', enum: ['created', 'updated'] },
              conditionField: { type: 'string', maxLength: 60 },
              conditionEquals: { type: 'string', maxLength: 80 },
              message: { type: 'string', maxLength: 180 },
            },
            required: ['name', 'entity', 'event', 'message'],
          },
        },
        metrics: {
          type: 'array', maxItems: 4,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              label: { type: 'string', maxLength: 60 },
              entity: { type: 'string', maxLength: 60 },
              operation: { type: 'string', enum: ['count', 'sum'] },
              field: { type: 'string', maxLength: 60 },
              statusNotEquals: { type: 'string', maxLength: 40 },
            },
            required: ['label', 'entity', 'operation'],
          },
        },
      },
      required: ['label', 'module', 'capabilityIds', 'entities', 'entityUpdates', 'workflows', 'metrics'],
    },
  },
  required: ['decision', 'message', 'question', 'plan'],
}

const commandSystem = `You are Wesify, the operating agent inside one company's Business Command Center. Turn the operator's request into one safe action against the workspace you are given.

Use only what is supplied. Entity ids, record ids, field ids, navigation ids and capability ids are used exactly as given — never invented, never guessed at, never corrected. If the thing they are asking about is not in what you were given, CLARIFY and say what you could not find.

Choose one kind: create_record, update_record, delete_record, add_field, add_collection, add_capability, remove_capability, create_workflow, navigate, query.

EXECUTE creating and updating records, navigating and querying. PREVIEW every deletion and every change to the shape of the workspace. CLARIFY when the target is ambiguous or something required is missing. ANSWER from the supplied records only, and say plainly when the answer is not in them.

Act within the supplied actingAgent scope where one is given, and respect its prohibited actions. Never invent business data: no customer names, no amounts, no dates the operator did not give you.

Write back like a colleague, not a system. One short sentence. Return only schema-valid JSON.`

const buildSystem = `You are Wesify, building inside a company's Command Center that already exists. The operator has asked for something the workspace cannot do yet. Design that change.

This is their working software, not a blank page. So:

- Never rebuild what is already there. If the workspace has a record type that should carry this, add the fields to it through entityUpdates instead of creating a second one beside it. Two record types for the same thing is the worst outcome here.
- Prefer capabilityIds. The catalog you are given is a set of complete, dependency-aware packages that Wesify installs properly. Where one covers the request, name it and leave entities empty. Invent a record type only for something genuinely specific to this company that no capability covers.
- Fields in the company's own words, the ones they would put on paper — usually five to ten. A plumber's job has a service address and a technician; a law firm's matter has a court date and a responsible partner. Do not add a field nobody would ever fill in.
- relatedTo connects this to what they already have. Point it at an entity id in the workspace, or at the name of another record type in this same plan.
- states are what this company calls each point in the life of one of these records. Every board, filter and alert is built from them.
- A workflow only for something that actually goes wrong and that somebody has to be told about. Not one per field.
- A metric only if somebody would act on the number today.
- Never remove anything, and never touch records. This is additive only.

If the request is ambiguous, or is really several changes, decide CLARIFY and ask one short question in plain words. A wrong build is more expensive to undo than a question is to ask.

message is what you are about to add, in one or two sentences an operator would recognise: no entity, field, schema, module or capability. Return only schema-valid JSON.`

/**
 * One turn, on whichever provider this deployment has.
 *
 * The same cascade as the interview — Anthropic first when configured, Gemini's free tier
 * otherwise, a key that cannot be used at all parked rather than retried in front of somebody.
 */
export async function runWorkspaceAgentTurn({ mode = 'command', command, context }) {
  if (!command) throw Object.assign(new Error('A command is required.'), { status: 400 })
  const building = mode === 'build'
  const schema = building ? planSchema : commandSchema
  const system = building ? buildSystem : commandSystem
  const providers = interviewProviders()
  if (!providers.length) throw Object.assign(new Error('Wesify has no model configured for the workspace agent. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.'), { status: 503 })

  const instruction = [
    'This workspace, as it is right now:',
    JSON.stringify(context),
    '',
    `What the operator asked for: "${command}"`,
    '',
    building ? 'Design the change.' : 'Decide the action.',
  ].join('\n')

  const askProvider = async provider => {
    if (provider === 'gemini') {
      const result = await runGeminiJson({
        system,
        prompt: instruction,
        schema,
        // Building is the one thing in a workspace worth waiting for; a command is not.
        maxTokens: building ? 6000 : 900,
        thinkingBudget: building ? 2048 : 0,
        temperature: building ? 0.2 : 0.1,
        timeoutMs: building ? 40000 : 12000,
        budgetMs: building ? 75000 : 30000,
      })
      return { raw: result.text, usedModel: result.model }
    }
    const { message } = await withFallbacks(
      {
        model: AGENT_MODEL,
        max_tokens: building ? 6000 : 900,
        system,
        output_config: { effort: building ? 'medium' : 'low', format: { type: 'json_schema', schema: wireSchema(schema) } },
      },
      [{ role: 'user', content: instruction }],
    )
    const declined = refusal(message, 'Wesify could not act on that request.')
    if (declined) throw declined
    return { raw: textOf(message), usedModel: message.model ?? AGENT_MODEL }
  }

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
  if (raw === undefined) throw lastError ?? Object.assign(new Error('No model answered.'), { status: 502 })

  let parsed
  try { parsed = JSON.parse(raw) }
  catch { throw Object.assign(new Error('The agent returned output Wesify could not read.'), { status: 502 }) }
  return { ...parsed, mode: building ? 'build' : 'command', model: usedModel }
}
