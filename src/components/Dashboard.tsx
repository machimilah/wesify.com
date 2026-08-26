import {
  AlertTriangle, ArrowRight, Bot, Boxes, Check, CircleDollarSign, Clock3, FileText,
  FolderKanban, Headphones, LayoutDashboard, Network, Plus, ShieldCheck,
  Users, UsersRound, Workflow, Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Answers } from '../types'
import type { AIBlueprint, ModuleId } from '../engine/blueprint'
import { isWorkspaceConfiguration, type WorkspaceConfiguration } from '../engine/workspaceSchema'
import { AccountButton } from './AccountButton'
import { Brand } from './Brand'
import { SchemaDashboard } from './SchemaDashboard'
import { readStorage } from '../engine/shared'
import { loadGeneratedManifest } from '../engine/projectClient'

type PlatformView = 'documents' | 'governance' | 'links'
type ViewId = 'overview' | ModuleId | PlatformView
type WorkspaceRole = 'founder' | 'operations' | 'finance' | 'delivery'
type ActionType = 'task' | 'invoice' | 'alert' | 'signature' | 'approval'

interface ActionItem {
  id: string
  title: string
  type: ActionType
  done: boolean
}

const moduleMeta: Record<ModuleId, { label: string; singular: string; icon: LucideIcon }> = {
  sales: { label: 'Sales pipeline', singular: 'opportunity', icon: Network },
  customers: { label: 'Clients', singular: 'client', icon: Users },
  projects: { label: 'Projects', singular: 'project', icon: FolderKanban },
  processes: { label: 'Processes', singular: 'process', icon: Workflow },
  finance: { label: 'Finance', singular: 'financial record', icon: CircleDollarSign },
  team: { label: 'Team', singular: 'team member', icon: UsersRound },
  inventory: { label: 'Inventory', singular: 'item', icon: Boxes },
  support: { label: 'Support', singular: 'request', icon: Headphones },
  marketing: { label: 'Marketing', singular: 'campaign', icon: Network },
  commerce: { label: 'Commerce', singular: 'order', icon: Boxes },
  subscriptions: { label: 'Subscriptions', singular: 'subscription', icon: Clock3 },
  scheduling: { label: 'Scheduling', singular: 'appointment', icon: Clock3 },
  'field-service': { label: 'Field service', singular: 'work order', icon: Workflow },
  procurement: { label: 'Procurement', singular: 'purchase order', icon: Boxes },
  manufacturing: { label: 'Manufacturing', singular: 'production order', icon: Workflow },
  quality: { label: 'Quality', singular: 'quality check', icon: ShieldCheck },
  maintenance: { label: 'Maintenance', singular: 'maintenance order', icon: Zap },
  logistics: { label: 'Logistics', singular: 'shipment', icon: Boxes },
  accounting: { label: 'Accounting', singular: 'journal entry', icon: CircleDollarSign },
  documents: { label: 'Documents', singular: 'document', icon: FileText },
  hr: { label: 'People operations', singular: 'people record', icon: UsersRound },
  payroll: { label: 'Payroll', singular: 'pay run', icon: CircleDollarSign },
  compliance: { label: 'Compliance', singular: 'control', icon: ShieldCheck },
  analytics: { label: 'Reporting', singular: 'report', icon: LayoutDashboard },
}

const platformMeta: Record<PlatformView, { label: string; singular: string; icon: LucideIcon }> = {
  documents: { label: 'Documents', singular: 'document', icon: FileText },
  governance: { label: 'Access & audit', singular: 'role', icon: ShieldCheck },
  links: { label: 'Automations', singular: 'automation', icon: Zap },
}

const roles: Array<{ id: WorkspaceRole; label: string }> = [
  { id: 'founder', label: 'Founder' },
  { id: 'operations', label: 'Operations' },
  { id: 'finance', label: 'Accountant' },
  { id: 'delivery', label: 'Delivery' },
]

