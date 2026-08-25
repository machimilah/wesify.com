import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Home } from './components/Home'
import type { AIBlueprint } from './engine/blueprint'
import { isWorkspaceConfiguration } from './engine/workspaceSchema'
import type { Answers } from './types'
import { readStorage } from './engine/shared'
import { accountsEnabled, currentAccount, type Account, type AccountWorkspace } from './engine/authClient'
import { AccountWatch, type SignedInAccount } from './components/AccountWatch'

const Builder = lazy(() => import('./components/Builder').then(module => ({ default: module.Builder })))
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })))
const SignIn = lazy(() => import('./components/SignIn').then(module => ({ default: module.SignIn })))
const Billing = lazy(() => import('./components/Billing').then(module => ({ default: module.Billing })))

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
  // Signed in with Clerk, but the server would not say who: a key from another Clerk instance, or a
  // database that is down. The sign-in screen says so rather than sitting on 'one moment' forever.
  const [unreachable, setUnreachable] = useState(false)

  const navigate = (nextPath: string) => { window.history.pushState({}, '', nextPath); setPath(nextPath) }

  /**
   * Where a signed-in account lands with no more specific intent than "I am here": the workspace it
   * last used, or the build prompt if it does not have one yet. `list[0]` is deliberate rather than a
   * separate "last active" concept — the server already orders a person's workspaces by creation
   * date, and until there is a switcher, the most recent one *is* the one anybody was last using.
   */
  const homeFor = (list: AccountWorkspace[]) => list[0] ? `/workspace/${list[0].id}/home` : '/'

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
    setAccount(found?.user ?? null)
    setWorkspaces(found?.workspaces ?? [])
    setUnreachable(signedInWithClerk && !found)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      /**
       * Both questions at once, because the answers do not depend on each other: whether this server
       * has accounts, and who is holding this browser. Asked in sequence, every load cost two round
       * trips end to end before Wesify drew anything.
       *
       * The second answer is provisional wherever Clerk is present — at this instant Clerk has
       * usually not restored the session yet, so it comes back "nobody", and `AccountWatch` corrects
       * it a moment later. It is the whole answer only where there is no Clerk to ask.
       */
      const [enabled, found] = await Promise.all([accountsEnabled(), currentAccount()])
      if (cancelled) return
      setAccounts(enabled)
      if (enabled && found) handleAccount(found, false)
    })()
    return () => { cancelled = true }
  }, [handleAccount])

  /**
   * The one thing that happens on its own the first time Wesify learns who somebody is.
   *
   * There used to be two. The other sent anybody who owned a workspace straight to it from a bare
   * "/", on the theory that a returning operator should not be shown a prompt they had already
   * answered. That was true when "/" was only a prompt. It is the home page now — the argument for
   * the product, the thing a person might want to re-read, and the page they get if they type the
   * address — and taking it away from the people who use Wesify most made it unreachable to exactly
   * them. Their workspace is a click away in the header instead.
   *
   * What survives is the brief: somebody who described their company and was asked to sign in has
   * already done the one thing Wesify needs from them, and sending them back to an empty box to prove
   * they now have an account is how they get lost between two screens.
   *
   * An effect rather than something done inside the callback above, because the two facts it needs —
   * the account, and that sentence — arrive from different places at times neither controls. Reading
   * them from state at the moment both exist is the only version that cannot be handed a stale copy
   * of one while holding the other. `landed` makes it happen once: Clerk renewing a token is a change
   * here, and none of those is an arrival.
   */
  useEffect(() => {
    if (!account || landed.current) return
    landed.current = true
    if (pendingBrief) build(pendingBrief)
  }, [account, pendingBrief])

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
    document.title = path === '/' ? 'Wesify' : path.startsWith('/build') ? 'Build your workspace — Wesify' : `${companyName} — Wesify`
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
    navigate('/signin')
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
  if (path === '/') return <Home
    initialValue={String(answers.companyDescription ?? '')}
    onSubmit={startBuild}
    signedIn={Boolean(account)}
    accounts={accounts === true}
    onSignIn={() => navigate('/signin')}
  />

  // `/start` was Wesify's second home page until there was only one. It is gone rather than duplicated,
  // and anybody holding an old link or an open tab lands on the page it became.
  if (path === '/start') {
    window.history.replaceState({}, '', '/')
    setTimeout(() => setPath('/'), 0)
    return <main className="bo-home"/>
  }

  if (accounts === undefined) return <main className="bo-home"/>

  // Wesify had a /reset page of its own, for links its own server mailed. Clerk mails them now and
  // handles the whole flow inside the sign-in screen, so an old link is answered by the screen that
  // can actually help: sign-in, which is where forgetting a password is dealt with.
  if (path === '/reset') {
    window.history.replaceState({}, '', '/signin')
    setTimeout(() => setPath('/signin'), 0)
    return <main className="bo-home"/>
  }

  if (accounts && !account) return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><SignIn unreachable={unreachable}/></Suspense>

  // Behind the gate, unlike /reset: a plan belongs to an account, so there is nothing to show anyone
  // who has not signed in.
  if (path === '/billing') return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><Billing onBack={() => navigate(homeFor(workspaces))}/></Suspense>
  if (path === '/signin') { navigate('/'); return <main className="bo-home"/> }

  const buildMatch = path.match(/^\/build\/([a-zA-Z0-9-]+)$/)
  if (buildMatch) return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><Builder workspaceId={buildMatch[1]} initialAnswers={answers} onAnswersChange={setAnswers} onBlueprintChange={setBlueprint} onExit={() => navigate('/')} onComplete={() => { localStorage.setItem('bo-active-workspace-id', buildMatch[1]); navigate(`/workspace/${buildMatch[1]}/home`) }}/></Suspense>
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
      return <Suspense fallback={<main className="bo-home" aria-busy="true"/>}><Dashboard workspaceId={matchedWorkspaceId} answers={answers} blueprint={blueprint}/></Suspense>
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

  /**
   * The watcher is mounted only where Clerk is, because it holds a Clerk hook and those need the
   * provider — which main.tsx mounts only when this build has a publishable key. Without one there is
   * nothing to watch, and the boot fetch above is the whole answer.
   */
  return <>
    {Boolean(String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim()) && <AccountWatch onChange={handleAccount}/>}
    {renderPage()}
  </>
}
