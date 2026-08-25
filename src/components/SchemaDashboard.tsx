import {
  ArrowRight, BadgeCheck, Banknote, BarChart3, BookOpen, Bot, Boxes, CalendarDays, Check, CircleDollarSign,
  ChevronRight, ClipboardList, Contact, Download, Factory, FileText, FolderKanban, GripVertical, Headphones, LayoutDashboard, Link2,
  ArrowLeftRight, Building2, CalendarCheck, Flag, Handshake, HardHat, Layers, ListChecks, Megaphone, Package,
  Plus, Receipt, RefreshCw, ScanLine, ScrollText, ShieldCheck, ShoppingCart, Sparkles, Target, TrendingUp, Truck,
  Users, UsersRound, Wallet, Warehouse,
  Workflow, Wrench, X, Zap,
  Calendar,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ActionResult, BusinessRecord, WorkspaceAction, WorkspaceRecords } from '../engine/workspaceActions'
import { executeWorkspaceAction, interpretWorkspaceCommand } from '../engine/workspaceActions'
import type { EntityDefinition, FieldDefinition, MetricDefinition, NavigationDefinition, ViewDefinition, WorkspaceConfiguration, WorkspaceRoleId } from '../engine/workspaceSchema'
import { buildGeneratedChange, ensureGeneratedProject, executeGeneratedRecordAction, exportWorkspace, listGeneratedVersions, loadGeneratedRecords, loadGeneratedRuntime, loadWorkspaceAudit, loadWorkspaceNotifications, markWorkspaceNotificationRead, promoteGeneratedChange, queryGeneratedProject, rollbackGeneratedProject, type GeneratedProjectManifest, type GeneratedRuntime, type WorkspaceAuditEvent, type WorkspaceNotification } from '../engine/projectClient'
import { askWorkspaceAgent } from '../engine/workspaceAgent'
import { capabilityById } from '../engine/capabilityCatalog'
import { moduleLabel } from '../engine/shared'
import { connectionFor, providerOf, type WorkspaceConnection } from '../engine/connections'
import { recordIndustryObservations } from '../engine/industryClient'
import { connectStripe, disconnectApp, loadConnectedApps, syncConnectedApp, syncSummary, type ConnectedApp } from '../engine/connectionClient'
import { createAutomationConnector, createManagedAutomation, loadAutomationWorkspace, setManagedAutomationEnabled, testManagedAutomation, type AutomationWorkspace, type ConnectorType } from '../engine/automationClient'
import { humanize, readStorage } from '../engine/shared'
import { faceFor, faceForNavigation } from './faces'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'
import { evaluateActionControl } from '../engine/governanceArchitecture'
import { planWorkspaceMutation } from '../engine/mutationArchitecture'
import { refreshWorkspaceIntelligence } from '../engine/operatingArchitecture'

const emptyAutomationWorkspace: AutomationWorkspace = { connectors: [], automations: [], runs: [] }

function routeId(config: WorkspaceConfiguration, basePath: string) {
  const id = window.location.pathname.slice(basePath.length).split('/').filter(Boolean)[0] ?? 'home'
  return config.navigation.some(item => item.id === id) ? id : 'home'
}

function matchesFilter(record: BusinessRecord, metric: MetricDefinition) {
  if (!metric.filter) return true
  const value = String(record[metric.filter.field] ?? '')
  if (metric.filter.equals !== undefined) return value === metric.filter.equals
  if (metric.filter.notEquals !== undefined) return value !== metric.filter.notEquals
  return true
}

function metricValue(metric: MetricDefinition, records: WorkspaceRecords) {
  const matching = (records[metric.entityId] ?? []).filter(record => matchesFilter(record, metric))
  const value = metric.operation === 'count' ? matching.length : matching.reduce((sum, record) => sum + Number(record[metric.field ?? ''] ?? 0), 0)
  return metric.format === 'currency' ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) : String(value)
}

/**
 * Normalises the navigation of a workspace built by an older version of Wesify.
 *
 * Two things changed after workspaces were already in the wild: automations became "Links", and the
 * assistant stopped being a page — it is reachable from anywhere now, so a tab for it is a section
 * that leads to a screen no longer worth its own place in the rail.
 */
function normalizeNavigation(config: WorkspaceConfiguration): WorkspaceConfiguration {
  let found = false
  const navigation = config.navigation.filter(item => item.kind !== 'assistant').map(item => {
    if (item.kind !== 'automations' && item.kind !== 'links') return item
    found = true
    return { ...item, id: 'links', label: 'Links', kind: 'links' as const }
  })
  if (!found) {
    const index = navigation.findIndex(item => item.kind === 'settings')
    navigation.splice(index < 0 ? navigation.length : index, 0, { id: 'links', label: 'Links', kind: 'links' })
  }
  return navigation.length === config.navigation.length && navigation.every((item, index) => item === config.navigation[index]) ? config : { ...config, navigation }
}

/**
 * The few things a new workspace still needs before it is a working system rather than an empty one.
 *
 * Shown as a banner across the top of every page rather than a panel on Home: it is the one piece of
 * guidance that stays relevant wherever the operator happens to be, and it disappears on its own once
 * there is nothing left in it.
 */
function setupStepsFor(config: WorkspaceConfiguration, records: WorkspaceRecords, automationWorkspace: AutomationWorkspace) {
  const navigationFor = (entityId: string) => {
    const viewIds = config.views.filter(view => view.entityId === entityId).map(view => view.id)
    return config.navigation.find(item => item.viewId && viewIds.includes(item.viewId))?.id
  }
  const entityByPattern = (pattern: RegExp) => config.entities.find(entity => pattern.test(`${entity.id} ${entity.label} ${entity.pluralLabel}`))
  const clientEntity = entityByPattern(/client|customer|account|contact/i)
  const workEntity = entityByPattern(/project|task|job|order|campaign|case/i)
  const teamEntity = entityByPattern(/team|employee|staff|contractor|member/i)
  return [
    clientEntity && !(records[clientEntity.id]?.length) ? { id: 'client', label: `Add your first ${clientEntity.label.toLowerCase()}`, detail: `Start the real ${clientEntity.pluralLabel.toLowerCase()} database.`, target: navigationFor(clientEntity.id) } : null,
    workEntity && !(records[workEntity.id]?.length) ? { id: 'work', label: `Add your first ${workEntity.label.toLowerCase()}`, detail: 'Put your operating flow into motion.', target: navigationFor(workEntity.id) } : null,
    teamEntity && !(records[teamEntity.id]?.length) ? { id: 'team', label: 'Confirm who works here', detail: `Add internal people or contractors to ${teamEntity.pluralLabel}.`, target: navigationFor(teamEntity.id) } : null,
    !automationWorkspace.connectors.length ? { id: 'automation', label: 'Create your first Link', detail: 'Connect a Make custom webhook or another HTTPS service.', target: config.navigation.find(item => item.kind === 'links' || item.kind === 'automations')?.id } : null,
  ].filter(Boolean) as Array<{ id: string; label: string; detail: string; target?: string }>
}

const navIcons: Record<NavigationDefinition['kind'], typeof LayoutDashboard> = {
  home: LayoutDashboard, today: Sparkles, entity: FileText, analytics: CircleDollarSign, links: Link2, automations: Workflow, assistant: Bot, settings: Zap,
}

