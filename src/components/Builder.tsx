import { ArrowLeft, ArrowRight, Check, ChevronDown, LayoutDashboard, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import type { Answers } from '../types'
import type { AIBlueprint } from '../engine/blueprint'
import {
  addUserMessage,
  applyAgentResponse,
  architectureToBlueprint,
  createDiscoverySession,
  type DiscoverySession,
} from '../engine/businessDiscovery'
import { businessDiscoveryModel, researchSession, resilientArchitecture } from '../engine/discoveryModel'
import { capabilityById } from '../engine/capabilityCatalog'
import { resolveIndustry } from '../engine/industryResolver'
import { applyFrontierArchitecture, frontierResearchStatus, mergeFrontierResearch, requestFrontierResearch, type FrontierResearch } from '../engine/researchClient'
import { applyIndustryVerdict, loadIndustryVerdict, recordIndustryObservations, type IndustryVerdict } from '../engine/industryClient'
import { loadDiscoverySession, saveDiscoverySession } from '../engine/discoverySessionClient'
import { generateWorkspaceConfigurationFromDiscovery, type WorkspaceConfiguration } from '../engine/workspaceSchema'
import { faceForNavigation } from './faces'
import { Brand } from './Brand'
import { DashboardSurface } from './Dashboard'

gsap.registerPlugin(useGSAP)

interface BuilderProps {
  workspaceId: string
  initialAnswers: Answers
  onAnswersChange: (answers: Answers) => void
  onBlueprintChange: (blueprint: AIBlueprint) => void
  onExit: () => void
  onComplete: () => void
}

/** The four things BO does, named so the wait is legible without reading the journal. */
const stages = ['Understanding you', 'Researching', 'Designing', 'Ready to build']

const buildLabels = ['Creating data model', 'Building operational pages', 'Connecting workflows', 'Adding controls', 'Testing BO', 'Command Center ready']

interface BuildThought { id: string; title: string; body: string }

function asksToSkip(message: string) {
  return /\b(just build|build it|skip (the )?questions|no more questions|go ahead and build)\b/i.test(message)
}

function stateNarrative(session: DiscoverySession, questionReason = '') {
  const state = session.businessState
  const company = state.industry || state.companySummary || 'This company'
  const offer = state.productsOrServices.slice(0, 3).join(', ') || state.businessModel.slice(0, 2).join(', ') || 'its core offer'
  const flow = state.operations.slice(0, 4).join(' → ') || state.knownWorkflows.slice(0, 2).join(', ') || 'the operating process still being defined'
  const money = state.revenueModel.slice(0, 2).join(', ') || 'the payment model still to confirm'
  const next = questionReason ? ` I’m asking the next question because ${questionReason.replace(/\.$/, '').toLowerCase()}.` : ''
  return `${company} delivers ${offer}. The operating flow currently looks like ${flow}, with revenue coming through ${money}. I’m using those facts to decide which records, workflows, financial controls, and daily views belong in the Command Center.${next}`
}

/**
 * Business-facing research conclusions: what BO worked out, the evidence, and what it changes.
 *
 * It deliberately does not announce which question is coming next. The local planner and the server
 * consultant choose differently, so that line could sit beside a question BO never asked — and the
 * progress bar on the question already says how much is settled, in both modes.
 */
function researchNarrative(session: DiscoverySession, seen: Set<string>, frontier: FrontierResearch | null = null) {
  const research = mergeFrontierResearch(researchSession(session), frontier)
  const entries: BuildThought[] = []
  for (const finding of research.findings) {
    if (seen.has(finding.id)) continue
    seen.add(finding.id)
    // The quote already ends in whatever punctuation the operator typed, so adding a full stop
    // produced "…plumbing service business..".
    const quoted = finding.because.replace(/[.\s]+$/, '')
    entries.push({ id: finding.id, title: finding.conclusion, body: `${finding.implication} Because you said: “${quoted}”.` })
  }
  return entries
}

function architectureNarrative(session: DiscoverySession, architecture: ReturnType<typeof resilientArchitecture>) {
  const selected = architecture.capabilities.slice(0, 9).join(', ')
  const excluded = architecture.excludedCapabilityIds.length ? ` Unrelated systems remain hidden until the company needs them.` : ''
  return `This company needs ${selected || 'a focused operating base'}. Therefore I’m connecting ${architecture.entities.slice(0, 7).map(entity => entity.name).join(', ')} into one workspace, with a focused set of operational pages instead of exposing the entire BO platform.${excluded}`
}

function ProgressiveCommandCenter({ config, activity, loading, asking }: { config: WorkspaceConfiguration; activity: string; loading: boolean; asking: boolean }) {
  const businessNavigation = config.navigation.filter(item => item.kind === 'entity').slice(0, 16)

  /**
   * Pages that appeared since the last answer.
   *
   * The interview only feels worth doing if answering visibly changes the thing being built. Without
   * this the preview quietly rearranges and the operator has no reason to believe their answer
   * mattered. Marks fade, because a workspace permanently covered in "new" badges says nothing.
   */
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<string[]>([])
  useEffect(() => {
    const ids = businessNavigation.map(item => item.id)
    if (known.current === null) { known.current = new Set(ids); return }
    const added = ids.filter(id => !known.current!.has(id))
    known.current = new Set(ids)
    if (!added.length) return
    setFresh(added)
    const timer = setTimeout(() => setFresh([]), 2600)
    return () => clearTimeout(timer)
  }, [businessNavigation.map(item => item.id).join('|')])

  return <div className="bo-progressive-command-center" data-testid="building-command-center">
    <aside><Brand inverse/><nav><button className="active"><LayoutDashboard size={15}/><span>Home</span></button>{businessNavigation.map(item => {
      // Same faces as the finished Command Center. A column of identical document icons says nothing
      // about what is being built, and the preview's whole job is to show that.
      const Face = faceForNavigation(config, item).icon
      return <button key={item.id} className={fresh.includes(item.id) ? 'fresh' : ''}><Face size={14}/><span>{item.label}</span>{fresh.includes(item.id) && <em>new</em>}</button>
    })}</nav></aside>
    <section>
      <div className="bo-progressive-content">
        <div className="bo-progressive-heading"><small>COMMAND CENTER · BUILDING LIVE</small><h1>{config.profile.companyName}</h1><p>{config.profile.description}</p></div>
        <div className="bo-progressive-kpis">{config.metrics.slice(0, 4).map(metric => <article key={metric.id}><small>{metric.label}</small><strong>—</strong><span>Waiting for operating data</span></article>)}</div>
        <div className="bo-progressive-panels"><article><small>ACTION QUEUE</small><h2>What needs attention</h2><div><i/><span>Connecting approvals, deadlines, and alerts</span></div><div><i/><span>Preparing role-based actions</span></div></article><article><small>BUSINESS SYSTEMS</small><h2>Being connected</h2>{config.capabilities?.slice(0, 6).map(capability => <span key={capability}><Check size={11}/>{capabilityById.get(capability)?.label ?? capability.replace(/[.-]/g, ' ')}</span>)}</article></div>
      </div>
    </section>
    <div className="bo-progressive-status"><Sparkles size={14}/><span><strong>{activity || (loading ? 'Shaping your Command Center' : asking ? 'Waiting on your answer' : 'Command Center structure ready')}</strong><small>{config.entities.length} record types · {businessNavigation.length} pages · {config.workflows.length} automation rules</small></span>{loading && <i/>}</div>
  </div>
}

export function Builder({ workspaceId, initialAnswers, onAnswersChange, onBlueprintChange, onExit, onComplete }: BuilderProps) {
  const root = useRef<HTMLElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const chat = useRef<HTMLDivElement>(null)
  const launchRect = useRef<DOMRect | null>(null)
  const booted = useRef(false)
  const [session, setSession] = useState<DiscoverySession | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [activity, setActivity] = useState('')
  const [streamedText, setStreamedText] = useState('')
  const [error, setError] = useState('')
  const [launching, setLaunching] = useState(false)
  const [launchPhase, setLaunchPhase] = useState(0)
  const [launchBlueprint, setLaunchBlueprint] = useState<AIBlueprint | null>(null)
  const [thoughts, setThoughts] = useState<BuildThought[]>([])
  const [frontier, setFrontier] = useState<FrontierResearch | null>(null)
  const [industry, setIndustry] = useState<IndustryVerdict | null>(null)
  const [frontierModel, setFrontierModel] = useState('')
  const [researching, setResearching] = useState(false)

  // BO shows its working by default — that is the product's whole claim — but it collapses in one click.
  const [thinkingOpen, setThinkingOpen] = useState(false)

  const researched = useRef(new Set<string>())
  const frontierRef = useRef<FrontierResearch | null>(null)
  const frontierStarted = useRef(false)

  const appendThought = (title: string, body: string) => setThoughts(current => {
    if (current.at(-1)?.title === title && current.at(-1)?.body === body) return current
    return [...current, { id: crypto.randomUUID(), title, body }]
  })
  const appendThoughts = (entries: BuildThought[]) => {
    if (entries.length) setThoughts(current => [...current, ...entries])
  }

  const commit = (next: DiscoverySession) => {
    setSession(next)
    void saveDiscoverySession(next)
  }

  /**
   * Runs alongside the interview rather than blocking it: external research takes far longer than a
   * question, and its conclusions are additive. If it is unavailable, BO keeps its built-in researcher.
   */
  const runFrontierResearch = async (base: DiscoverySession) => {
    if (frontierStarted.current) return
    frontierStarted.current = true
    const status = await frontierResearchStatus()
    if (!status.available) return
    setFrontierModel(status.model)
    setResearching(true)
    appendThought('Researching this kind of business', `BO is searching external sources with ${status.model} to learn how companies like this actually operate before deciding which systems it needs.`)
    try {
      const description = base.messages.find(message => message.role === 'user')?.content ?? ''
      const result = await requestFrontierResearch(base.workspaceId, description, base.messages.map(message => ({ role: message.role, content: message.content })))
      if (!result) return
      frontierRef.current = result
      setFrontier(result)
      appendThoughts(researchNarrative(base, researched.current, result))
      if (result.sources.length) appendThought('Sources BO read', result.sources.slice(0, 5).map(source => source.title || source.url).join(' · '))
    } catch (reason) {
      appendThought('External research unavailable', `${reason instanceof Error ? reason.message : 'The researcher could not be reached.'} BO continued with its built-in business researcher, so nothing was lost.`)
    } finally {
      setResearching(false)
    }
  }

  const runAgent = async (base: DiscoverySession) => {
    setLoading(true); setError(''); setStreamedText(''); setActivity('Understanding your business')
    const latestUser = [...base.messages].reverse().find(message => message.role === 'user')?.content ?? ''
    try {
      const response = await businessDiscoveryModel.generate(
        { mode: 'DISCOVER', session: base, forceArchitecture: asksToSkip(latestUser) },
        { onText: setStreamedText, onActivity: setActivity },
      )
      const responseSession = { ...base, businessState: response.businessState }
      appendThought('Updating the operating model', stateNarrative(responseSession, response.decision === 'ASK_QUESTION' ? response.nextQuestion.reason : ''))
      appendThoughts(researchNarrative(responseSession, researched.current, frontierRef.current))
      if (response.decision === 'READY_TO_ARCHITECT') {
        setActivity('Designing your Command Center')
        appendThought('Choosing the business systems', 'The main actors, work flow, and revenue path are now clear enough to create the first version. I’m selecting the smallest complete set of BO capabilities and their required dependencies, while keeping unrelated ERP areas out of view.')
        const architectureResponse = await businessDiscoveryModel.generate(
          { mode: 'ARCHITECT', session: { ...base, phase: 'ARCHITECTING', businessState: response.businessState } },
          { onText: setStreamedText, onActivity: setActivity },
        )
        appendThought('Knitting the Command Center together', architectureNarrative(responseSession, architectureResponse.architectureContext))
        const proposed = applyAgentResponse({ ...base, phase: 'ARCHITECTING' }, architectureResponse)
        let finalResponse = architectureResponse
        try {
          appendThought('Checking the architecture', 'I’m checking that every page has a real operational purpose, every workflow has the records it depends on, and no adjacent feature has appeared without evidence from the company description or answers.')
          const reviewed = await businessDiscoveryModel.generate(
            { mode: 'REVIEW_ARCHITECTURE', session: { ...proposed, phase: 'ARCHITECTING' } },
            { onText: setStreamedText, onActivity: setActivity },
          )
          if (reviewed.decision === 'READY_TO_ARCHITECT') {
            finalResponse = reviewed
          }
        } catch { /* The first architecture is valid; a failed critic must not erase it. */ }
        commit(applyAgentResponse(base, finalResponse))
      } else {
        commit(applyAgentResponse(base, response))
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'BO could not reach the local AI.'
      appendThought('The build paused', `${message} No workspace changes were applied. BO can retry from the confirmed business facts without losing the conversation.`)
      setError(message)
    } finally {
      setLoading(false); setActivity(''); setStreamedText('')
    }
  }

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      const existing = await loadDiscoverySession(workspaceId)
      const brief = String(initialAnswers.companyDescription ?? '').trim()
      const initial = existing ?? (brief ? createDiscoverySession(workspaceId, brief) : null)
      if (!initial) { onExit(); return }
      setSession(initial)
      if (!existing) await saveDiscoverySession(initial)
      if (['BUILDING', 'TESTING', 'READY'].includes(initial.phase) && initial.architecture) {
        onBlueprintChange(architectureToBlueprint(initial.architecture))
        onComplete()
        return
      }
      void runFrontierResearch(initial)
      void loadIndustryVerdict(resolveIndustry(initial.messages.find(message => message.role === 'user')?.content ?? '')?.subsector)
        .then(verdict => {
          if (!verdict) return
          setIndustry(verdict)
          appendThought(
            `What ${verdict.companies} other ${verdict.label || 'companies like this'} actually kept`,
            `BO is not guessing here. ${verdict.include.length + verdict.exclude.length} of these decisions come from what real companies in this industry did with the workspace BO built them: ${[...verdict.exclude.slice(0, 2).map(item => `dropped ${item.capabilityId}`), ...verdict.include.slice(0, 2).map(item => `kept ${item.capabilityId}`)].join(', ')}.`,
          )
        })
      const last = initial.messages.at(-1)
      if (initial.phase === 'DISCOVERING' && last?.role === 'user' && !initial.currentQuestion) await runAgent(initial)
    })()
  }, [workspaceId])

  useEffect(() => {
    if (!chat.current) return
    chat.current.scrollTop = chat.current.scrollHeight
  }, [session?.messages.length, loading, streamedText])

  const submit = async (value = draft) => {
    const answer = value.trim()
    if (!answer || !session || loading) return
    setDraft('')
    const next = addUserMessage(session, answer)
    commit(next)
    await runAgent(next)
  }

  const approve = () => {
    if (!session?.architecture) return
    const architecture = applyFrontierArchitecture(applyIndustryVerdict(session.architecture, industry), frontier)
    const blueprint = architectureToBlueprint(architecture)
    const nextAnswers = {
      ...initialAnswers,
      companyDescription: session.messages.find(message => message.role === 'user')?.content ?? String(initialAnswers.companyDescription ?? ''),
      discoveryIndustry: session.businessState.industry,
    }
    const config = generateWorkspaceConfigurationFromDiscovery(nextAnswers, blueprint, session.businessState, architecture)
    config.id = workspaceId
    localStorage.setItem('bo-workspace-config', JSON.stringify(config))
    localStorage.setItem(`bo-workspace-config:${workspaceId}`, JSON.stringify(config))
    localStorage.setItem('bo-workspace-id', workspaceId)
    // What this company was given becomes evidence for the next company in the same industry.
    void recordIndustryObservations(config.industrySubsector, { kept: config.capabilities ?? [], label: config.industryLabel, newCompany: true })
    onAnswersChange(nextAnswers)
    onBlueprintChange(blueprint)
    const now = new Date().toISOString()
    commit({ ...session, phase: 'BUILDING', projectId: workspaceId, metrics: { ...session.metrics, architectureApproved: true, approvedAt: now }, updatedAt: now })
    launchRect.current = preview.current?.getBoundingClientRect() ?? null
    setLaunchBlueprint(blueprint); setLaunchPhase(0); setLaunching(true)
  }

  useEffect(() => {
    if (!launching) return
    const timer = window.setInterval(() => setLaunchPhase(current => Math.min(current + 1, buildLabels.length - 1)), 300)
    return () => window.clearInterval(timer)
  }, [launching])

  const finish = () => {
    if (session) commit({ ...session, phase: 'READY', updatedAt: new Date().toISOString() })
    onComplete()
  }

  useGSAP(() => {
    if (!launching || !launchRect.current || !launchBlueprint) return
    const rect = launchRect.current
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.bo-launch-overlay', { x: rect.left, y: rect.top, scaleX: rect.width / window.innerWidth, scaleY: rect.height / window.innerHeight, transformOrigin: 'top left', borderRadius: 24 }, { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 0, duration: 0.9, ease: 'power3.inOut', onComplete: () => window.setTimeout(finish, 900) })
      gsap.to('.bo-builder__conversation', { xPercent: -18, autoAlpha: 0, duration: 0.45, ease: 'power2.in' })
    })
    media.add('(prefers-reduced-motion: reduce)', finish)
    return () => media.revert()
  }, { dependencies: [launching], scope: root, revertOnUpdate: true })

  const currentAssistantId = session?.currentQuestion ? session.messages.at(-1)?.id : null
  /**
   * What BO said alongside the question, without the question itself.
   *
   * The message carries both. Subtracting blindly meant that when the wording drifted even slightly,
   * nothing was removed and the question was printed twice — once as prose and once as the question.
   */
  const latestMessage = session?.currentQuestion ? (session.messages.at(-1)?.content ?? '') : ''
  const askedText = session?.currentQuestion?.text ?? ''
  const currentAcknowledgment = askedText && latestMessage.includes(askedText)
    ? latestMessage.replace(askedText, '').trim()
    : ''
  const architecture = session?.architecture
  // The research stage only appears when a researcher is actually configured, so the tracker never
  // shows a step BO is not taking.
  const activeStages = frontierModel ? stages : stages.filter(stage => stage !== 'Researching')
  const stageName = architecture ? 'Ready to build'
    : researching ? 'Researching'
    : loading && /design|architect|command center/i.test(activity) ? 'Designing'
    : 'Understanding you'
  const stageIndex = Math.max(0, activeStages.indexOf(stageName))
  const proposalReasoning = useMemo(() => session && architecture ? mergeFrontierResearch(researchSession(session), frontier).findings.slice(0, 5) : [], [session, architecture, frontier])
  // How much of the operating model is settled. The same number the planner uses to decide whether
  // another question is worth asking, so the bar cannot claim progress the interview has not made.
  const coverage = useMemo(() => session ? mergeFrontierResearch(researchSession(session), frontier).coverage : 0, [session, frontier])
  const previewConfig = useMemo(() => {
    if (!session || !(session.businessState.industry || session.businessState.companySummary || session.businessState.facts.length)) return null
    // Industry evidence first, then what BO learned about this company — the specific outranks the typical.
    const previewArchitecture = applyFrontierArchitecture(applyIndustryVerdict(resilientArchitecture(session.businessState, session.architecture), industry), frontier)
    const previewBlueprint = architectureToBlueprint(previewArchitecture)
    const config = generateWorkspaceConfigurationFromDiscovery(initialAnswers, previewBlueprint, session.businessState, previewArchitecture)
    config.id = workspaceId
    return config
  }, [initialAnswers, session, workspaceId, frontier, industry])

  return <main className="bo-builder" ref={root}>
    <section className="bo-builder__conversation">
      <header>
        <button onClick={onExit} aria-label="Back to home"><ArrowLeft size={18}/></button>
        <Brand/>
        <ol className="bo-stages" data-testid="build-stages">
          {activeStages.map((label, index) => (
            <li key={label} className={index < stageIndex ? 'done' : index === stageIndex ? 'active' : ''}>
              <i>{index < stageIndex ? <Check size={10}/> : null}</i><span>{label}</span>
            </li>
          ))}
        </ol>
      </header>

      {/* One thread, oldest first. The question BO is asking is simply the newest thing in it. */}
      <div className="bo-thread" ref={chat} data-testid="build-thread">
        {!session?.messages.length && <div className="bo-turn bo-turn--bo"><span><Sparkles size={15}/></span><div><p>Tell me how your company works.</p></div></div>}

        {session?.messages.map(message => message.id === currentAssistantId ? null : message.role === 'user'
          ? <div className="bo-turn bo-turn--you" key={message.id}><div><p>{message.content}</p></div></div>
          : <div className="bo-turn bo-turn--bo" key={message.id}><span><Sparkles size={15}/></span><div><p>{message.content}</p></div></div>)}

        {(thoughts.length > 0 || loading) && <div className="bo-turn bo-turn--bo">
          <span><Sparkles size={15}/></span>
          <div>
            <button type="button" className="bo-thinking-toggle" onClick={() => setThinkingOpen(open => !open)} aria-expanded={thinkingOpen}>
              <span>{loading ? (activity || 'Thinking') : `Thought this through in ${thoughts.length} step${thoughts.length === 1 ? '' : 's'}`}</span>
              <ChevronDown size={13} className={thinkingOpen ? 'open' : ''}/>
            </button>
            {thinkingOpen && <div className="bo-thinking" data-testid="agent-thinking">
              {thoughts.map(thought => <article key={thought.id}><strong>{thought.title}</strong><span>{thought.body}</span></article>)}
              {loading && <article className="active"><strong>{activity || 'Understanding your business'}</strong><span>{streamedText || 'Working through the confirmed business facts and updating the Command Center on the right.'}</span></article>}
            </div>}
          </div>
        </div>}

        {error ? <div className="bo-turn bo-turn--bo">
          <span><Sparkles size={15}/></span>
          <div className="bo-turn-error"><p>BO couldn’t finish that thought. {error}</p><button onClick={() => session && runAgent(session)}><RotateCcw size={13}/> Retry</button></div>
        </div> : architecture && session?.phase === 'AWAITING_APPROVAL' ? <div className="bo-turn bo-turn--bo">
          <span><Sparkles size={15}/></span>
          <div className="bo-proposal" data-testid="architecture-proposal">
            <small>PROPOSED COMMAND CENTER</small>
            <strong>{architecture.title || 'Your Command Center'}</strong>
            <p>{architecture.explanation || architecture.summary}</p>
            {proposalReasoning.length > 0 && <ul className="bo-proposal-reasoning" data-testid="proposal-reasoning">{proposalReasoning.map(finding => <li key={finding.id}><b>{finding.conclusion}</b><span>{finding.implication}</span><em>“{finding.because}”</em></li>)}</ul>}
            <div className="bo-workspace-plan">{architecture.pages.map(page => <span key={page}><Check size={11}/>{page}</span>)}</div>
            {frontier?.sources.length ? <div className="bo-research-sources" data-testid="research-sources"><small>RESEARCHED FROM</small>{frontier.sources.slice(0, 6).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener">{source.title || source.url}</a>)}</div> : null}
            <div className="bo-proposal-actions"><button onClick={approve} data-testid="open-dashboard">Build my Command Center <ArrowRight size={16}/></button><span>or tell BO what to change below</span></div>
          </div>
        </div> : session?.currentQuestion ? <div className="bo-turn bo-turn--bo bo-turn--asking" data-testid="discovery-question">
          <span><Sparkles size={15}/></span>
          <div>
            {currentAcknowledgment && <p className="bo-turn-ack">{currentAcknowledgment}</p>}
            <p className="bo-turn-ask">{session.currentQuestion.text}</p>
            {session.currentQuestion.suggestedAnswers.length > 0 && <div className="bo-quick-answers">{session.currentQuestion.suggestedAnswers.map(option => <button key={option} onClick={() => void submit(option)}>{option}</button>)}</div>}
          </div>
        </div> : loading ? <div className="bo-turn bo-turn--bo"><span><Sparkles size={15}/></span><div className="bo-typing" aria-label="BO is working"><i/><i/><i/></div></div> : null}
      </div>

      {/* One composer, always in the same place: answering a question and asking for a change are the
          same act, and moving the box between them is what made the build feel like a sequence of
          different screens rather than a conversation. */}
      <footer className="bo-composer">
        {session?.currentQuestion && <div className="bo-question-progress" data-testid="question-progress">
          <b>Question {session.metrics.questionsAsked + 1}</b>
          <i><u style={{ width: `${Math.round(coverage * 100)}%` }}/></i>
          <span>{Math.round(coverage * 100)}% understood</span>
        </div>}
        <div className="bo-composer__field">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }}
            placeholder={architecture && session?.phase === 'AWAITING_APPROVAL' ? 'Tell BO what should change…' : 'Reply to BO…'}
            rows={1}
            data-testid="discovery-answer"
          />
          <button onClick={() => void submit()} disabled={!draft.trim() || loading} aria-label="Send" data-testid="answer-question"><Send size={15}/></button>
        </div>
      </footer>
    </section>

    <section className="bo-builder__preview" ref={preview}>{previewConfig ? <ProgressiveCommandCenter config={previewConfig} activity={activity} loading={loading} asking={Boolean(session?.currentQuestion)}/> : <div className="bo-preview-empty">Building operation...</div>}</section>
    {launching && launchBlueprint && <div className="bo-launch-overlay"><DashboardSurface answers={initialAnswers} blueprint={launchBlueprint}/><div className="bo-generation-status"><Sparkles size={17}/><strong>{buildLabels[launchPhase]}</strong><span/></div></div>}
  </main>
}
