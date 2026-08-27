import { erpFieldType, erpModelFor, erpPrefixArchetypes, type ErpModelMapping } from '../data/erpModelMap'
import { emptyArchitecture, emptyBusinessState, type ArchitectureContext, type ArchitectureField, type BusinessState } from './businessDiscovery'
import { capabilityIds as knownCapabilityIds } from './capabilityCatalog'
import { moduleIds, type ModuleId } from './blueprint'
import { slug } from './shared'
import type { FieldType } from './workspaceSchema'

/**
 * A company, read out of its own ERP.
 *
 * Wesify's interview asks an operator to describe their operation from memory. This asks their
 * system instead, and for the structural half of the question the system is the better witness: it
 * knows which modules hold records and which have sat empty since the day they were installed, it
 * knows the fields somebody paid to add, and it knows what the company calls each state a job passes
 * through. None of that survives being remembered.
 *
 * What comes out is the same pair the interview produces — a `BusinessState` and an
 * `ArchitectureContext` — so everything downstream is untouched: the capability planner, the
 * completeness check against APQC and SCOR, the compile, the versioned build, promote and rollback.
 * That is the whole reason this returns those two shapes rather than a workspace.
 *
 * The one thing it will not do is guess. A model with no records contributes nothing, a field type
 * Odoo does not name is text, and a relation to a record type that is not being imported is dropped
 * rather than built as a dropdown nobody can fill.
 */

export interface ErpField {
  name: string
  label: string
  type: string
  required: boolean
  relation: string
  selection: Array<{ value: string; label: string }>
  custom: boolean
}

export interface ErpModel {
  model: string
  label: string
  count: number
  custom: boolean
  fields: ErpField[]
}

export interface ErpIntrospection {
  provider: string
  at: string
  company: { name: string; country: string; currency: string }
  modules: Array<{ name: string; label: string }>
  models: ErpModel[]
  roles: Array<{ name: string }>
}

/** One entity's worth of instructions for the import, handed to the server at sync time. */
export interface ErpEntityMapping {
  model: string
  entityId: string
  fields: Array<{ from: string; to: string; kind: FieldType }>
}

export interface ErpBlueprint {
  businessState: BusinessState
  architecture: ArchitectureContext
  /** What the server needs to fill the entities this blueprint just described. */
  mapping: ErpEntityMapping[]
  /** Custom models and fields, for the pass that gives them human names. */
  custom: Array<{ model: string; entityId: string; fields: ErpField[] }>
}

/** A field Odoo carries on everything, which says nothing about the company. */
const NOISE = /^(id|create_|write_|__|display_name|message_|activity_|access_|company_id|currency_id)/

const MAX_FIELDS_PER_ENTITY = 14

const stateField = (model: ErpModel) => model.fields.find(field =>
  field.selection.length >= 2 && /^(state|stage_id|status|quality_state)$/.test(field.name))

/**
 * The fields this record type actually gets.
 *
 * Curated ones first, because they land on the ids the rest of Wesify reasons about — an imported
 * invoice with a `status` and a `dueDate` gets the same overdue alert a built one would. Then every
 * custom field, unconditionally, because those are the parts of the operation this company paid to
 * make specific and dropping one would be dropping the reason they are worth importing at all.
 */
function fieldsFor(model: ErpModel, mapping: ErpModelMapping | undefined): { fields: ArchitectureField[]; mapping: ErpEntityMapping['fields'] } {
  const fields: ArchitectureField[] = []
  const wire: ErpEntityMapping['fields'] = []
  const taken = new Set<string>()

  const push = (from: string, to: string, label: string, kind: FieldType, options?: string[], required?: boolean) => {
    if (taken.has(to) || fields.length >= MAX_FIELDS_PER_ENTITY) return
    taken.add(to)
    fields.push({ label, type: kind, ...(required ? { required: true } : {}), ...(options?.length ? { options } : {}) })
    wire.push({ from, to, kind })
  }

  for (const item of mapping?.fields ?? []) {
    const present = model.fields.find(field => field.name === item.from)
    if (!present) continue
    const options = present.selection.map(option => option.label)
    // A select Odoo gave no options for is a text box, not an empty dropdown.
    const kind = item.kind === 'select' && options.length < 2 ? 'text' : item.kind
    push(item.from, item.to, item.label, kind, kind === 'select' ? options : undefined, present.required)
  }

  for (const field of model.fields) {
    if (!field.custom || NOISE.test(field.name)) continue
    const kind = erpFieldType(field.type)
    const options = field.selection.map(option => option.label)
    push(field.name, slug(field.label) || slug(field.name), field.label, kind === 'select' && options.length < 2 ? 'text' : kind, options, field.required)
  }

  return { fields, mapping: wire }
}

/** Sentence-case, because Odoo labels a state `sale` and an operator does not read it that way. */
const readable = (value: string) => value.replace(/[_-]+/g, ' ').replace(/^\w/, letter => letter.toUpperCase())

