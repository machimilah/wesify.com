import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Home } from './components/Home'
import type { AIBlueprint } from './engine/blueprint'
import { isWorkspaceConfiguration } from './engine/workspaceSchema'
import type { Answers } from './types'
import { readStorage } from './engine/shared'
import { accountsEnabled, currentAccount, type Account, type AccountWorkspace } from './engine/authClient'
import { rememberSignedInAccount } from './engine/workspaceSetup'
import { AccountWatch, type SignedInAccount } from './components/AccountWatch'

const Builder = lazy(() => import('./components/Builder').then(module => ({ default: module.Builder })))
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })))
const ProjectDashboard = lazy(() => import('./components/ProjectDashboard').then(module => ({ default: module.ProjectDashboard })))
const SignInDialog = lazy(() => import('./components/SignIn').then(module => ({ default: module.SignInDialog })))
const Billing = lazy(() => import('./components/Billing').then(module => ({ default: module.Billing })))
const clerkConfigured = Boolean(String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim())

function activeWorkspaceId() {
  return localStorage.getItem('bo-active-workspace-id') || localStorage.getItem('bo-workspace-id') || readStorage<{ id?: string }>('bo-workspace-config', {}).id || ''
}

/** Every section of a built Command Center owns a top-level indexed URL, such as /clients. */
function workspaceSections(workspaceId: string) {
  const saved = readStorage<unknown>(`bo-workspace-config:${workspaceId}`, readStorage<unknown>('bo-workspace-config', null))
  return isWorkspaceConfiguration(saved) ? saved.navigation.map(item => item.id) : []
}

/**
 * Opens Clerk's sign-up panel, waiting out the moment early in a page load where the button that
 * opens it exists before the script that makes it work has attached itself to the page.
 *
 * `window.Clerk` is a queueing object: calling `openSignUp` on it before Clerk has finished loading is
 * normal and Clerk runs the call once it is ready. What is not safe to assume is that `window.Clerk`
 * exists at all yet — `ClerkProvider` injects the script asynchronously, and a click a beat after
 * first paint can land before that script has run. Retried for a few seconds rather than given up on
 * immediately, which is what silently did nothing before.
 */