export function SchemaDashboard({ initialConfig, basePath = '' }: { initialConfig: WorkspaceConfiguration; basePath?: string }) {
  const normalizedInitial = normalizeNavigation(refreshWorkspaceIntelligence(initialConfig))
  const storagePrefix = `bo-workspace:${initialConfig.id}`
  const [config, setConfig] = useState(normalizedInitial)
  const [records, setRecords] = useState<WorkspaceRecords>(() => readStorage(`${storagePrefix}:records`, readStorage('bo-workspace-records', {})))
  const [activeId, setActiveId] = useState(() => routeId(normalizedInitial, basePath))
  const [role, setRole] = useState<WorkspaceRoleId>(() => readStorage(`${storagePrefix}:role`, 'owner'))
  const [formEntity, setFormEntity] = useState<EntityDefinition | null>(null)
  const [editingRecord, setEditingRecord] = useState<{ entity: EntityDefinition; record: BusinessRecord } | null>(null)
  const [command, setCommand] = useState('')
  const [commandMessage, setCommandMessage] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantThread, setAssistantThread] = useState<Array<{ id: string; role: 'you' | 'bo'; text: string }>>([])
  const [assistantWorking, setAssistantWorking] = useState('')
  const [proposedAction, setProposedAction] = useState<WorkspaceAction | null>(null)
  const [manifest, setManifest] = useState<GeneratedProjectManifest | null>(null)
  const [runtime, setRuntime] = useState<GeneratedRuntime | null>(null)
  const [versions, setVersions] = useState<Array<{ version: number; changeDescription: string; createdAt: string; status: string }>>([])
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([])
  const [auditEvents, setAuditEvents] = useState<WorkspaceAuditEvent[]>([])
  const [automationWorkspace, setAutomationWorkspace] = useState<AutomationWorkspace>(emptyAutomationWorkspace)
  const [buildState, setBuildState] = useState('')
  const [commandWorking, setCommandWorking] = useState(false)
  const [candidate, setCandidate] = useState<{ result: ActionResult; manifest: GeneratedProjectManifest | null; runtime: GeneratedRuntime | null } | null>(null)
  /**
   * The first load fetches records in the background. If the user creates something before that
   * fetch returns, its response is already stale and would wipe the new record. Until the overlay was
   * removed it blocked input and hid this; now the write simply wins.
   */
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const recordsTouched = useRef(false)
  /**
   * The first load is no longer blocked by an overlay, so the user can act before the project
   * manifest has arrived. Writes must still reach the server: anything that needs the manifest waits
   * on this instead of silently saving to the browser only and losing the record on the next load.
   */
  const mountedProject = useRef<Promise<GeneratedProjectManifest | null> | null>(null)
  const readyManifest = async () => manifest ?? await (mountedProject.current ?? Promise.resolve(null))
  const visiblePageIds = new Set(config.interfaceArchitecture?.pages.filter(page => page.roleIds.includes(role)).map(page => page.id) ?? config.navigation.map(item => item.id))
  const visibleNavigation = config.navigation.filter(item => visiblePageIds.has(item.id))
  const activeNavigation = visibleNavigation.find(item => item.id === activeId) ?? visibleNavigation[0] ?? config.navigation[0]
  const activeView = config.views.find(view => view.id === activeNavigation.viewId)
  const activeEntity = config.entities.find(entity => entity.id === activeView?.entityId)
  const permissions = config.roles.find(item => item.id === role)?.permissions ?? []
  const canCreate = permissions.includes('create') || permissions.includes('admin')
  const canEdit = permissions.includes('edit') || permissions.includes('admin')
  const canDelete = permissions.includes('delete') || permissions.includes('admin')

  useEffect(() => {
    let cancelled = false
    // First load is not a build. The user already watched the Command Center being built and approved
    // it, so opening it must feel like opening a finished app. The server work below only fetches the
    // manifest and records — the workspace is already usable from the approved spec — so it happens
    // quietly. The overlay is for later structural changes, where "adapting" is the truth.
    const mount = async (): Promise<GeneratedProjectManifest | null> => {
      try {
        const project = await ensureGeneratedProject(config)
        if (cancelled) return project
        const [generatedRuntime, generatedRecords, history, alerts, auditHistory, automations] = await Promise.all([loadGeneratedRuntime(project), loadGeneratedRecords(project.workspaceId), listGeneratedVersions(project.workspaceId), loadWorkspaceNotifications(project.workspaceId), loadWorkspaceAudit(project.workspaceId).catch(() => []), loadAutomationWorkspace(project.workspaceId).catch(() => emptyAutomationWorkspace)])
        if (cancelled) return null
        const linkedSpecification = normalizeNavigation(project.specification)
        setManifest(project); setRuntime(generatedRuntime); setVersions(history); setNotifications(alerts); setAuditEvents(auditHistory); setAutomationWorkspace(automations); setConfig(linkedSpecification)
        if (!recordsTouched.current) setRecords(generatedRecords)
        localStorage.setItem('bo-workspace-config', JSON.stringify(linkedSpecification))
        if (!recordsTouched.current) localStorage.setItem('bo-workspace-records', JSON.stringify(generatedRecords))
        localStorage.setItem(`bo-workspace-config:${initialConfig.id}`, JSON.stringify(linkedSpecification))
        if (!recordsTouched.current) localStorage.setItem(`${storagePrefix}:records`, JSON.stringify(generatedRecords))
        return project
      } catch {
        // Running without the project service is a state, not an event, so it does not belong in a
        // dismissible strip across the top of the workspace. Settings already reports it, as the
        // workspace version reading "Local" rather than "Healthy".
        return null
      }
    }
    mountedProject.current = mount()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const syncRoute = () => setActiveId(routeId(config, basePath))
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [config, basePath])

  /** A capability the operator added or removed is a correction to Wesify, and the best evidence there is. */
  const recordCapabilityChange = (nextConfig: WorkspaceConfiguration) => {
    const before = new Set(config.capabilities ?? [])
    const after = new Set(nextConfig.capabilities ?? [])
    const added = [...after].filter(id => !before.has(id))
    const removed = [...before].filter(id => !after.has(id))
    if (added.length || removed.length) void recordIndustryObservations(nextConfig.industrySubsector ?? config.industrySubsector, config.id, { added, removed, label: nextConfig.industryLabel })
  }

  const persist = (nextConfig: WorkspaceConfiguration, nextRecords: WorkspaceRecords) => {
    recordCapabilityChange(nextConfig)
    recordsTouched.current = true
    setConfig(nextConfig); setRecords(nextRecords)
    localStorage.setItem('bo-workspace-config', JSON.stringify(nextConfig))
    localStorage.setItem('bo-workspace-records', JSON.stringify(nextRecords))
    localStorage.setItem(`bo-workspace-config:${initialConfig.id}`, JSON.stringify(nextConfig))
    localStorage.setItem(`${storagePrefix}:records`, JSON.stringify(nextRecords))
  }
  /**
   * The nested panel belongs to its own button and to nothing else.
   *
   * It opens when a module group is clicked and closes when the operator goes anywhere outside it —
   * including sections that have no panel at all. Leaving it standing while an unrelated page is open
   * showed a rail nobody asked for, listing pages that had nothing to do with what was on screen.
   * Moving between pages of the module it belongs to keeps it open, because that is still inside it.
   */
  /**
   * Everything Wesify says back to the operator, routed by where the request came from.
   *
   * A reply to something the operator asked the assistant belongs in the conversation, including the
   * outcome of whatever the agent then did. Feedback from a form or a dialog does not — it would read
   * as Wesify talking to itself, and the thread would fill with turns nobody said. Those keep the strip.
   * While the panel is open the strip stays quiet, so one sentence never appears twice at once.
   */
  const assistantOpenRef = useRef(false)
  assistantOpenRef.current = assistantOpen
  const answering = useRef(false)
  const say = (text: string) => {
    if (!text) return
    if (!answering.current) { setCommandMessage(text); return }
    // One request can produce the same sentence twice — the agent reports what it is about to do, and
    // the action reports the same outcome. Saying it once is the honest count.
    setAssistantThread(current => current.at(-1)?.text === text && current.at(-1)?.role === 'bo' ? current : [...current, { id: crypto.randomUUID(), role: 'bo', text }])
    if (!assistantOpenRef.current) setCommandMessage(text)
  }

  const navigate = (id: string) => {
    setActiveId(id)
    // The same fallback the grouping uses, or a page with no module of its own would read as leaving
    // the panel it is actually listed in.
    setOpenGroup(current => current && (config.navigation.find(item => item.id === id)?.module ?? 'operations') === current ? current : null)
    window.history.pushState({}, '', `${basePath}/${id}`)
  }
  const refreshAutomations = async () => {
    if (!manifest) return
    setAutomationWorkspace(await loadAutomationWorkspace(manifest.workspaceId))
  }
  const runAction = async (action: WorkspaceAction, forcePreview = false) => {
    const control = evaluateActionControl(config, action, { roleId: role })
    if (control.disposition === 'blocked') { say(control.reasons.at(-1) ?? 'Your role does not allow this action.'); return }
    if (forcePreview || control.requiresApproval || !control.canExecuteDirectly) { await prepareChange(action); return }
    const result = executeWorkspaceAction(config, records, action)
    try {
      const project = ['create_record', 'update_record', 'delete_record'].includes(action.type) ? await readyManifest() : null
      if (project) {
        await executeGeneratedRecordAction(project.workspaceId, action)
        const [nextRecords, alerts, auditHistory] = await Promise.all([loadGeneratedRecords(project.workspaceId), loadWorkspaceNotifications(project.workspaceId), loadWorkspaceAudit(project.workspaceId).catch(() => auditEvents)])
        result.records = nextRecords; setNotifications(alerts); setAuditEvents(auditHistory)
      }
      persist(result.config, result.records)
      say(result.message)
      if (result.navigationId) navigate(result.navigationId)
      setProposedAction(null)
    } catch (error) {
      say(error instanceof Error ? error.message : 'Wesify could not complete that change.')
    } finally { setBuildState('') }
  }
  const prepareChange = async (action: WorkspaceAction) => {
    const result = executeWorkspaceAction(config, records, action)
    setBuildState('Preparing your updated workspace')
    try {
      if (manifest) {
        const project = await buildGeneratedChange(result.config, action, result.message)
        setBuildState('Testing the proposed change')
        const generatedRuntime = await loadGeneratedRuntime(project)
        setCandidate({ result, manifest: project, runtime: generatedRuntime })
      } else setCandidate({ result, manifest: null, runtime: null })
      setProposedAction(action)
    } catch (error) {
      say(error instanceof Error ? error.message : 'Wesify could not prepare that workspace change.')
    } finally { setBuildState('') }
  }
  const applyCandidate = async () => {
    if (!candidate || !proposedAction) return
    setBuildState('Applying your updated workspace')
    try {
      let promoted = candidate.manifest
      if (candidate.manifest) promoted = await promoteGeneratedChange(candidate.manifest.workspaceId, candidate.manifest.version)
      if (promoted) {
        const [history, auditHistory] = await Promise.all([listGeneratedVersions(promoted.workspaceId), loadWorkspaceAudit(promoted.workspaceId).catch(() => auditEvents)])
        setManifest(promoted); setRuntime(candidate.runtime); setVersions(history); setAuditEvents(auditHistory)
      }
      if (manifest && ['delete_record', 'create_record', 'update_record'].includes(proposedAction.type)) {
        await executeGeneratedRecordAction(manifest.workspaceId, proposedAction)
        candidate.result.records = await loadGeneratedRecords(manifest.workspaceId)
      }
      persist(candidate.result.config, candidate.result.records)
      say(candidate.result.message)
      setCandidate(null); setProposedAction(null)
    } catch (error) { say(error instanceof Error ? error.message : 'Wesify could not apply that change.') }
    finally { setBuildState('') }
  }
  const submitCommand = async () => {
    const request = command.trim()
    if (!request || commandWorking) return
    setAssistantThread(current => [...current, { id: crypto.randomUUID(), role: 'you', text: request }])
    answering.current = true
    if (/which project.+cost|most expensive project|costing us the most/i.test(command) && manifest) {
      const result = await queryGeneratedProject<{ project: BusinessRecord | null; cost: number }>(manifest.workspaceId, 'most-expensive-project').catch(() => null)
      setCommand('')
      say(result?.project ? `${String(result.project.name ?? 'The leading project')} has the highest recorded cost at ${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(result.cost)}.` : 'There are no project costs to compare yet.')
      answering.current = false
      return
    }
    setCommand('')
    setCommandWorking(true)
    try {
      const agent = await askWorkspaceAgent(request, config, records, label => setAssistantWorking(label))
      if (agent.response.message) say(agent.response.message)
      if (agent.action) await runAction(agent.action, agent.response.decision === 'PREVIEW')
    } catch {
      const interpreted = interpretWorkspaceCommand(request, config, records)
      if (interpreted.message) say(interpreted.message)
      if (interpreted.action) await runAction(interpreted.action, Boolean(interpreted.needsPreview))
    } finally { setCommandWorking(false); setAssistantWorking(''); answering.current = false }
  }

  const rollback = async () => {
    if (!manifest?.previousVersion) return
    setBuildState('Restoring your previous workspace')
    try {
      const project = await rollbackGeneratedProject(manifest.workspaceId, manifest.previousVersion)
      const generatedRuntime = await loadGeneratedRuntime(project)
      setManifest(project); setRuntime(generatedRuntime); setConfig(project.specification); localStorage.setItem('bo-workspace-config', JSON.stringify(project.specification)); localStorage.setItem(`bo-workspace-config:${initialConfig.id}`, JSON.stringify(project.specification)); say('The previous workspace version has been restored.')
    } finally { setBuildState('') }
  }

  const openNotification = async (notification: WorkspaceNotification) => {
    const view = config.views.find(item => item.entityId === notification.entityId)
    const destination = config.navigation.find(item => item.viewId === view?.id)
    if (destination) navigate(destination.id)
    if (!manifest || notification.read) return
    try {
      await markWorkspaceNotificationRead(manifest.workspaceId, notification.id)
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read: true } : item))
    } catch { /* The alert remains visible if the local service is unavailable. */ }
  }

  const primaryNavigation = visibleNavigation.filter(item => item.kind === 'home' || item.kind === 'today')
  const utilityNavigation = visibleNavigation.filter(item => !['home', 'today', 'entity'].includes(item.kind))
  const businessNavigation = [...visibleNavigation.filter(item => item.kind === 'entity').reduce((groups, item) => {
    const module = item.module ?? 'operations'
    const group = groups.get(module) ?? []
    group.push(item)
    groups.set(module, group)
    return groups
  }, new Map<string, NavigationDefinition[]>()).entries()]
  const navigationButton = (item: NavigationDefinition) => {
    const Icon = navIcons[item.kind]
    return <button key={item.id} className={activeId === item.id ? 'active' : ''} onClick={() => navigate(item.id)} data-testid={`schema-nav-${item.id}`}><Icon size={17}/><span>{item.label}</span></button>
  }
  /**
   * A module with one page is shown as that page.
   *
   * Nesting a single item behind a group is pure friction — two clicks and a name the operator never
   * asked about ("Customers" wrapping nothing but "Clients"). Only modules that really hold several
   * pages become groups, which is what keeps the rail short without hiding anything.
   */
  const groupedNavigation = businessNavigation.map(([module, items]) => ({ module, items, nested: items.length > 1 }))
  const setupSteps = setupStepsFor(config, records, automationWorkspace)
  const openItems = groupedNavigation.find(group => group.module === openGroup)
  const groupButton = (group: typeof groupedNavigation[number]) => {
    const face = faceFor(group.module)
    const Icon = face.icon
    const holdsActive = group.items.some(item => item.id === activeId)
    return <button
      key={group.module}
      className={`bo-nav-group${holdsActive ? ' active' : ''}${openGroup === group.module ? ' open' : ''}`}
      onClick={() => setOpenGroup(openGroup === group.module ? null : group.module)}
      data-testid={`schema-group-${group.module}`}
    ><Icon size={17}/><span>{moduleLabel(group.module)}</span><ChevronRight size={14}/></button>
  }

  return <div className="bo-dashboard bo-schema-workspace">
    <aside className="bo-dashboard__sidebar">
      <div className="bo-dashboard__sidebar-head"><Brand inverse/><ThemeToggle/></div>
      <nav>
        {primaryNavigation.map(navigationButton)}
        <section className="bo-sidebar-group">{groupedNavigation.map(group => group.nested ? groupButton(group) : navigationButton(group.items[0]))}</section>
        {utilityNavigation.length ? <section className="bo-sidebar-group bo-sidebar-group--utility">{utilityNavigation.map(navigationButton)}</section> : null}
      </nav>
      {canCreate && <button className="bo-schema-create" onClick={() => setFormEntity(config.entities[0] ?? null)}><Plus size={15}/><span>Create</span></button>}
    </aside>
    {openItems && <aside className="bo-subsidebar" data-testid="sub-sidebar">
      <header><strong>{moduleLabel(openItems.module)}</strong><button onClick={() => setOpenGroup(null)} aria-label="Close"><X size={15}/></button></header>
      {openItems.items.map(navigationButton)}
    </aside>}
    <div className="bo-dashboard__main">
      {setupSteps.length ? <div className="bo-setup-banner" data-testid="setup-banner">
        <span><Sparkles size={14}/></span>
        <strong>Finish setting up Wesify</strong>
        <em>{4 - setupSteps.length}/4 done</em>
        <div>{setupSteps.map(step => <button key={step.id} onClick={() => step.target && navigate(step.target)} title={step.detail}>{step.label}<ArrowRight size={13}/></button>)}</div>
      </div> : null}
      {commandMessage && <div className="bo-command-result"><Bot size={15}/><span>{commandMessage}</span><button onClick={() => setCommandMessage('')}><X size={14}/></button></div>}
      <div className="bo-dashboard__content">
        {activeNavigation.kind === 'home' && <WorkspaceHome config={config} records={records} role={role} navigate={navigate} runtime={runtime} notifications={notifications} automationWorkspace={automationWorkspace} openNotification={notification => void openNotification(notification)}/>} 
        {activeNavigation.kind === 'today' && <TodayView config={config} records={records} navigate={navigate}/>} 
        {activeNavigation.kind === 'entity' && activeEntity && activeView && <EntityView entity={activeEntity} view={activeView} records={records[activeEntity.id] ?? []} connection={connectionFor(config.connections, activeEntity.capabilityId)} onCreate={canCreate ? () => setFormEntity(activeEntity) : undefined} onEdit={canEdit ? record => setEditingRecord({ entity: activeEntity, record }) : undefined}/>} 
        {activeNavigation.kind === 'analytics' && <AnalyticsView config={config} records={records}/>} 
        {(activeNavigation.kind === 'links' || activeNavigation.kind === 'automations') && <LinksView config={config} manifest={manifest} workspace={automationWorkspace} refresh={refreshAutomations}/>} 
        {activeNavigation.kind === 'settings' && <SettingsView config={config} manifest={manifest} versions={versions} auditEvents={auditEvents} role={role} onRoleChange={next => { setRole(next); localStorage.setItem(`${storagePrefix}:role`, JSON.stringify(next)); if ((next === 'owner' || next === 'admin') && manifest) void loadWorkspaceAudit(manifest.workspaceId).then(setAuditEvents).catch(() => setAuditEvents([])) }} rollback={() => void rollback()}/>} 
      </div>
    </div>
    {formEntity && <RecordForm entity={formEntity} entities={config.entities} records={records} onClose={() => setFormEntity(null)} onSubmit={values => { void runAction({ type: 'create_record', entityId: formEntity.id, values }); setFormEntity(null) }} onChangeEntity={setFormEntity}/>} 
    {editingRecord && <RecordForm key={editingRecord.record.id} entity={editingRecord.entity} entities={config.entities} records={records} initialRecord={editingRecord.record} onClose={() => setEditingRecord(null)} onSubmit={values => { void runAction({ type: 'update_record', entityId: editingRecord.entity.id, recordId: editingRecord.record.id, values }); setEditingRecord(null) }} onDelete={canDelete ? () => { void prepareChange({ type: 'delete_record', entityId: editingRecord.entity.id, recordId: editingRecord.record.id }); setEditingRecord(null) } : undefined} onChangeEntity={() => undefined}/>} 
    {proposedAction && <ChangePreview action={proposedAction} config={config} candidate={candidate?.manifest ?? null} onCancel={() => { setProposedAction(null); setCandidate(null) }} onApply={() => void applyCandidate()}/>} 
    {buildState && <ProjectBuildState label={buildState}/>}
    {/* The panel carries its own close control, so the launcher would be a second one saying the same thing. */}
    {!assistantOpen && <button className="bo-assistant-launcher" onClick={() => setAssistantOpen(true)} aria-label="Ask Wesify" data-testid="assistant-launcher"><Bot size={20}/></button>}
    {assistantOpen && <AssistantPanel
      thread={assistantThread}
      working={assistantWorking || (commandWorking ? 'Working on it' : '')}
      command={command}
      setCommand={setCommand}
      submit={() => void submitCommand()}
      close={() => setAssistantOpen(false)}
    />}
  </div>
}

