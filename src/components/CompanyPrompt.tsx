import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowUp } from 'lucide-react'
import { useRef, useState } from 'react'

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

export function CompanyPrompt({ initialValue = '', onSubmit, testId }: {
  initialValue?: string
  onSubmit: (brief: string) => void
  testId: string
}) {
  const [brief, setBrief] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const promptRef = useRef<HTMLDivElement>(null)
  const exampleTextRef = useRef<HTMLSpanElement>(null)

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
    if (value) onSubmit(value)
  }

  return <>
    <div className="bo-prompt" ref={promptRef}>
      <div className={`bo-prompt__example${brief || focused ? ' hidden' : ''}`} aria-hidden="true"><span ref={exampleTextRef}/><i/></div>
      <textarea
        value={brief}
        onChange={event => setBrief(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }}
        placeholder={focused ? 'Describe your business…' : ''}
        aria-label="Describe your business"
        rows={3}
        data-testid={testId}
      />
      <button onClick={submit} disabled={!brief.trim()} aria-label="Start building" data-testid="start-building"><ArrowUp size={20}/></button>
    </div>
    <div className="bo-prompt__guidance">Describe what you do, Wesify will build your workspace.</div>
  </>
}