export function erpBlueprint(introspection: ErpIntrospection): ErpBlueprint {
  const used = introspection.models.filter(model => model.count > 0)
  const capabilities = new Set<string>()
  const modules = new Set<ModuleId>()
  const archetypes = new Set<string>()
  const entities: ArchitectureContext['entities'] = []
  const lifecycles: NonNullable<ArchitectureContext['lifecycles']> = []
  const mapping: ErpBlueprint['mapping'] = []
  const custom: ErpBlueprint['custom'] = []
  const pages: string[] = []
  const facts: BusinessState['facts'] = []
  const knownEntities: string[] = []

  for (const model of used) {
    const known = erpModelFor(model.model)
    const entityId = known?.entityId ?? slug(model.label || model.model)
    if (!entityId || entities.some(entity => slug(entity.name) === slug(known?.pluralLabel ?? model.label))) continue

    const module = known?.module && moduleIds.includes(known.module) ? known.module : 'processes'
    const { fields, mapping: wire } = fieldsFor(model, known)
    if (!fields.length) continue

    /**
     * A capability is claimed only by a model holding records.
     *
     * This is the line the whole approach rests on. An Odoo with Manufacturing installed and nothing
     * ever produced in it does not manufacture, and an interview that asked would have been told
     * otherwise by somebody who remembered buying the module.
     */
    for (const capabilityId of known?.capabilityIds ?? []) if (knownCapabilityIds.includes(capabilityId)) capabilities.add(capabilityId)
    for (const archetype of known?.archetypes ?? []) archetypes.add(archetype)
    // Keyed on a model that holds records, never on a module somebody merely installed.
    for (const archetype of erpPrefixArchetypes[model.model.split('.')[0]] ?? []) archetypes.add(archetype)
    modules.add(module)

    const pluralLabel = known?.pluralLabel ?? readable(model.label || model.model)
    entities.push({ name: pluralLabel, module, purpose: known?.purpose ?? `Brought across from ${model.model}`, fields })
    pages.push(pluralLabel)
    knownEntities.push(pluralLabel)
    mapping.push({ model: model.model, entityId, fields: wire })

    // The states this company actually uses, in the words it uses for them. Everything in a Wesify
    // workspace that groups, filters or alerts is built from these.
    const state = stateField(model)
    if (state) lifecycles.push({ entity: pluralLabel, states: state.selection.map(option => option.label).slice(0, 12) })

    const customFields = model.fields.filter(field => field.custom && !NOISE.test(field.name))
    if (customFields.length) custom.push({ model: model.model, entityId, fields: customFields })

    facts.push({
      topic: pluralLabel,
      value: `${model.count} record${model.count === 1 ? '' : 's'} in ${model.model}`,
      status: 'explicit',
      confidence: 0.95,
      evidence: `Counted in the company's own Odoo on ${introspection.at.slice(0, 10)}`,
      basis: 'research',
    })
  }

  /**
   * An installed module nobody has used is worth recording as a fact, not as a capability.
   *
   * It is the most interesting thing an ERP can say about a company — somebody bought this and it
   * never took — and it belongs in front of the operator at the review step rather than silently
   * shaping the build.
   */
  const emptyModules = introspection.models.filter(model => model.count === 0).map(model => model.model)
  if (emptyModules.length) {
    facts.push({
      topic: 'Installed but unused',
      value: emptyModules.slice(0, 8).join(', '),
      status: 'explicit',
      confidence: 0.9,
      evidence: 'These Odoo record types hold no records at all',
      basis: 'research',
    })
  }

  // Described by what the company keeps records of, not by what it owns a licence for.
  const businessState: BusinessState = {
    ...emptyBusinessState(),
    companySummary: `${introspection.company.name || 'This company'} runs on Odoo${knownEntities.length ? `, keeping ${knownEntities.slice(0, 6).join(', ').toLowerCase()}` : ''}.`,
    industry: introspection.company.country ? `${introspection.company.name || 'Company'} · ${introspection.company.country}` : introspection.company.name,
    facts,
    currentTools: ['Odoo'],
    knownEntities,
    locations: introspection.company.country ? [introspection.company.country] : [],
    operations: entities.map(entity => `${entity.name}: ${entity.purpose}`),
    softwareImplications: [`Rebuilt from an existing Odoo with ${used.length} record types in use.`],
  }

  const architecture: ArchitectureContext = {
    ...emptyArchitecture(),
    title: introspection.company.name || 'Command Center',
    summary: `Rebuilt from ${introspection.company.name || 'this company'}'s Odoo.`,
    explanation: `Wesify read ${introspection.models.length} record types out of Odoo and rebuilt the ${used.length} that are actually in use, including the fields added specifically for this company.`,
    modules: [...modules],
    startView: [...modules][0] ?? 'overview',
    capabilityIds: [...capabilities],
    pages,
    entities,
    lifecycles,
    archetypes: [...archetypes],
    processStages: lifecycles[0]?.states ?? [],
  }

  return { businessState, architecture, mapping, custom }
}
