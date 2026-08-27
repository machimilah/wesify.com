import {
  ArrowRight, BadgeCheck, Banknote, BarChart3, Bot, Boxes, CalendarDays, Check, CircleDollarSign,
  ChevronRight, ClipboardList, Contact, Download, Factory, FileText, FolderKanban, Headphones, LayoutDashboard, Link2,
  ArrowLeftRight, Building2, CalendarCheck, Flag, Handshake, HardHat, Layers, ListChecks, Megaphone, Package,
  ArrowUpDown, Columns3, LogOut, Plus, Receipt, RefreshCw, ScanLine, ScrollText, Search, ShieldCheck, ShoppingCart, Table2, Target, TrendingUp, Truck,
  Users, UsersRound, Wallet, Warehouse,
  Workflow, Wrench, X, Zap,
  Calendar,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ActionResult, BusinessRecord, WorkspaceAction, WorkspaceRecords } from '../engine/workspaceActions'
import { executeWorkspaceAction, interpretWorkspaceCommand } from '../engine/workspaceActions'
import type { EntityDefinition, FieldDefinition, NavigationDefinition, ViewDefinition, WorkspaceConfiguration, WorkspaceRoleId } from '../engine/workspaceSchema'
import { buildGeneratedChange, ensureGeneratedProject, executeGeneratedRecordAction, exportWorkspace, listGeneratedVersions, loadGeneratedRecords, loadGeneratedRuntime, loadWorkspaceAudit, loadWorkspaceNotifications, markWorkspaceNotificationRead, promoteGeneratedChange, queryGeneratedProject, rollbackGeneratedProject, type GeneratedProjectManifest, type GeneratedRuntime, type WorkspaceAuditEvent, type WorkspaceNotification } from '../engine/projectClient'
import { askWorkspaceAgent } from '../engine/workspaceAgent'
import { capabilityById } from '../engine/capabilityCatalog'
import { connectionFor, providerOf, type WorkspaceConnection } from '../engine/connections'
import { recordIndustryObservations } from '../engine/industryClient'
import { connectStripe, disconnectApp, loadConnectedApps, syncConnectedApp, syncSummary, type ConnectedApp } from '../engine/connectionClient'
import { loadAutomationWorkspace, respondToAutomationApproval, type AutomationWorkspace } from '../engine/automationClient'
import { currentAccount } from '../engine/authClient'
import { convertBusinessRecord, saveDocumentLines, type DocumentLine } from '../engine/documentClient'
import { postJournal } from '../engine/accountingClient'
import { humanize, readStorage } from '../engine/shared'
import { faceFor, faceForNavigation } from './faces'
import { AccountButton } from './AccountButton'
import { Brand } from './Brand'
import { evaluateActionControl } from '../engine/governanceArchitecture'
import { planWorkspaceMutation } from '../engine/mutationArchitecture'
import { refreshWorkspaceIntelligence } from '../engine/operatingArchitecture'
import { activeOperatingFlows, activeProcessCount, activeSuiteDomains, recordTransitions, suiteDomainForModule, suiteDomainLabel, type BusinessSuiteDomainId } from '../engine/operatingSuite'
import { AnalyticsView, ControlView, TodayView, metricValue } from './BusinessOverviewViews'
import { ChangePreview, JournalPostForm, RecordForm } from './SchemaDashboardForms'
import { WorkflowStudio } from './WorkflowStudio'

const emptyAutomationWorkspace: AutomationWorkspace = { connectors: [], automations: [], approvals: [], runs: [] }

function routeId(config: WorkspaceConfiguration, basePath: string) {
  const id = window.location.pathname.slice(basePath.length).split('/').filter(Boolean)[0] ?? 'home'
  return config.navigation.some(item => item.id === id) ? id : 'home'
}

/**
 * Normalises the navigation of a workspace built by an older version of Wesify.
 *
 * The assistant stopped being a page — it is reachable from anywhere now, so a tab for it is a section
 * that leads to a screen no longer worth its own place in the rail.
 */
function normalizeNavigation(config: WorkspaceConfiguration): WorkspaceConfiguration {
  let foundLinks = false
  let foundControl = false
  const navigation = config.navigation.filter(item => item.kind !== 'assistant').map(item => {
    if (item.kind === 'analytics') return { ...item, label: 'Reporting' }
    if (item.kind === 'control') { foundControl = true; return { ...item, label: 'Access & control' } }
    if (item.kind !== 'automations' && item.kind !== 'links') return item
    foundLinks = true
    return { ...item, id: 'links', label: 'Automations', kind: 'links' as const }
  })
  if (!foundLinks) {
    const index = navigation.findIndex(item => item.kind === 'settings')
    navigation.splice(index < 0 ? navigation.length : index, 0, { id: 'links', label: 'Automations', kind: 'links' })
  }
  if (!foundControl) {
    const index = navigation.findIndex(item => item.kind === 'settings')
    navigation.splice(index < 0 ? navigation.length : index, 0, { id: 'control', label: 'Access & control', kind: 'control' })
  }
  const unchanged = navigation.length === config.navigation.length && navigation.every((item, index) => item === config.navigation[index])
  return unchanged ? config : { ...config, navigation }
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
    !automationWorkspace.connectors.length ? { id: 'automation', label: 'Create your first automation', detail: 'Connect a Make custom webhook or another HTTPS service.', target: config.navigation.find(item => item.kind === 'links' || item.kind === 'automations')?.id } : null,
  ].filter(Boolean) as Array<{ id: string; label: string; detail: string; target?: string }>
}