/**
 * The assistant, reachable from every page.
 *
 * It was a tab, which made asking Wesify something a place you had to travel to and come back from — and
 * the request always concerned the page you had just left. As a panel it sits beside the work instead
 * of replacing it, and it keeps the conversation rather than showing one answer at a time.
 */
function AssistantPanel({ thread, working, command, setCommand, submit, close }: { thread: Array<{ id: string; role: 'you' | 'bo'; text: string }>; working: string; command: string; setCommand: (value: string) => void; submit: () => void; close: () => void }) {
  const foot = useRef<HTMLDivElement>(null)
  useEffect(() => { foot.current?.scrollIntoView({ block: 'end' }) }, [thread.length, working])
  return <aside className="bo-assistant-panel" data-testid="assistant-panel">
    <header><span><Bot size={15}/></span><strong>Ask Wesify</strong><button onClick={close} aria-label="Close assistant"><X size={15}/></button></header>
    <div className="bo-assistant-thread">
      {thread.length === 0 && null}
      {thread.map(message => <div key={message.id} className={`bo-assistant-turn bo-assistant-turn--${message.role}`}>{message.text}</div>)}
      {working && <div className="bo-assistant-turn bo-assistant-turn--working">{working}<i/><i/><i/></div>}
      <div ref={foot}/>
    </div>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); submit() }}>
      <input value={command} onChange={event => setCommand(event.target.value)} placeholder="Create a new client called ACME" autoFocus data-testid="assistant-command"/>
      <button aria-label="Send"><ArrowRight size={15}/></button>
    </form>
  </aside>
}