const roleKpis: Record<WorkspaceRole, string[]> = {
  founder: ['cash', 'accounts', 'projects', 'approvals'],
  operations: ['projects', 'approvals', 'accounts'],
  finance: ['cash', 'accounts', 'approvals'],
  delivery: ['projects', 'approvals'],
}

function pathView(modules: ModuleId[]): ViewId {
  const segment = window.location.pathname.split('/').filter(Boolean)[1] as ViewId | undefined
  if (!segment) return 'overview'
  if (segment === 'overview' || segment in platformMeta || modules.includes(segment as ModuleId)) return segment
  return 'overview'
}

export function DashboardSurface({ answers, blueprint, compact = false, editable = false }: { answers: Answers; blueprint: AIBlueprint; compact?: boolean; editable?: boolean }) {
  const modules = blueprint.modules
  const companyName = String(answers.companyName ?? 'Workspace')
  const [activeView, setActiveView] = useState<ViewId>(() => compact ? blueprint.startView : pathView(modules))
  const [records, setRecords] = useState<Record<string, string[]>>(() => readStorage('bo-records', {}))
  const [actions, setActions] = useState<ActionItem[]>(() => readStorage('bo-actions', []))
  const [role] = useState<WorkspaceRole>(() => readStorage('bo-role', 'founder'))
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [actionType, setActionType] = useState<ActionType>('task')

  useEffect(() => {
    if (compact && (blueprint.startView === 'overview' || modules.includes(blueprint.startView as ModuleId))) setActiveView(blueprint.startView)
  }, [compact, blueprint.startView, modules])
  useEffect(() => {
    if (!editable) return
    const onHistory = () => setActiveView(pathView(modules))
    window.addEventListener('popstate', onHistory)
    return () => window.removeEventListener('popstate', onHistory)
  }, [editable, modules])
  useEffect(() => { if (editable) localStorage.setItem('bo-records', JSON.stringify(records)) }, [records, editable])
  useEffect(() => { if (editable) localStorage.setItem('bo-actions', JSON.stringify(actions)) }, [actions, editable])
  useEffect(() => { if (editable) localStorage.setItem('bo-role', JSON.stringify(role)) }, [role, editable])

  const pendingActions = actions.filter(action => !action.done)
  const open = (view: ViewId) => {
    setActiveView(view); setCreating(false); setDraft('')
    if (editable) window.history.pushState({}, '', view === 'overview' ? '/dashboard' : `/dashboard/${view}`)
  }
  const addRecord = () => {
    if (!draft.trim() || activeView === 'overview') return
    setRecords(current => ({ ...current, [activeView]: [...(current[activeView] ?? []), draft.trim()] }))
    setDraft(''); setCreating(false)
  }
  const addAction = () => {
    if (!actionDraft.trim()) return
    setActions(current => [...current, { id: crypto.randomUUID(), title: actionDraft.trim(), type: actionType, done: false }])
    setActionDraft('')
  }
  const activeMeta = activeView === 'overview' ? null : activeView in moduleMeta ? moduleMeta[activeView as ModuleId] : platformMeta[activeView as PlatformView]

  return <div className={`bo-dashboard ${compact ? 'bo-dashboard--compact' : ''}`}>
    <aside className="bo-dashboard__sidebar">
      <Brand inverse />
      <nav>
        <button className={activeView === 'overview' ? 'active' : ''} onClick={() => open('overview')} data-testid="nav-overview"><LayoutDashboard size={18}/><span>Command center</span></button>
        {modules.map(id => { const item = moduleMeta[id]; const Icon = item.icon; return <button key={id} className={activeView === id ? 'active' : ''} onClick={() => open(id)} data-testid={`nav-${id}`}><Icon size={18}/><span>{item.label}</span></button> })}
        <small>PLATFORM</small>
        {(Object.entries(platformMeta) as Array<[PlatformView, typeof platformMeta[PlatformView]]>).map(([id, item]) => { const Icon = item.icon; return <button key={id} className={activeView === id ? 'active' : ''} onClick={() => open(id)} data-testid={`nav-${id}`}><Icon size={18}/><span>{item.label}</span></button> })}
      </nav>
      <div className="bo-dashboard__agent"><Bot size={16}/><span>Ask Wesify</span><i/></div>
      <div className="bo-dashboard__account"><AccountButton/></div>
    </aside>
    <div className="bo-dashboard__main">
      <div className="bo-dashboard__content">
        {activeView === 'overview' ? <CommandCenter companyName={companyName} role={role} records={records} actions={actions} pendingActions={pendingActions} actionDraft={actionDraft} actionType={actionType} setActionDraft={setActionDraft} setActionType={setActionType} addAction={addAction} toggleAction={id => setActions(current => current.map(action => action.id === id ? { ...action, done: !action.done } : action))} modules={modules} open={open}/>
          : activeMeta && <>
            <div className="bo-operating-head"><div><small>OPERATING MODULE</small><h1>{activeMeta.label}</h1></div>{editable && activeView !== 'governance' && <button onClick={() => setCreating(true)} data-testid="add-record"><Plus size={16}/> Add {activeMeta.singular}</button>}</div>
            {creating && <div className="bo-create-row"><input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && addRecord()} placeholder={`${activeMeta.singular} name`} autoFocus data-testid="record-name"/><button onClick={() => setCreating(false)}>Cancel</button><button onClick={addRecord} data-testid="create-record">Create</button></div>}
            <CapabilityStrip view={activeView}/>
            {activeView === 'sales' ? <PipelineBoard stages={blueprint.moduleConfig.pipelineStages} records={records.sales ?? []}/>
              : activeView === 'processes' || activeView === 'projects' ? <><FlowBoard steps={blueprint.moduleConfig.processSteps}/><RecordsTable label={activeMeta.singular} records={records[activeView] ?? []}/></>
              : activeView === 'support' ? <FlowBoard steps={blueprint.moduleConfig.supportStages}/>
              : activeView === 'inventory' ? <FlowBoard steps={blueprint.moduleConfig.inventoryStages}/>
              : activeView === 'governance' ? <GovernancePanel/>
              : activeView === 'links' ? <AutomationPanel/>
              : <><ModuleSetting view={activeView} billingCadence={blueprint.moduleConfig.billingCadence}/><RecordsTable label={activeMeta.singular} records={records[activeView] ?? []}/></>}
          </>}
      </div>
    </div>
  </div>
}