const navIcons: Record<NavigationDefinition['kind'], typeof LayoutDashboard> = {
  home: LayoutDashboard, today: Bot, entity: FileText, analytics: BarChart3, links: Workflow, automations: Workflow, control: ShieldCheck, assistant: Bot, settings: Zap,
}

export function SchemaDashboard({ initialConfig, basePath = '', onExit }: { initialConfig: WorkspaceConfiguration; basePath?: string; onExit?: () => void }) {
  const normalizedInitial = normalizeNavigation(refreshWorkspaceIntelligence(initialConfig))
  const storagePrefix = `bo-workspace:${initialConfig.id}`
  const [config, setConfig] = useState(normalizedInitial)
  const [records, setRecords] = useState<WorkspaceRecords>(() => readStorage(`${storagePrefix}:records`, readStorage('bo-workspace-records', {})))
  const [activeId, setActiveId] = useState(() => routeId(normalizedInitial, basePath))
  const [role, setRole] = useState<WorkspaceRoleId>(() => readStorage(`${storagePrefix}:role`, 'owner'))
  const [serverRole, setServerRole] = useState<WorkspaceRoleId | null>(null)
  const [formEntity, setFormEntity] = useState<EntityDefinition | null>(null)
  const [formDefaults, setFormDefaults] = useState<Record<string, string | number | boolean>>({})
  const [formTransition, setFormTransition] = useState<{ entityId: string; recordId: string } | null>(null)
  const [journalOpen, setJournalOpen] = useState(false)
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
  const mainRef = useRef<HTMLDivElement>(null)
  const recordsTouched = useRef(false)
  /**
   * The first load is no longer blocked by an overlay, so the user can act before the project
   * manifest has arrived. Writes must still reach the server: anything that needs the manifest waits
   * on this instead of silently saving to the browser only and losing the record on the next load.
   */
  const mountedProject = useRef<Promise<GeneratedProjectManifest | null> | null>(null)
  const readyManifest = async () => manifest ?? await (mountedProject.current ?? Promise.resolve(null))
  const activeRole = serverRole ?? role
  const visiblePageIds = new Set(config.interfaceArchitecture?.pages.filter(page => page.roleIds.includes(activeRole)).map(page => page.id) ?? config.navigation.map(item => item.id))
  const visibleNavigation = config.navigation.filter(item => visiblePageIds.has(item.id))
  const activeNavigation = visibleNavigation.find(item => item.id === activeId) ?? visibleNavigation[0] ?? config.navigation[0]
  const immersiveWorkspace = activeNavigation.kind === 'links' || activeNavigation.kind === 'automations'
  const activeView = config.views.find(view => view.id === activeNavigation.viewId)
  const activeEntity = config.entities.find(entity => entity.id === activeView?.entityId)
  const permissions = config.roles.find(item => item.id === activeRole)?.permissions ?? []
  const canCreate = permissions.includes('create') || permissions.includes('admin')
  const canEdit = permissions.includes('edit') || permissions.includes('admin')
  const canDelete = permissions.includes('delete') || permissions.includes('admin')
  const openCreateForm = (entity: EntityDefinition | null, values: Record<string, string | number | boolean> = {}, transition: { entityId: string; recordId: string } | null = null) => {
    setFormDefaults(values)
    setFormTransition(transition)
    setFormEntity(entity)
  }

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
        const [generatedRuntime, generatedRecords, history, alerts, auditHistory, automations, account] = await Promise.all([loadGeneratedRuntime(project), loadGeneratedRecords(project.workspaceId), listGeneratedVersions(project.workspaceId), loadWorkspaceNotifications(project.workspaceId), loadWorkspaceAudit(project.workspaceId).catch(() => []), loadAutomationWorkspace(project.workspaceId).catch(() => emptyAutomationWorkspace), currentAccount()])
        if (cancelled) return null
        const linkedSpecification = normalizeNavigation(project.specification)
        const assignedRole = account?.workspaces.find(item => item.id === project.workspaceId)?.role as WorkspaceRoleId | undefined
        setManifest(project); setRuntime(generatedRuntime); setVersions(history); setNotifications(alerts); setAuditEvents(auditHistory); setAutomationWorkspace(automations); setServerRole(assignedRole && linkedSpecification.roles.some(item => item.id === assignedRole) ? assignedRole : null); setConfig(linkedSpecification)
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
    mainRef.current?.scrollTo({ top: 0 })
    // The same fallback the grouping uses, or a page with no module of its own would read as leaving
    // the panel it is actually listed in.
    setOpenGroup(current => current && suiteDomainForModule(config.navigation.find(item => item.id === id)?.module ?? 'operations') === current ? current : null)
    window.history.pushState({}, '', `${basePath}/${id}`)
  }

  /**
   * The way back out of a workspace and into the list of them.
   *
   * The router owns this when it hands one down — pushing a path from in here would change the
   * address bar without telling the thing that decides what to render. The fallback is for a
   * workspace mounted outside that router: it pushes the path and then says so out loud, which is
   * the one event any router is already listening to.
   */
  const leaveWorkspace = onExit ?? (() => {
    window.history.pushState({}, '', '/dashboard')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  const refreshAutomations = async () => {
    if (!manifest) return
    setAutomationWorkspace(await loadAutomationWorkspace(manifest.workspaceId))
  }
  const runAction = async (action: WorkspaceAction, forcePreview = false) => {
    const control = evaluateActionControl(config, action, { roleId: activeRole })
    if (control.disposition === 'blocked') { say(control.reasons.at(-1) ?? 'Your role does not allow this action.'); return null }
    if (forcePreview || control.requiresApproval || !control.canExecuteDirectly) { await prepareChange(action); return null }
    const result = executeWorkspaceAction(config, records, action)
    let persistedRecord: BusinessRecord | null = null
    try {
      const project = ['create_record', 'update_record', 'delete_record'].includes(action.type) ? await readyManifest() : null
      if (project) {
        const executed = await executeGeneratedRecordAction(project.workspaceId, action)
        if (action.type === 'create_record' || action.type === 'update_record') persistedRecord = executed as BusinessRecord
        const [nextRecords, alerts, auditHistory] = await Promise.all([loadGeneratedRecords(project.workspaceId), loadWorkspaceNotifications(project.workspaceId), loadWorkspaceAudit(project.workspaceId).catch(() => auditEvents)])
        result.records = nextRecords; setNotifications(alerts); setAuditEvents(auditHistory)
      } else if (action.type === 'create_record') {
        persistedRecord = result.records[action.entityId]?.at(-1) ?? null
      } else if (action.type === 'update_record') {
        persistedRecord = result.records[action.entityId]?.find(record => record.id === action.recordId) ?? null
      }
      persist(result.config, result.records)
      say(result.message)
      if (result.navigationId) navigate(result.navigationId)
      setProposedAction(null)
      return persistedRecord
    } catch (error) {
      say(error instanceof Error ? error.message : 'Wesify could not complete that change.')
      return null
    } finally { setBuildState('') }
  }
  const persistDocumentLines = async (entity: EntityDefinition, record: BusinessRecord, lines: DocumentLine[]) => {
    const project = await readyManifest()
    if (!project) throw new Error('Document lines require the workspace service to be available.')
    await saveDocumentLines(project.workspaceId, entity.id, record.id, lines)
    const nextRecords = await loadGeneratedRecords(project.workspaceId)
    persist(config, nextRecords)
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
      const agent = await askWorkspaceAgent(request, config, records, { workspaceId: manifest?.workspaceId ?? '', onActivity: label => setAssistantWorking(label) })
      // Said once, and only when it happened: an answer from the browser model instead of the server
      // is a different answer, and an operator who is not told reads it as Wesify getting worse.
      if ('notice' in agent && agent.notice) say(agent.notice)
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
    const module = suiteDomainForModule(item.module ?? 'operations')
    const group = groups.get(module) ?? []
    group.push(item)
    groups.set(module, group)
    return groups
  }, new Map<BusinessSuiteDomainId, NavigationDefinition[]>()).entries()]
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
    const face = faceFor(group.items[0]?.module ?? group.module)
    const Icon = face.icon
    const holdsActive = group.items.some(item => item.id === activeId)
    return <button
      key={group.module}
      className={`bo-nav-group${holdsActive ? ' active' : ''}${openGroup === group.module ? ' open' : ''}`}
      onClick={() => setOpenGroup(openGroup === group.module ? null : group.module)}
      data-testid={`schema-group-${group.module}`}
    ><Icon size={17}/><span>{suiteDomainLabel(group.module)}</span><ChevronRight size={14}/></button>
  }

  return <div className="bo-dashboard bo-schema-workspace">
    <aside className="bo-dashboard__sidebar">
      <div className="bo-dashboard__sidebar-head"><Brand inverse/></div>
      <nav>
        {primaryNavigation.map(navigationButton)}
        <section className="bo-sidebar-group">{groupedNavigation.map(group => group.nested ? groupButton(group) : navigationButton(group.items[0]))}</section>
        {utilityNavigation.length ? <section className="bo-sidebar-group bo-sidebar-group--utility">{utilityNavigation.map(navigationButton)}</section> : null}
      </nav>
      {canCreate && <button className="bo-schema-create" onClick={() => openCreateForm(config.entities[0] ?? null)}><Plus size={15}/><span>Create</span></button>}
      {/* Who is signed in, and the door. The same two things the workspace list keeps at the foot of
          its own rail, so moving between the two does not move the account menu. The identity block
          renders nothing at all in a build with no Clerk key, which is why the door is a sibling
          rather than something inside it. */}
      <div className="bo-schema-sidebar-foot">
        <div className="bo-schema-identity" data-testid="workspace-account"><AccountButton/></div>
        <button type="button" className="bo-schema-exit" onClick={leaveWorkspace} aria-label="Leave workspace" title="Leave workspace" data-testid="leave-workspace"><LogOut size={16}/></button>
      </div>
    </aside>
    {openItems && <aside className="bo-subsidebar" data-testid="sub-sidebar">
      <header><strong>{suiteDomainLabel(openItems.module)}</strong><button onClick={() => setOpenGroup(null)} aria-label="Close"><X size={15}/></button></header>
      {openItems.items.map(navigationButton)}
    </aside>}
    <div className={`bo-dashboard__main${immersiveWorkspace ? ' bo-dashboard__main--immersive' : ''}`} ref={mainRef}>
      {setupSteps.length ? <div className="bo-setup-banner" data-testid="setup-banner">
        <span><Bot size={14}/></span>
        <strong>Finish setting up Wesify</strong>
        <em>{4 - setupSteps.length}/4 done</em>
        <div>{setupSteps.map(step => <button key={step.id} onClick={() => step.target && navigate(step.target)} title={step.detail}>{step.label}<ArrowRight size={13}/></button>)}</div>
      </div> : null}
      {commandMessage && <div className="bo-command-result"><Bot size={15}/><span>{commandMessage}</span><button onClick={() => setCommandMessage('')}><X size={14}/></button></div>}
      <div className={`bo-dashboard__content${immersiveWorkspace ? ' bo-dashboard__content--immersive' : ''}`}>
        {activeNavigation.kind === 'home' && <WorkspaceHome config={config} records={records} role={activeRole} navigate={navigate} runtime={runtime} notifications={notifications} automationWorkspace={automationWorkspace} openNotification={notification => void openNotification(notification)}/>}
        {activeNavigation.kind === 'today' && <TodayView config={config} records={records} approvals={automationWorkspace.approvals} navigate={navigate}/>}
        {activeNavigation.kind === 'entity' && activeEntity && activeView && <EntityView entity={activeEntity} view={activeView} records={records[activeEntity.id] ?? []} workspaceRecords={records} entities={config.entities} connection={connectionFor(config.connections, activeEntity.capabilityId)} createLabel={activeEntity.id === 'journal-entries' ? 'Post journal' : undefined} onCreate={canCreate ? activeEntity.id === 'journal-entries' ? () => setJournalOpen(true) : () => openCreateForm(activeEntity) : undefined} onEdit={canEdit && activeEntity.id !== 'journal-entries' ? record => setEditingRecord({ entity: activeEntity, record }) : undefined} onUpdate={canEdit && activeEntity.id !== 'journal-entries' ? (record, values) => { void runAction({ type: 'update_record', entityId: activeEntity.id, recordId: record.id, values }) } : undefined}/>}
        {activeNavigation.kind === 'analytics' && <AnalyticsView config={config} records={records} role={activeRole}/>}
        {immersiveWorkspace && <WorkflowPage config={config} manifest={manifest} workspace={automationWorkspace} refresh={refreshAutomations}/>}
        {activeNavigation.kind === 'control' && <ControlView config={config} records={records} automationApprovals={automationWorkspace.approvals} auditEvents={auditEvents} onApprovalDecision={async (approvalId, decision) => { if (!manifest) throw new Error('This workspace is not connected to the automation service.'); await respondToAutomationApproval(manifest.workspaceId, approvalId, decision); await refreshAutomations() }}/>}
        {activeNavigation.kind === 'settings' && <SettingsView config={config} manifest={manifest} versions={versions} auditEvents={auditEvents} role={activeRole} roleLocked={Boolean(serverRole)} onRoleChange={next => { setRole(next); localStorage.setItem(`${storagePrefix}:role`, JSON.stringify(next)); if ((next === 'owner' || next === 'admin') && manifest) void loadWorkspaceAudit(manifest.workspaceId).then(setAuditEvents).catch(() => setAuditEvents([])) }} rollback={() => void rollback()}/>}
      </div>
    </div>
    {formEntity && <RecordForm entity={formEntity} entities={config.entities} records={records} workspaceId={manifest?.workspaceId} copyLinesFrom={formTransition ?? undefined} initialValues={formDefaults} onClose={() => openCreateForm(null)} onSubmit={async (values, lines) => { const targetEntity = formEntity; if (formTransition) { const project = await readyManifest(); if (!project) throw new Error('Business document conversion requires the workspace service.'); const converted = await convertBusinessRecord(project.workspaceId, formTransition.entityId, formTransition.recordId, targetEntity.id, values, lines); const nextRecords = await loadGeneratedRecords(project.workspaceId); persist(config, nextRecords); say(converted.existing ? `${targetEntity.label} already exists and was opened without creating a duplicate.` : `${targetEntity.label} created${converted.copiedLines ? ` with ${converted.copiedLines} line item${converted.copiedLines === 1 ? '' : 's'}` : ''}.`); openCreateForm(null); return } const record = await runAction({ type: 'create_record', entityId: targetEntity.id, values }); if (!record) return; if (lines) { try { await persistDocumentLines(targetEntity, record, lines) } catch (error) { say(error instanceof Error ? error.message : 'Wesify could not save those document lines.'); setEditingRecord({ entity: targetEntity, record }); openCreateForm(null); return } } openCreateForm(null) }} onChangeEntity={entity => openCreateForm(entity)}/>}
    {editingRecord && <RecordForm key={editingRecord.record.id} entity={editingRecord.entity} entities={config.entities} records={records} workspaceId={manifest?.workspaceId} initialRecord={editingRecord.record} transitions={recordTransitions(config, editingRecord.entity, editingRecord.record)} onTransition={transition => { const source = editingRecord; setEditingRecord(null); openCreateForm(transition.entity, transition.values, { entityId: source.entity.id, recordId: source.record.id }) }} onClose={() => setEditingRecord(null)} onSubmit={async (values, lines) => { const target = editingRecord; const record = await runAction({ type: 'update_record', entityId: target.entity.id, recordId: target.record.id, values }); if (!record) return; if (lines) await persistDocumentLines(target.entity, record, lines); setEditingRecord(null) }} onDelete={canDelete ? () => { void prepareChange({ type: 'delete_record', entityId: editingRecord.entity.id, recordId: editingRecord.record.id }); setEditingRecord(null) } : undefined} onChangeEntity={() => undefined}/>}
    {journalOpen && <JournalPostForm accounts={records.accounts ?? []} accountEntity={config.entities.find(entity => entity.id === 'accounts')} onClose={() => setJournalOpen(false)} onSubmit={async input => { const project = await readyManifest(); if (!project) throw new Error('Journal posting requires the workspace service.'); const posted = await postJournal(project.workspaceId, input); const nextRecords = await loadGeneratedRecords(project.workspaceId); persist(config, nextRecords); say(posted.existing ? 'This journal was already posted; no duplicate entries were created.' : `Journal posted with ${posted.entries.length} balanced lines.`); setJournalOpen(false) }}/>}
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
  const allowedPageIds = new Set(config.interfaceArchitecture?.pages.filter(page => page.roleIds.includes(role)).map(page => page.id) ?? config.navigation.map(item => item.id))
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
  const appTiles = config.navigation.filter(item => item.kind !== 'home' && allowedPageIds.has(item.id)).map(item => {
    const view = config.views.find(candidate => candidate.id === item.viewId)
    const entity = config.entities.find(candidate => candidate.id === view?.entityId)
    const face = faceForNavigation(config, item)
    const utility: Record<string, { icon: typeof LayoutDashboard; tint: string; hint: string }> = {
      today: { icon: Calendar, tint: 'amber', hint: 'What needs you today' },
      analytics: { icon: BarChart3, tint: 'indigo', hint: 'Live numbers' },
      links: { icon: Workflow, tint: 'cyan', hint: 'Rules and integrations' },
      automations: { icon: Workflow, tint: 'cyan', hint: 'Rules and integrations' },
      control: { icon: ShieldCheck, tint: 'rose', hint: 'Roles, approvals and audit' },
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
    !automationWorkspace.connectors.length ? { id: 'automation', label: 'Create your first automation', detail: 'Connect a Make custom webhook or another HTTPS service.', target: config.navigation.find(item => item.kind === 'links' || item.kind === 'automations')?.id } : null,
  ].filter(Boolean) as Array<{ id: string; label: string; detail: string; target?: string }>
  const operatingFlows = activeOperatingFlows(config, records).slice(0, 3)
  const activeDomains = activeSuiteDomains(config).filter(domain => domain.active)
  const processCount = activeProcessCount(config)
  return <>
    <div className="bo-schema-heading"><h1>{config.profile.companyName}</h1></div>
    <div className="bo-workspace-section-head"><div><small>BUSINESS SUITE</small><h2>Your apps</h2></div><span>{activeDomains.length} operating domains</span></div>
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
    <section className="bo-operating-map" data-testid="operating-map">
      <header><div><small>CONNECTED OPERATIONS</small><h2>How work moves through the company</h2></div><span>{processCount} active processes</span></header>
      <div>{operatingFlows.map(flow => <article key={flow.id} data-testid={`operating-flow-${flow.id}`}>
        <strong>{flow.label}</strong>
        <div>{flow.stages.map((stage, index) => <span key={`${flow.id}-${stage.entityId}`}>
          <button disabled={!stage.navigationId} onClick={() => stage.navigationId && navigate(stage.navigationId)}><b>{stage.label}</b><small>{stage.count} in {stage.entityLabel.toLowerCase()}</small></button>
          {index < flow.stages.length - 1 && <ArrowRight size={14}/>}
        </span>)}</div>
      </article>)}</div>
      {!operatingFlows.length && <div className="bo-operating-map__empty">No multi-step operating flow is active yet.</div>}
    </section>
    <section className="bo-schema-kpis">{metrics.map(metric => <article key={metric.id}><small>{metric.label}</small><strong>{metricValue(metric, records)}</strong><span>Live workspace data</span></article>)}{metrics.length === 0 && <div className="bo-empty-state">KPIs will appear when Wesify has operational data to measure.</div>}</section>
    {runtime?.widgets.length ? <section className="bo-generated-widgets">{runtime.widgets.map(widget => <article key={widget.id}><small>GENERATED FOR YOUR BUSINESS</small><strong>{widget.label}</strong><span>{records[widget.entityId]?.length ?? 0} connected records</span></article>)}</section> : null}
    <section className="bo-command-layout">
      <div className="bo-action-queue"><header><div><h2>What needs attention</h2></div><span>{attentionCount} open</span></header><div className="bo-action-list">
        {unreadNotifications.slice(0, 4).map(notification => <button key={notification.id} onClick={() => openNotification(notification)}><span><Zap size={13}/></span><strong>{notification.message}</strong><small>{humanize(config.entities.find(item => item.id === notification.entityId)?.label ?? 'Alert')}</small></button>)}
        {recordAlerts.map(alert => <button key={alert.id} onClick={() => { const destination = navigationFor(alert.entityId); if (destination) navigate(destination) }}><span><Bot size={13}/></span><strong>{alert.message}</strong><small>{humanize(config.entities.find(item => item.id === alert.entityId)?.label ?? 'Record')}</small></button>)}
        {!attentionCount && <div className="bo-empty-state">Nothing needs your attention.</div>}
      </div><button className="bo-open-briefing" onClick={() => navigate('today')}>Open daily briefing <ArrowRight size={14}/></button></div>
      <div className="bo-command-modules"><header><div><h2>Recent activity</h2></div></header>{recent.map(({ entity, record }) => <button key={`${entity.id}-${record.id}`} onClick={() => { const destination = navigationFor(entity.id); if (destination) navigate(destination) }}><FileText size={15}/><span><strong>{String(record[entity.primaryField] ?? entity.label)}</strong><small>{entity.label} · {record.updatedAt ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(record.updatedAt)) : 'Just now'}</small></span><ArrowRight size={14}/></button>)}{!recent.length && <div className="bo-empty-state">Activity appears as your team works in Wesify.</div>}</div>
    </section>
  </>
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

type RecordViewMode = 'table' | 'kanban' | 'calendar'

function statusTone(value: unknown) {
  const status = String(value ?? '').toLowerCase()
  if (/won|paid|complete|completed|active|approved|available|fulfilled|resolved|accepted|reconciled/.test(status)) return 'positive'
  if (/lost|overdue|failed|rejected|cancelled|void|blocked|disputed|out of stock|breach/.test(status)) return 'negative'
  if (/pending|await|draft|sent|progress|scheduled|review|low stock|hold|submitted/.test(status)) return 'warning'
  return 'neutral'
}

function recordValue(field: FieldDefinition, value: unknown, entities: EntityDefinition[], records: WorkspaceRecords) {
  if (value === undefined || value === null || value === '') return '—'
  if (field.type === 'relation' && field.relationEntityId) {
    const related = entities.find(item => item.id === field.relationEntityId)
    const record = (records[field.relationEntityId] ?? []).find(item => item.id === value)
    return String(record?.[related?.primaryField ?? 'name'] ?? value)
  }
  if (field.type === 'currency') return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value) || 0)
  if (field.type === 'number') return new Intl.NumberFormat().format(Number(value) || 0)
  if (field.type === 'date') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
  }
  if (field.type === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function EntityView({ entity, view, records, workspaceRecords, entities, connection, createLabel, onCreate, onEdit, onUpdate }: { entity: EntityDefinition; view: ViewDefinition; records: BusinessRecord[]; workspaceRecords: WorkspaceRecords; entities: EntityDefinition[]; connection?: WorkspaceConnection; createLabel?: string; onCreate?: () => void; onEdit?: (record: BusinessRecord) => void; onUpdate?: (record: BusinessRecord, values: Record<string, string | number | boolean>) => void }) {
  const statusField = entity.fields.find(item => item.id === (view.groupBy ?? 'status')) ?? entity.fields.find(item => item.type === 'select')
  const dateField = view.dateField ?? entity.fields.find(item => item.type === 'date')?.id
  const defaultMode: RecordViewMode = view.type === 'kanban' && statusField ? 'kanban' : view.type === 'calendar' && dateField ? 'calendar' : 'table'
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortField, setSortField] = useState(entity.primaryField)
  const [sortDescending, setSortDescending] = useState(false)
  const [mode, setMode] = useState<RecordViewMode>(defaultMode)
  useEffect(() => { setQuery(''); setStatusFilter(''); setSortField(entity.primaryField); setSortDescending(false); setMode(defaultMode) }, [defaultMode, entity.id, entity.primaryField])
  const edit = onEdit ?? (() => undefined)
  const canAdd = onCreate && (!connection || connection.status === 'connected')
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = records.filter(record => {
    if (statusFilter && String(record[statusField?.id ?? 'status'] ?? '') !== statusFilter) return false
    return !normalizedQuery || entity.fields.some(field => recordValue(field, record[field.id], entities, workspaceRecords).toLowerCase().includes(normalizedQuery))
  }).slice().sort((left, right) => {
    const comparison = String(left[sortField] ?? '').localeCompare(String(right[sortField] ?? ''), undefined, { numeric: true })
    return sortDescending ? -comparison : comparison
  })
  const currencyField = entity.fields.find(item => item.type === 'currency')
  const currencyTotal = currencyField ? records.reduce((sum, record) => sum + Number(record[currencyField.id] ?? 0), 0) : null
  const statusCount = statusField ? new Set(records.map(record => String(record[statusField.id] ?? '')).filter(Boolean)).size : 0
  const statusOptions = statusField ? [...new Set([...(statusField.options ?? []), ...records.map(record => String(record[statusField.id] ?? '')).filter(Boolean)])] : []
  return <>
    <div className="bo-operating-head"><div><small>{entity.module.toUpperCase()}</small><h1>{view.label || entity.pluralLabel}</h1></div>{canAdd && <button onClick={onCreate} data-testid="schema-add-record"><Plus size={16}/> {createLabel ?? `Add ${entity.label.toLowerCase()}`}</button>}</div>
    {connection && <ConnectionBanner connection={connection}/>}
    <section className="bo-record-summary" aria-label={`${entity.pluralLabel} summary`}>
      <span><strong>{records.length}</strong><small>Total records</small></span>
      {statusField ? <span><strong>{statusCount}</strong><small>Active stages</small></span> : null}
      {currencyField ? <span><strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(currencyTotal ?? 0)}</strong><small>{currencyField.label}</small></span> : null}
      <span><strong>{filtered.length}</strong><small>In this view</small></span>
    </section>
    <div className="bo-record-toolbar">
      <label className="bo-record-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${entity.pluralLabel.toLowerCase()}`} aria-label={`Search ${entity.pluralLabel}`}/>{query ? <button onClick={() => setQuery('')} aria-label="Clear search"><X size={13}/></button> : null}</label>
      {statusField ? <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label={`Filter by ${statusField.label}`}><option value="">All {statusField.label.toLowerCase()}</option>{statusOptions.map(option => <option key={option}>{option}</option>)}</select> : null}
      <label className="bo-record-sort"><ArrowUpDown size={14}/><select value={sortField} onChange={event => setSortField(event.target.value)} aria-label="Sort records">{entity.fields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select><button onClick={() => setSortDescending(value => !value)} title={sortDescending ? 'Descending' : 'Ascending'} aria-label="Change sort direction">{sortDescending ? '↓' : '↑'}</button></label>
      <div className="bo-view-switcher" role="group" aria-label="View records"><button className={mode === 'table' ? 'active' : ''} onClick={() => setMode('table')} title="Table" aria-label="Table view"><Table2 size={15}/></button>{statusField ? <button className={mode === 'kanban' ? 'active' : ''} onClick={() => setMode('kanban')} title="Board" aria-label="Board view"><Columns3 size={15}/></button> : null}{dateField ? <button className={mode === 'calendar' ? 'active' : ''} onClick={() => setMode('calendar')} title="Schedule" aria-label="Schedule view"><Calendar size={15}/></button> : null}</div>
    </div>
    {mode === 'calendar' && dateField ? <SchemaCalendar entity={entity} dateField={dateField} records={filtered} entities={entities} workspaceRecords={workspaceRecords} onEdit={edit}/> : mode === 'kanban' && statusField ? <SchemaKanban entity={entity} groupBy={statusField.id} records={filtered} entities={entities} workspaceRecords={workspaceRecords} onEdit={edit} onMove={onUpdate}/> : <SchemaTable entity={entity} view={view} records={filtered} entities={entities} workspaceRecords={workspaceRecords} onEdit={edit}/>}
  </>
}

