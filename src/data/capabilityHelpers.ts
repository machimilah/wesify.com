import type { CapabilityDefinition, CatalogEntity, CatalogField } from '../engine/capabilityCatalog'

/**
 * Field and entity builders for the capability catalog.
 *
 * These mirror the helpers inside `capabilityCatalog.ts` so the extended catalogs can be authored in
 * their own files without importing values from it — which would create a runtime import cycle, since
 * the catalog imports them back. Only types cross that boundary, and types are erased.
 */

export const text = (id: string, label: string, required = false): CatalogField => ({ id, label, type: 'text', required })
export const long = (id: string, label: string): CatalogField => ({ id, label, type: 'long-text' })
export const currency = (id: string, label: string): CatalogField => ({ id, label, type: 'currency' })
export const number = (id: string, label: string): CatalogField => ({ id, label, type: 'number' })
export const date = (id: string, label: string): CatalogField => ({ id, label, type: 'date' })
export const email = (id: string, label: string): CatalogField => ({ id, label, type: 'email' })
export const file = (id: string, label: string): CatalogField => ({ id, label, type: 'file' })
export const select = (id: string, label: string, options: string[]): CatalogField => ({ id, label, type: 'select', options })
export const relation = (id: string, label: string, relationEntityId: string): CatalogField => ({ id, label, type: 'relation', relationEntityId })

export const entity = (
  id: string,
  label: string,
  pluralLabel: string,
  primaryField: string,
  fields: CatalogField[],
  view: CatalogEntity['view'] = 'table',
  groupBy?: string,
  dateField?: string,
): CatalogEntity => ({ id, label, pluralLabel, primaryField, fields, view, groupBy, dateField })

export const capability = (definition: CapabilityDefinition) => definition
