import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowUp, Mic, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { enrichBriefWithTools } from '../engine/toolSelection'
import { ToolConnectionsDialog } from './ToolConnections'
import './PromptSurface.css'

gsap.registerPlugin(useGSAP)

/**
 * The box someone describes their company in.
 *
 * It lives in two places — the public page and the signed-in start page — and it is the same box in
 * both, so it is one component rather than two copies of a typewriter animation that would drift.
 * Only the test id differs, and it differs on purpose: the public one and the in-product one have to
 * be told apart by the suite that proves the product itself is still behind an account.
 */

const exampleBriefs = [
  'We run a marketing agency with monthly retainers and client campaigns.',
  'We manufacture custom furniture and need to track orders, materials, and production.',
  'We sell B2B SaaS subscriptions with a sales pipeline and customer support.',
]

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

function speechRecognitionConstructor() {
  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

export function CompanyPrompt({ initialValue = '', onSubmit, testId, submitTestId = 'start-building', selectedTools, onToolsChange, toolsOpen, onToolsOpenChange }: {
  initialValue?: string
  onSubmit: (brief: string) => void
  testId: string
  /** Named separately so two pages carrying the same box stay tellable apart in a browser suite. */
  submitTestId?: string
  selectedTools: string[]
  onToolsChange: (providerIds: string[]) => void
  /**
   * The connections dialog, where the page has its own way of opening it.
   *
   * The box brings the dialog with it, because the `+` inside the box has to open something. A page
   * with a second entrance to the same dialog — the dashboard has two, in its sidebar and its mobile
   * header — must not bring a second dialog along with them: there would be two of the same modal in
   * the document, and whichever one a click reached would be a coin toss. So the page can hold the
   * open state instead, and there is still exactly one dialog.
   */
  toolsOpen?: boolean
  onToolsOpenChange?: (open: boolean) => void
}) {
  const [brief, setBrief] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const [listening, setListening] = useState(false)
  const [ownToolsOpen, setOwnToolsOpen] = useState(false)
  const dialogOpen = toolsOpen ?? ownToolsOpen
  const openTools = (open: boolean) => (onToolsOpenChange ?? setOwnToolsOpen)(open)
  const promptRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const exampleTextRef = useRef<HTMLSpanElement>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [brief])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  useGSAP(() => {
    const target = exampleTextRef.current
    if (!target || brief || focused) {
      if (target) target.textContent = ''
      return
    }
    const media = gsap.matchMedia()
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)', allowMotion: '(prefers-reduced-motion: no-preference)' }, context => {
      if (context.conditions?.reduceMotion) {
        target.textContent = exampleBriefs[0]
        return
      }
      const progress = { characters: 0 }
      const timeline = gsap.timeline({ repeat: -1, defaults: { ease: 'none' } })
      exampleBriefs.forEach(phrase => {
        timeline
          .set(progress, { characters: 0, onComplete: () => { target.textContent = '' } })
          .to(progress, { characters: phrase.length, duration: phrase.length * 0.038, snap: { characters: 1 }, onUpdate: () => { target.textContent = phrase.slice(0, progress.characters) } })
          .to(progress, { duration: 1.6 })
          .to(progress, { characters: 0, duration: phrase.length * 0.018, snap: { characters: 1 }, onUpdate: () => { target.textContent = phrase.slice(0, progress.characters) } })
          .to(progress, { duration: 0.35 })
      })
      return () => timeline.kill()
    })
    return () => media.revert()
  }, { dependencies: [brief, focused], scope: promptRef, revertOnUpdate: true })

  const submit = () => {
    const value = brief.trim()
    if (!value) return
    onSubmit(enrichBriefWithTools(value, selectedTools))
  }

  const toggleVoiceInput = () => {
    if (recognitionRef.current && listening) {
      recognitionRef.current.stop()
      return
    }

    const Recognition = speechRecognitionConstructor()
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = document.documentElement.lang || navigator.language || 'en'
    recognition.onresult = event => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map(result => result[0]?.transcript ?? '')
        .join(' ')
        .trim()
      if (transcript) setBrief(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${transcript}`)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognition.onerror = recognition.onend
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  const voiceInputAvailable = typeof window !== 'undefined' && Boolean(speechRecognitionConstructor())

  return <>
    <div className="bo-prompt" ref={promptRef}>
      <div className="bo-prompt__input">
        <div className={`bo-prompt__example${brief || focused ? ' hidden' : ''}`} aria-hidden="true"><span ref={exampleTextRef}/><i/></div>
        <textarea
          ref={textareaRef}
          value={brief}
          onChange={event => setBrief(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }}
          placeholder={focused ? 'Describe your business…' : ''}
          aria-label="Describe your business"
          rows={1}
          data-testid={testId}
        />
      </div>
      <div className="bo-prompt__footer">
        <button type="button" className="bo-prompt__add-tool" onClick={() => openTools(true)} aria-label="Connect tools" title="Connect tools" data-testid="prompt-connect-tools">
          <Plus size={21}/>
          {selectedTools.length > 0 && <span>{selectedTools.length}</span>}
        </button>
        <div className="bo-prompt__actions">
          <button
            type="button"
            className={`bo-prompt__voice${listening ? ' is-listening' : ''}`}
            onClick={toggleVoiceInput}
            disabled={!voiceInputAvailable}
            aria-label={listening ? 'Stop voice input' : 'Use voice input'}
            title={voiceInputAvailable ? (listening ? 'Stop voice input' : 'Use voice input') : 'Voice input is not supported by this browser'}
          >
            <Mic size={20}/>
          </button>
          <button type="button" className="bo-prompt__submit" onClick={submit} disabled={!brief.trim()} aria-label="Start building" title="Start building" data-testid={submitTestId}><ArrowUp size={21}/></button>
        </div>
      </div>
    </div>
    {/**
      * The dialog only, with no visible trigger of its own.
      *
      * Under the box there used to be a row naming CRM, ERP, Automations and KPIs, and a second
      * button offering to connect tools. Neither was something to do: the row restated the sentence
      * already printed above the prompt, and the button repeated the `+` inside the box a few pixels
      * away. What is left below the prompt is nothing, which is the point — there is one thing to do
      * on this page and it is type.
      */}
    <ToolConnectionsDialog
      open={dialogOpen}
      selected={selectedTools}
      onClose={() => openTools(false)}
      onSave={providerIds => { onToolsChange(providerIds); openTools(false) }}
    />
  </>
}
