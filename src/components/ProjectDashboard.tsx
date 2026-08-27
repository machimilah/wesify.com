import { ArrowRight, DollarSign, House, Link2, Menu, MoreHorizontal, Settings, Sparkles, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { Account, AccountWorkspace } from '../engine/authClient'
import { loadSelectedTools, saveSelectedTools } from '../engine/toolSelection'
import { deletedWorkspaceIds, forgetWorkspaceLocally, readWorkspaceSetup } from '../engine/workspaceSetup'
import { deleteWorkspace } from '../engine/workspaceSetupClient'
import { isWorkspaceConfiguration } from '../engine/workspaceSchema'
import { AccountButton } from './AccountButton'
import { Brand } from './Brand'
import './ProjectDashboard.css'

/** The public page's one shaft of light, on the page an account lands on straight after it. */
const LightPillar = lazy(() => import('./LightPillar').then(module => ({ default: module.LightPillar })))
/** The public page's prompt, unchanged: one box, described once, used in both places. */
const CompanyPrompt = lazy(() => import('./CompanyPrompt').then(module => ({ default: module.CompanyPrompt })))

interface ProjectItem {
  id: string
  name: string
  /** The logo onboarding was given, if it was given one. Empty for every workspace built without it. */
  logo: string
  role: string
  createdAt: string
  local: boolean
}

function readLocalProjects(): ProjectItem[] {
  const projects = new Map<string, ProjectItem>()
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith('bo-workspace-config:')) continue
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (!isWorkspaceConfiguration(value)) continue
      projects.set(value.id, {
        id: value.id,
        name: value.profile.companyName || 'Untitled company',
        logo: value.profile.logo || readWorkspaceSetup(value.id).logo,
        role: 'owner',
        createdAt: '',
        local: true,
      })
    } catch {
      // A partial local build should not hide the rest of the dashboard.
    }
  }

  try {
    const legacy: unknown = JSON.parse(localStorage.getItem('bo-workspace-config') ?? 'null')
    if (isWorkspaceConfiguration(legacy) && !projects.has(legacy.id)) {
      projects.set(legacy.id, {
        id: legacy.id,
        name: legacy.profile.companyName || 'Untitled company',
        logo: legacy.profile.logo || readWorkspaceSetup(legacy.id).logo,
        role: 'owner',
        createdAt: '',
        local: true,
      })
    }
  } catch {
    // Ignore a stale legacy cache.
  }

  return [...projects.values()]
}

