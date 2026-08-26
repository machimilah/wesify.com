const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100

function completedPayment(payment) {
  return /completed|received|paid/i.test(String(payment.status ?? '')) && !/refund|failed|cancel/i.test(String(payment.status ?? ''))
}

/** Recalculates receivables from payment allocations after any record or document mutation. */
export function reconcileReceivables(data, manifest) {
  const invoiceEntity = manifest.entities.find(entity => entity.id === 'invoices')
  if (!invoiceEntity) return { data, changed: [], entityId: '' }
  const amountField = invoiceEntity.fields.find(field => field.type === 'currency' && ['amount', 'total', 'value'].includes(field.id))
  const balanceField = invoiceEntity.fields.find(field => field.id === 'balance')
  if (!amountField || !balanceField) return { data, changed: [], entityId: '' }
  const statusField = invoiceEntity.fields.find(field => field.id === 'status')
  const statusOptions = statusField?.options ?? []
  const changed = []
  const invoices = (data.invoices ?? []).map(invoice => {
    const amount = Math.max(0, Number(invoice[amountField.id] ?? 0))
    const paid = roundMoney((data.payments ?? []).filter(payment => payment.invoice === invoice.id && completedPayment(payment)).reduce((sum, payment) => sum + Math.max(0, Number(payment.amount ?? 0)), 0))
    if (paid > amount + 0.001) throw Object.assign(new Error(`Completed payments exceed the total for ${invoice.number ?? 'this invoice'}.`), { status: 409 })
    const balance = roundMoney(Math.max(0, amount - paid))
    let status = String(invoice.status ?? '')
    if (!/void|cancel/i.test(status)) {
      if (amount > 0 && balance === 0 && statusOptions.includes('Paid')) status = 'Paid'
      else if (paid > 0 && statusOptions.includes('Part paid')) status = 'Part paid'
      else if (paid === 0 && /paid|part paid/i.test(status)) {
        const overdue = invoice.dueDate && String(invoice.dueDate) < new Date().toISOString().slice(0, 10)
        status = overdue && statusOptions.includes('Overdue') ? 'Overdue' : statusOptions.includes('Sent') ? 'Sent' : statusOptions[0] ?? status
      }
    }
    if (Number(invoice.balance ?? 0) === balance && String(invoice.status ?? '') === status) return invoice
    const updated = { ...invoice, balance, ...(statusField ? { status } : {}), updatedAt: new Date().toISOString() }
    changed.push(updated)
    return updated
  })
  return { data: { ...data, invoices }, changed, entityId: 'invoices' }
}
