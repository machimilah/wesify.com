import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prepareBusinessDiscoveryModel } from '../engine/discoveryModel'
import { Brand } from './Brand'

gsap.registerPlugin(useGSAP)

/**
 * One-click starts. The blank prompt box is the hardest moment in the product: people know their
 * business but not what BO wants to hear. A starter fills that in and begins immediately, and the
 * interview refines it from there — so nothing about the first sentence has to be precise.
 */
const starters = [
  { label: 'Marketing agency', brief: 'We run a marketing agency with monthly retainers and client campaigns for other businesses.' },
  { label: 'Plumbing & repairs', brief: 'We run a plumbing service business. Technicians visit customer homes and customers pay on completion.' },
  { label: 'Online store', brief: 'We sell physical products online, hold stock and ship orders to customers.' },
  { label: 'Consulting', brief: 'We are a consulting firm delivering client projects billed per project with a small internal team.' },
  { label: 'Restaurant', brief: 'We run a restaurant with table reservations, suppliers, stock and shift staff.' },
  { label: 'Manufacturing', brief: 'We manufacture custom furniture and track orders, materials and production in our workshop.' },
]

const exampleBriefs = [
  'We run a marketing agency with monthly retainers and client campaigns.',
  'We manufacture custom furniture and need to track orders, materials, and production.',
  'We sell B2B SaaS subscriptions with a sales pipeline and customer support.',
]

export function Home({ initialValue = '', onSubmit }: { initialValue?: string; onSubmit: (brief: string) => void }) {
  const [brief, setBrief] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const promptRef = useRef<HTMLDivElement>(null)
  const exampleTextRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { void prepareBusinessDiscoveryModel().catch(() => undefined) }, [])
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

  return <main className="bo-home">
    <header><Brand /></header>
    <section className="bo-home__center">
      <h1>Build your company</h1>
      <p>Tell me how your business works. I’ll build the system you need to run it.</p>
      <div className="bo-prompt" ref={promptRef}>
        <div className={`bo-prompt__example${brief || focused ? ' hidden' : ''}`} aria-hidden="true"><span ref={exampleTextRef}/><i/></div>
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
          }}
          placeholder={focused ? 'Describe your business…' : ''}
          aria-label="Describe your business"
          rows={3}
          data-testid="company-brief"
        />
        <button onClick={submit} disabled={!brief.trim()} aria-label="Start building" data-testid="start-building"><ArrowUp size={20}/></button>
      </div>
      <div className="bo-starters">
        <small>Or pick the closest one</small>
        <div>
          {starters.map(starter => (
            <button key={starter.label} onClick={() => { setBrief(starter.brief); onSubmit(starter.brief) }} data-testid="starter">
              {starter.label}
            </button>
          ))}
        </div>
      </div>

    </section>
  </main>
}