function WorkspaceHome({ config, records, role, navigate, runtime, notifications, automationWorkspace, openNotification }: { config: WorkspaceConfiguration; records: WorkspaceRecords; role: WorkspaceRoleId; navigate: (id: string) => void; runtime: GeneratedRuntime | null; notifications: WorkspaceNotification[]; automationWorkspace: AutomationWorkspace; openNotification: (notification: WorkspaceNotification) => void }) {
  const metrics = config.metrics.filter(metric => metric.roles.includes(role)).slice(0, 6)
  const navigationFor = (entityId: string) => {
    const viewIds = config.views.filter(view => view.entityId === entityId).map(view => view.id)
    return config.navigation.find(item => item.viewId && viewIds.includes(item.viewId))?.id
  }
  const today = new Date().toISOString().slice(0, 10)
  const recordAlerts = config.entities.flatMap(entity => (records[entity.id] ?? []).flatMap(record => {
    const status = String(record.status ?? '')
    const dateField = entity.fields.find(field => field.type === 'date' && /due|end|expiry|schedule|date/i.test(field.id))
    const overdue = dateField && record[dateField.id] && String(record[dateField.id]) < today && !/paid|complete|done|closed|resolved|cancelled|archived/i.test(status)
    const attention = /overdue|blocked|pending approval|failed|low stock|out of stock/i.test(status)
    if (!overdue && !attention) return []
    return [{ id: `${entity.id}-${record.id}`, message: `${String(record[entity.primaryField] ?? entity.label)} · ${overdue ? 'Overdue' : status}`, entityId: entity.id }]
  })).slice(0, 6)
  const unreadNotifications = notifications.filter(item => !item.read)
  /**
   * The launcher is built from the workspace's own navigation, so it always matches the sidebar. The
   * counts are real records — a tile never shows a number Wesify cannot point at.
   */
  const alertsByEntity = new Map<string, number>()
  for (const alert of recordAlerts) alertsByEntity.set(alert.entityId, (alertsByEntity.get(alert.entityId) ?? 0) + 1)
  for (const notification of unreadNotifications) alertsByEntity.set(notification.entityId, (alertsByEntity.get(notification.entityId) ?? 0) + 1)
  const appTiles = config.navigation.filter(item => item.kind !== 'home').map(item => {
    const view = config.views.find(candidate => candidate.id === item.viewId)
    const entity = config.entities.find(candidate => candidate.id === view?.entityId)
    const face = faceForNavigation(config, item)
    const utility: Record<string, { icon: typeof LayoutDashboard; tint: string; hint: string }> = {
      today: { icon: Calendar, tint: 'amber', hint: 'What needs you today' },
      analytics: { icon: BarChart3, tint: 'indigo', hint: 'Live numbers' },
      links: { icon: Link2, tint: 'cyan', hint: 'Connect other apps' },
      automations: { icon: Zap, tint: 'cyan', hint: 'Connect other apps' },
      settings: { icon: Zap, tint: 'slate', hint: 'How Wesify is set up' },
    }
    const special = utility[item.kind]
    return {
      id: item.id,
      label: item.label,
      icon: special?.icon ?? face.icon,
      tint: special?.tint ?? face.tint,
      hint: special?.hint ?? 'Open',
      count: entity ? (records[entity.id]?.length ?? 0) : null,
      alerts: entity ? (alertsByEntity.get(entity.id) ?? 0) : 0,
    }
  })
  const recent = config.entities.flatMap(entity => (records[entity.id] ?? []).map(record => ({ entity, record }))).sort((left, right) => String(right.record.updatedAt ?? '').localeCompare(String(left.record.updatedAt ?? ''))).slice(0, 5)
  const attentionCount = unreadNotifications.length + recordAlerts.length
  const entityByPattern = (pattern: RegExp) => config.entities.find(entity => pattern.test(`${entity.id} ${entity.label} ${entity.pluralLabel}`))
  const clientEntity = entityByPattern(/client|customer|account|contact/i)
  const workEntity = entityByPattern(/project|task|job|order|campaign|case/i)
  const teamEntity = entityByPattern(/team|employee|staff|contractor|member/i)
  const setupSteps = [
    clientEntity && !(records[clientEntity.id]?.length) ? { id: 'client', label: `Add your first ${clientEntity.label.toLowerCase()}`, detail: `Start the real ${clientEntity.pluralLabel.toLowerCase()} database.`, target: navigationFor(clientEntity.id) } : null,
    workEntity && !(records[workEntity.id]?.length) ? { id: 'work', label: `Add your first ${workEntity.label.toLowerCase()}`, detail: 'Put your operating flow into motion.', target: navigationFor(workEntity.id) } : null,
    teamEntity && !(records[teamEntity.id]?.length) ? { id: 'team', label: 'Confirm who works here', detail: `Add internal people or contractors to ${teamEntity.pluralLabel}.`, target: navigationFor(teamEntity.id) } : null,
    !automationWorkspace.connectors.length ? { id: 'automation', label: 'Create your first Link', detail: 'Connect a Make custom webhook or another HTTPS service.', target: config.navigation.find(item => item.kind === 'links' || item.kind === 'automations')?.id } : null,
  ].filter(Boolean) as Array<{ id: string; label: string; detail: string; target?: string }>
  return <>
    <div className="bo-schema-heading"><h1>{config.profile.companyName}</h1></div>
    <section className="bo-app-grid" data-testid="app-grid">
      {appTiles.map(tile => {
        const Icon = tile.icon
        return <button key={tile.id} className={`tint-${tile.tint}`} onClick={() => navigate(tile.id)} data-testid={`app-tile-${tile.id}`}>
          <span><Icon size={26} strokeWidth={1.6}/></span>
          <strong>{tile.label}</strong>
          <small>{tile.count === null ? tile.hint : tile.count === 0 ? 'Nothing yet' : `${tile.count} ${tile.count === 1 ? 'record' : 'records'}`}</small>
          {tile.alerts > 0 && <i data-testid={`app-tile-alert-${tile.id}`}>{tile.alerts}</i>}
        </button>
      })}
    </section>
    <section className="bo-schema-kpis">{metrics.map(metric => <article key={metric.id}><small>{metric.label}</small><strong>{metricValue(metric, records)}</strong><span>Live workspace data</span></article>)}{metrics.length === 0 && <div className="bo-empty-state">KPIs will appear when Wesify has operational data to measure.</div>}</section>
    {runtime?.widgets.length ? <section className="bo-generated-widgets">{runtime.widgets.map(widget => <article key={widget.id}><small>GENERATED FOR YOUR BUSINESS</small><strong>{widget.label}</strong><span>{records[widget.entityId]?.length ?? 0} connected records</span></article>)}</section> : null}
    <section className="bo-command-layout">
      <div className="bo-action-queue"><header><div><h2>What needs attention</h2></div><span>{attentionCount} open</span></header><div className="bo-action-list">
        {unreadNotifications.slice(0, 4).map(notification => <button key={notification.id} onClick={() => openNotification(notification)}><span><Zap size={13}/></span><strong>{notification.message}</strong><small>{humanize(config.entities.find(item => item.id === notification.entityId)?.label ?? 'Alert')}</small></button>)}
        {recordAlerts.map(alert => <button key={alert.id} onClick={() => { const destination = navigationFor(alert.entityId); if (destination) navigate(destination) }}><span><Sparkles size={13}/></span><strong>{alert.message}</strong><small>{humanize(config.entities.find(item => item.id === alert.entityId)?.label ?? 'Record')}</small></button>)}
        {!attentionCount && <div className="bo-empty-state">Nothing needs your attention.</div>}
      </div><button className="bo-open-briefing" onClick={() => navigate('today')}>Open daily briefing <ArrowRight size={14}/></button></div>
      <div className="bo-command-modules"><header><div><h2>Recent activity</h2></div></header>{recent.map(({ entity, record }) => <button key={`${entity.id}-${record.id}`} onClick={() => { const destination = navigationFor(entity.id); if (destination) navigate(destination) }}><FileText size={15}/><span><strong>{String(record[entity.primaryField] ?? entity.label)}</strong><small>{entity.label} · {record.updatedAt ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(record.updatedAt)) : 'Just now'}</small></span><ArrowRight size={14}/></button>)}{!recent.length && <div className="bo-empty-state">Activity appears as your team works in Wesify.</div>}</div>
    </section>
  </>
}