function SchemaTable({ entity, view, records, entities, workspaceRecords, onEdit }: { entity: EntityDefinition; view: ViewDefinition; records: BusinessRecord[]; entities: EntityDefinition[]; workspaceRecords: WorkspaceRecords; onEdit: (record: BusinessRecord) => void }) {
  const fields = (view.columns ?? entity.fields.slice(0, 6).map(item => item.id)).slice(0, 7).map(id => entity.fields.find(item => item.id === id)).filter(Boolean) as FieldDefinition[]
  const columns = { gridTemplateColumns: `repeat(${Math.max(fields.length, 1)}, minmax(125px, 1fr))` }
  return <section className="bo-schema-table"><header style={columns}>{fields.map(item => <span key={item.id}>{item.label}</span>)}</header>{records.map(record => <button className="bo-schema-record-row" style={columns} key={record.id} onClick={() => onEdit(record)}>{fields.map(item => item.id === 'status' || item.type === 'select' && /status|stage/i.test(item.label) ? <span key={item.id}><i className="bo-status-pill" data-tone={statusTone(record[item.id])}>{recordValue(item, record[item.id], entities, workspaceRecords)}</i></span> : <span key={item.id}>{recordValue(item, record[item.id], entities, workspaceRecords)}</span>)}</button>)}{records.length === 0 && <div className="bo-empty-state">No matching {entity.pluralLabel.toLowerCase()}.</div>}</section>
}

