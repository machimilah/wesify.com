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
import { Landing } from './components/Landing'

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
    document.title = path === '/' ? 'BO — Describe your company, get the software to run it' : path === '/start' ? 'BO — Build your company workspace' : path.startsWith('/build') ? 'Build your workspace — BO' : `${companyName} — BO`
  }, [path, answers.companyName])

  /**
   * The landing page is public; everything else is not.
   *
   * A landing page behind a sign-in screen cannot do its job — nobody signs up for something they
   * have not seen. So `/` is always reachable, and the gate sits in front of the product instead.
   *
   * `accounts === undefined` means BO has not asked the server whether it has accounts yet. Rendering
   * either the product or a sign-in screen during that moment would show the wrong one and swap it,
   * so it waits. With no database configured there are no accounts and none of this appears.
   */
  const start = () => navigate(accounts && !account ? '/signin' : '/start')
  if (path === '/') return <Landing onStart={start} signedIn={Boolean(account)}/>

  if (accounts === undefined) return <main className="bo-home"/>
  if (accounts && !account) return <SignIn onSignedIn={account => { setAccount(account); navigate('/start') }}/>
  if (path === '/signin') { navigate('/start'); return <main className="bo-home"/> }

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

  // Anything else is the prompt: the page a signed-in operator starts a new company from.
  return <Home initialValue={String(answers.companyDescription ?? '')} onSubmit={(brief) => {
    const workspaceId = crypto.randomUUID()
    localStorage.removeItem('bo-records'); localStorage.removeItem('bo-actions'); localStorage.removeItem('bo-workspace-config'); localStorage.removeItem('bo-workspace-records'); localStorage.removeItem('bo-ai-history'); localStorage.removeItem('bo-active-workspace-id'); setAnswers({ companyDescription: brief }); setBlueprint(null); navigate(`/build/${workspaceId}`)
  }}/>
}
