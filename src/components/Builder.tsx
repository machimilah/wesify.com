import { ArrowLeft, ArrowRight, Bot, Check, Eye, RotateCcw, Send } from 'lucide-react'
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
import { businessDiscoveryModel, interviewQuestionProgress, researchSession, resilientArchitecture } from '../engine/discoveryModel'
import { resolveIndustry } from '../engine/industryResolver'
import { applyFrontierArchitecture, frontierResearchStatus, mergeFrontierResearch, requestFrontierResearch, type FrontierResearch } from '../engine/researchClient'
import { applyIndustryVerdict, loadIndustryVerdict, recordIndustryObservations, type IndustryVerdict } from '../engine/industryClient'
import { loadDiscoverySession, saveDiscoverySession } from '../engine/discoverySessionClient'
import { generateWorkspaceConfigurationFromDiscovery } from '../engine/workspaceSchema'
import { applyWorkspaceSetup, briefWithSetup, readWorkspaceSetup } from '../engine/workspaceSetup'
import { answerIntake, readBuildIntake, saveBuildIntake, withLogo, type BuildIntake } from '../engine/buildIntake'
import { publishWorkspaceIdentity, sendInvites } from '../engine/workspaceSetupClient'
import { BuildIntakeControls } from './BuildIntake'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

gsap.registerPlugin(useGSAP)

interface BuilderProps {
  workspaceId: string
  initialAnswers: Answers
  onAnswersChange: (answers: Answers) => void
  onBlueprintChange: (blueprint: AIBlueprint) => void
  onExit: () => void
  onComplete: () => void
}

/** The four things Wesify does, named so the wait is legible without reading the journal. */
const stages = ['Understanding you', 'Researching', 'Designing', 'Ready to build']

const buildLabels = ['Creating data model', 'Building operational pages', 'Connecting workflows', 'Adding controls', 'Testing Wesify', 'Command Center ready']

function asksToSkip(message: string) {
  return /\b(just build|build it|skip (the )?questions|no more questions|go ahead and build)\b/i.test(message)
}

