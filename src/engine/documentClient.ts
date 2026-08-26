import { apiUrl } from './apiBase'
import { workspaceAccessHeaders } from './workspaceAccess'
import type { EntityDefinition } from './workspaceSchema'

export interface DocumentLine {
  id?: string
  productId?: string
  description: string
  quantity: number
  unitPrice: number
  discountPercent: number
  taxPercent: number
  subtotal?: number
  taxAmount?: number
  total?: number
}

const documentId = /(^|[-_])(quote|estimate|order|invoice|bill|credit-note)s?($|[-_])/i

export function documentSupportsLines(entity: EntityDefinition) {
  return documentId.test(entity.id) && entity.fields.some(field => field.type === 'currency' && ['amount', 'total', 'value'].includes(field.id))
}

async function request<T>(workspaceId: string, entityId: string, recordId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(`/api/projects/${workspaceId}/records/${entityId}/${recordId}/lines`), {
    ...init,
    headers: { 'content-type': 'application/json', ...(await workspaceAccessHeaders(workspaceId)), ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? 'Wesify could not save the document lines.')
  }
  return response.json() as Promise<T>
}

export function loadDocumentLines(workspaceId: string, entityId: string, recordId: string) {
  return request<DocumentLine[]>(workspaceId, entityId, recordId)
}

export function saveDocumentLines(workspaceId: string, entityId: string, recordId: string, lines: DocumentLine[]) {
  return request<{ document: Record<string, string | number | boolean>; lines: DocumentLine[]; summary: { subtotal: number; taxAmount: number; amount: number } }>(workspaceId, entityId, recordId, { method: 'PUT', body: JSON.stringify({ lines }) })
}

export async function convertBusinessRecord(workspaceId: string, sourceEntityId: string, sourceRecordId: string, targetEntityId: string, values: Record<string, string | number | boolean>, lines?: DocumentLine[]) {
  const response = await fetch(apiUrl(`/api/projects/${workspaceId}/records/${sourceEntityId}/${sourceRecordId}/convert`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await workspaceAccessHeaders(workspaceId)) },
    body: JSON.stringify({ targetEntityId, values, ...(lines?.length ? { lines } : {}) }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? 'Wesify could not continue that business flow.')
  }
  return response.json() as Promise<{ record: Record<string, string | number | boolean> & { id: string }; copiedLines: number; existing: boolean }>
}