function TodayView({ config, records, navigate }: { config: WorkspaceConfiguration; records: WorkspaceRecords; navigate: (id: string) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const overdueInvoices = (records.invoices ?? []).filter(record => record.status !== 'Paid' && String(record.dueDate ?? '') < today && record.dueDate)
  const overdueTasks = (records.tasks ?? []).filter(record => record.status !== 'Done' && String(record.dueDate ?? '') < today && record.dueDate)
  const lowStock = (records.products ?? []).filter(record => Number(record.stock ?? 0) <= Number(record.reorderPoint ?? -1))
  const items = [
    { label: 'Cash', text: overdueInvoices.length ? `${overdueInvoices.length} invoices are overdue.` : 'No overdue invoices.', target: 'finance' },
    { label: 'Operations', text: overdueTasks.length ? `${overdueTasks.length} tasks are overdue.` : 'No overdue tasks.', target: 'projects' },
    ...(config.modules.includes('inventory') ? [{ label: 'Inventory', text: lowStock.length ? `${lowStock.length} products are at or below their reorder point.` : 'No inventory alerts.', target: 'inventory' }] : []),
  ]
  return <><div className="bo-schema-heading"><h1>Today</h1></div><section className="bo-today-list">{items.map(item => <button key={item.label} onClick={() => navigate(item.target)}><span>{item.label}</span><strong>{item.text}</strong><ArrowRight size={16}/></button>)}</section><section className="bo-recommendations"><small>RECOMMENDED ACTIONS</small>{!overdueInvoices.length && !overdueTasks.length && <div className="bo-empty-state">No urgent recommendations from current records.</div>}</section></>
}

function ConnectionBanner({ connection }: { connection: WorkspaceConnection }) {
  const provider = providerOf(connection)
  const connected = connection.status === 'connected'
  return <div className={`bo-connection-banner${connected ? ' connected' : ''}`} data-testid="connection-banner">
    <span><Link2 size={14}/></span>
    <div>
      <strong>{connection.providerLabel} owns this</strong>
      <small>
        {connected
          ? `Wesify shows your ${connection.providerLabel} records here. ${connection.mode === 'read-write' ? 'Changes you make are sent back.' : `To change one, open ${connection.providerLabel}.`}`
          : `Not connected yet, so this page is empty. Connect ${connection.providerLabel} in Settings and your records appear here.`}
      </small>
    </div>
    {provider && <a href={provider.home} target="_blank" rel="noreferrer noopener">Open {connection.providerLabel}</a>}
  </div>
}

function EntityView({ entity, view, records, connection, onCreate, onEdit }: { entity: EntityDefinition; view: ViewDefinition; records: BusinessRecord[]; connection?: WorkspaceConnection; onCreate?: () => void; onEdit?: (record: BusinessRecord) => void }) {
  const edit = onEdit ?? (() => undefined)
  // A connected page never offers Create until the app behind it is actually connected — a record
  // created here would have nowhere to go.
  const canAdd = onCreate && (!connection || connection.status === 'connected')
  return <><div className="bo-operating-head"><div><h1>{view.label || entity.pluralLabel}</h1></div>{canAdd && <button onClick={onCreate} data-testid="schema-add-record"><Plus size={16}/> Add {entity.label.toLowerCase()}</button>}</div>{connection && <ConnectionBanner connection={connection}/>}{view.type === 'calendar' && view.dateField ? <SchemaCalendar entity={entity} dateField={view.dateField} records={records} onEdit={edit}/> : view.type === 'kanban' && view.groupBy ? <SchemaKanban entity={entity} groupBy={view.groupBy} records={records} onEdit={edit}/> : <SchemaTable entity={entity} view={view} records={records} onEdit={edit}/>}</>
}

function SchemaTable({ entity, view, records, onEdit }: { entity: EntityDefinition; view: ViewDefinition; records: BusinessRecord[]; onEdit: (record: BusinessRecord) => void }) {
  const fields = (view.columns ?? entity.fields.slice(0, 5).map(item => item.id)).map(id => entity.fields.find(item => item.id === id)).filter(Boolean) as FieldDefinition[]
  return <section className="bo-schema-table"><header>{fields.map(item => <span key={item.id}>{item.label}</span>)}</header>{records.map(record => <button className="bo-schema-record-row" key={record.id} onClick={() => onEdit(record)}>{fields.map(item => <span key={item.id}>{String(record[item.id] ?? '—')}</span>)}</button>)}{records.length === 0 && <div className="bo-empty-state">No {entity.pluralLabel.toLowerCase()} yet.</div>}</section>
}

function SchemaKanban({ entity, groupBy, records, onEdit }: { entity: EntityDefinition; groupBy: string; records: BusinessRecord[]; onEdit: (record: BusinessRecord) => void }) {
  const options = entity.fields.find(item => item.id === groupBy)?.options ?? ['Unassigned']
  return <section className="bo-pipeline" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(190px, 1fr))` }}>{options.map(option => { const matching = records.filter(record => String(record[groupBy] ?? options[0]) === option); return <article key={option}><header><strong>{option}</strong><span>{matching.length}</span></header>{matching.map(record => <button className="bo-pipeline-card" key={record.id} onClick={() => onEdit(record)}><strong>{String(record[entity.primaryField] ?? entity.label)}</strong><small>{entity.label}</small></button>)}{matching.length === 0 && <div className="bo-column-empty"/>}</article> })}</section>
}

function SchemaCalendar({ entity, dateField, records, onEdit }: { entity: EntityDefinition; dateField: string; records: BusinessRecord[]; onEdit: (record: BusinessRecord) => void }) {
  const scheduled = records.filter(record => record[dateField]).slice().sort((left, right) => String(left[dateField]).localeCompare(String(right[dateField])))
  return <section className="bo-schema-calendar">{scheduled.map(record => <button key={record.id} onClick={() => onEdit(record)}><time>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(String(record[dateField])))}</time><span><strong>{String(record[entity.primaryField] ?? entity.label)}</strong><small>{String(record.status ?? 'Scheduled')}</small></span><ArrowRight size={15}/></button>)}{scheduled.length === 0 && <div className="bo-empty-state">No scheduled {entity.pluralLabel.toLowerCase()} yet.</div>}</section>
}

function AnalyticsView({ config, records }: { config: WorkspaceConfiguration; records: WorkspaceRecords }) {
  const counts = config.entities.map(entity => ({ label: entity.pluralLabel, count: records[entity.id]?.length ?? 0 })).slice(0, 8)
  const max = Math.max(1, ...counts.map(item => item.count))
  return <><div className="bo-schema-heading"><h1>Analytics</h1></div><section className="bo-analytics-chart">{counts.map(item => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${(item.count / max) * 100}%` }}/></i><strong>{item.count}</strong></div>)}</section></>
}

