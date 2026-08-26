import { randomUUID } from 'node:crypto'

const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100
const clean = (value, maximum) => String(value ?? '').trim().slice(0, maximum)

function money(value, label) {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000_000) throw Object.assign(new Error(`${label} must be a valid positive amount.`), { status: 400 })
  return roundMoney(parsed)
}

/** Builds a complete, balanced journal batch before any ledger row is persisted. */
export function postBalancedJournal({ workspaceId, manifest, data, input }) {
  const journalEntity = manifest.entities.find(entity => entity.id === 'journal-entries')
  const accountEntity = manifest.entities.find(entity => entity.id === 'accounts')
  if (!journalEntity || !accountEntity) throw Object.assign(new Error('Accounting journal posting is not installed in this workspace.'), { status: 400 })
  const reference = clean(input?.reference, 120)
  if (!reference) throw Object.assign(new Error('A journal reference is required.'), { status: 400 })
  const idempotencyKey = clean(input?.idempotencyKey || reference, 160)
  const existing = (data['journal-entries'] ?? []).filter(entry => entry._journalPostKey === idempotencyKey)
  if (existing.length) return { data, entries: existing, batchId: existing[0]._journalBatchId, total: roundMoney(existing.reduce((sum, entry) => sum + Number(entry.debit ?? 0), 0)), existing: true }
  const candidates = input?.lines
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 100) throw Object.assign(new Error('A journal needs between 2 and 100 lines.'), { status: 400 })
  const accounts = data.accounts ?? []
  const lines = candidates.map((line, index) => {
    const account = clean(line?.account, 120)
    if (!accounts.some(item => item.id === account)) throw Object.assign(new Error(`Line ${index + 1} needs a valid ledger account.`), { status: 400 })
    const debit = money(line.debit, `Line ${index + 1} debit`)
    const credit = money(line.credit, `Line ${index + 1} credit`)
    if ((debit > 0) === (credit > 0)) throw Object.assign(new Error(`Line ${index + 1} must have either a debit or a credit, but not both.`), { status: 400 })
    return { account, debit, credit, memo: clean(line.memo || input.memo, 500) }
  })
  const debitTotal = roundMoney(lines.reduce((sum, line) => sum + line.debit, 0))
  const creditTotal = roundMoney(lines.reduce((sum, line) => sum + line.credit, 0))
  if (debitTotal <= 0 || Math.abs(debitTotal - creditTotal) > 0.001) throw Object.assign(new Error(`Journal is out of balance by ${roundMoney(debitTotal - creditTotal)}.`), { status: 409 })

  const now = new Date().toISOString()
  const batchId = randomUUID()
  const supportsStatus = journalEntity.fields.some(field => field.id === 'status')
  const entries = lines.map(line => ({
    id: randomUUID(), workspaceId, reference, date: clean(input.date, 20) || now.slice(0, 10), account: line.account,
    debit: line.debit, credit: line.credit, memo: line.memo, ...(supportsStatus ? { status: 'Posted' } : {}),
    _journalBatchId: batchId, _journalPostKey: idempotencyKey, createdAt: now, updatedAt: now,
  }))
  return { data: { ...data, 'journal-entries': [...(data['journal-entries'] ?? []), ...entries] }, entries, batchId, total: debitTotal, existing: false }
}
