import { AlertTriangle, ArrowRight, Check, Download, FileText, Mail, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import type { BusinessRecord, WorkspaceRecords } from '../engine/workspaceActions'
import type { MetricDefinition, WorkspaceConfiguration, WorkspaceRoleId } from '../engine/workspaceSchema'
import type { WorkspaceAuditEvent } from '../engine/projectClient'
import type { AutomationApproval } from '../engine/automationClient'
import { humanize } from '../engine/shared'
import { changeWorkspaceMemberRole, loadWorkspaceTeam, removeWorkspaceMember, revokeInvite, sendInvites, type WorkspaceTeam } from '../engine/workspaceSetupClient'

function matchesFilter(record: BusinessRecord, metric: MetricDefinition) {
  if (!metric.filter) return true
  const value = String(record[metric.filter.field] ?? '')
  if (metric.filter.equals !== undefined) return value === metric.filter.equals
  if (metric.filter.notEquals !== undefined) return value !== metric.filter.notEquals
  return true
}

export function metricValue(metric: MetricDefinition, records: WorkspaceRecords) {
  const matching = (records[metric.entityId] ?? []).filter(record => matchesFilter(record, metric))
  const value = metric.operation === 'count'
    ? matching.length
    : matching.reduce((sum, record) => sum + Number(record[metric.field ?? ''] ?? 0), 0)
  return metric.format === 'currency'
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
    : String(value)
}

export function TodayView({ config, records, approvals, navigate }: {
  config: WorkspaceConfiguration
  records: WorkspaceRecords
  approvals: AutomationApproval[]
  navigate: (id: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const navigationFor = (entityId: string) => {
    const viewIds = config.views.filter(view => view.entityId === entityId).map(view => view.id)
    return config.navigation.find(item => item.viewId && viewIds.includes(item.viewId))?.id
  }
  const invoiceEntity = config.entities.find(entity => entity.id === 'invoices')
  const taskEntity = config.entities.find(entity => entity.id === 'tasks')
  const stockEntity = config.entities.find(entity => ['stock-items', 'products'].includes(entity.id)
    && entity.fields.some(field => ['quantity', 'stock'].includes(field.id)))
  const overdueInvoices = (records[invoiceEntity?.id ?? ''] ?? []).filter(record =>
    !/paid|void/i.test(String(record.status ?? '')) && String(record.dueDate ?? '') < today && record.dueDate)
  const overdueTasks = (records[taskEntity?.id ?? ''] ?? []).filter(record =>
    !/done|complete|cancel/i.test(String(record.status ?? '')) && String(record.dueDate ?? '') < today && record.dueDate)
  const lowStock = (records[stockEntity?.id ?? ''] ?? []).filter(record =>
    Number(record.quantity ?? record.stock ?? 0) <= Number(record.reorderPoint ?? -1))
  const pendingApprovals = approvals.filter(item => item.status === 'pending')
  const items = [
    pendingApprovals.length ? { label: 'Approvals', text: `${pendingApprovals.length} decisions are waiting.`, target: config.navigation.find(item => item.kind === 'links' || item.kind === 'automations')?.id } : null,
    invoiceEntity ? { label: 'Cash', text: overdueInvoices.length ? `${overdueInvoices.length} invoices are overdue.` : 'No overdue invoices.', target: navigationFor(invoiceEntity.id) } : null,
    taskEntity ? { label: 'Operations', text: overdueTasks.length ? `${overdueTasks.length} tasks are overdue.` : 'No overdue tasks.', target: navigationFor(taskEntity.id) } : null,
    stockEntity ? { label: 'Inventory', text: lowStock.length ? `${lowStock.length} items are at or below their reorder point.` : 'No inventory alerts.', target: navigationFor(stockEntity.id) } : null,
  ].filter(Boolean) as Array<{ label: string; text: string; target?: string }>

  return <>
    <div className="bo-schema-heading"><small>DAILY OPERATIONS</small><h1>Today</h1></div>
    <section className="bo-today-list">{items.map(item =>
      <button key={item.label} disabled={!item.target} onClick={() => item.target && navigate(item.target)}>
        <span>{item.label}</span><strong>{item.text}</strong><ArrowRight size={16}/>
      </button>)}</section>
    <section className="bo-recommendations"><small>RECOMMENDED ACTIONS</small>
      {!pendingApprovals.length && !overdueInvoices.length && !overdueTasks.length && !lowStock.length
        && <div className="bo-empty-state">No urgent recommendations from current records.</div>}
    </section>
  </>
}

export function AnalyticsView({ config, records, role }: {
  config: WorkspaceConfiguration
  records: WorkspaceRecords
  role: WorkspaceRoleId
}) {
  const [period, setPeriod] = useState<'all' | '30' | '90'>('all')
  const visibleEntityIds = new Set(config.interfaceArchitecture?.pages
    .filter(page => page.roleIds.includes(role) && page.entityId)
    .map(page => page.entityId!) ?? config.entities.map(entity => entity.id))
  const cutoff = period === 'all' ? 0 : Date.now() - Number(period) * 24 * 60 * 60 * 1000
  const periodRecords: WorkspaceRecords = Object.fromEntries(Object.entries(records).map(([entityId, rows]) => [entityId, cutoff ? rows.filter(record => {
    const timestamp = Date.parse(String(record.updatedAt ?? record.createdAt ?? ''))
    return Number.isFinite(timestamp) && timestamp >= cutoff
  }) : rows]))
  const counts = config.entities
    .filter(entity => visibleEntityIds.has(entity.id))
    .map(entity => {
      const rows = periodRecords[entity.id] ?? []
      const statusField = entity.fields.find(field => field.id === 'status' || /status|stage|result/i.test(field.label) && field.type === 'select')
      const currencyField = entity.fields.find(field => field.type === 'currency')
      const open = statusField ? rows.filter(record => !/paid|complete|completed|closed|resolved|cancelled|void|rejected|lost|archived/i.test(String(record[statusField.id] ?? ''))).length : rows.length
      return { id: entity.id, label: entity.pluralLabel, count: rows.length, open, value: currencyField ? rows.reduce((sum, record) => sum + Number(record[currencyField.id] ?? 0), 0) : null, valueLabel: currencyField?.label ?? '' }
    })
    .filter(item => item.count > 0)
    .sort((left, right) => right.count - left.count)
  const metrics = config.metrics.filter(metric => metric.roles.includes(role)).slice(0, 8)
  const statusTotals = new Map<string, number>()
  for (const entity of config.entities.filter(item => visibleEntityIds.has(item.id))) {
    const statusField = entity.fields.find(field => field.id === 'status' || /status|stage|result/i.test(field.label) && field.type === 'select')
    if (!statusField) continue
    for (const record of periodRecords[entity.id] ?? []) {
      const value = String(record[statusField.id] ?? 'Unassigned')
      statusTotals.set(value, (statusTotals.get(value) ?? 0) + 1)
    }
  }
  const statuses = [...statusTotals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8)
  const maxStatus = Math.max(1, ...statuses.map(([, count]) => count))
  const today = new Date().toISOString().slice(0, 10)
  const exceptions = config.entities.flatMap(entity => {
    const statusField = entity.fields.find(field => field.id === 'status')
    const dueField = entity.fields.find(field => field.type === 'date' && /due|expiry|expected|end/i.test(`${field.id} ${field.label}`))
    return (periodRecords[entity.id] ?? []).filter(record => {
      const status = String(record[statusField?.id ?? 'status'] ?? '')
      return /overdue|blocked|failed|low stock|out of stock|disputed|breach/i.test(status) || Boolean(dueField && record[dueField.id] && String(record[dueField.id]) < today && !/paid|complete|closed|resolved|cancelled|void/i.test(status))
    }).map(record => ({ entity: entity.label, name: String(record[entity.primaryField] ?? entity.label) }))
  })
  const exportCsv = () => {
    const rows = [['Area', 'Records', 'Open', 'Value'], ...counts.map(item => [item.label, String(item.count), String(item.open), item.value === null ? '' : String(item.value)])]
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${config.profile.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'wesify'}-report.csv`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return <>
    <div className="bo-reporting-head"><div className="bo-schema-heading"><small>LIVE BUSINESS DATA</small><h1>Reporting</h1></div><button onClick={exportCsv}><Download size={15}/> Export CSV</button></div>
    <div className="bo-report-period" role="group" aria-label="Reporting period"><button className={period === 'all' ? 'active' : ''} onClick={() => setPeriod('all')}>All time</button><button className={period === '90' ? 'active' : ''} onClick={() => setPeriod('90')}>90 days</button><button className={period === '30' ? 'active' : ''} onClick={() => setPeriod('30')}>30 days</button></div>
    <section className="bo-schema-kpis">{metrics.map(metric => <article key={metric.id}>
      <small>{metric.label}</small><strong>{metricValue(metric, periodRecords)}</strong>
      <span>{humanize(metric.operation)} from {humanize(metric.entityId)}</span>
    </article>)}{!metrics.length ? <div className="bo-empty-state">No report metrics are available for this role.</div> : null}</section>
    <section className="bo-reporting-grid">
      <article className="bo-report-status"><header><div><small>STATUS MIX</small><h2>Work by stage</h2></div><span>{statuses.reduce((sum, [, count]) => sum + count, 0)} records</span></header><div>{statuses.map(([label, count]) => <div key={label}><span>{label}</span><i><b style={{ width: `${(count / maxStatus) * 100}%` }}/></i><strong>{count}</strong></div>)}{!statuses.length ? <div className="bo-empty-state">No staged work in this period.</div> : null}</div></article>
      <article className="bo-report-exceptions"><header><div><small>EXCEPTIONS</small><h2>Needs attention</h2></div><span>{exceptions.length}</span></header><div>{exceptions.slice(0, 7).map((item, index) => <span key={`${item.entity}-${item.name}-${index}`}><AlertTriangle size={14}/><b>{item.name}</b><em>{item.entity}</em></span>)}{!exceptions.length ? <div className="bo-empty-state">No operational exceptions in this period.</div> : null}</div></article>
    </section>
    <section className="bo-report-portfolio"><header><div><small>OPERATING PORTFOLIO</small><h2>Activity by area</h2></div><span>{counts.reduce((sum, item) => sum + item.count, 0)} total records</span></header><div><table><thead><tr><th>Area</th><th>Records</th><th>Open</th><th>Value</th></tr></thead><tbody>{counts.map(item => <tr key={item.id}><th>{item.label}</th><td>{item.count}</td><td>{item.open}</td><td>{item.value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(item.value)}</td></tr>)}</tbody></table>{!counts.length ? <div className="bo-empty-state">No activity in this period.</div> : null}</div></section>
  </>
}

export function ControlView({ config, records, automationApprovals, auditEvents, workspaceId, workspaceTeam, canManageTeam, onTeamChanged, onApprovalDecision }: {
  config: WorkspaceConfiguration
  records: WorkspaceRecords
  automationApprovals: AutomationApproval[]
  auditEvents: WorkspaceAuditEvent[]
  workspaceId: string
  workspaceTeam: WorkspaceTeam | null
  canManageTeam: boolean
  onTeamChanged: (team: WorkspaceTeam) => void
  onApprovalDecision: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>
}) {
  const [deciding, setDeciding] = useState('')
  const [decisionMessage, setDecisionMessage] = useState('')
  const permissions: Array<{ id: WorkspaceConfiguration['roles'][number]['permissions'][number]; label: string }> = [
    { id: 'view', label: 'View' }, { id: 'create', label: 'Create' }, { id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' },
    { id: 'approve', label: 'Approve' }, { id: 'financial', label: 'Financial' }, { id: 'people', label: 'People' }, { id: 'admin', label: 'Admin' },
  ]
  const pendingApprovals = (records.approvals ?? [])
    .filter(record => !/approved|rejected|cancelled/i.test(String(record.status ?? '')))
  const pendingAutomationApprovals = automationApprovals.filter(item => item.status === 'pending')
  const policies = config.governanceArchitecture?.policies ?? []
  // Absent in every workspace built before the completeness check existed, which is why the whole
  // panel is conditional rather than rendered empty.
  const coverage = config.coverage
  const humanControls = Object.entries(config.governanceArchitecture?.humanControl ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => humanize(name))
  const decide = async (approvalId: string, decision: 'approved' | 'rejected') => {
    setDeciding(approvalId)
    setDecisionMessage('')
    try {
      await onApprovalDecision(approvalId, decision)
      setDecisionMessage(decision === 'approved' ? 'Approved. The workflow continued.' : 'Rejected. The workflow stopped at the decision point.')
    } catch (error) {
      setDecisionMessage(error instanceof Error ? error.message : 'Wesify could not record that decision.')
    } finally {
      setDeciding('')
    }
  }

  return <>
    <div className="bo-schema-heading"><small>GOVERNANCE</small><h1>Access &amp; control</h1>
      <p>Roles, approvals, action boundaries and audit evidence for this workspace.</p>
    </div>
    <section className="bo-control-summary">
      <article><small>Roles</small><strong>{config.roles.length}</strong><span>Configured access profiles</span></article>
      <article><small>Pending approvals</small><strong>{pendingApprovals.length + pendingAutomationApprovals.length}</strong><span>Business decisions waiting</span></article>
      <article><small>Controlled actions</small><strong>{policies.length}</strong><span>Typed action policies</span></article>
      <article><small>Audit events</small><strong>{auditEvents.length}</strong><span>Recorded administrative actions</span></article>
    </section>
    {(pendingAutomationApprovals.length > 0 || pendingApprovals.length > 0) && <section className="bo-approval-queue" data-testid="approval-queue">
      <header><div><small>DECISION QUEUE</small><h2>Waiting for approval</h2></div><span>{pendingAutomationApprovals.length + pendingApprovals.length} pending</span></header>
      <div>
        {pendingAutomationApprovals.map(approval => <article key={approval.id}>
          <ShieldCheck size={16}/><span><strong>{approval.automationName}</strong><small>{approval.message}</small></span>
          <button disabled={Boolean(deciding)} onClick={() => void decide(approval.id, 'rejected')}>Reject</button>
          <button className="primary" disabled={Boolean(deciding)} onClick={() => void decide(approval.id, 'approved')}>{deciding === approval.id ? 'Saving...' : 'Approve'}</button>
        </article>)}
        {pendingApprovals.map(record => <article key={record.id}><FileText size={16}/><span><strong>{String(record.name ?? record.title ?? 'Business approval')}</strong><small>{String(record.status ?? 'Pending review')}</small></span><em>Open the approval record to decide</em></article>)}
      </div>
      {decisionMessage && <p>{decisionMessage}</p>}
    </section>}
    <TeamControl workspaceId={workspaceId} team={workspaceTeam} canManage={canManageTeam} onChanged={onTeamChanged}/>
    <section className="bo-permission-matrix" data-testid="permission-matrix">
      <header><div><small>ACCESS MODEL</small><h2>Role permissions</h2></div><span>Effective workspace policy</span></header>
      <div className="bo-permission-matrix__scroll"><table><thead><tr><th>Role</th>
        {permissions.map(permission => <th key={permission.id}>{permission.label}</th>)}
      </tr></thead><tbody>{config.roles.map(role => <tr key={role.id}><th>{role.label}</th>
        {permissions.map(permission => {
          const allowed = role.permissions.includes(permission.id) || role.permissions.includes('admin')
          return <td key={permission.id}><span className={allowed ? 'allowed' : 'denied'} aria-label={allowed ? 'Allowed' : 'Not allowed'}>
            {allowed ? <Check size={14}/> : <>&mdash;</>}
          </span></td>
        })}
      </tr>)}</tbody></table></div>
    </section>
    {coverage && <section className="bo-control-detail" data-testid="operating-coverage">
      {/**
       * What Wesify checked this workspace against, kept where the controls are.
       *
       * The build was compared to the APQC process framework — plus SCOR and ISA-95 where they apply
       * — and this is the part of that an operator has to see: what kind of company Wesify concluded
       * they run, what it could not close on its own, and what nobody may take Wesify's word for. The
       * regulatory half never states a rule. It names the subject and the kind of authority to ask,
       * because Wesify does not know their jurisdiction and somebody would act on what it wrote.
       */}
      <article><header><small>OPERATING MODEL</small><h2>How Wesify read this company</h2></header>
        {coverage.archetypes.slice(0, 5).map(item => <div key={item.id}><ShieldCheck size={15}/><strong>{item.label}</strong><span>{item.meaning}</span></div>)}
        {coverage.blocking.filter(item => item.capabilityIds.length).slice(0, 3).map(item => <div key={item.id}><FileText size={15}/><strong>{item.label}</strong><span>{item.because}</span></div>)}
        {!coverage.archetypes.length && <div className="bo-empty-state">Nothing in this workspace describes a trading company, so no business process framework was applied to it.</div>}
      </article>
      <article><header><small>TO CONFIRM</small><h2>What nobody has verified</h2></header>
        {coverage.verify.slice(0, 3).map(item => <div key={item.id}><FileText size={15}/><strong>{item.label}</strong><span>Confirm with {item.authorities[0]}: {item.obligations.slice(0, 3).join(', ')}.</span></div>)}
        {coverage.questions.slice(0, 3).map(item => <div key={item.id}><FileText size={15}/><strong>{item.text}</strong><span>{item.because}</span></div>)}
        {!coverage.verify.length && !coverage.questions.length && <div className="bo-empty-state">Nothing outstanding. Every process this company needs is carried by something in the workspace.</div>}
      </article>
    </section>}
    <section className="bo-control-detail">
      <article><header><small>HUMAN CONTROL</small><h2>Approval boundaries</h2></header>
        {humanControls.map(item => <div key={item}><ShieldCheck size={15}/><strong>{item}</strong><span>Human approval required</span></div>)}
      </article>
      <article><header><small>AUDIT</small><h2>Recent activity</h2></header>
        {auditEvents.slice(0, 6).map(item => <div key={item.id}><FileText size={15}/>
          <strong>{humanize(item.event.replaceAll('.', '-'))}</strong>
          <span>{humanize(item.role)} / {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.at))}</span>
        </div>)}
        {!auditEvents.length && <div className="bo-empty-state">No administrative actions yet.</div>}
      </article>
    </section>
  </>
}

const managedRoles = [
  { id: 'admin', label: 'Admin' },
  { id: 'manager', label: 'Manager' },
  { id: 'employee', label: 'Employee' },
  { id: 'accountant', label: 'Accountant' },
]

function TeamControl({ workspaceId, team, canManage, onChanged }: { workspaceId: string; team: WorkspaceTeam | null; canManage: boolean; onChanged: (team: WorkspaceTeam) => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('employee')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const refresh = async () => {
    const next = await loadWorkspaceTeam(workspaceId)
    if (next) onChanged(next)
  }
  const invite = async () => {
    if (!email.trim()) return
    setBusy('invite'); setMessage('')
    const result = await sendInvites(workspaceId, [{ email: email.trim(), role: role as 'admin' | 'manager' | 'employee' | 'accountant' }])
    if (result.failed.length) setMessage(result.failed[0].message)
    else { setEmail(''); setMessage('Invitation sent.'); await refresh() }
    setBusy('')
  }
  const changeRole = async (userId: string, nextRole: string) => {
    setBusy(userId); setMessage('')
    try { await changeWorkspaceMemberRole(workspaceId, userId, nextRole); await refresh(); setMessage('Member role updated.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Wesify could not update that member.') }
    finally { setBusy('') }
  }
  const remove = async (userId: string, label: string) => {
    if (!window.confirm(`Remove ${label} from this workspace?`)) return
    setBusy(userId); setMessage('')
    try { await removeWorkspaceMember(workspaceId, userId); await refresh(); setMessage('Member removed.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Wesify could not remove that member.') }
    finally { setBusy('') }
  }
  const revoke = async (address: string) => {
    setBusy(address); setMessage('')
    try { const ok = await revokeInvite(workspaceId, address); if (!ok) throw new Error('Wesify could not withdraw that invitation.'); await refresh(); setMessage('Invitation withdrawn.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Wesify could not withdraw that invitation.') }
    finally { setBusy('') }
  }

  return <section className="bo-team-control" data-testid="team-control">
    <header><div><small>WORKSPACE TEAM</small><h2>Members &amp; roles</h2></div><span>{team ? `${team.members.length} member${team.members.length === 1 ? '' : 's'}` : 'Account mode unavailable'}</span></header>
    {canManage && team && <form onSubmit={event => { event.preventDefault(); void invite() }}>
      <label><Mail size={15}/><input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="colleague@company.com" aria-label="Email address"/></label>
      <select value={role} onChange={event => setRole(event.target.value)} aria-label="Workspace role">{managedRoles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <button disabled={busy === 'invite'}><UserPlus size={15}/>{busy === 'invite' ? 'Inviting...' : 'Invite'}</button>
    </form>}
    {team ? <div className="bo-team-list">
      {team.members.map(member => <article key={member.userId}><span><Users size={15}/></span><div><strong>{member.email || member.userId}</strong><small>Joined {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(member.joinedAt))}</small></div>
        <select value={member.role} disabled={!canManage || member.role === 'owner' || busy === member.userId} onChange={event => void changeRole(member.userId, event.target.value)} aria-label={`Role for ${member.email || member.userId}`}><option value="owner">Owner</option>{managedRoles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        {canManage && member.role !== 'owner' ? <button type="button" onClick={() => void remove(member.userId, member.email || member.userId)} disabled={busy === member.userId} title="Remove member" aria-label={`Remove ${member.email || member.userId}`}><Trash2 size={14}/></button> : <i/>}
      </article>)}
      {team.invites.map(invite => <article key={invite.email} className="pending"><span><Mail size={15}/></span><div><strong>{invite.email}</strong><small>Invitation pending</small></div><em>{humanize(invite.role)}</em>{canManage ? <button type="button" onClick={() => void revoke(invite.email)} disabled={busy === invite.email} title="Withdraw invitation" aria-label={`Withdraw invitation for ${invite.email}`}><Trash2 size={14}/></button> : <i/>}</article>)}
    </div> : <div className="bo-team-unavailable"><ShieldCheck size={17}/><span><strong>Team roles are enforced when accounts are configured.</strong><small>Local mode keeps this workspace on one device and does not pretend to send invitations.</small></span></div>}
    {message && <p>{message}</p>}
  </section>
}
