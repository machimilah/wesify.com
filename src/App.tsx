import { useEffect, useState } from 'react'
import { Builder } from './components/Builder'
import { Dashboard } from './components/Dashboard'
import { Home } from './components/Home'
import type { AIBlueprint } from './engine/blueprint'
import { isWorkspaceConfiguration } from './engine/workspaceSchema'
import type { Answers } from './types'
import { readStorage } from './engine/shared'

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

  const navigate = (nextPath: string) => { window.history.pushState({}, '', nextPath); setPath(nextPath) }

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
    document.title = path === '/' ? 'BO — Build your company workspace' : path.startsWith('/build') ? 'Build your workspace — BO' : `${companyName} — BO`
  }, [path, answers.companyName])

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

  if (path !== '/') return <Home onSubmit={brief => { setAnswers({ companyDescription: brief }); navigate(`/build/${crypto.randomUUID()}`) }}/>
  return <Home initialValue={String(answers.companyDescription ?? '')} onSubmit={(brief) => {
    const workspaceId = crypto.randomUUID()
    localStorage.removeItem('bo-records'); localStorage.removeItem('bo-actions'); localStorage.removeItem('bo-workspace-config'); localStorage.removeItem('bo-workspace-records'); localStorage.removeItem('bo-ai-history'); localStorage.removeItem('bo-active-workspace-id'); setAnswers({ companyDescription: brief }); setBlueprint(null); navigate(`/build/${workspaceId}`)
  }}/>
}