function CommandCenter({ companyName, role, records, actions, pendingActions, actionDraft, actionType, setActionDraft, setActionType, addAction, toggleAction, modules, open }: {
  companyName: string; role: WorkspaceRole; records: Record<string, string[]>; actions: ActionItem[]; pendingActions: ActionItem[]; actionDraft: string; actionType: ActionType
  setActionDraft: (value: string) => void; setActionType: (value: ActionType) => void; addAction: () => void; toggleAction: (id: string) => void; modules: ModuleId[]; open: (view: ViewId) => void
}) {
  const kpis = useMemo(() => [
    { id: 'cash', label: 'Cash flow', value: 'Not connected', icon: CircleDollarSign },
    { id: 'accounts', label: 'Active accounts', value: String(records.customers?.length ?? 0), icon: Users },
    { id: 'projects', label: 'Active projects', value: String(records.projects?.length ?? 0), icon: FolderKanban },
    { id: 'approvals', label: 'Pending approvals', value: String(pendingActions.filter(item => item.type === 'approval' || item.type === 'signature').length), icon: Check },
  ].filter(item => roleKpis[role].includes(item.id)), [records, pendingActions, role])
  return <>
    <div className="bo-operating-head"><div><small>{roles.find(item => item.id === role)?.label.toUpperCase()} COMMAND CENTER</small><h1>{companyName}</h1></div></div>
    <section className="bo-command-kpis">{kpis.map(item => { const Icon = item.icon; return <article key={item.id}><span><Icon size={18}/></span><small>{item.label}</small><strong>{item.value}</strong></article> })}</section>
    <section className="bo-command-layout">
      <div className="bo-action-queue">
        <header><div><small>CENTRAL ACTION QUEUE</small><h2>Needs attention</h2></div><span>{pendingActions.length} open</span></header>
        <div className="bo-action-create"><select value={actionType} onChange={event => setActionType(event.target.value as ActionType)} data-testid="action-type"><option value="task">Task</option><option value="invoice">Invoice</option><option value="signature">Signature</option><option value="approval">Approval</option><option value="alert">Alert</option></select><input value={actionDraft} onChange={event => setActionDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && addAction()} placeholder="Add something that needs attention" data-testid="action-title"/><button onClick={addAction} data-testid="add-action" aria-label="Add action"><Plus size={15}/></button></div>
        <div className="bo-action-list">{actions.map(action => <button key={action.id} className={action.done ? 'done' : ''} onClick={() => toggleAction(action.id)}><span>{action.done ? <Check size={14}/> : action.type === 'alert' ? <AlertTriangle size={14}/> : <Clock3 size={14}/>}</span><strong>{action.title}</strong><small>{action.type}</small></button>)}{actions.length === 0 && <div className="bo-empty-state">Nothing needs attention yet.</div>}</div>
      </div>
      <div className="bo-command-modules"><header><small>YOUR OPERATION</small><h2>Workspace</h2></header>{modules.map(id => { const item = moduleMeta[id]; const Icon = item.icon; return <button key={id} onClick={() => open(id)}><Icon size={17}/><span><strong>{item.label}</strong><small>{records[id]?.length ?? 0} records</small></span><ArrowRight size={15}/></button> })}</div>
    </section>
  </>
}