export function Builder({ workspaceId, initialAnswers, onAnswersChange, onBlueprintChange, onExit, onComplete }: BuilderProps) {
  const root = useRef<HTMLElement>(null)
  const chat = useRef<HTMLDivElement>(null)
  const launchRect = useRef<DOMRect | null>(null)
  const booted = useRef(false)
  const [session, setSession] = useState<DiscoverySession | null>(null)
  /**
   * The three scripted questions that open every build — a name, a logo, colleagues — and what has
   * been said about them so far. Read from storage rather than started fresh, so a reload lands back
   * in the conversation instead of asking for a name that was given a minute ago.
   */
  const [intake, setIntake] = useState<BuildIntake>(() => readBuildIntake(workspaceId))
  const [intakeProblem, setIntakeProblem] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [activity, setActivity] = useState('')
  /**
   * The one thing the journal said that an operator has to act on: Wesify is answering from somewhere
   * weaker than it should be. It survives as its headline only — "Falling back to Wesify's built-in
   * questions" is the actionable part; the paragraph explaining the model cascade was not.
   */
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [launching, setLaunching] = useState(false)
  const [launchPhase, setLaunchPhase] = useState(0)
  const [frontier, setFrontier] = useState<FrontierResearch | null>(null)
  const [industry, setIndustry] = useState<IndustryVerdict | null>(null)
  const [frontierModel, setFrontierModel] = useState('')
  const [researching, setResearching] = useState(false)
  // Closed by default: the proposal is there to be read on request, not to stand between the
  // operator and the workspace they have just spent an interview describing.
  const [proposalOpen, setProposalOpen] = useState(false)
  /**
   * Which model asked the question on screen.
   *
   * Wesify falls back through three paths, and they ask visibly different questions — so an operator who
   * met a blunt built-in question had no way to tell whether Wesify was thinking or whether the key had
   * never been picked up. Naming the source is one line of screen and answers it outright.
   */
  const [askedBy, setAskedBy] = useState('')

  const frontierStarted = useRef(false)

  const commit = (next: DiscoverySession) => {
    setSession(next)
    void saveDiscoverySession(next)
  }

  /**
   * Runs alongside the interview rather than blocking it: external research takes far longer than a
   * question, and its conclusions are additive. If it is unavailable, Wesify keeps its built-in researcher.
   */
  const runFrontierResearch = async (base: DiscoverySession) => {
    if (frontierStarted.current) return
    frontierStarted.current = true
    const status = await frontierResearchStatus()
    // `available` covers the interview, which a free Gemini key alone turns on. Web research is the
    // Anthropic path only, and announcing a search Wesify cannot run is worse than not mentioning it.
    if (!(status.research ?? status.available)) return
    setFrontierModel(status.model)
    setResearching(true)
    try {
      const description = base.messages.find(message => message.role === 'user')?.content ?? ''
      const result = await requestFrontierResearch(base.workspaceId, description, base.messages.map(message => ({ role: message.role, content: message.content })))
      if (!result) return
      setFrontier(result)
    } catch {
      // Wesify's built-in researcher still runs, so a missing web pass costs detail, not the build.
    } finally {
      setResearching(false)
    }
  }

  const runAgent = async (base: DiscoverySession) => {
    setLoading(true); setError(''); setNotice(''); setActivity('Understanding your business')
    const latestUser = [...base.messages].reverse().find(message => message.role === 'user')?.content ?? ''
    try {
      const response = await businessDiscoveryModel.generate(
        { mode: 'DISCOVER', session: base, forceArchitecture: asksToSkip(latestUser) },
        { onActivity: setActivity, onNotice: setNotice, onSource: setAskedBy },
      )
      if (response.decision === 'READY_TO_ARCHITECT') {
        setActivity('Designing your Command Center')
        const architectureResponse = await businessDiscoveryModel.generate(
          { mode: 'ARCHITECT', session: { ...base, phase: 'ARCHITECTING', businessState: response.businessState } },
          { onActivity: setActivity, onNotice: setNotice, onSource: setAskedBy },
        )
        const proposed = applyAgentResponse({ ...base, phase: 'ARCHITECTING' }, architectureResponse)
        let finalResponse = architectureResponse
        try {
          setActivity('Checking the architecture')
          const reviewed = await businessDiscoveryModel.generate(
            { mode: 'REVIEW_ARCHITECTURE', session: { ...proposed, phase: 'ARCHITECTING' } },
            { onActivity: setActivity, onNotice: setNotice, onSource: setAskedBy },
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
      const message = reason instanceof Error ? reason.message : 'Wesify could not reach the local AI.'
      setError(message)
    } finally {
      setLoading(false); setActivity('')
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
        })
      const last = initial.messages.at(-1)
      // Nothing is asked of the model until the three opening questions have been answered: the
      // description they enrich is the one the interview starts from.
      if (readBuildIntake(workspaceId).stage !== 'done') return
      if (initial.phase === 'DISCOVERING' && last?.role === 'user' && !initial.currentQuestion) await runAgent(initial)
    })()
  }, [workspaceId])

  /**
   * Stays on the newest message, unless the operator has scrolled up to re-read something.
   *
   * A dependency list cannot do this job: the thread grows from a dozen places — a question arriving,
   * the thinking panel opening, streamed text getting longer, the proposal rendering — and any list
   * that tries to name them all lands a frame early and stops short of the bottom. Watching the DOM
   * catches every one of them, and the near-bottom check is what keeps Wesify from yanking the view back
   * down while somebody is reading their own third answer.
   */
  useEffect(() => {
    const node = chat.current
    if (!node) return
    const nearBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight < 120
    let stick = true
    const onScroll = () => { stick = nearBottom() }
    const pin = () => { if (stick) node.scrollTop = node.scrollHeight }
    node.addEventListener('scroll', onScroll, { passive: true })
    const observer = new MutationObserver(pin)
    observer.observe(node, { childList: true, subtree: true, characterData: true })
    pin()
    return () => { node.removeEventListener('scroll', onScroll); observer.disconnect() }
  }, [session?.workspaceId])

  /**
   * The end of the intake, which is the beginning of the interview.
   *
   * Everything the three answers are good for happens here, once: the name and logo go up so a
   * second device and every colleague see the same workspace, the invitations go out, and the
   * description the interview will work from is rewritten to include what was just said — so nobody
   * is asked their company's name twice, once by a form and once by a model.
   */
  const advanceIntake = (next: BuildIntake) => {
    setIntake(saveBuildIntake(workspaceId, next))
    setIntakeProblem('')
  }

  /**
   * The end of the intake, which is the beginning of the interview.
   *
   * An effect rather than the last line of the last answer, because the two are not the same moment:
   * the session is still loading while the first questions are being answered, and the description
   * these answers enrich lives in it. So the answers wait here for it, and `settled` — written to
   * storage — is what stops a reload doing all of this a second time.
   */
  useEffect(() => {
    if (intake.stage !== 'done' || intake.settled || !session || loading) return
    const setup = intake.setup
    const brief = session.messages.find(message => message.role === 'user')
    setIntake(saveBuildIntake(workspaceId, { ...intake, settled: true }))
    void publishWorkspaceIdentity(workspaceId, setup)
    if (setup.invites.length) {
      void sendInvites(workspaceId, setup.invites).then(result => {
        if (result.failed.length) setNotice(`Wesify could not invite ${result.failed.map(failure => failure.email).join(', ')}.`)
      })
    }
    const described = briefWithSetup(brief?.content ?? '', setup)
    onAnswersChange({ ...initialAnswers, companyDescription: described, ...(setup.name.trim() ? { companyName: setup.name.trim() } : {}) })
    // The interview starts from what the operator has just added to their description, rather than
    // being told the company's name and then asking for it.
    const enriched = { ...session, messages: session.messages.map(message => message.id === brief?.id ? { ...message, content: described } : message) }
    commit(enriched)
    void runAgent(enriched)
  }, [intake.stage, intake.settled, session?.workspaceId, Boolean(session)])

  /** The question on the table, and everything said before it. */
  const intakeAsking = intake.stage === 'done' ? null : intake.turns.at(-1)?.role === 'bo' ? intake.turns.at(-1) : null
  const intakeSaid = intakeAsking ? intake.turns.slice(0, -1) : intake.turns

  const submit = async (value = draft) => {
    const answer = value.trim()
    if (!answer) return
    // The opening questions are Wesify's own, and answering them waits for nothing: the session behind
    // the interview may still be loading, and a name typed into a box that ignores it is worse than
    // a name asked for twice.
    if (intake.stage !== 'done') {
      const result = answerIntake(intake, answer)
      if (result.problem) return setIntakeProblem(result.problem)
      setDraft('')
      return advanceIntake(result.intake)
    }
    if (!session || loading) return
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
    // Onboarding asked for the name and the logo before any of this ran, and what a person typed
    // about their own company outranks what the interview inferred about it.
    const config = applyWorkspaceSetup(generateWorkspaceConfigurationFromDiscovery(nextAnswers, blueprint, session.businessState, architecture), readWorkspaceSetup(workspaceId))
    config.id = workspaceId
    localStorage.setItem('bo-workspace-config', JSON.stringify(config))
    localStorage.setItem(`bo-workspace-config:${workspaceId}`, JSON.stringify(config))
    localStorage.setItem('bo-workspace-id', workspaceId)
    // What this company was given becomes evidence for the next company in the same industry.
    const patterns = [
      ...(config.businessModel?.operatingModel.processIds ?? []).map(id => ({ kind: 'process' as const, id, outcome: 'adopted' as const })),
      ...(config.businessModel?.intelligence.kpiPatternIds ?? []).map(id => ({ kind: 'kpi' as const, id, outcome: 'adopted' as const })),
      ...(config.businessModel?.governance.approvalPatternIds ?? []).map(id => ({ kind: 'automation' as const, id, outcome: 'adopted' as const })),
      ...(config.businessModel?.knowledge.requirementIds ?? []).map(id => ({ kind: 'diagnostic' as const, id, outcome: 'adopted' as const })),
    ]
    void recordIndustryObservations(config.industrySubsector, workspaceId, { kept: config.capabilities ?? [], patterns, label: config.industryLabel, newCompany: true })
    onAnswersChange(nextAnswers)
    onBlueprintChange(blueprint)
    const now = new Date().toISOString()
    commit({ ...session, phase: 'BUILDING', projectId: workspaceId, metrics: { ...session.metrics, architectureApproved: true, approvedAt: now }, updatedAt: now })
    launchRect.current = root.current?.getBoundingClientRect() ?? null
    setLaunchPhase(0); setLaunching(true)
  }

  useEffect(() => {
    if (!launching) return
    const timer = window.setInterval(() => setLaunchPhase(current => Math.min(current + 1, buildLabels.length - 1)), 160)
    return () => window.clearInterval(timer)
  }, [launching])

  const finish = () => {
    if (session) commit({ ...session, phase: 'READY', updatedAt: new Date().toISOString() })
    onComplete()
  }

  useGSAP(() => {
    if (!launching || !launchRect.current) return
    const rect = launchRect.current
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.bo-launch-overlay', { x: rect.left, y: rect.top, scaleX: rect.width / window.innerWidth, scaleY: rect.height / window.innerHeight, transformOrigin: 'top left', borderRadius: 24 }, { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 0, duration: 0.45, ease: 'power3.inOut', onComplete: () => window.setTimeout(finish, 250) })
      gsap.to('.bo-builder__conversation', { autoAlpha: 0, duration: 0.25, ease: 'power2.in' })
    })
    media.add('(prefers-reduced-motion: reduce)', finish)
    return () => media.revert()
  }, { dependencies: [launching], scope: root, revertOnUpdate: true })

  const currentAssistantId = session?.currentQuestion ? session.messages.at(-1)?.id : null
  /**
   * What Wesify said alongside the question, without the question itself.
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
  // shows a step Wesify is not taking.
  const activeStages = frontierModel ? stages : stages.filter(stage => stage !== 'Researching')
  const stageName = architecture ? 'Ready to build'
    : researching ? 'Researching'
    : loading && /design|architect|command center/i.test(activity) ? 'Designing'
    : 'Understanding you'
  const stageIndex = Math.max(0, activeStages.indexOf(stageName))
  const proposalResearch = useMemo(() => session && architecture ? mergeFrontierResearch(researchSession(session), frontier) : null, [session, architecture, frontier])
  const proposalReasoning = proposalResearch?.findings.slice(0, 5) ?? []
  const proposalGaps = proposalResearch?.gaps.slice(0, 5) ?? []
  const questionProgress = interviewQuestionProgress(session?.metrics.questionsAsked ?? 0)

  /**
   * The thread in two halves, because something belongs between them.
   *
   * The opening questions — a name, a logo, colleagues — are asked before the interview and answered
   * before it, so that is where they have to be read. Drawn after the message list instead, they sat
   * below every answer given since, which put "How should we name this workspace?" underneath the
   * third question of an interview it had already finished, and moved further down with every reply.
   * The first message is the sentence somebody typed to start the build; everything after it is the
   * interview those three questions came before.
   */
  const spoken = session?.messages.filter(message => message.id !== currentAssistantId) ?? []
  const openingBrief = spoken[0]
  const interviewSaid = spoken.slice(1)
  const turn = (id: string, role: 'user' | 'assistant' | 'you' | 'bo', text: string) => (role === 'user' || role === 'you'
    ? <div className="bo-turn bo-turn--you" key={id}><div><span className="bo-turn__text">{text}</span></div></div>
    : <div className="bo-turn bo-turn--bo" key={id}><span><Bot size={15}/></span><div><span className="bo-turn__text">{text}</span></div></div>)

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
        <ThemeToggle/>
      </header>

      {/* One thread, oldest first. The question Wesify is asking is simply the newest thing in it. */}
      <div className="bo-thread" ref={chat} data-testid="build-thread">
        {!session?.messages.length && <div className="bo-turn bo-turn--bo"><span><Bot size={15}/></span><div><span className="bo-turn__text">Tell me how your company works.</span></div></div>}

        {openingBrief && turn(openingBrief.id, openingBrief.role, openingBrief.content)}

        {/**
         * The three opening questions, after the sentence that started the build and before the
         * interview that follows them — which is the order they were said in.
         *
         * The one still waiting for an answer is drawn like any other question Wesify is asking, because
         * that is what it is. The ones already answered settle back into the thread behind it.
         */}
        {intakeSaid.map(said => turn(said.id, said.role, said.text))}

        {intakeAsking && <div className="bo-turn bo-turn--bo bo-turn--asking" data-testid="intake-question">
          <span><Bot size={15}/></span>
          <div><span className="bo-turn-ask">{intakeAsking.text}</span></div>
        </div>}

        {intakeProblem && <div className="bo-turn bo-turn--bo"><span><Bot size={15}/></span><div><span className="bo-turn__text bo-turn__notice" data-testid="intake-problem">{intakeProblem}</span></div></div>}

        {intake.stage !== 'done' && <BuildIntakeControls
          intake={intake}
          onLogo={(logo, fileName) => advanceIntake(withLogo(intake, logo, fileName))}
          onSkip={() => advanceIntake(answerIntake(intake, 'Skip').intake)}
          onProblem={setIntakeProblem}
        />}

        {interviewSaid.map(message => turn(message.id, message.role, message.content))}

        {/**
         * What Wesify is doing, and nothing about how it is doing it.
         *
         * This was an expandable journal: every fact re-stated, every capability decision explained,
         * a paragraph per research finding. It was written to show Wesify's working, and what it actually
         * showed was that Wesify had a great deal to say while somebody was waiting to answer a question.
         * The reasoning still happens and still decides what gets built — it is simply not the
         * operator's reading material.
         *
         * One line survives, because a wait with no label is a wait that looks broken.
         */}
        {notice && <div className="bo-turn bo-turn--bo"><span><Bot size={15}/></span><div><span className="bo-turn__text bo-turn__notice" data-testid="agent-notice">{notice}</span></div></div>}

        {intake.stage === 'done' && loading && <div className="bo-turn bo-turn--bo" data-testid="agent-activity">
          <span><Bot size={15}/></span>
          <div><span className="bo-turn__text bo-turn__working">{activity || 'Working on it'}</span></div>
        </div>}

        {error ? <div className="bo-turn bo-turn--bo">
          <span><Bot size={15}/></span>
          <div className="bo-turn-error"><span className="bo-turn__text">Wesify couldn't finish that thought. {error}</span><button onClick={() => session && runAgent(session)}><RotateCcw size={13}/> Retry</button></div>
        </div> : architecture && session?.phase === 'AWAITING_APPROVAL' ? <div className="bo-turn bo-turn--bo">
          <span><Bot size={15}/></span>
          <div>
            {/**
             * The end of the interview is a decision, not a document.
             *
             * Wesify used to answer twelve questions with a wall of its own reasoning and put the button
             * at the bottom of it. Somebody who already trusts what they have been told should reach
             * their workspace in one click; the plan is there for anyone who wants to read it first,
             * and that is one click too.
             */}
            {proposalOpen && <div className="bo-proposal" data-testid="architecture-proposal">
              <small>PROPOSED COMMAND CENTER</small>
              <strong>{architecture.title || 'Your Command Center'}</strong>
              <span className="bo-proposal__summary">{architecture.explanation || architecture.summary}</span>
              {proposalReasoning.length > 0 && <ul className="bo-proposal-reasoning" data-testid="proposal-reasoning">{proposalReasoning.map(finding => <li key={finding.id}><b>{finding.conclusion}</b><span>{finding.implication}</span><em>“{finding.because}”</em></li>)}</ul>}
              {proposalGaps.length > 0 && <>
                <small>OPERATING GAPS TO REVIEW</small>
                <ul className="bo-proposal-reasoning" data-testid="proposal-gaps">{proposalGaps.map(gap => <li key={gap.id}><b>{gap.title}</b><span>{gap.rationale}</span><em>{gap.classification}</em></li>)}</ul>
              </>}
              <div className="bo-workspace-plan">{architecture.pages.map(page => <span key={page}><Check size={11}/>{page}</span>)}</div>
            </div>}
            <div className="bo-proposal-actions">
              <button onClick={approve} data-testid="open-dashboard">Build my Command Center <ArrowRight size={16}/></button>
              <button type="button" className="bo-proposal-secondary" onClick={() => setProposalOpen(open => !open)} aria-expanded={proposalOpen} data-testid="check-proposal"><Eye size={15}/> {proposalOpen ? 'Hide proposal' : 'Check proposal'}</button>
              <span>or tell Wesify what to change below</span>
            </div>
          </div>
        </div> : session?.currentQuestion ? <div className="bo-turn bo-turn--bo bo-turn--asking" data-testid="discovery-question">
          <span><Bot size={15}/></span>
          <div>
            {currentAcknowledgment && <span className="bo-turn-ack">{currentAcknowledgment}</span>}
            <span className="bo-turn-ask">{session.currentQuestion.text}</span>
          </div>
        </div> : loading ? <div className="bo-turn bo-turn--bo"><span><Bot size={15}/></span><div className="bo-typing" aria-label="Wesify is working"><i/><i/><i/></div></div> : null}
      </div>

      {/* One composer, always in the same place: answering a question and asking for a change are the
          same act, and moving the box between them is what made the build feel like a sequence of
          different screens rather than a conversation. */}
      <footer className="bo-composer">
        {intake.stage === 'done' && session?.currentQuestion && <div className="bo-question-progress" data-testid="question-progress">
          <b>Question {questionProgress.current} of {questionProgress.total}</b>
          <i><u style={{ width: `${questionProgress.percent}%` }}/></i>
          <span>{questionProgress.percent}% complete</span>
          {askedBy && <em>asked by {askedBy}</em>}
        </div>}
        <div className="bo-composer__field">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }}
            placeholder={intake.stage !== 'done' ? 'Answer, or say skip…' : architecture && session?.phase === 'AWAITING_APPROVAL' ? 'Tell Wesify what should change…' : 'Reply to Wesify…'}
            rows={1}
            data-testid="discovery-answer"
          />
          <button onClick={() => void submit()} disabled={!draft.trim() || loading} aria-label="Send" data-testid="answer-question"><Send size={15}/></button>
        </div>
      </footer>
    </section>

    {launching && <div className="bo-launch-overlay"><div className="bo-generation-status"><Bot size={17}/><strong>{buildLabels[launchPhase]}</strong><span/></div></div>}
  </main>
}