function SchemaKanban({ entity, groupBy, records, entities, workspaceRecords, onEdit, onMove }: { entity: EntityDefinition; groupBy: string; records: BusinessRecord[]; entities: EntityDefinition[]; workspaceRecords: WorkspaceRecords; onEdit: (record: BusinessRecord) => void; onMove?: (record: BusinessRecord, values: Record<string, string | number | boolean>) => void }) {
  const groupField = entity.fields.find(item => item.id === groupBy)
  const options = [...new Set([...(groupField?.options ?? []), ...records.map(record => String(record[groupBy] ?? '')).filter(Boolean)])]
  const columns = options.length ? options : ['Unassigned']
  const detailFields = entity.fields.filter(item => ![entity.primaryField, groupBy].includes(item.id)).slice(0, 2)
  return <section className="bo-pipeline" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(230px, 1fr))` }}>{columns.map(option => {
    const matching = records.filter(record => String(record[groupBy] ?? columns[0]) === option)
    return <article key={option} onDragOver={event => { if (onMove) event.preventDefault() }} onDrop={event => { if (!onMove) return; event.preventDefault(); const record = records.find(item => item.id === event.dataTransfer.getData('application/x-wesify-record')); if (record && record[groupBy] !== option) onMove(record, { [groupBy]: option }) }}><header><strong>{option}</strong><span>{matching.length}</span></header>{matching.map(record => <button className="bo-pipeline-card" draggable={Boolean(onMove)} onDragStart={event => event.dataTransfer.setData('application/x-wesify-record', record.id)} key={record.id} onClick={() => onEdit(record)}><strong>{String(record[entity.primaryField] ?? entity.label)}</strong>{detailFields.map(field => record[field.id] !== undefined && record[field.id] !== '' ? <span key={field.id}><small>{field.label}</small><em>{recordValue(field, record[field.id], entities, workspaceRecords)}</em></span> : null)}</button>)}{matching.length === 0 && <div className="bo-column-empty"><small>Drop here</small></div>}</article>
  })}</section>
}

function SchemaCalendar({ entity, dateField, records, entities, workspaceRecords, onEdit }: { entity: EntityDefinition; dateField: string; records: BusinessRecord[]; entities: EntityDefinition[]; workspaceRecords: WorkspaceRecords; onEdit: (record: BusinessRecord) => void }) {
  const scheduled = records.filter(record => record[dateField]).slice().sort((left, right) => String(left[dateField]).localeCompare(String(right[dateField])))
  const status = entity.fields.find(item => item.id === 'status' || item.type === 'select')
  return <section className="bo-schema-calendar">{scheduled.map(record => <button key={record.id} onClick={() => onEdit(record)}><time>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(String(record[dateField])))}</time><span><strong>{String(record[entity.primaryField] ?? entity.label)}</strong>{status ? <small><i className="bo-status-pill" data-tone={statusTone(record[status.id])}>{recordValue(status, record[status.id], entities, workspaceRecords)}</i></small> : null}</span><ArrowRight size={15}/></button>)}{scheduled.length === 0 && <div className="bo-empty-state">No matching scheduled {entity.pluralLabel.toLowerCase()}.</div>}</section>
}

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

function WorkflowPage({ config, manifest, workspace, refresh }: { config: WorkspaceConfiguration; manifest: GeneratedProjectManifest | null; workspace: AutomationWorkspace; refresh: () => Promise<void> }) {
  return <section className="bo-workflow-page">
    <div className="bo-workflow-page__viewport">
      <WorkflowStudio config={config} manifest={manifest} workspace={workspace} refresh={refresh}/>
    </div>
    <ConnectedApps workspaceId={manifest?.workspaceId ?? ''} onSynced={refresh}/>
  </section>
}

function SettingsView({ config, manifest, versions, auditEvents, role, roleLocked, onRoleChange, rollback }: { config: WorkspaceConfiguration; manifest: GeneratedProjectManifest | null; versions: Array<{ version: number; changeDescription: string; createdAt: string; status: string }>; auditEvents: WorkspaceAuditEvent[]; role: WorkspaceRoleId; roleLocked: boolean; onRoleChange: (role: WorkspaceRoleId) => void; rollback: () => void }) {
  const canViewAudit = role === 'owner' || role === 'admin'
  const setupRequired = new Set(['finance.payments', 'documents.esign', 'crm.client-portal', 'commerce.ecommerce', 'marketing.email'])
  return <><div className="bo-schema-heading"><h1>Settings</h1></div><section className="bo-profile-grid"><article><small>Industry</small><strong>{config.profile.industry}</strong></article><article><small>Revenue model</small><strong>{config.profile.revenueModel || 'Not confirmed'}</strong></article><article><small>Team structure</small><strong>{config.profile.teamStructure || 'Not confirmed'}</strong></article><article><small>Operating base</small><strong>{humanize(config.capabilityPlan?.packId ?? 'Custom')}</strong></article><article><small>Workspace version</small><strong>Version {manifest?.version ?? 1} · {manifest?.buildStatus === 'HEALTHY' ? 'Healthy' : 'Local'}</strong>{manifest?.previousVersion ? <button className="bo-undo-change" onClick={rollback}>Undo last change</button> : null}</article><article><small>Change history</small><strong>{versions.slice(0, 3).map(item => `v${item.version} ${item.changeDescription}`).join(' · ') || 'Initial workspace'}</strong></article><article className="bo-profile-grid__wide"><small>Business systems</small><div className="bo-capability-list">{(config.capabilities ?? []).map(id => <span key={id} className={setupRequired.has(id) ? 'needs-setup' : ''}>{capabilityById.get(id)?.label ?? humanize(id)}<em>{setupRequired.has(id) ? 'Setup required' : 'Ready'}</em></span>)}</div></article><article className="bo-profile-grid__wide"><small>Connected apps</small>{config.connections?.length
      ? <div className="bo-connection-list" data-testid="connection-list">{config.connections.map(item => <span key={item.capabilityId} className={item.status}>
          <b>{item.providerLabel}</b>
          <em>{capabilityById.get(item.capabilityId)?.label ?? item.capabilityId} · {item.status === 'connected' ? (item.mode === 'read-write' ? 'two-way' : 'read only') : 'not connected yet'}</em>
        </span>)}</div>
      : <strong>Wesify holds all your records. Tell the assistant which apps you already use and Wesify will show them here instead.</strong>}</article><article className="bo-profile-grid__wide"><small>Why Wesify built this</small><div className="bo-audit-list" data-testid="capability-reasons">{Object.entries(config.capabilityPlan?.reasons ?? {}).filter(([id]) => (config.capabilities ?? []).includes(id)).slice(0, 8).map(([id, reason]) => <span key={id}><b>{capabilityById.get(id)?.label ?? humanize(id)}</b><em>{reason}</em></span>)}{!Object.keys(config.capabilityPlan?.reasons ?? {}).length && <strong>This workspace was assembled before Wesify recorded its selection reasons.</strong>}</div></article><article className="bo-profile-grid__wide bo-role-settings"><small>{roleLocked ? 'Assigned role' : 'Role preview'}</small><select value={role} disabled={roleLocked} onChange={event => onRoleChange(event.target.value as WorkspaceRoleId)} data-testid="schema-role" aria-label={roleLocked ? 'Assigned workspace role' : 'Preview workspace as role'}>{config.roles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><strong>{roleLocked ? 'This role comes from your authenticated workspace membership and is enforced by the server.' : 'Local preview changes visibility on this device. Account deployments use server-assigned roles.'}</strong></article><article className="bo-profile-grid__wide bo-export"><small>Your data</small><strong>Every record, with the field definitions that give them meaning, in one file. Yours to keep whatever happens to this account.</strong><button onClick={() => { if (manifest) void exportWorkspace(manifest.workspaceId).catch(() => undefined) }} data-testid="export-workspace"><Download size={14}/> Export everything</button></article><article className="bo-profile-grid__wide"><small>Security audit</small>{canViewAudit ? <div className="bo-audit-list">{auditEvents.slice(0, 5).map(item => <span key={item.id}><b>{humanize(item.event.replaceAll('.', '-'))}</b><em>{humanize(item.role)} · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.at))}</em></span>)}{!auditEvents.length && <strong>No administrative actions yet.</strong>}</div> : <strong>Visible to owners and administrators only.</strong>}</article></section></>
}

function ProjectBuildState({ label }: { label: string }) {
  return <div className="bo-project-build"><section><Bot size={20}/><small>WESTIFY IS ADAPTING YOUR COMMAND CENTER</small><h2>{label}</h2><div><span className="done"><Check size={13}/> Understanding the change</span><span className="done"><Check size={13}/> Updating your business system</span><span><i/> Testing everything</span></div></section></div>
}
