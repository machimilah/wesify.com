import { interviewProvider } from './discoveryAgent.mjs'
import { MODEL, conversationText, refusal, textOf, wireSchema, withFallbacks } from './anthropic.mjs'
import { runGeminiJson } from './gemini.mjs'

/**
 * What the workspace already knows on the day it is handed over.
 *
 * An operator answers twelve questions — "one supplier, about five regular shops, we invoice thirty
 * days after delivery" — and then BO used to open a workspace with empty tables and a button that
 * says "Add your first client". Everything they said existed in the transcript and nowhere in the
 * software, so the first thing the product asked them to do was type it all again.
 *
 * This turns the interview into rows. It is a recorder, not an author: names it was given are used
 * exactly, counts it was given become that many rows, and anything nobody said stays empty. A
 * plausible invented customer is worse than an empty table, because an empty table is obviously
 * empty while a fabricated one has to be found and deleted before it corrupts somebody's first week.
 */

const system = `You are BO's recorder. An operator has just been interviewed about their company, and BO has built them a workspace. Your job is to write down what they already told you, as records in that workspace, so they do not have to type it all again.

You are recording, not imagining.

- Use only what the operator actually said. Every record must trace to a sentence in the conversation.
- Names they gave you are used exactly as given: a supplier they called "Makro" is a record named Makro.
- A count without names is still a fact worth keeping. "About five regular shops" becomes five records named "Shop 1" … "Shop 5" — plain placeholders they can rename, never invented business names.
- Never invent an email address, a phone number, an amount, a date, an address or a reference number. Leave the field out. An empty field is honest; a fabricated one has to be found and deleted before somebody trusts it.
- If they said a count larger than 12, record 12 and say so in the summary. Nobody wants two hundred placeholder rows.
- Skip an entity entirely when they said nothing about it. Most workspaces should come back with only two or three entities filled in.
- Records that belong to another record use the relation field, pointing at the label of a record you are also creating in this same response.

Then write summary: one or two plain sentences telling the operator what you put in and where it came from, in their own words. No software vocabulary. This is the first thing they read inside their new workspace.

Return only schema-valid JSON.`

const seedSchema = () => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', maxLength: 400 },
    records: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          /**
           * Described rather than merely named, because a bare `entityId` gets filled in with an id
           * for the record itself. Asked for a shop, a real model answered `entityId: "shop-5"` —
           * inventing a table per row — and every one of them was dropped as unknown.
           */
          entityId: { type: 'string', maxLength: 80, description: 'Which table this row goes in. Exactly one of the entity ids listed in the prompt, never a name for this particular row.' },
          // The name that goes in the entity's primary field, kept separate so a model that fills in
          // nothing else still produces a record somebody can recognise in a list.
          label: { type: 'string', maxLength: 120, description: 'What this row is called, for its name field.' },
          values: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string', maxLength: 80, description: 'A field id from that entity, exactly as listed in the prompt — the part before the bracket, not the human label inside it.' },
                value: { type: 'string', maxLength: 300 },
              },
              required: ['field', 'value'],
            },
          },
          because: { type: 'string', maxLength: 200, description: 'The words in the conversation this row came from.' },
        },
        required: ['entityId', 'label', 'values', 'because'],
      },
    },
  },
  required: ['summary', 'records'],
})

/** What the model is told the workspace can hold, in the workspace's own words. */
function entityBrief(entities) {
  return entities.map(entity => {
    const fields = (entity.fields ?? [])
      .map(field => `${field.id} (${field.label}, ${field.type}${field.required ? ', required' : ''}${field.options?.length ? `, one of: ${field.options.join(' / ')}` : ''}${field.relationEntityId ? `, points at ${field.relationEntityId}` : ''})`)
      .join('; ')
    return `${entity.id} — ${entity.pluralLabel || entity.label}. Name field: ${entity.primaryField}. Fields: ${fields}`
  }).join('\n')
}

