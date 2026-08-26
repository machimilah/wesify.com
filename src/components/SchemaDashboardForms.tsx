import { ArrowRight, BookOpen, Bot, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JournalLineInput } from '../engine/accountingClient'
import { capabilityById } from '../engine/capabilityCatalog'
import { documentSupportsLines, loadDocumentLines, type DocumentLine } from '../engine/documentClient'
import { evaluateActionControl } from '../engine/governanceArchitecture'
import { planWorkspaceMutation } from '../engine/mutationArchitecture'
import type { RecordTransition } from '../engine/operatingSuite'
import type { GeneratedProjectManifest } from '../engine/projectClient'
import { humanize } from '../engine/shared'
import type { BusinessRecord, WorkspaceAction, WorkspaceRecords } from '../engine/workspaceActions'
import type { EntityDefinition, WorkspaceConfiguration } from '../engine/workspaceSchema'

const money = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(value)
const emptyJournalLine = (): JournalLineInput => ({ account: '', debit: 0, credit: 0, memo: '' })

export function JournalPostForm({ accounts, accountEntity, onClose, onSubmit }: { accounts: BusinessRecord[]; accountEntity?: EntityDefinition; onClose: () => void; onSubmit: (input: { reference: string; date: string; memo?: string; idempotencyKey: string; lines: JournalLineInput[] }) => Promise<void> }) {
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<JournalLineInput[]>([emptyJournalLine(), emptyJournalLine()])
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const debitTotal = Math.round(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0) * 100) / 100
  const creditTotal = Math.round(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0) * 100) / 100
  const difference = Math.round((debitTotal - creditTotal) * 100) / 100
  const balanced = lines.length >= 2 && debitTotal > 0 && difference === 0 && lines.every(line => line.account && ((line.debit > 0) !== (line.credit > 0)))
  const updateLine = (index: number, values: Partial<JournalLineInput>) => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...values } : line))
  const accountLabel = (account: BusinessRecord) => [account.code, account[accountEntity?.primaryField ?? 'name']].filter(Boolean).join(' · ') || account.id
  return <div className="bo-modal-backdrop"><form className="bo-journal-form" onSubmit={event => { event.preventDefault(); if (!balanced) return; setSaving(true); setProblem(''); void onSubmit({ reference, date, memo, idempotencyKey, lines }).catch(error => setProblem(error instanceof Error ? error.message : 'Wesify could not post that journal.')).finally(() => setSaving(false)) }}>
    <header><span><BookOpen size={17}/></span><div><small>GENERAL LEDGER</small><strong>Post balanced journal</strong></div><button type="button" onClick={onClose} aria-label="Close"><X size={17}/></button></header>
    <section className="bo-journal-header"><label><span>Reference *</span><input required value={reference} onChange={event => setReference(event.target.value)} placeholder="e.g. ACCRUAL-2026-08"/></label><label><span>Posting date *</span><input type="date" required value={date} onChange={event => setDate(event.target.value)}/></label><label><span>Memo</span><input value={memo} onChange={event => setMemo(event.target.value)} placeholder="Purpose of this journal"/></label></section>
    <section className="bo-journal-lines"><header><span>Account</span><span>Debit</span><span>Credit</span><i/></header>{lines.map((line, index) => <div key={index}><select required value={line.account} onChange={event => updateLine(index, { account: event.target.value })} aria-label={`Account for line ${index + 1}`}><option value="">Choose account</option>{accounts.map(account => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select><input type="number" min="0" step="0.01" value={line.debit || ''} onChange={event => updateLine(index, { debit: Number(event.target.value), ...(Number(event.target.value) > 0 ? { credit: 0 } : {}) })} aria-label={`Debit for line ${index + 1}`}/><input type="number" min="0" step="0.01" value={line.credit || ''} onChange={event => updateLine(index, { credit: Number(event.target.value), ...(Number(event.target.value) > 0 ? { debit: 0 } : {}) })} aria-label={`Credit for line ${index + 1}`}/><button type="button" disabled={lines.length <= 2} onClick={() => setLines(current => current.filter((_, lineIndex) => lineIndex !== index))} title="Remove line" aria-label={`Remove line ${index + 1}`}><Trash2 size={14}/></button></div>)}</section>
    <div className="bo-journal-add"><button type="button" onClick={() => setLines(current => [...current, emptyJournalLine()])}><Plus size={14}/> Add line</button></div>
    <section className="bo-journal-totals"><span><small>Debits</small><strong>{money(debitTotal)}</strong></span><span><small>Credits</small><strong>{money(creditTotal)}</strong></span><span className={difference === 0 && debitTotal > 0 ? 'balanced' : 'unbalanced'}><small>Difference</small><strong>{money(difference)}</strong></span></section>
    {problem && <p role="alert">{problem}</p>}
    <footer><button type="button" onClick={onClose}>Cancel</button><button disabled={!balanced || saving}>{saving ? 'Posting...' : 'Post journal'}</button></footer>
  </form></div>
}

const emptyDocumentLine = (): DocumentLine => ({ description: '', quantity: 1, unitPrice: 0, discountPercent: 0, taxPercent: 0 })
const lineSubtotal = (line: DocumentLine) => Number(line.quantity || 0) * Number(line.unitPrice || 0) * (1 - Number(line.discountPercent || 0) / 100)
const lineTotal = (line: DocumentLine) => lineSubtotal(line) * (1 + Number(line.taxPercent || 0) / 100)

export function RecordForm({ entity, entities, records, workspaceId, copyLinesFrom, initialRecord, initialValues = {}, transitions = [], onTransition, onClose, onSubmit, onDelete, onChangeEntity }: { entity: EntityDefinition; entities: EntityDefinition[]; records: WorkspaceRecords; workspaceId?: string; copyLinesFrom?: { entityId: string; recordId: string }; initialRecord?: BusinessRecord; initialValues?: Record<string, string | number | boolean>; transitions?: RecordTransition[]; onTransition?: (transition: RecordTransition) => void; onClose: () => void; onSubmit: (values: Record<string, string | number | boolean>, lines?: DocumentLine[]) => Promise<void>; onDelete?: () => void; onChangeEntity: (entity: EntityDefinition) => void }) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => initialRecord ? Object.fromEntries(entity.fields.filter(item => initialRecord[item.id] !== undefined).map(item => [item.id, initialRecord[item.id]])) : initialValues)
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const supportsLines = documentSupportsLines(entity)
  const amountField = entity.fields.find(field => field.type === 'currency' && ['amount', 'total', 'value'].includes(field.id))
  const products = records.products ?? []
  const productEntity = entities.find(item => item.id === 'products')
  useEffect(() => {
    setLines([])
    setProblem('')
    const copySourceEntity = copyLinesFrom ? entities.find(item => item.id === copyLinesFrom.entityId) : undefined
    const source = initialRecord ? { entityId: entity.id, recordId: initialRecord.id } : copySourceEntity && documentSupportsLines(copySourceEntity) ? copyLinesFrom : undefined
    if (!supportsLines || !source || !workspaceId) { setLinesLoading(false); return }
    let cancelled = false
    setLinesLoading(true)
    void loadDocumentLines(workspaceId, source.entityId, source.recordId)
      .then(result => { if (!cancelled) setLines(result) })
      .catch(error => { if (!cancelled) setProblem(error instanceof Error ? error.message : 'Wesify could not load the document lines.') })
      .finally(() => { if (!cancelled) setLinesLoading(false) })
    return () => { cancelled = true }
  }, [copyLinesFrom?.entityId, copyLinesFrom?.recordId, entity.id, initialRecord?.id, supportsLines, workspaceId])
  const update = (id: string, value: string | number | boolean) => setValues(current => ({ ...current, [id]: value }))
  const updateLine = (index: number, values: Partial<DocumentLine>) => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...values } : line))
  const chooseProduct = (index: number, productId: string) => setLines(current => current.map((line, lineIndex) => {
    if (lineIndex !== index) return line
    const product = products.find(item => item.id === productId)
    return { ...line, productId, description: line.description || String(product?.[productEntity?.primaryField ?? 'name'] ?? ''), unitPrice: line.unitPrice || Number(product?.price ?? product?.unitPrice ?? 0) }
  }))
  const subtotal = lines.reduce((sum, line) => sum + lineSubtotal(line), 0)
  const tax = lines.reduce((sum, line) => sum + lineSubtotal(line) * Number(line.taxPercent || 0) / 100, 0)
  const total = subtotal + tax
  const submitValues = lines.length && amountField ? { ...values, [amountField.id]: Math.round(total * 100) / 100 } : values
  return <div className="bo-modal-backdrop"><form className={`bo-schema-form${supportsLines ? ' bo-schema-form--document' : ''}`} onSubmit={event => { event.preventDefault(); setSaving(true); setProblem(''); void onSubmit(submitValues, supportsLines ? lines : undefined).catch(error => setProblem(error instanceof Error ? error.message : 'Wesify could not save this record.')).finally(() => setSaving(false)) }}><header><div><small>{initialRecord ? 'EDIT' : 'CREATE'}</small>{initialRecord ? <strong>{entity.label}</strong> : <select value={entity.id} onChange={event => { const next = entities.find(item => item.id === event.target.value); if (next) { setValues({}); setLines([]); onChangeEntity(next) } }}>{entities.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>}</div><button type="button" onClick={onClose} aria-label="Close"><X size={17}/></button></header><div>{entity.fields.map(item => <label key={item.id}><span>{item.label}{item.required ? ' *' : ''}</span>{item.type === 'select' ? <select value={String(values[item.id] ?? '')} onChange={event => update(item.id, event.target.value)} required={item.required} data-testid={`field-${item.id}`}><option value="">Select</option>{item.options?.map(option => <option key={option}>{option}</option>)}</select> : item.type === 'relation' ? <select value={String(values[item.id] ?? '')} onChange={event => update(item.id, event.target.value)} required={item.required} data-testid={`field-${item.id}`}><option value="">Select</option>{(records[item.relationEntityId ?? ''] ?? []).map(record => { const related = entities.find(candidate => candidate.id === item.relationEntityId); return <option key={record.id} value={record.id}>{String(record[related?.primaryField ?? 'name'] ?? related?.label ?? 'Record')}</option> })}</select> : item.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[item.id])} onChange={event => update(item.id, event.target.checked)} data-testid={`field-${item.id}`}/> : item.type === 'long-text' ? <textarea value={String(values[item.id] ?? '')} onChange={event => update(item.id, event.target.value)} data-testid={`field-${item.id}`}/> : <input type={item.type === 'date' ? 'date' : item.type === 'number' || item.type === 'currency' ? 'number' : item.type === 'email' ? 'email' : 'text'} value={String(lines.length && amountField?.id === item.id ? total.toFixed(2) : values[item.id] ?? '')} disabled={Boolean(lines.length && amountField?.id === item.id)} step={item.type === 'currency' ? '0.01' : undefined} onChange={event => update(item.id, item.type === 'number' || item.type === 'currency' ? Number(event.target.value) : event.target.value)} required={item.required} data-testid={`field-${item.id}`}/>}</label>)}</div>
    {supportsLines && <section className="bo-document-lines" data-testid="document-lines"><header><div><small>LINE ITEMS</small><strong>Products &amp; services</strong></div><button type="button" onClick={() => setLines(current => [...current, emptyDocumentLine()])}><Plus size={14}/> Add line</button></header>
      {linesLoading ? <div className="bo-document-lines__empty">Loading line items...</div> : lines.length ? <div className="bo-document-lines__table"><header><span>Description</span><span>Qty</span><span>Unit price</span><span>Discount</span><span>Tax</span><span>Total</span><i/></header>{lines.map((line, index) => <div key={line.id ?? `line-${index}`}>
        <span className="bo-line-description">{products.length ? <select value={line.productId ?? ''} onChange={event => chooseProduct(index, event.target.value)} aria-label={`Product for line ${index + 1}`}><option value="">Custom line</option>{products.map(product => <option key={product.id} value={product.id}>{String(product[productEntity?.primaryField ?? 'name'] ?? 'Product')}</option>)}</select> : null}<input required value={line.description} onChange={event => updateLine(index, { description: event.target.value })} placeholder="Description" aria-label={`Description for line ${index + 1}`}/></span>
        <input type="number" min="0.0001" step="any" required value={line.quantity} onChange={event => updateLine(index, { quantity: Number(event.target.value) })} aria-label={`Quantity for line ${index + 1}`}/>
        <input type="number" min="0" step="0.01" required value={line.unitPrice} onChange={event => updateLine(index, { unitPrice: Number(event.target.value) })} aria-label={`Unit price for line ${index + 1}`}/>
        <label><input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={event => updateLine(index, { discountPercent: Number(event.target.value) })} aria-label={`Discount for line ${index + 1}`}/><em>%</em></label>
        <label><input type="number" min="0" max="100" step="0.01" value={line.taxPercent} onChange={event => updateLine(index, { taxPercent: Number(event.target.value) })} aria-label={`Tax for line ${index + 1}`}/><em>%</em></label>
        <strong>{money(lineTotal(line))}</strong><button type="button" onClick={() => setLines(current => current.filter((_, lineIndex) => lineIndex !== index))} title="Remove line" aria-label={`Remove line ${index + 1}`}><Trash2 size={14}/></button>
      </div>)}</div> : <div className="bo-document-lines__empty"><span>No line items yet</span><button type="button" onClick={() => setLines([emptyDocumentLine()])}>Add the first line</button></div>}
      <footer><span><small>Subtotal</small><strong>{money(subtotal)}</strong></span><span><small>Tax</small><strong>{money(tax)}</strong></span><span><small>Total</small><strong>{money(total)}</strong></span></footer>
    </section>}
    {problem && <p className="bo-form-problem" role="alert">{problem}</p>}{transitions.length > 0 && <section className="bo-record-transitions"><small>CONTINUE THIS FLOW</small><div>{transitions.map(transition => <button type="button" key={transition.entity.id} onClick={() => onTransition?.(transition)}><span>{transition.label}</span><ArrowRight size={14}/></button>)}</div></section>}<footer>{onDelete && <button type="button" className="bo-record-delete" onClick={onDelete}>Delete</button>}<button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving || linesLoading} data-testid="schema-create-record">{saving ? 'Saving...' : initialRecord ? 'Save changes' : `Create ${entity.label.toLowerCase()}`}</button></footer></form></div>
}