type LinkCanvasNode =
  | { id: 'trigger'; kind: 'trigger'; entityId: string; event: 'created' | 'updated'; x: number; y: number }
  | { id: 'action'; kind: 'action'; connectorId: string; x: number; y: number }

/**
 * The apps a company already runs on, shown in Wesify.
 *
 * Read-only on purpose. Wesify is not going to become anyone's payment system, and until the mapping has
 * been proved against real accounts it should not be able to change anything in one either. The
 * screen says so plainly rather than implying more than Wesify does.
 */
function ConnectedApps({ workspaceId, onSynced }: { workspaceId: string; onSynced: () => Promise<void> }) {
  const [apps, setApps] = useState<ConnectedApp[]>([])
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState('')

  useEffect(() => { if (workspaceId) void loadConnectedApps(workspaceId).then(setApps) }, [workspaceId])

  const run = async (label: string, operation: () => Promise<unknown>, success: string) => {
    setBusy(label); setNote(''); setFailed('')
    try { await operation(); setApps(await loadConnectedApps(workspaceId)); setNote(success) }
    catch (error) { setFailed(error instanceof Error ? error.message : 'That did not work.') }
    finally { setBusy('') }
  }

  const stripe = apps.find(app => app.providerId === 'stripe')
  if (!workspaceId) return null

  return <section className="bo-connected-apps" data-testid="connected-apps">
    <header><h2>Connected apps</h2><small>READ-ONLY</small></header>
    {note ? null : null}
    {failed ? null : null}
    <article data-testid="connected-app-stripe">
      <div><strong>Stripe</strong>{stripe
        ? <small>{stripe.account} · {stripe.lastSyncAt ? `last synced ${new Date(stripe.lastSyncAt).toLocaleString()} · ${syncSummary(stripe.lastSyncCounts)}` : 'not synced yet'}</small>
        : <small>Customers, subscriptions and payments, shown in Wesify. Wesify never changes anything in Stripe.</small>}
        {stripe?.lastError ? <em>{stripe.lastError}</em> : null}
      </div>
      {stripe ? <div className="bo-connected-actions">
        <button disabled={Boolean(busy)} onClick={() => void run('sync', async () => { await syncConnectedApp(workspaceId, 'stripe'); await onSynced() }, 'Stripe is up to date in Wesify.')} data-testid="sync-stripe">{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
        <button disabled={Boolean(busy)} onClick={() => void run('remove', () => disconnectApp(workspaceId, 'stripe'), 'Stripe disconnected. The records it brought in stay in Wesify.')} data-testid="disconnect-stripe">Disconnect</button>
      </div> : <form onSubmit={(event: FormEvent) => { event.preventDefault(); void run('connect', () => connectStripe(workspaceId, apiKey.trim()), 'Stripe connected. Sync to bring your records in.').then(() => setApiKey('')) }}>
        <input value={apiKey} onChange={event => setApiKey(event.target.value)} type="password" autoComplete="off" placeholder="rk_live_… restricted key" aria-label="Stripe restricted key" data-testid="stripe-key"/>
        <button disabled={!apiKey.trim() || Boolean(busy)} data-testid="connect-stripe">{busy === 'connect' ? 'Checking…' : 'Connect'}</button>
      </form>}
    </article>
  </section>
}

function LinksView({ config, manifest, workspace, refresh }: { config: WorkspaceConfiguration; manifest: GeneratedProjectManifest | null; workspace: AutomationWorkspace; refresh: () => Promise<void> }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [connectorName, setConnectorName] = useState('Make')
  const [connectorType, setConnectorType] = useState<ConnectorType>('make-webhook')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [nodes, setNodes] = useState<LinkCanvasNode[]>([])
  const [pointerNode, setPointerNode] = useState<LinkCanvasNode | null>(null)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const withRefresh = async (operation: () => Promise<unknown>, success: string) => {
    setWorking(true); setMessage('')
    try { await operation(); await refresh(); setMessage(success) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Wesify could not update the automation.') }
    finally { setWorking(false) }
  }
  const addConnector = (formEvent: FormEvent) => {
    formEvent.preventDefault()
    if (!manifest) return
    void withRefresh(() => createAutomationConnector(manifest.workspaceId, { name: connectorName.trim(), type: connectorType, endpointUrl: endpointUrl.trim() }), 'Connector saved. Its secret URL is hidden from the interface.').then(() => setEndpointUrl(''))
  }

  const placeNode = (node: LinkCanvasNode) => setNodes(current => [...current.filter(item => item.kind !== node.kind), node])
  useEffect(() => {
    if (!pointerNode) return
    const release = (pointerEvent: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect && pointerEvent.clientX >= rect.left && pointerEvent.clientX <= rect.right && pointerEvent.clientY >= rect.top && pointerEvent.clientY <= rect.bottom) {
        const x = Math.max(20, Math.min(690, pointerEvent.clientX - rect.left - 92))
        const y = Math.max(30, Math.min(350, pointerEvent.clientY - rect.top - 35))
        placeNode({ ...pointerNode, x, y })
      }
      setPointerNode(null)
    }
    window.addEventListener('pointerup', release, { once: true })
    return () => window.removeEventListener('pointerup', release)
  }, [pointerNode])
  const addPaletteNode = (kind: LinkCanvasNode['kind'], id: string) => {
    if (kind === 'trigger') placeNode({ id: 'trigger', kind, entityId: id, event: 'created', x: 90, y: 170 })
    else placeNode({ id: 'action', kind, connectorId: id, x: 560, y: 170 })
  }
  const trigger = nodes.find(item => item.kind === 'trigger') as Extract<LinkCanvasNode, { kind: 'trigger' }> | undefined
  const action = nodes.find(item => item.kind === 'action') as Extract<LinkCanvasNode, { kind: 'action' }> | undefined
  const saveLink = async () => {
    if (!manifest || !trigger || !action) return
    const entity = config.entities.find(item => item.id === trigger.entityId)
    const connector = workspace.connectors.find(item => item.id === action.connectorId)
    await withRefresh(
      () => createManagedAutomation(manifest.workspaceId, { name: linkName.trim() || `${entity?.label ?? 'Record'} to ${connector?.name ?? 'connector'}`, entityId: trigger.entityId, event: trigger.event, connectorId: action.connectorId }),
      'Link saved in paused mode. Simulate it before switching it on.',
    )
  }
  const loadLink = (automationId: string) => {
    const automation = workspace.automations.find(item => item.id === automationId)
    if (!automation) return
    setLinkName(automation.name)
    setNodes([
      { id: 'trigger', kind: 'trigger', entityId: automation.trigger.entityId, event: automation.trigger.event, x: 90, y: 170 },
      { id: 'action', kind: 'action', connectorId: automation.action.connectorId, x: 560, y: 170 },
    ])
    canvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  return <>
    <div className="bo-schema-heading"><h1>Links</h1></div>
    {message ? <div className="bo-automation-message" role="status">{message}</div> : null}
    <ConnectedApps workspaceId={manifest?.workspaceId ?? ''} onSynced={refresh}/>
    <section className="bo-links-toolbar"><label><span>LINK NAME</span><input value={linkName} onChange={input => setLinkName(input.target.value)} placeholder="Send new leads to Make" data-testid="link-name"/></label><button onClick={() => { setLinkName(''); setNodes([]); setMessage('') }}>New canvas</button><button className="primary" disabled={working || !manifest || !trigger || !action} onClick={() => void saveLink()}><Link2 size={15}/> Save Link</button></section>
    <section className="bo-links-studio">
      <aside>
        <header><h2>Drag onto canvas</h2></header>
        <div><small>WHEN THIS HAPPENS</small>{config.entities.map(entity => { const node: LinkCanvasNode = { id: 'trigger', kind: 'trigger', entityId: entity.id, event: 'created', x: 90, y: 170 }; return <button key={entity.id} onPointerDown={() => setPointerNode(node)} onClick={() => addPaletteNode('trigger', entity.id)} data-testid={`link-trigger-source-${entity.id}`}><GripVertical size={13}/><span><strong>{entity.label}</strong><em>Wesify record</em></span><Plus size={13}/></button> })}</div>
        <div><small>DO THIS</small>{workspace.connectors.map(connector => { const node: LinkCanvasNode = { id: 'action', kind: 'action', connectorId: connector.id, x: 560, y: 170 }; return <button key={connector.id} onPointerDown={() => setPointerNode(node)} onClick={() => addPaletteNode('action', connector.id)} data-testid="link-action-source"><GripVertical size={13}/><span><strong>{connector.name}</strong><em>{connector.endpointHost}</em></span><Plus size={13}/></button> })}{!workspace.connectors.length && null}</div>
      </aside>
      <div className="bo-links-canvas-scroll">
        <div className="bo-links-canvas" ref={canvasRef} data-testid="links-canvas">
          <div className="bo-links-grid"/>
          {trigger && action ? <svg viewBox="0 0 900 460" aria-hidden="true"><defs><marker id="bo-link-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"/></marker></defs><path d={`M ${trigger.x + 190} ${trigger.y + 45} C ${trigger.x + 300} ${trigger.y + 45}, ${action.x - 110} ${action.y + 45}, ${action.x} ${action.y + 45}`} markerEnd="url(#bo-link-arrow)"/></svg> : null}
          {!nodes.length ? <div className="bo-links-empty"><Link2 size={27}/><strong>Build your first Link</strong><span>Drag a Wesify event here, then drag the service that should receive it.</span></div> : null}
          {trigger ? <article className="bo-link-node trigger" style={{ left: trigger.x, top: trigger.y }} onPointerDown={() => setPointerNode(trigger)} data-testid="link-trigger-node"><i/><header><span><small>TRIGGER</small><strong>{config.entities.find(item => item.id === trigger.entityId)?.label}</strong></span><button onPointerDown={event => event.stopPropagation()} onClick={() => setNodes(current => current.filter(item => item.kind !== 'trigger'))}><X size={13}/></button></header><label onPointerDown={event => event.stopPropagation()}>When record is <select value={trigger.event} onChange={input => setNodes(current => current.map(item => item.kind === 'trigger' ? { ...item, event: input.target.value as 'created' | 'updated' } : item))} data-testid="link-event"><option value="created">created</option><option value="updated">updated</option></select></label><em><GripVertical size={12}/> Drag to move</em></article> : null}
          {action ? <article className="bo-link-node action" style={{ left: action.x, top: action.y }} onPointerDown={() => setPointerNode(action)} data-testid="link-action-node"><i/><header><span><small>ACTION</small><strong>{workspace.connectors.find(item => item.id === action.connectorId)?.name}</strong></span><button onPointerDown={event => event.stopPropagation()} onClick={() => setNodes(current => current.filter(item => item.kind !== 'action'))}><X size={13}/></button></header><label>Send secure event payload</label><em><GripVertical size={12}/> Drag to move</em></article> : null}
        </div>
      </div>
    </section>
    <section className="bo-automation-connect bo-links-connection">
      <div><h2>Plug in Make or another service</h2></div>
      <form onSubmit={addConnector}>
        <label><span>Name</span><input value={connectorName} onChange={input => setConnectorName(input.target.value)} required data-testid="connector-name"/></label>
        <label><span>Connector</span><select value={connectorType} onChange={input => setConnectorType(input.target.value as ConnectorType)}><option value="make-webhook">Make custom webhook</option><option value="generic-webhook">Other HTTPS webhook</option></select></label>
        <label className="wide"><span>Webhook URL</span><input type="url" placeholder="https://hook.eu2.make.com/..." value={endpointUrl} onChange={input => setEndpointUrl(input.target.value)} required data-testid="connector-url"/></label>
        <button disabled={working || !manifest}><Plus size={15}/> Save connection</button>
      </form>
    </section>
    <section className="bo-automation-list"><header><div><h2>Saved Links</h2></div><span>{workspace.automations.filter(item => item.enabled).length} active</span></header>{workspace.automations.map(item => <article key={item.id} data-testid="saved-link" data-trigger={item.trigger.entityId}><span className={item.enabled ? 'on' : ''}><Link2 size={15}/></span><div><strong>{item.name}</strong><small>{humanize(item.trigger.entityId)} · {item.trigger.event}</small></div><button disabled={working} onClick={() => loadLink(item.id)}>View graph</button><button disabled={working || !manifest} onClick={() => manifest && void withRefresh(() => testManagedAutomation(manifest.workspaceId, item.id), 'Simulation passed. No external data was sent.')}>Simulate</button><button className={item.enabled ? 'enabled' : ''} disabled={working || !manifest} onClick={() => manifest && void withRefresh(() => setManagedAutomationEnabled(manifest.workspaceId, item.id, !item.enabled), item.enabled ? 'Link paused.' : 'Link is live.')}>{item.enabled ? 'On' : 'Off'}</button></article>)}{!workspace.automations.length && <div className="bo-empty-state">No Links saved yet.</div>}</section>
    {workspace.runs.length ? <section className="bo-automation-runs"><header><h2>Run history</h2></header>{workspace.runs.slice(0, 8).map(run => <div key={run.id}><span className={run.status}>{humanize(run.status)}</span><strong>{run.automationName}</strong><small>{humanize(run.event)} · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(run.finishedAt))}</small></div>)}</section> : null}
    <section className="bo-built-in-workflows"><header><h2>Built-in notifications</h2></header>{config.workflows.map(item => <div key={item.id}><strong>{item.name}</strong><span>{item.trigger.event}{item.trigger.field ? ` · ${item.trigger.field} = ${item.trigger.equals}` : ''}</span><small>{item.enabled ? 'Active' : 'Paused'}</small></div>)}{config.workflows.length === 0 && <div className="bo-empty-state">Ask Wesify to add a notification rule in the assistant.</div>}</section>
  </>
}

