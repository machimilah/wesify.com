import { useEffect, useState } from 'react'
import { Builder } from './components/Builder'
import { Dashboard } from './components/Dashboard'
import { Home } from './components/Home'
import type { AIBlueprint } from './engine/blueprint'
import { isWorkspaceConfiguration } from './engine/workspaceSchema'
import type { Answers } from './types'
import { readStorage } from './engine/shared'
import { accountsEnabled, currentAccount, type Account } from './engine/authClient'
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
  // What a stranger typed on the public page, held across the sign-in screen so it is not asked for
  // twice. Deliberately not persisted: a sentence typed and abandoned is not something to keep.
  const [pendingBrief, setPendingBrief] = useState('')

  const navigate = (nextPath: string) => { window.history.pushState({}, '', nextPath); setPath(nextPath) }

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
    document.title = path === '/' ? 'BO — Describe your company, get the software to run it' : path.startsWith('/build') ? 'Build your workspace — BO' : `${companyName} — BO`
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
    onSignedIn={account => { setAccount(account); pendingBrief ? build(pendingBrief) : navigate('/') }}
    onGiveUp={() => navigate('/signin')}
  />

  if (accounts && !account) return <SignIn onSignedIn={account => { setAccount(account); pendingBrief ? build(pendingBrief) : navigate('/') }}/>

  // Behind the gate, unlike /reset: a plan belongs to an account, so there is nothing to show anyone
  // who has not signed in.
  if (path === '/billing') return <Billing onBack={() => navigate('/home')}/>
  if (path === '/signin') { navigate('/'); return <main className="bo-home"/> }

  const buildMatch = path.match(/^\/build\/([a-zA-Z0-9-]+)$/)
  if (buildMatch) return <Builder workspaceId={buildMatch[1]} initialAnswers={answers} onAnswersChange={setAnswers} onBlueprintChange={setBlueprint} onExit={() => navigate('/')} onComplete={() => { localStorage.setItem('bo-active-workspace-id', buildMatch[1]); navigate('/home') }}/>
  if (path === '/build') return <main className="bo-home"/>

  // Workspace-scoped links stay valid; they resolve to the indexed section URL of that workspace.
  const workspaceMatch = path.match(/^\/workspace\/([a-zA-Z0-9-]+)(?:\/([a-zA-Z0-9-]+))?/)
  if (workspaceMatch) {
    localStorage.setItem('bo-active-workspace-id', workspaceMatch[1])
    const destination = `/${workspaceMatch[2] || 'home'}`
    window.history.replaceState({}, '', destination)
    setTimeout(() => setPath(destination), 0)
    return <main className="bo-dashboard-page"><div className="bo-preview-empty">Opening workspace...</div></main>
  }
  if (path.startsWith('/dashboard')) {
    const destination = `/${path.split('/').filter(Boolean)[1] || 'home'}`
    window.history.replaceState({}, '', destination)
    setTimeout(() => setPath(destination), 0)
    return <main className="bo-dashboard-page"><div className="bo-preview-empty">Opening workspace...</div></main>
  }

  const section = path.split('/').filter(Boolean)[0] ?? ''
  const workspaceId = activeWorkspaceId()
  if (section && workspaceId && (section === 'home' || workspaceSections(workspaceId).includes(section))) {
    return <Dashboard workspaceId={workspaceId} answers={answers} blueprint={blueprint}/>
  }

  // Anything else is the home page, which by this point is reached signed in.
  return <Home initialValue={String(answers.companyDescription ?? '')} onSubmit={build} signedIn={Boolean(account)} accounts={accounts === true}/>
}