function openClerkSignUp() {
  if (typeof window === 'undefined') return
  const attempt = (triesLeft: number) => {
    const clerk = (window as any).Clerk
    if (clerk) { clerk.openSignUp({ redirectUrl: '/dashboard' }); return }
    if (triesLeft <= 0) {
      console.error('Wesify could not open sign-up: Clerk never loaded. If this is a deployment, check that VITE_CLERK_PUBLISHABLE_KEY is set for the build.')
      return
    }
    window.setTimeout(() => attempt(triesLeft - 1), 200)
  }
  attempt(25)
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [answers, setAnswers] = useState<Answers>(() => readStorage('bo-answers', {}))
  const [blueprint, setBlueprint] = useState<AIBlueprint | null>(() => readStorage('bo-blueprint', null))

  const [accounts, setAccounts] = useState<boolean | undefined>(undefined)
  const [account, setAccount] = useState<Account | null>(null)
  const [clerkSession, setClerkSession] = useState<'loading' | 'signed-in' | 'signed-out'>(clerkConfigured ? 'loading' : 'signed-out')
  // Every workspace this account owns or belongs to, most recently created first — the same order
  // the server already returns them in. Empty until the account is known, and re-read after signing
  // in, since neither /api/auth/register nor /api/auth/login themselves return the list.
  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([])
  // What a stranger typed on the public page, held across the sign-in screen so it is not asked for
  // twice. Deliberately not persisted: a sentence typed and abandoned is not something to keep.
  const [pendingBrief, setPendingBrief] = useState('')
  // Signed in with Clerk, but the server would not say who: a key from another Clerk instance, or a
  // database that is down. The sign-in screen says so rather than sitting on 'one moment' forever.
  const [unreachable, setUnreachable] = useState(false)
  /**
   * A description that has been accepted but not yet built: onboarding is open over it.
   *
   * Held here rather than inside either page that can start a build, because both of them can — the
   * public prompt and the project dashboard — and the dialog, the workspace id it produces and the
   * invitations it sends all have to be the same three things whichever door somebody came through.
   */
  // Invitations the server refused, named. Silence here would leave somebody believing a colleague
  // was invited when the plan allowed none.
  /**
   * Whether Wesify is asking who is knocking.
   *
   * A dialog rather than a page, and therefore a piece of state rather than a URL. Sign-in used to
   * live at /signin, which meant that describing a company and being asked to sign in were two
   * different addresses — somebody mid-sentence was navigated away from everything they had just
   * seen. The page they were on stays where it is now, and the question is asked over it.
   */
  const [signInOpen, setSignInOpen] = useState(false)

  const navigate = (nextPath: string) => { window.history.pushState({}, '', nextPath); setPath(nextPath) }

  /** The signed-in front door owns project selection; individual workspaces keep their scoped URLs. */
  const homeFor = () => '/dashboard'

  /**
   * What the interface does when it learns who is signed in — whichever of the two ways told it.
   *
   * `AccountWatch` is one, and is authoritative wherever Clerk is present: it reports every change
   * Clerk makes, at the moment Clerk makes it. The boot fetch below is the other, and covers the
   * build that has no Clerk at all.
   *
   * It only records what it was told. Where that sends somebody is the effect below, which reads
   * the account and the typed-but-unsent brief together — those arrive from different places at
   * times neither controls, and deciding inside this callback meant deciding with a stale copy of
   * one of them.
   */
  const landed = useRef(false)
  const handleAccount = useCallback((found: SignedInAccount | null, signedInWithClerk: boolean) => {
    rememberSignedInAccount(found?.user.id ?? null)
    setAccount(found?.user ?? null)
    setWorkspaces(found?.workspaces ?? [])
    setUnreachable(signedInWithClerk && !found)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      /**
       * Without Clerk, ask both independent questions together so startup costs one round trip. With
       * Clerk, ask only whether accounts are enabled here; AccountWatch waits for Clerk to restore
       * its session before requesting the account, avoiding an anonymous request caused by the race.
       */
      const [enabled, found] = await Promise.all([
        accountsEnabled(),
        // With Clerk, AccountWatch waits for its restored session before making this request. Asking
        // here races the SDK and almost always produces a useless anonymous response first.
        clerkConfigured ? Promise.resolve(null) : currentAccount(),
      ])
      if (cancelled) return
      setAccounts(enabled)
      if (enabled && found) handleAccount(found, false)
    })()
    return () => { cancelled = true }
  }, [handleAccount])

  /**
   * A returning Clerk session can choose its route without waiting for `/api/auth/me` to return the
   * account profile. The public page remains ineligible to render while Clerk is deciding, and this
   * history replacement happens before the browser paints the signed-in state.
   */
  useLayoutEffect(() => {
    if (accounts !== true || clerkSession !== 'signed-in' || path !== '/') return
    window.history.replaceState({}, '', '/dashboard')
    setPath('/dashboard')
  }, [accounts, clerkSession, path])

  /** Resume a public brief after sign-in; otherwise send the account to its project dashboard. */
  useEffect(() => {
    if (!account) {
      landed.current = false
      return
    }
    // Whoever it is, they are in: the question the panel was asking has been answered.
    setSignInOpen(false)
    if (pendingBrief && !landed.current) {
      landed.current = true
      // The sentence survived the sign-in panel, and lands in the build exactly as it would have
      // done had this person already been signed in when they typed it.
      build(pendingBrief)
      return
    }
    if (!pendingBrief && path === '/') {
      window.history.replaceState({}, '', '/dashboard')
      setPath('/dashboard')
    }
  }, [account, path, pendingBrief])

  /**
   * A signed-out person on a page that belongs to an account.
   *
   * There is nothing to render for them there — the workspace, the project dashboard and the billing
   * screen are all somebody's — so they land on the one page that is genuinely public, with the
   * sign-in panel already open over it. Before, this was a full-page redirect to /signin, which lost
   * both the page they wanted and any sense that Wesify was still the thing behind the form.
   */
  const hasSignedInSession = Boolean(account) || (clerkConfigured && clerkSession === 'signed-in')
  const locked = accounts === true && !hasSignedInSession && path !== '/'
  useEffect(() => {
    if (!locked) return
    window.history.replaceState({}, '', '/')
    setPath('/')
    openClerkSignUp()
  }, [locked])

  /** Refresh project membership when the dashboard becomes visible after a completed build. */
  useEffect(() => {
    if (path !== '/dashboard' || !account) return
    let cancelled = false
    void currentAccount().then(found => {
      if (!cancelled && found) handleAccount(found, false)
    })
    return () => { cancelled = true }
  }, [account?.id, handleAccount, path])

  useEffect(() => {
    const handleHistory = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handleHistory)
    return () => window.removeEventListener('popstate', handleHistory)
  }, [])
  useEffect(() => { localStorage.setItem('bo-answers', JSON.stringify(answers)) }, [answers])
  useEffect(() => { blueprint ? localStorage.setItem('bo-blueprint', JSON.stringify(blueprint)) : localStorage.removeItem('bo-blueprint') }, [blueprint])
  useEffect(() => {
    if (path !== '/build') return
    const workspaceId = crypto.randomUUID()
    window.history.replaceState({}, '', `/build/${workspaceId}`)
    setPath(`/build/${workspaceId}`)
  }, [path])
  useEffect(() => {
    const companyName = String(answers.companyName ?? 'Dashboard')
    document.title = path === '/' ? 'Wesify' : path === '/dashboard' ? 'Dashboard | Wesify' : path.startsWith('/build') ? 'Build | Wesify' : `${companyName} | Wesify`
  }, [path, answers.companyName])

  /**
   * Starts a fresh company from one sentence.
   *
   * Everything a previous workspace left behind goes first, and then the sentence is handed to the
   * build. What used to happen here — a name, a logo and a list of colleagues, collected by a dialog
   * standing in front of all this — is now the first thing the build itself asks about, so this is
   * the whole of it again.
   */
  function build(brief: string) {
    const workspaceId = crypto.randomUUID()
    localStorage.removeItem('bo-records'); localStorage.removeItem('bo-actions'); localStorage.removeItem('bo-workspace-config'); localStorage.removeItem('bo-workspace-records'); localStorage.removeItem('bo-ai-history'); localStorage.removeItem('bo-active-workspace-id')
    setAnswers({ companyDescription: brief })
    setBlueprint(null); setPendingBrief('')
    navigate(`/build/${workspaceId}`)
  }

  /**
   * Describing a company is public; the workspace it produces is not.
   *
   * There is one home page, and it is the prompt. A separate landing page arguing for Wesify could only
   * describe what Wesify does, while this does it — and nobody signs up for something they have not seen
   * work. So `/` is always reachable, and the gate sits in front of the product instead.
   *
   * The sentence survives the sign-in screen rather than being asked for twice: somebody who has
   * just described their business has done the only work Wesify needs from them, and making them repeat
   * it to prove they have an account is a way to lose them between the two screens.
   *
   * `accounts === undefined` means Wesify has not asked the server whether it has accounts yet. Waiting
   * is deliberate — rendering either half of that answer would show the wrong page and swap it.
   */
  const startBuild = (brief: string) => {
    if (!accounts || account) return build(brief)
    setPendingBrief(brief)
    openClerkSignUp()
  }

  /**
   * Which page this is, given the path and who is signed in.
   *
   * A function rather than a chain of early returns straight out of the component, so that one thing
   * can be rendered alongside whatever it produces: the watcher below, which has to stay mounted on
   * every page. Unmounting it on navigation would mean losing track of the session on exactly the
   * screens where somebody is using it.
   */
  const renderPage = () => {
  // `/start` was Wesify's second home page until there was only one. It is gone rather than duplicated,
  // and anybody holding an old link or an open tab lands on the page it became.
  if (path === '/start') {
    window.history.replaceState({}, '', '/')
    setTimeout(() => setPath('/'), 0)
    return <main className="bo-home"/>
  }

  if (accounts === undefined || (accounts === true && clerkConfigured && clerkSession === 'loading')) {
    return <main className="wes-dashboard" aria-busy="true" data-testid="session-boot"/>
  }

  // The public prompt is the first visit. Once an account is known, the arrival effect above owns
  // the move to `/dashboard`; holding this frame avoids flashing the public page during that move.
  if (path === '/' && hasSignedInSession) return <main className="wes-dashboard" aria-busy="true" data-testid="session-boot"/>
  if (path === '/') return <Home
    initialValue={String(answers.companyDescription ?? '')}
    onSubmit={startBuild}
    accounts={accounts === true}
    signedIn={hasSignedInSession}
    onSignIn={openClerkSignUp}
  />

  /**
   * Two addresses Wesify used to own and no longer does.
   *
   * /reset was for links its own server mailed, before Clerk mailed them; /signin was the sign-in
   * page, before signing in became a panel. Both are answered the same way — the public prompt, with
   * the panel open over it — so an old link, a bookmark or a tab left open since last week still
   * arrives somewhere that can help.
   */
  if (path === '/reset' || path === '/signin') {
    window.history.replaceState({}, '', '/')
    setTimeout(() => { setPath('/'); setSignInOpen(true) }, 0)
    return <main className="bo-home"/>
  }

  if (path === '/dashboard') return <Suspense fallback={<main className="wes-dashboard" aria-busy="true"/>}>
    <ProjectDashboard account={account} workspaces={workspaces} onNavigate={navigate} onBuild={startBuild}/>
  </Suspense>

  // Behind the gate, unlike /reset: a plan belongs to an account, so there is nothing to show anyone
  // who has not signed in.
  if (path === '/billing') return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><Billing onBack={() => navigate(homeFor())}/></Suspense>

  const buildMatch = path.match(/^\/build\/([a-zA-Z0-9-]+)$/)
  if (buildMatch) return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><Builder workspaceId={buildMatch[1]} initialAnswers={answers} onAnswersChange={setAnswers} onBlueprintChange={setBlueprint} onExit={() => navigate(account ? '/dashboard' : '/')} onComplete={() => { localStorage.setItem('bo-active-workspace-id', buildMatch[1]); navigate(`/workspace/${buildMatch[1]}/home`) }}/></Suspense>
  if (path === '/build') return <main className="bo-home"/>

  /**
   * The canonical address of a workspace: /workspace/:workspaceId, optionally followed by a section.
   *
   * This used to be a shim that rewrote itself down to a flat, un-scoped /section URL kept in
   * localStorage — which meant a bookmark, a second tab, or a shared link all silently pointed at
   * "whichever workspace this browser last had open" rather than at a specific one. It is the render
   * target now: which workspace's data appears is decided by the URL a person is looking at, not by
   * a value sitting in storage.
   */
  const workspaceMatch = path.match(/^\/workspace\/([a-zA-Z0-9-]+)(?:\/([a-zA-Z0-9-]+))?/)
  if (workspaceMatch) {
    const [, matchedWorkspaceId, section] = workspaceMatch
    // Kept as a fallback for old flat links only — see below — not read by anything that decides
    // what this render shows.
    localStorage.setItem('bo-active-workspace-id', matchedWorkspaceId)
    if (!section || section === 'home' || workspaceSections(matchedWorkspaceId).includes(section)) {
      return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><Dashboard workspaceId={matchedWorkspaceId} onExit={() => navigate('/dashboard')}/></Suspense>
    }
    // An unrecognised section under a real workspace still lands inside that workspace, at home,
    // rather than falling all the way through to the public prompt as if the workspace did not exist.
    const home = `/workspace/${matchedWorkspaceId}/home`
    window.history.replaceState({}, '', home)
    setTimeout(() => setPath(home), 0)
    return <main className="bo-dashboard-page"><div className="bo-preview-empty">Opening workspace...</div></main>
  }

  /**
   * Everything below here is a redirect into the canonical form above, never a render of its own.
   * `/dashboard/*` is an old prefix; a bare `/section` is older still, from before workspaces were
   * in the URL at all. Both are resolved against whichever workspace this browser last had open —
   * the one thing localStorage's memory of "the active workspace" is still for.
   */
  if (path.startsWith('/dashboard/') || (path !== '/' && !path.startsWith('/build') && !path.startsWith('/workspace'))) {
    const section = path.startsWith('/dashboard/') ? (path.split('/').filter(Boolean)[1] || 'home') : (path.split('/').filter(Boolean)[0] || 'home')
    const knownWorkspaceId = activeWorkspaceId()
    if (knownWorkspaceId && (section === 'home' || workspaceSections(knownWorkspaceId).includes(section))) {
      const destination = `/workspace/${knownWorkspaceId}/${section}`
      window.history.replaceState({}, '', destination)
      setTimeout(() => setPath(destination), 0)
      return <main className="bo-dashboard-page"><div className="bo-preview-empty">Opening workspace...</div></main>
    }
  }

  // Unknown public URLs return to the prompt; an authenticated operator stays inside the product.
  return account
    ? <Suspense fallback={<main className="wes-dashboard" aria-busy="true"/>}><ProjectDashboard account={account} workspaces={workspaces} onNavigate={navigate} onBuild={startBuild}/></Suspense>
    : <Home initialValue={String(answers.companyDescription ?? '')} onSubmit={startBuild} accounts={accounts === true} signedIn={hasSignedInSession} onSignIn={openClerkSignUp}/>
  }

  /**
   * The watcher is mounted only where Clerk is, because it holds a Clerk hook and those need the
   * provider — which main.tsx mounts only when this build has a publishable key. Without one there is
   * nothing to watch, and the boot fetch above is the whole answer.
   */
  return <>
    {clerkConfigured && <AccountWatch onChange={handleAccount} onSessionChange={setClerkSession}/>}
    {renderPage()}
    {/* Mounted only while it is being asked for, so Clerk's form is not loaded by every visitor who
        never signs in — and closing it leaves them exactly where they were. */}
    {signInOpen && accounts === true && !account && <Suspense fallback={null}>
      <SignInDialog open unreachable={unreachable} onClose={() => { setSignInOpen(false); setPendingBrief('') }}/>
    </Suspense>}
  </>
}