function SettingsView({ config, manifest, versions, auditEvents, role, onRoleChange, rollback }: { config: WorkspaceConfiguration; manifest: GeneratedProjectManifest | null; versions: Array<{ version: number; changeDescription: string; createdAt: string; status: string }>; auditEvents: WorkspaceAuditEvent[]; role: WorkspaceRoleId; onRoleChange: (role: WorkspaceRoleId) => void; rollback: () => void }) {
  const canViewAudit = role === 'owner' || role === 'admin'
  const setupRequired = new Set(['finance.payments', 'documents.esign', 'crm.client-portal', 'commerce.ecommerce', 'marketing.email'])
  return <><div className="bo-schema-heading"><h1>Settings</h1></div><section className="bo-profile-grid"><article><small>Industry</small><strong>{config.profile.industry}</strong></article><article><small>Revenue model</small><strong>{config.profile.revenueModel || 'Not confirmed'}</strong></article><article><small>Team structure</small><strong>{config.profile.teamStructure || 'Not confirmed'}</strong></article><article><small>Operating base</small><strong>{humanize(config.capabilityPlan?.packId ?? 'Custom')}</strong></article><article><small>Workspace version</small><strong>Version {manifest?.version ?? 1} · {manifest?.buildStatus === 'HEALTHY' ? 'Healthy' : 'Local'}</strong>{manifest?.previousVersion ? <button className="bo-undo-change" onClick={rollback}>Undo last change</button> : null}</article><article><small>Change history</small><strong>{versions.slice(0, 3).map(item => `v${item.version} ${item.changeDescription}`).join(' · ') || 'Initial workspace'}</strong></article><article className="bo-profile-grid__wide"><small>Business systems</small><div className="bo-capability-list">{(config.capabilities ?? []).map(id => <span key={id} className={setupRequired.has(id) ? 'needs-setup' : ''}>{capabilityById.get(id)?.label ?? humanize(id)}<em>{setupRequired.has(id) ? 'Setup required' : 'Ready'}</em></span>)}</div></article><article className="bo-profile-grid__wide"><small>Connected apps</small>{config.connections?.length
      ? <div className="bo-connection-list" data-testid="connection-list">{config.connections.map(item => <span key={item.capabilityId} className={item.status}>
          <b>{item.providerLabel}</b>
          <em>{capabilityById.get(item.capabilityId)?.label ?? item.capabilityId} · {item.status === 'connected' ? (item.mode === 'read-write' ? 'two-way' : 'read only') : 'not connected yet'}</em>
        </span>)}</div>
      : <strong>Wesify holds all your records. Tell the assistant which apps you already use and Wesify will show them here instead.</strong>}</article><article className="bo-profile-grid__wide"><small>Why Wesify built this</small><div className="bo-audit-list" data-testid="capability-reasons">{Object.entries(config.capabilityPlan?.reasons ?? {}).filter(([id]) => (config.capabilities ?? []).includes(id)).slice(0, 8).map(([id, reason]) => <span key={id}><b>{capabilityById.get(id)?.label ?? humanize(id)}</b><em>{reason}</em></span>)}{!Object.keys(config.capabilityPlan?.reasons ?? {}).length && <strong>This workspace was assembled before Wesify recorded its selection reasons.</strong>}</div></article><article className="bo-profile-grid__wide bo-role-settings"><small>Role preview</small><select value={role} onChange={event => onRoleChange(event.target.value as WorkspaceRoleId)} data-testid="schema-role" aria-label="Preview workspace as role">{config.roles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><strong>This previews visibility locally. Production users still require authenticated accounts and server-assigned roles.</strong></article><article className="bo-profile-grid__wide bo-export"><small>Your data</small><strong>Every record, with the field definitions that give them meaning, in one file. Yours to keep whatever happens to this account.</strong><button onClick={() => { if (manifest) void exportWorkspace(manifest.workspaceId).catch(() => undefined) }} data-testid="export-workspace"><Download size={14}/> Export everything</button></article><article className="bo-profile-grid__wide"><small>Security audit</small>{canViewAudit ? <div className="bo-audit-list">{auditEvents.slice(0, 5).map(item => <span key={item.id}><b>{humanize(item.event.replaceAll('.', '-'))}</b><em>{humanize(item.role)} · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.at))}</em></span>)}{!auditEvents.length && <strong>No administrative actions yet.</strong>}</div> : <strong>Visible to owners and administrators only.</strong>}</article></section></>
}