function displayName(account: Account | null) {
  if (!account?.email) return 'there'
  const first = account.email.split('@')[0].split(/[._-]/).find(Boolean) || 'there'
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function projectList(workspaces: AccountWorkspace[]) {
  const merged = new Map<string, ProjectItem>()
  // Checked against both halves of the list. The server stops listing a deleted workspace the moment
  // it is deleted, so this is really about the local half — but a stale account response held by a
  // page that has not refetched would put one back on screen just as effectively.
  const buried = new Set(deletedWorkspaceIds())
  workspaces.forEach(workspace => merged.set(workspace.id, {
    id: workspace.id,
    name: workspace.name,
    logo: workspace.logo ?? '',
    role: workspace.role,
    createdAt: workspace.created_at,
    local: false,
  }))
  readLocalProjects().forEach(project => {
    const current = merged.get(project.id)
    // The server's row wins on name and role; the logo comes from whichever of the two has one, so a
    // workspace built before logos existed still shows the one this browser was given.
    merged.set(project.id, current ? { ...project, ...current, logo: current.logo || project.logo } : project)
  })
  return [...merged.values()].filter(project => !buried.has(project.id))
}

/**
 * How long a deleted workspace takes to reach the bin, in step with the keyframes in the stylesheet.
 *
 * Held here as well as there because the row is discarded by React rather than by the animation
 * ending: the two have to agree, or the name disappears mid-flight or hangs around after landing.
 */
const binFlightMs = 640

/**
 * How many workspaces the Recents list names before it stops.
 *
 * Ten rather than a handful because this is now the only place a workspace is managed from — the ⋯
 * beside each name is where deleting lives — and a cap that hides the eleventh workspace hides the
 * only way to get rid of it. The list scrolls past what fits.
 */
const recentsShown = 10

export function ProjectDashboard({ account, workspaces, onNavigate, onBuild }: {
  account: Account | null
  workspaces: AccountWorkspace[]
  onNavigate: (path: string) => void
  onBuild: (brief: string) => void
}) {
  const allProjects = useMemo(() => projectList(workspaces), [workspaces])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** The workspace whose actions menu is open, and the one being asked about. Ids, never booleans. */
  const [actionsFor, setActionsFor] = useState('')
  const [confirmingFor, setConfirmingFor] = useState('')
  const [deleting, setDeleting] = useState(false)
  /** The workspace currently being thrown away on screen. Cleared whether it lands or comes back. */
  const [vanishing, setVanishing] = useState('')
  const [notice, setNotice] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [selectedTools, setSelectedTools] = useState(() => loadSelectedTools())
  /**
   * Workspaces this browser has deleted, held here rather than waiting for the account to be fetched
   * again. The list arrives as a prop from whoever owns the session, and a deleted workspace that
   * stays on screen until that refresh happens reads as a deletion that did not work.
   */
  const [deleted, setDeleted] = useState<string[]>([])
  useEffect(() => saveSelectedTools(selectedTools), [selectedTools])

  const projects = useMemo(() => allProjects.filter(project => !deleted.includes(project.id)), [allProjects, deleted])

  const openProject = (project: ProjectItem) => {
    localStorage.setItem('bo-active-workspace-id', project.id)
    onNavigate(`/workspace/${project.id}/home`)
  }

  /**
   * Deletes one workspace, on the server and in this browser both.
   *
   * The request and the animation run together rather than one after the other. Waiting for the
   * server before starting to move would make a fast deletion look like nothing happened and a slow
   * one look broken; starting the movement first and discarding the row on the server's word means
   * the row is only gone once it really is. A refusal puts it back where it was.
   *
   * The local sweep is the other half. A workspace built before anybody signed in also lives in this
   * browser's storage, and keys left behind would put it straight back in the list on the next load.
   */
  const removeProject = async (project: ProjectItem) => {
    if (deleting) return
    setDeleting(true)
    setNotice('')
    setConfirmingFor('')
    setVanishing(project.id)

    // Somebody who has asked for less movement is not made to wait for movement they will not see.
    const flight = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : binFlightMs
    const [outcome] = await Promise.all([
      deleteWorkspace(project.id).then(
        result => ({ failure: '', reached: result.reached }),
        (error: unknown) => ({ failure: error instanceof Error ? error.message : 'Wesify could not delete that workspace.', reached: true }),
      ),
      new Promise(resolve => window.setTimeout(resolve, flight)),
    ])

    if (outcome.failure) {
      setVanishing('')
      setDeleting(false)
      setNotice(outcome.failure)
      return
    }
    forgetWorkspaceLocally(project.id)
    setDeleted(ids => [...ids, project.id])
    setVanishing('')
    setDeleting(false)
    // Said plainly rather than left to be discovered on another device: nothing beyond this browser
    // heard about the deletion.
    if (!outcome.reached) setNotice(`${project.name} was removed from this browser. Wesify could not reach the server to delete it there.`)
  }

  return <main className="wes-dashboard" data-testid="project-dashboard">
    <aside className={`wes-dashboard__sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Main navigation">
      <div className="wes-dashboard__brand-row">
        <button type="button" onClick={() => onNavigate('/dashboard')} aria-label="Dashboard home"><Brand inverse/></button>
        <button type="button" className="wes-dashboard__sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" title="Close navigation"><X size={17}/></button>
      </div>

      <nav className="wes-dashboard__primary-nav" aria-label="Workspace">
        <button type="button" className="active" onClick={() => setSidebarOpen(false)}><House size={17}/><span>Home</span></button>
        <button type="button" onClick={() => { setToolsOpen(true); setSidebarOpen(false) }}><Link2 size={17}/><span>Connectors</span></button>
      </nav>

      <section className="wes-dashboard__recents">
        <h2>Recents</h2>
        {projects.slice(0, recentsShown).map(project => <div className={`wes-dashboard__recent${vanishing === project.id ? ' is-vanishing' : ''}`} key={project.id}>
          <div className="wes-dashboard__recent-row" aria-busy={vanishing === project.id}>
            <button type="button" className="wes-dashboard__recent-open" onClick={() => openProject(project)} disabled={vanishing === project.id} data-testid="open-workspace">{project.name}</button>
            <button
              type="button"
              className="wes-dashboard__recent-more"
              onClick={() => { setActionsFor(open => open === project.id ? '' : project.id); setConfirmingFor(''); setNotice('') }}
              aria-expanded={actionsFor === project.id}
              aria-haspopup="menu"
              aria-label={`Actions for ${project.name}`}
              title="Workspace actions"
              data-testid="workspace-actions"
            ><MoreHorizontal size={15}/></button>
            {/* The bin the name is thrown into: only ever on screen while something is falling in. */}
            {vanishing === project.id && <span className="wes-dashboard__recent-bin" aria-hidden="true"><Trash2 size={15}/></span>}
          </div>

          {/* Opened in place rather than floating over the list: the sidebar clips what overflows it,
              and a menu that is cut in half by the column it lives in is worse than one that pushes
              the names below it down. */}
          {actionsFor === project.id && <div className="wes-dashboard__recent-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setActionsFor(''); setNotice('Workspace settings are not built yet.') }} data-testid="workspace-settings"><Settings size={13}/><span>Settings</span></button>
            <button type="button" role="menuitem" className="is-destructive" onClick={() => { setActionsFor(''); setConfirmingFor(project.id) }} data-testid="workspace-delete"><Trash2 size={13}/><span>Delete</span></button>
          </div>}

          {confirmingFor === project.id && <div className="wes-dashboard__confirm" role="alertdialog" aria-label={`Delete ${project.name}`} data-testid="workspace-delete-confirm">
            <strong>Delete {project.name}?</strong>
            <small>Every record, page and version in it goes too. This cannot be undone.</small>
            <div>
              <button type="button" onClick={() => setConfirmingFor('')} disabled={deleting}>Cancel</button>
              <button type="button" className="is-destructive" onClick={() => removeProject(project)} disabled={deleting} data-testid="workspace-delete-confirmed">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>}
        </div>)}
        {!projects.length && <span>No projects yet</span>}
        {notice && <p className="wes-dashboard__notice" role="status">{notice}</p>}
      </section>

      <div className="wes-dashboard__account">
        
        <div className="wes-dashboard__identity">
          <AccountButton/>
        </div>
      </div>
    </aside>

    {sidebarOpen && <button type="button" className="wes-dashboard__backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"/>}

    <section className="wes-dashboard__main">
      <div className="wes-dashboard__visual" aria-hidden="true">
        <Suspense fallback={<div className="wes-dashboard__visual-loading"/>}>
          <LightPillar
            topColor="#ffca55"
            bottomColor="#ffffff"
            intensity={0.8}
            rotationSpeed={0.1}
            glowAmount={0.005}
            pillarWidth={2.2}
            pillarHeight={0.3}
            noiseIntensity={0.5}
            pillarRotation={22}
            mixBlendMode="normal"
          />
        </Suspense>
      </div>
      <div className="wes-dashboard__visual-veil" aria-hidden="true"/>

      <header className="wes-dashboard__mobile-header">
        <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation" title="Open navigation"><Menu size={19}/></button>
        <Brand inverse/>
        <button type="button" onClick={() => setToolsOpen(true)} aria-label="Connect tools" title="Connect tools"><Link2 size={18}/></button>
      </header>

      <div className="wes-dashboard__center">
        <h1>Ready to work?</h1>
        <div className="wes-prompt-shell wes-prompt-dark">
          <Suspense fallback={<div className="wes-prompt-shell__loading" aria-busy="true"/>}>
            <CompanyPrompt
              onSubmit={onBuild}
              testId="dashboard-brief"
              submitTestId="dashboard-start-building"
              selectedTools={selectedTools}
              onToolsChange={setSelectedTools}
              toolsOpen={toolsOpen}
              onToolsOpenChange={setToolsOpen}
            />
          </Suspense>
        </div>

      </div>
    </section>

  </main>
}
