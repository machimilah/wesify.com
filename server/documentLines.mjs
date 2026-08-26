import { randomUUID } from 'node:crypto'

export const DOCUMENT_LINE_KEY = '_document-lines'

const documentId = /(^|[-_])(quote|estimate|order|invoice|bill|credit-note)s?($|[-_])/i

export function documentAmountField(entity) {
  if (!entity || !documentId.test(entity.id)) return null
  return entity.fields.find(field => field.type === 'currency' && ['amount', 'total', 'value'].includes(field.id))
    ?? entity.fields.find(field => field.type === 'currency')
    ?? null
}

export function documentSupportsLines(entity) {
  return Boolean(documentAmountField(entity))
}

const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100

function numberInRange(value, label, minimum, maximum, fallback) {
  if (value === '' || value == null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw Object.assign(new Error(`${label} must be between ${minimum} and ${maximum}.`), { status: 400 })
  }
  return parsed
}

function cleanText(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum)
}

export function linesForDocument(data, entityId, recordId) {
  return (data[DOCUMENT_LINE_KEY] ?? []).filter(line => line.parentEntityId === entityId && line.parentRecordId === recordId)
}

/** Replaces one document's lines and recalculates its authoritative monetary totals. */
export function replaceDocumentLines({ workspaceId, entity, record, data, input }) {
  if (!documentSupportsLines(entity)) throw Object.assign(new Error('This record type does not support document lines.'), { status: 400 })
  const candidates = Array.isArray(input) ? input : input?.lines
  if (!Array.isArray(candidates)) throw Object.assign(new Error('Document lines must be an array.'), { status: 400 })
  if (candidates.length > 200) throw Object.assign(new Error('A document can contain up to 200 lines.'), { status: 400 })

  const current = new Map(linesForDocument(data, entity.id, record.id).map(line => [line.id, line]))
  const products = data.products ?? []
  const now = new Date().toISOString()
  const lines = candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw Object.assign(new Error(`Line ${index + 1} is invalid.`), { status: 400 })
    const productId = cleanText(candidate.productId, 120)
    const product = productId ? products.find(item => item.id === productId) : null
    if (productId && !product) throw Object.assign(new Error(`Line ${index + 1} refers to a product that no longer exists.`), { status: 400 })
    const description = cleanText(candidate.description || product?.name, 300)
    if (!description) throw Object.assign(new Error(`Line ${index + 1} needs a description or product.`), { status: 400 })
    const quantity = numberInRange(candidate.quantity, `Line ${index + 1} quantity`, 0.0001, 1_000_000, 1)
    const unitPrice = numberInRange(candidate.unitPrice, `Line ${index + 1} unit price`, 0, 1_000_000_000, Number(product?.price ?? product?.unitPrice ?? 0))
    const discountPercent = numberInRange(candidate.discountPercent, `Line ${index + 1} discount`, 0, 100, 0)
    const taxPercent = numberInRange(candidate.taxPercent, `Line ${index + 1} tax`, 0, 100, 0)
    const subtotal = roundMoney(quantity * unitPrice * (1 - discountPercent / 100))
    const taxAmount = roundMoney(subtotal * taxPercent / 100)
    const prior = current.get(cleanText(candidate.id, 120))
    return {
      id: prior?.id ?? randomUUID(), workspaceId, parentEntityId: entity.id, parentRecordId: record.id,
      ...(productId ? { productId } : {}), description, quantity, unitPrice, discountPercent, taxPercent,
      subtotal, taxAmount, total: roundMoney(subtotal + taxAmount), createdAt: prior?.createdAt ?? now, updatedAt: now,
    }
  })

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0))
  const taxAmount = roundMoney(lines.reduce((sum, line) => sum + line.taxAmount, 0))
  const amount = roundMoney(lines.reduce((sum, line) => sum + line.total, 0))
  const amountField = documentAmountField(entity)
  const document = { ...record, [amountField.id]: amount, subtotal, taxAmount, updatedAt: now }
  if (entity.fields.some(field => field.id === 'balance')) {
    const paid = (data.payments ?? [])
      .filter(payment => payment.invoice === record.id && /completed|paid|received/i.test(String(payment.status ?? '')))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
    document.balance = roundMoney(Math.max(0, amount - paid))
  }

  const otherLines = (data[DOCUMENT_LINE_KEY] ?? []).filter(line => line.parentEntityId !== entity.id || line.parentRecordId !== record.id)
  return {
    data: {
      ...data,
      [entity.id]: (data[entity.id] ?? []).map(item => item.id === record.id ? document : item),
      [DOCUMENT_LINE_KEY]: [...otherLines, ...lines],
    },
    document,
    lines,
    summary: { subtotal, taxAmount, amount },
  }
}

export function removeDocumentLines(data, entityId, recordId) {
  if (!Array.isArray(data[DOCUMENT_LINE_KEY])) return data
  return { ...data, [DOCUMENT_LINE_KEY]: data[DOCUMENT_LINE_KEY].filter(line => line.parentEntityId !== entityId || line.parentRecordId !== recordId) }
}