function ProjectBuildState({ label }: { label: string }) {
  return <div className="bo-project-build"><section><Sparkles size={20}/><small>WESTIFY IS ADAPTING YOUR COMMAND CENTER</small><h2>{label}</h2><div><span className="done"><Check size={13}/> Understanding the change</span><span className="done"><Check size={13}/> Updating your business system</span><span><i/> Testing everything</span></div></section></div>
}

function RecordForm({ entity, entities, records, initialRecord, onClose, onSubmit, onDelete, onChangeEntity }: { entity: EntityDefinition; entities: EntityDefinition[]; records: WorkspaceRecords; initialRecord?: BusinessRecord; onClose: () => void; onSubmit: (values: Record<string, string | number | boolean>) => void; onDelete?: () => void; onChangeEntity: (entity: EntityDefinition) => void }) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => initialRecord ? Object.fromEntries(entity.fields.filter(item => initialRecord[item.id] !== undefined).map(item => [item.id, initialRecord[item.id]])) : {})
  const update = (id: string, value: string | number | boolean) => setValues(current => ({ ...current, [id]: value }))
  return <div className="bo-modal-backdrop"><form className="bo-schema-form" onSubmit={event => { event.preventDefault(); onSubmit(values) }}><header><div><small>{initialRecord ? 'EDIT' : 'CREATE'}</small>{initialRecord ? <strong>{entity.label}</strong> : <select value={entity.id} onChange={event => { const next = entities.find(item => item.id === event.target.value); if (next) { setValues({}); onChangeEntity(next) } }}>{entities.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>}</div><button type="button" onClick={onClose}><X size={17}/></button></header><div>{entity.fields.map(item => <label key={item.id}><span>{item.label}{item.required ? ' *' : ''}</span>{item.type === 'select' ? <select value={String(values[item.id] ?? '')} onChange={event => update(item.id, event.target.value)} required={item.required} data-testid={`field-${item.id}`}><option value="">Select</option>{item.options?.map(option => <option key={option}>{option}</option>)}</select> : item.type === 'relation' ? <select value={String(values[item.id] ?? '')} onChange={event => update(item.id, event.target.value)} required={item.required} data-testid={`field-${item.id}`}><option value="">Select</option>{(records[item.relationEntityId ?? ''] ?? []).map(record => { const related = entities.find(candidate => candidate.id === item.relationEntityId); return <option key={record.id} value={record.id}>{String(record[related?.primaryField ?? 'name'] ?? related?.label ?? 'Record')}</option> })}</select> : item.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[item.id])} onChange={event => update(item.id, event.target.checked)} data-testid={`field-${item.id}`}/> : item.type === 'long-text' ? <textarea value={String(values[item.id] ?? '')} onChange={event => update(item.id, event.target.value)} data-testid={`field-${item.id}`}/> : <input type={item.type === 'date' ? 'date' : item.type === 'number' || item.type === 'currency' ? 'number' : item.type === 'email' ? 'email' : 'text'} value={String(values[item.id] ?? '')} onChange={event => update(item.id, item.type === 'number' || item.type === 'currency' ? Number(event.target.value) : event.target.value)} required={item.required} data-testid={`field-${item.id}`}/>}</label>)}</div><footer>{onDelete && <button type="button" className="bo-record-delete" onClick={onDelete}>Delete</button>}<button type="button" onClick={onClose}>Cancel</button><button type="submit" data-testid="schema-create-record">{initialRecord ? 'Save changes' : `Create ${entity.label.toLowerCase()}`}</button></footer></form></div>
}

function ChangePreview({ action, config, candidate, onCancel, onApply }: { action: WorkspaceAction; config: WorkspaceConfiguration; candidate: GeneratedProjectManifest | null; onCancel: () => void; onApply: () => void }) {
  const description = action.type === 'add_field' ? `Add “${action.field.label}” to ${config.entities.find(item => item.id === action.entityId)?.pluralLabel}.` : action.type === 'create_workflow' ? `Create the automation “${action.workflow.name}”.` : action.type === 'delete_record' ? `Delete this ${config.entities.find(item => item.id === action.entityId)?.label.toLowerCase()} record.` : action.type === 'activate_module' ? `Add ${action.capabilityId ? capabilityById.get(action.capabilityId)?.label ?? action.capabilityId : action.entities.map(entity => entity.pluralLabel).join(', ')} and everything it requires.` : action.type === 'deactivate_capability' ? `Remove ${capabilityById.get(action.capabilityId)?.label ?? action.capabilityId} from the visible workspace. Existing data stays recoverable.` : `Apply ${action.type.replaceAll('_', ' ')}.`
  const plan = planWorkspaceMutation(config, action)
  const control = evaluateActionControl(config, action)
  const affected = [plan.affected.entityIds.length && `${plan.affected.entityIds.length} data types`, plan.affected.viewIds.length && `${plan.affected.viewIds.length} views`, plan.affected.workflowIds.length && `${plan.affected.workflowIds.length} workflows`, plan.affected.kpiIds.length && `${plan.affected.kpiIds.length} KPIs`, plan.affected.agentIds.length && `${plan.affected.agentIds.length} agents`, plan.affected.eventTypes.length && `${plan.affected.eventTypes.length} event types`].filter(Boolean).join(' · ')
  return <div className="bo-modal-backdrop"><section className="bo-change-preview"><span><Sparkles size={18}/></span><small>TESTED WORKSPACE PREVIEW</small><h2>Wesify prepared your update</h2><div className="bo-change-impact"><strong>{description}</strong><span>Autonomy level {control.level}: {humanize(control.disposition)}</span>{affected && <span>Affects {affected}</span>}{plan.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>{candidate && <div className="bo-candidate-preview"><strong>Version {candidate.version} passed its checks</strong><span>{candidate.pages.map(page => page.label).join(' · ')}</span><span>{candidate.specializedComponents.map(component => component.label).join(' · ')}</span></div>}<footer><button onClick={onCancel}>Request changes</button><button onClick={onApply}>Apply changes</button></footer></section></div>
}
