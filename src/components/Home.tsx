import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowUp, ChevronDown, Lock } from 'lucide-react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { capabilityIds } from '../engine/capabilityCatalog'
import { prepareBusinessDiscoveryModel } from '../engine/discoveryModel'
import { Brand } from './Brand'
import { CompanyPrompt } from './CompanyPrompt'
import { AccountButton } from './AccountButton'
import { ThemeToggle } from './ThemeToggle'
import wave04 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_04.png'
import wave05 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_05.png'
import wave06 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_06.png'
import wave07 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_07.png'
import wave08 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_08.png'
import wave09 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_09.png'

gsap.registerPlugin(useGSAP)

const cardImage = (image: string) => ({ '--bo-card-image': `url("${image}")` }) as React.CSSProperties

/**
 * Wesify's home page, signed in or not.
 *
 * There used to be two of these: a landing page at `/` that argued for Wesify, and this page behind the
 * account. They had converged on the same thing — a sentence and the box to answer it in — so the
 * landing page is gone and this is what `/` serves.
 *
 * That makes the front door and the workbench the same door, which is the honest arrangement for a
 * product whose entire pitch is the thing it builds from one sentence. A stranger types; Wesify asks who
 * they are afterwards, at the moment there is something worth signing in for.
 *
 * What follows below the fold is not the landing page come back. It answers the one question the
 * prompt itself cannot — "and then what happens?" — by showing it. Every card carries a picture of
 * Wesify's own interface rather than an icon standing in for an idea, because a picture of the product
 * is the only illustration that cannot promise something the product does not do.
 */

/**
 * How far a card tilts toward the cursor, and the ceiling below which Wesify does not try.
 *
 * `(hover: hover) and (pointer: fine)` is a mouse — a trackpad or a real mouse, not a finger — and
 * reduced-motion is a person who has said, at the operating-system level, that they do not want
 * things moving on their behalf. Read once, at module load: neither answer changes during a session,
 * and re-asking on every pointer move would be the one part of this effect actually worth avoiding
 * for performance.
 */
const MAX_TILT_DEGREES = 4
const tiltEnabled = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * One pointer position driving two effects.
 *
 * The glow is CSS alone — `--mx`/`--my` are read by a radial gradient that stays invisible until
 * `:hover`, so this is the only thing that needs to run. The tilt is a real transform, set here
 * because CSS cannot turn a cursor position into an angle; it only runs where `tiltEnabled` says a
 * mouse and a person willing to see motion are both present.
 */
function tiltCard(event: React.MouseEvent<HTMLElement>) {
  const card = event.currentTarget
  const rect = card.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  card.style.setProperty('--mx', `${x}px`)
  card.style.setProperty('--my', `${y}px`)
  if (!tiltEnabled) return
  const rotateY = ((x / rect.width) - 0.5) * MAX_TILT_DEGREES * 2
  const rotateX = ((y / rect.height) - 0.5) * -MAX_TILT_DEGREES * 2
  card.style.transform = `perspective(1200px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`
}

function settleCard(event: React.MouseEvent<HTMLElement>) {
  event.currentTarget.style.transform = ''
}