const capabilities: Partial<Record<ViewId, string[]>> = {
  sales: ['Contacts & accounts', 'Deal pipeline', 'Estimates & proposals'],
  customers: ['Interaction history', 'Contracts & files', 'Client portal readiness'],
  finance: ['Invoices & payments', 'Expenses & receipts', 'Recurring billing'],
  projects: ['Kanban, list & timeline', 'Tasks & dependencies', 'Time & capacity'],
  team: ['Directory & contractors', 'Capacity & availability', 'Role assignments'],
  documents: ['Linked file repository', 'Document templates', 'Versions & access history'],
  governance: ['Granular permissions', 'Audit log', 'Privacy & security configuration'],
  links: ['Event triggers', 'External integrations', 'CSV & JSON transfer'],
}

function CapabilityStrip({ view }: { view: ViewId }) {
  const items = capabilities[view]
  if (!items) return null
  return <section className="bo-capability-strip">{items.map(item => <span key={item}><Check size={13}/>{item}</span>)}</section>
}

function GovernancePanel() {
  return <section className="bo-control-grid"><article><ShieldCheck size={20}/><strong>Roles & permissions</strong><button>Configure roles</button></article><article><FileText size={20}/><strong>Activity & audit log</strong><span>No events recorded</span></article><article><AlertTriangle size={20}/><strong>Security setup</strong><span>Configuration required</span></article></section>
}

function AutomationPanel() {
  return <section className="bo-control-grid"><article><Zap size={20}/><strong>Triggers</strong><button>Create trigger</button></article><article><Workflow size={20}/><strong>Integrations & API</strong><span>No connections</span></article><article><FileText size={20}/><strong>Import & export</strong><button>Import data</button></article></section>
}