export async function proposeOpeningRecords({ conversation = [], businessState = null, entities = [] }) {
  if (!entities.length) return { summary: '', records: [] }
  const provider = interviewProvider()
  if (!provider) return { summary: '', records: [] }

  const known = businessState ? `What BO recorded during the interview:\n${JSON.stringify(businessState)}` : 'BO recorded nothing structured during the interview.'
  const prompt = `${known}\n\nThe conversation:\n${conversationText(conversation) || '(nothing)'}\n\nThe workspace BO just built for them holds:\n${entityBrief(entities)}\n\nWrite down what they already told you.`

  let raw
  if (provider === 'gemini') {
    raw = (await runGeminiJson({ system, prompt, schema: seedSchema(), maxTokens: 4000, thinkingBudget: 0, temperature: 0.2 })).text
  } else {
    const { message } = await withFallbacks(
      {
        model: MODEL,
        max_tokens: 4000,
        system,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: wireSchema(seedSchema()) } },
      },
      [{ role: 'user', content: prompt }],
    )
    const declined = refusal(message, 'BO opened the workspace empty instead.')
    if (declined) throw declined
    raw = textOf(message)
  }

  try { return JSON.parse(raw) } catch { throw Object.assign(new Error('The recorder returned output BO could not read.'), { status: 502 }) }
}

/**
 * The model's proposal, reduced to what this workspace can actually hold.
 *
 * Nothing here trusts the model with the shape of the data: an unknown entity, an unknown field, a
 * relation pointing at a record that does not exist — each is dropped rather than stored, because a
 * record that does not match its own entity definition is a form that cannot be opened later.
 */
export function compileOpeningRecords(proposal, entities, newId = () => Math.random().toString(36).slice(2)) {
  /**
   * Matched by id first, then by the words a human would use.
   *
   * Models name things the way people do. Asked for the `city` field, a real one answered `City`;
   * asked which entity a row belongs to, it answered with the plural label. Rejecting those is
   * technically defensible and practically wrong — the intent is unambiguous, and the alternative is
   * an empty workspace. Anything that still matches nothing is dropped, which is the part that
   * matters: a field this workspace does not have never reaches storage.
   */
  const key = value => String(value ?? '').trim().toLowerCase()
  const byId = new Map()
  for (const entity of entities) {
    for (const name of [entity.id, entity.label, entity.pluralLabel]) if (name) byId.set(key(name), entity)
  }
  const created = new Map()
  const labelIndex = new Map()

  for (const candidate of Array.isArray(proposal?.records) ? proposal.records.slice(0, 60) : []) {
    const entity = byId.get(key(candidate?.entityId))
    if (!entity) continue
    const rows = created.get(entity.id) ?? []
    // Twelve placeholders is already the point at which a table stops being a head start.
    if (rows.length >= 12) continue

    const fields = new Map()
    for (const field of entity.fields ?? []) {
      fields.set(key(field.id), field)
      if (field.label && !fields.has(key(field.label))) fields.set(key(field.label), field)
    }
    const record = { id: newId(), createdAt: new Date().toISOString() }
    const label = String(candidate?.label ?? '').trim()
    if (label && fields.has(key(entity.primaryField))) record[entity.primaryField] = label.slice(0, 300)

    for (const pair of Array.isArray(candidate?.values) ? candidate.values.slice(0, 24) : []) {
      const field = fields.get(key(pair?.field))
      const value = String(pair?.value ?? '').trim()
      if (!field || !value) continue
      if (field.type === 'select' && field.options?.length && !field.options.includes(value)) continue
      if (field.type === 'relation') {
        const target = labelIndex.get(`${field.relationEntityId}:${value.toLowerCase()}`)
        if (!target) continue
        record[field.id] = target
        continue
      }
      record[field.id] = value.slice(0, 300)
    }

    // A record with nothing in it but an id is a blank row, which is worse than no row.
    if (!Object.keys(record).some(key => key !== 'id' && key !== 'createdAt')) continue
    rows.push(record)
    created.set(entity.id, rows)
    const primary = String(record[entity.primaryField] ?? '').toLowerCase()
    if (primary) labelIndex.set(`${entity.id}:${primary}`, record.id)
  }

  return { records: Object.fromEntries(created), summary: String(proposal?.summary ?? '').slice(0, 400) }
}