export function Home({ initialValue = '', onSubmit, signedIn = false, accounts = false, onSignIn }: {
  initialValue?: string
  onSubmit: (brief: string) => void
  signedIn?: boolean
  accounts?: boolean
  onSignIn?: () => void
}) {
  const explain = useRef<HTMLElement>(null)
  const center = useRef<HTMLElement>(null)
  const promptStage = useRef<HTMLDivElement>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  // Stable across re-renders so React never treats "the same handler" as a prop change on six cards.
  const card = useMemo(() => ({ onMouseMove: tiltCard, onMouseLeave: settleCard }), [])

  useGSAP(() => {
    if (!promptOpen || !promptStage.current) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    gsap.fromTo(promptStage.current, { autoAlpha: 0, y: reduceMotion ? 0 : 14 }, {
      autoAlpha: 1,
      y: 0,
      duration: reduceMotion ? 0 : .42,
      ease: 'power2.out',
    })
  }, { dependencies: [promptOpen], scope: center, revertOnUpdate: true })

  /**
   * Only warmed up for somebody who is already in.
   *
   * The in-browser model is a large download, and starting it for every stranger who lands spends
   * their bandwidth before they have asked Wesify for anything. With no accounts configured there are no
   * strangers — Wesify is a single-browser prototype — so it warms up then too.
   */
  useEffect(() => {
    if (accounts && !signedIn) return
    void prepareBusinessDiscoveryModel().catch(() => undefined)
  }, [accounts, signedIn])

  return <main className="bo-home">
    <div className="bo-home__hero">
      <header>
        <Brand />
        <ThemeToggle className="bo-home__theme-toggle"/>
        {/* Only where it means something: with no accounts there is nothing to sign in to, and
            somebody already signed in does not need to be offered it. */}
        {accounts && !signedIn && <button type="button" className="bo-home__signin" onClick={onSignIn} data-testid="open-signin">Sign in</button>}
        {/* And the other half of the same thought: somebody signed in gets their account here, so
            the page they land on after signing in shows that it worked. */}
        {accounts && signedIn && <div className="bo-home__account" data-testid="home-account"><AccountButton/></div>}
      </header>
      <section className="bo-home__center" ref={center}>
        {/**
         * Counted, not claimed.
         *
         * The number is `capabilityIds.length` rather than a figure typed into the markup, so it is
         * whatever the catalog actually holds on the day somebody reads it and cannot drift into
         * being a lie the next time a capability is added or removed.
         */}
        <h1>
          <span>Business managing </span>
          <span>in one place.</span>
        </h1>
        {!promptOpen && <div className="bo-home__actions">
          <button type="button" className="bo-home__get-started" onClick={() => setPromptOpen(true)} data-testid="get-started">
            Get started <ArrowRight size={17}/>
          </button>
          <button type="button" className="bo-home__learn-more" onClick={() => explain.current?.scrollIntoView({ behavior: 'smooth' })} data-testid="learn-more">
            Learn more <ChevronDown size={17}/>
          </button>
        </div>}
        {promptOpen && <div className="bo-home__prompt-stage" ref={promptStage} data-testid="prompt-stage">
          <CompanyPrompt initialValue={initialValue} onSubmit={onSubmit} testId="company-brief"/>
        </div>}
      </section>
      {/* Where a company with customers would put their logos. Wesify has none yet, and a row of
          borrowed or invented marks is the one thing on a landing page that cannot be walked back —
          so this carries what is true instead: the trades Wesify knows before the first question. */}
      <div className="bo-home__proof">
        <div>
          <small>ALREADY KNOWS</small>
          <span>Field service</span>
          <span>Agencies</span>
          <span>Wholesale</span>
          <span>Manufacturing</span>
          <span>Clinics</span>
          <span>Restaurants</span>
          <button
            type="button"
            className="bo-home__scroll-cue"
            onClick={() => explain.current?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="See how it works"
          >
            <ChevronDown size={18}/>
          </button>
        </div>
      </div>
    </div>

    <section className="bo-home__explain" ref={explain}>
      <div className="bo-home__explain-intro">
        <small>HOW IT WORKS</small>
        <h2>From one sentence to a working system</h2>
      </div>

      <div className="bo-bento">
        <article className="bo-bento__card bo-bento__card--wide" style={cardImage(wave04)} {...card}>
          <h3>Describe your business in one sentence</h3>
          <div className="bo-shot bo-shot--prompt" aria-hidden="true">
            <div className="bo-shot__frame">
              <div className="bo-shot__prompt-box">
                <span className="bo-shot__send"><ArrowUp size={16}/></span>
              </div>
              <div className="bo-shot__starters">
                <span>Marketing agency</span>
                <span>Plumbing &amp; repairs</span>
                <span>Online store</span>
                <span>Consulting</span>
                <span>Restaurant</span>
                <span>Manufacturing</span>
              </div>
            </div>
          </div>
        </article>

        <article className="bo-bento__card" style={cardImage(wave05)} {...card}>
          <h3>It only asks what it cannot work out</h3>
          <div className="bo-shot bo-shot--interview" aria-hidden="true">
            <div className="bo-shot__frame">
              <div className="bo-shot__turn bo-shot__turn--bo">Do you sell direct to shoppers, or to shops and restaurants?</div>
              <div className="bo-shot__turn bo-shot__turn--you">To shops and restaurants, and we keep stock in Madrid.</div>
              <div className="bo-shot__turn bo-shot__turn--bo bo-shot__turn--asking">How do the shops pay you?</div>
              <div className="bo-shot__meta"><span>Question 4</span><i/><span>62% understood</span></div>
            </div>
          </div>
        </article>

        <article className="bo-bento__card" style={cardImage(wave06)} {...card}>
          <h3>Built for your business, not a template</h3>
          <div className="bo-shot bo-shot--modules" aria-hidden="true">
            <div className="bo-shot__frame">
              <span className="on">Shops</span>
              <span className="on">Stock in Madrid</span>
              <span className="on">Deliveries</span>
              <span className="on">Invoices</span>
              <span className="on">Suppliers</span>
              <span className="off">Manufacturing</span>
              <span className="off">Field service</span>
              <span className="off">Payroll</span>
              <span className="off">Subscriptions</span>
              <span className="off">Recruiting</span>
              <span className="off">Quality checks</span>
              <small>Hidden until this company needs them.</small>
            </div>
          </div>
        </article>

        <article className="bo-bento__card" style={cardImage(wave07)} {...card}>
          <h3>Already holds what you told it</h3>
          <div className="bo-shot" aria-hidden="true">
            <div className="bo-shot__frame">
              <div className="bo-shot__table">
                <div className="head"><span>Shop</span><span>City</span></div>
                <div><span>La Pampa</span><span>Barcelona</span></div>
                <div><span>Shop 1</span><span>Madrid</span></div>
                <div><span>Shop 2</span><span>Madrid</span></div>
                <div><span>Shop 3</span><span>Madrid</span></div>
                <div><span>Shop 4</span><span>Madrid</span></div>
                <div><span>Shop 5</span><span>Madrid</span></div>
              </div>
            </div>
          </div>
        </article>

        <article className="bo-bento__card" style={cardImage(wave08)} {...card}>
          <h3>Nothing you connect writes back</h3>
          <div className="bo-shot bo-shot--access" aria-hidden="true">
            <div className="bo-shot__frame">
              <div className="bo-shot__conn">
                <strong>Payments</strong>
                <span className="bo-shot__badge bo-shot__badge--allow"><Lock size={11}/> Read-only</span>
              </div>
              <div className="bo-shot__conn">
                <strong>Write access</strong>
                <span className="bo-shot__badge bo-shot__badge--deny">Not requested</span>
              </div>
              <div className="bo-shot__conn">
                <strong>Stored key</strong>
                <span className="bo-shot__badge bo-shot__badge--allow"><Lock size={11}/> Encrypted</span>
              </div>
              <div className="bo-shot__conn">
                <strong>Key shown back to you</strong>
                <span className="bo-shot__badge bo-shot__badge--deny">Never</span>
              </div>
            </div>
          </div>
        </article>

        <article className="bo-bento__card bo-bento__card--full" style={cardImage(wave09)} {...card}>
          <h3>Get your Command Center</h3>
          <div className="bo-shot bo-shot--workspace" aria-hidden="true">
            <div className="bo-shot__frame">
              <div className="bo-shot__rail">
                <b>Iberia Import</b>
                <span className="active">Command center</span>
                <span>Shops</span>
                <span>Stock in Madrid</span>
                <span>Deliveries</span>
                <span>Invoices</span>
                <span>Suppliers</span>
              </div>
              <div className="bo-shot__main">
                <div className="bo-shot__kpis">
                  <div><small>Unpaid invoices</small><strong>€12,480</strong></div>
                  <div><small>Stock on hand</small><strong>418</strong></div>
                  <div><small>Deliveries this week</small><strong>26</strong></div>
                </div>
                <div className="bo-shot__panel">
                  <div className="bo-shot__table">
                    <div className="head"><span>Shop</span><span>City</span><span>Terms</span></div>
                    <div><span>La Pampa</span><span>Barcelona</span><span>30 days</span></div>
                    <div><span>Shop 1</span><span>Madrid</span><span>30 days</span></div>
                    <div><span>Shop 2</span><span>Madrid</span><span>30 days</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
}