function PipelineBoard({ stages, records }: { stages: string[]; records: string[] }) {
  if (!stages.length) return <div className="bo-module-building"/>
  return <section className="bo-pipeline" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(180px, 1fr))` }}>{stages.map((column, index) => <article key={column}><header><strong>{column}</strong><span>{index === 0 ? records.length : 0}</span></header>{index === 0 && records.map(record => <div className="bo-pipeline-card" key={record}><strong>{record}</strong><small>Created now</small></div>)}{(index > 0 || records.length === 0) && <div className="bo-column-empty"/>}</article>)}</section>
}

function FlowBoard({ steps }: { steps: string[] }) {
  if (!steps.length) return <div className="bo-module-building"/>
  return <section className="bo-flow-board">{steps.map((step, index) => <article key={`${step}-${index}`}><span>{index + 1}</span><strong>{step}</strong>{index < steps.length - 1 && <ArrowRight size={16}/>}</article>)}</section>
}

function ModuleSetting({ view, billingCadence }: { view: ViewId; billingCadence: string }) {
  if (view !== 'finance' || !billingCadence) return null
  return <div className="bo-module-setting"><span>Invoice timing</span><strong>{billingCadence}</strong></div>
}

function RecordsTable({ label, records }: { label: string; records: string[] }) {
  return <section className="bo-records"><header><span>{label}</span><span>Status</span><span>Updated</span></header>{records.map(record => <div key={record}><strong>{record}</strong><span>Active</span><span>Now</span></div>)}{records.length === 0 && <div className="bo-records-empty">No records yet</div>}</section>
}

/**
 * The generated shape of one workspace — its pages, its entities, what a record looks like — used to
 * be cached only in the browser that built it. That was invisible as long as an operator only ever
 * opened their own workspace from their own browser. It breaks the moment someone signs in somewhere
 * else, or opens a link on a second device: there was no local cache to fall back to, and this
 * screen showed "Building operation..." forever, with nothing behind it that would ever resolve.
 *
 * The local cache is now the fast path, not the only path. It renders instantly when this browser
 * already has it — no round trip for the common case of an operator returning to their own machine —
 * and a server fetch fills the gap for anything else, because the server has held the real answer,
 * in `manifest.specification`, since the moment this workspace was built.
 */
export function Dashboard({ workspaceId, onExit }: { workspaceId: string; onExit?: () => void }) {
  const cached = readStorage<unknown>(`bo-workspace-config:${workspaceId}`, readStorage<unknown>('bo-workspace-config', null))
  const cachedConfig = isWorkspaceConfiguration(cached) && cached.id === workspaceId ? cached : null
  const [fetched, setFetched] = useState<WorkspaceConfiguration | null>(null)
  const [checkedServer, setCheckedServer] = useState(false)

  useEffect(() => {
    // The fast path already has an answer; asking the server as well would only race it and repaint
    // what is already correct. Only a browser with nothing cached needs to wait on this.
    if (cachedConfig) return
    let cancelled = false
    setCheckedServer(false)
    void loadGeneratedManifest(workspaceId).then(manifest => {
      if (cancelled) return
      setFetched(manifest?.specification ?? null)
      setCheckedServer(true)
    })
    return () => { cancelled = true }
  }, [workspaceId, cachedConfig])

  const config = cachedConfig ?? fetched

  /**
   * Nothing cached and nothing on the server: this workspace has not been built, and that is what is
   * said.
   *
   * There used to be a third option — generate a configuration here and now from `bo-blueprint` and
   * `bo-answers`, the leftovers of whatever this browser last went through onboarding for. It was
   * not a fallback, it was invention: those two values belong to no workspace in particular, so any
   * stale link, bookmark or redirect landed on this screen and *created* a workspace out of them,
   * named "Workspace" because the leftovers held no company name. Worse, it saved what it invented,
   * so the phantom joined the dashboard's list and came back however many times it was deleted.
   *
   * A workspace that was really built in this browser is already in the cache below, written by the
   * builder when it finished, so nothing real depended on the invention.
   */
  if (!config) return <main className="bo-dashboard-page"><div className="bo-preview-empty">{checkedServer ? 'This workspace has not been built yet.' : 'Opening workspace...'}</div></main>

  config.id = workspaceId
  localStorage.setItem('bo-workspace-config', JSON.stringify(config))
  localStorage.setItem(`bo-workspace-config:${workspaceId}`, JSON.stringify(config))
  localStorage.setItem('bo-active-workspace-id', workspaceId)
  // Every section link SchemaDashboard draws is built from this, which is what keeps a click on
  // "Clients" landing on /workspace/:id/clients instead of a bare, workspace-oblivious /clients.
  return <main className="bo-dashboard-page"><SchemaDashboard initialConfig={config} basePath={`/workspace/${workspaceId}`} onExit={onExit}/></main>
}
