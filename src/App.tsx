import { useEffect, useState } from 'react'
import { Builder } from './components/Builder'
import { Dashboard } from './components/Dashboard'
import { Home } from './components/Home'
import type { AIBlueprint } from './engine/blueprint'
import { isWorkspaceConfiguration } from './engine/workspaceSchema'
import type { Answers } from './types'
import { readStorage } from './engine/shared'
import { accountsEnabled, currentAccount, type Account, type AccountWorkspace } from './engine/authClient'
import { SignIn } from './components/SignIn'
import { ResetPassword } from './components/ResetPassword'
import { Billing } from './components/Billing'

function activeWorkspaceId() {
  return localStorage.getItem('bo-active-workspace-id') || localStorage.getItem('bo-workspace-id') || readStorage<{ id?: string }>('bo-workspace-config', {}).id || ''
}

/** Every section of a built Command Center owns a top-level indexed URL, such as /clients. */
function workspaceSections(workspaceId: string) {
  const saved = readStorage<unknown>(`bo-workspace-config:${workspaceId}`, readStorage<unknown>('bo-workspace-config', null))
  return isWorkspaceConfiguration(saved) ? saved.navigation.map(item => item.id) : []
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [answers, setAnswers] = useState<Answers>(() => readStorage('bo-answers', {}))
  const [blueprint, setBlueprint] = useState<AIBlueprint | null>(() => readStorage('bo-blueprint', null))

  const [accounts, setAccounts] = useState<boolean | undefined>(undefined)
  const [account, setAccount] = useState<Account | null>(null)
  // Every workspace this account owns or belongs to, most recently created first — the same order
  // the server already returns them in. Empty until the account is known, and re-read after signing
  // in, since neither /api/auth/register nor /api/auth/login themselves return the list.
  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([])
  // What a stranger typed on the public page, held across the sign-in screen so it is not asked for
  // twice. Deliberately not persisted: a sentence typed and abandoned is not something to keep.
  const [pendingBrief, setPendingBrief] = useState('')

  const navigate = (nextPath: string) => { window.history.pushState({}, '', nextPath); setPath(nextPath) }

  /**
   * Where a signed-in account lands with no more specific intent than "I am here": the workspace it
   * last used, or the build prompt if it does not have one yet. `list[0]` is deliberate rather than a
   * separate "last active" concept — the server already orders a person's workspaces by creation
   * date, and until there is a switcher, the most recent one *is* the one anybody was last using.
   */
  const homeFor = (list: AccountWorkspace[]) => list[0] ? `/workspace/${list[0].id}/home` : '/'

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const enabled = await accountsEnabled()
      // The stored session is checked against the server rather than trusted: it may have expired,
      // been signed out from another device, or belong to a database that has since been replaced.
      const existing = enabled ? await currentAccount() : null
      if (cancelled) return
      setAccount(existing?.user ?? null)
      setAccounts(enabled)
      setWorkspaces(existing?.workspaces ?? [])
      // Only a hard load of "/" redirects — a returning signed-in operator should not land back on
      // the empty prompt they have already answered once. This runs exactly once, at mount, so it
      // can never fire again later from something in-app navigating back to "/" on purpose.
      if (existing?.workspaces.length && window.location.pathname === '/') {
        window.history.replaceState({}, '', homeFor(existing.workspaces))
        setPath(homeFor(existing.workspaces))
      }
    })()
    return () => { cancelled = true }
  }, [])

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
    document.title = path === '/' ? 'Wesify — Describe your company, get the software to run it' : path.startsWith('/build') ? 'Build your workspace — Wesify' : `${companyName} — Wesify`
  }, [path, answers.companyName])

  /** Starts a fresh company from one sentence. Everything a previous workspace left behind goes. */
  function build(brief: string) {
    const workspaceId = crypto.randomUUID()
    localStorage.removeItem('bo-records'); localStorage.removeItem('bo-actions'); localStorage.removeItem('bo-workspace-config'); localStorage.removeItem('bo-workspace-records'); localStorage.removeItem('bo-ai-history'); localStorage.removeItem('bo-active-workspace-id')
    setAnswers({ companyDescription: brief }); setBlueprint(null); setPendingBrief('')
    navigate(`/build/${workspaceId}`)
  }

  /**
   * Describing a company is public; the workspace it produces is not.
   *
   * There is one home page, and it is the prompt. A separate landing page arguing for BO could only
   * describe what BO does, while this does it — and nobody signs up for something they have not seen
   * work. So `/` is always reachable, and the gate sits in front of the product instead.
   *
   * The sentence survives the sign-in screen rather than being asked for twice: somebody who has
   * just described their business has done the only work BO needs from them, and making them repeat
   * it to prove they have an account is a way to lose them between the two screens.
   *
   * `accounts === undefined` means BO has not asked the server whether it has accounts yet. Waiting
   * is deliberate — rendering either half of that answer would show the wrong page and swap it.
   */
  const startBuild = (brief: string) => {
    if (!accounts || account) return build(brief)
    setPendingBrief(brief)
    navigate('/signin')
  }

  /**
   * What happens right after somebody proves who they are, whether that was signing in, registering,
   * or spending a password-reset link.
   *
   * A typed-but-unsent brief wins outright: someone who described their company before being asked
   * to sign in has already done the one thing this product needs from them, and asking again to
   * prove they now have an account is how they get lost between the two screens. Otherwise they go
   * to the workspace they already have — /api/auth/register and /api/auth/login do not return the
   * list, so it is asked for here, once, right after.
   */
  const afterSignedIn = async (signedIn: Account) => {
    setAccount(signedIn)
    if (pendingBrief) return build(pendingBrief)
    const found = (await currentAccount())?.workspaces ?? []
    setWorkspaces(found)
    navigate(homeFor(found))
  }

  if (path === '/') return <Home
    initialValue={String(answers.companyDescription ?? '')}
    onSubmit={startBuild}
    signedIn={Boolean(account)}
    accounts={accounts === true}
    onSignIn={() => navigate('/signin')}
  />

  // `/start` was BO's second home page until there was only one. It is gone rather than duplicated,
  // and anybody holding an old link or an open tab lands on the page it became.
  if (path === '/start') {
    window.history.replaceState({}, '', '/')
    setTimeout(() => setPath('/'), 0)
    return <main className="bo-home"/>
  }

  if (accounts === undefined) return <main className="bo-home"/>

  // Before the gate, deliberately: whoever opens a reset link cannot get past a sign-in screen, which
  // is the entire reason they are here.
  if (path === '/reset') return <ResetPassword
    token={new URLSearchParams(window.location.search).get('token') ?? ''}
    onSignedIn={account => void afterSignedIn(account)}
    onGiveUp={() => navigate('/signin')}
  />

  if (accounts && !account) return <SignIn onSignedIn={account => void afterSignedIn(account)}/>

  // Behind the gate, unlike /reset: a plan belongs to an account, so there is nothing to show anyone
  // who has not signed in.
  if (path === '/billing') return <Billing onBack={() => navigate(homeFor(workspaces))}/>
  if (path === '/signin') { navigate('/'); return <main className="bo-home"/> }

  const buildMatch = path.match(/^\/build\/([a-zA-Z0-9-]+)$/)
  if (buildMatch) return <Builder workspaceId={buildMatch[1]} initialAnswers={answers} onAnswersChange={setAnswers} onBlueprintChange={setBlueprint} onExit={() => navigate('/')} onComplete={() => { localStorage.setItem('bo-active-workspace-id', buildMatch[1]); navigate(`/workspace/${buildMatch[1]}/home`) }}/>
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
      return <Dashboard workspaceId={matchedWorkspaceId} answers={answers} blueprint={blueprint}/>
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
  if (path.startsWith('/dashboard') || (path !== '/' && !path.startsWith('/build') && !path.startsWith('/workspace'))) {
    const section = path.startsWith('/dashboard') ? (path.split('/').filter(Boolean)[1] || 'home') : (path.split('/').filter(Boolean)[0] || 'home')
    const knownWorkspaceId = activeWorkspaceId()
    if (knownWorkspaceId && (section === 'home' || workspaceSections(knownWorkspaceId).includes(section))) {
      const destination = `/workspace/${knownWorkspaceId}/${section}`
      window.history.replaceState({}, '', destination)
      setTimeout(() => setPath(destination), 0)
      return <main className="bo-dashboard-page"><div className="bo-preview-empty">Opening workspace...</div></main>
    }
  }

  // Anything else is the home page, which by this point is reached signed in.
  return <Home initialValue={String(answers.companyDescription ?? '')} onSubmit={build} signedIn={Boolean(account)} accounts={accounts === true}/>
}