export function ChangePreview({ action, config, candidate, onCancel, onApply }: { action: WorkspaceAction; config: WorkspaceConfiguration; candidate: GeneratedProjectManifest | null; onCancel: () => void; onApply: () => void }) {
  const description = action.type === 'add_field' ? `Add “${action.field.label}” to ${config.entities.find(item => item.id === action.entityId)?.pluralLabel}.` : action.type === 'create_workflow' ? `Create the automation “${action.workflow.name}”.` : action.type === 'delete_record' ? `Delete this ${config.entities.find(item => item.id === action.entityId)?.label.toLowerCase()} record.` : action.type === 'activate_module' ? `Add ${action.capabilityId ? capabilityById.get(action.capabilityId)?.label ?? action.capabilityId : action.entities.map(entity => entity.pluralLabel).join(', ')} and everything it requires.` : action.type === 'deactivate_capability' ? `Remove ${capabilityById.get(action.capabilityId)?.label ?? action.capabilityId} from the visible workspace. Existing data stays recoverable.` : `Apply ${action.type.replaceAll('_', ' ')}.`
  const plan = planWorkspaceMutation(config, action)
  const control = evaluateActionControl(config, action)
  const affected = [plan.affected.entityIds.length && `${plan.affected.entityIds.length} data types`, plan.affected.viewIds.length && `${plan.affected.viewIds.length} views`, plan.affected.workflowIds.length && `${plan.affected.workflowIds.length} workflows`, plan.affected.kpiIds.length && `${plan.affected.kpiIds.length} KPIs`, plan.affected.agentIds.length && `${plan.affected.agentIds.length} agents`, plan.affected.eventTypes.length && `${plan.affected.eventTypes.length} event types`].filter(Boolean).join(' · ')
  return <div className="bo-modal-backdrop"><section className="bo-change-preview"><span><Bot size={18}/></span><small>TESTED WORKSPACE PREVIEW</small><h2>Wesify prepared your update</h2><div className="bo-change-impact"><strong>{description}</strong><span>Autonomy level {control.level}: {humanize(control.disposition)}</span>{affected && <span>Affects {affected}</span>}{plan.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>{candidate && <div className="bo-candidate-preview"><strong>Version {candidate.version} passed its checks</strong><span>{candidate.pages.map(page => page.label).join(' · ')}</span><span>{candidate.specializedComponents.map(component => component.label).join(' · ')}</span></div>}<footer><button onClick={onCancel}>Request changes</button><button onClick={onApply}>Apply changes</button></footer></section></div>
}
