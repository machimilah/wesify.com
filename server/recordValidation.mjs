function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 })
}

function blank(value) {
  return value === undefined || value === null || value === ''
}

function normalize(field, value) {
  if (blank(value)) return value === null ? '' : value
  if (field.type === 'number' || field.type === 'currency') {
    const number = Number(value)
    if (!Number.isFinite(number)) invalid(`${field.label} must be a valid number.`)
    return number
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') invalid(`${field.label} must be yes or no.`)
    return value
  }
  const text = String(value).trim()
  if (field.type === 'select' && field.options?.length && !field.options.includes(text)) invalid(`${field.label} must be one of: ${field.options.join(', ')}.`)
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) invalid(`${field.label} must be a valid email address.`)
  if (field.type === 'date' && Number.isNaN(Date.parse(text))) invalid(`${field.label} must be a valid date.`)
  const maximum = field.type === 'long-text' ? 20_000 : field.type === 'file' ? 4_000 : 2_000
  if (text.length > maximum) invalid(`${field.label} is too long.`)
  return text
}

/** The authoritative record boundary used by people, agents, imports, and automations alike. */
export function validateRecordValues(entity, input, { partial = false, data = {}, checkRelations = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Record values must be an object.')
  const definitions = new Map(entity.fields.map(field => [field.id, field]))
  const output = {}
  for (const [key, value] of Object.entries(input)) {
    const field = definitions.get(key)
    if (!field) continue
    const normalized = normalize(field, value)
    if (field.required && blank(normalized)) invalid(`${field.label} is required.`)
    output[key] = normalized
  }
  if (!partial) for (const field of entity.fields.filter(item => item.required)) {
    if (blank(output[field.id])) invalid(`${field.label} is required.`)
  }
  if (checkRelations) for (const field of entity.fields.filter(item => item.type === 'relation' && item.relationEntityId)) {
    const value = output[field.id]
    if (!blank(value) && !(data[field.relationEntityId] ?? []).some(record => record.id === value)) invalid(`${field.label} must reference an existing record.`)
  }
  return output
}
