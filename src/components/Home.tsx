import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Lock } from 'lucide-react'
import { capabilityIds } from '../engine/capabilityCatalog'
import { prepareBusinessDiscoveryModel } from '../engine/discoveryModel'
import { Brand } from './Brand'
import { AccountButton } from './AccountButton'
import { ThemeToggle } from './ThemeToggle'
import { MoltenMetal } from './MoltenMetal'
import Aurora from './Aurora'
import GlassSurface from './GlassSurface'
import LogoLoop from './LogoLoop'
import BorderGlow from './BorderGlow'
import GradualBlur from './GradualBlur'
import wave04 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_04.png'
import wave05 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_05.png'
import wave06 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_06.png'
import wave07 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_07.png'
import wave08 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_08.png'
import wave09 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_09.png'

const CompanyPrompt = lazy(() => import('./CompanyPrompt').then(module => ({ default: module.CompanyPrompt })))

function LazyCardImage({ src }: { src: string }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setShouldLoad(true)
      observer.disconnect()
    }, { rootMargin: '250px' })
    observer.observe(image)
    return () => observer.disconnect()
  }, [])

  return <img
    ref={imageRef}
    className="bo-bento__card-image"
    src={shouldLoad ? src : undefined}
    alt=""
    loading="lazy"
    decoding="async"
    fetchPriority="low"
  />
}

const trustedLogoPlaceholders = [
  { node: <span className="bo-home__logo-placeholder">logo here</span>, title: 'Logo placeholder' },
  { node: <span className="bo-home__logo-placeholder">logo here</span>, title: 'Logo placeholder' },
  { node: <span className="bo-home__logo-placeholder">logo here</span>, title: 'Logo placeholder' },
  { node: <span className="bo-home__logo-placeholder">logo here</span>, title: 'Logo placeholder' },
]

const howItWorksGlow = {
  edgeSensitivity: 30,
  glowColor: '40 80 80',
  backgroundColor: '#120F17',
  borderRadius: 28,
  glowRadius: 40,
  glowIntensity: 1.0,
  coneSpread: 25,
  animated: false,
  colors: ['#c084fc', '#f472b6', '#38bdf8'],
}

/**
 * Wesify's home page, signed in or not.
 *
 * There used to be two of these: a landing page at `/` that argued for Wesify, and this page behind the
 * account. They had converged on the same thing — a sentence and the box to answer it in — so the
 * landing page is gone and this is what `/` serves.
 *
 * That makes the front door and the workbench the same door, which is the honest arrangement for a
 * product whose entire pitch is the thing it builds from one sentence. A stranger can read all of it
 * and scroll all of it; what needs an account is starting something, so "Get started" is where the
 * asking happens.
 *
 * What follows below the fold is not the landing page come back. It answers the one question the
 * prompt itself cannot — "and then what happens?" — by showing it. Every card carries a picture of
 * Wesify's own interface rather than an icon standing in for an idea, because a picture of the product
 * is the only illustration that cannot promise something the product does not do.
 */

export function Home({ initialValue = '', onSubmit, signedIn = false, accounts = false, onSignIn }: {
  initialValue?: string
  onSubmit: (brief: string) => void
  signedIn?: boolean
  accounts?: boolean
  onSignIn?: () => void
}) {
  const explain = useRef<HTMLElement>(null)
  const modelWarmStarted = useRef(false)
  const promptCloseTimer = useRef<number | undefined>(undefined)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptClosing, setPromptClosing] = useState(false)

  useEffect(() => () => {
    if (promptCloseTimer.current !== undefined) window.clearTimeout(promptCloseTimer.current)
  }, [])

  /**
   * The front door, and where it leads depends on whether Wesify knows who is knocking.
   *
   * Signed in, it opens the box: describe the company, and building starts. Signed out, it asks who
   * they are first. The box used to open for everybody and the account was asked for at the moment
   * they pressed build — which reads well and cost people their sentence at the worst moment, one
   * keystroke from the thing they came to see.
   *
   * Below the fold is untouched by this. The page still argues for Wesify to anybody who scrolls; it is
   * only the one button that starts something which now needs an account behind it.
   */
  const getStarted = () => {
    if (accounts && !signedIn) {
      onSignIn?.()
      return
    }
    setPromptClosing(false)
    setPromptOpen(true)
    if (modelWarmStarted.current) return
    modelWarmStarted.current = true
    void prepareBusinessDiscoveryModel().catch(() => undefined)
  }

  const closePrompt = () => {
    if (promptClosing) return
    setPromptClosing(true)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    promptCloseTimer.current = window.setTimeout(() => {
      setPromptOpen(false)
      setPromptClosing(false)
      promptCloseTimer.current = undefined
    }, reduceMotion ? 0 : 240)
  }

  return <main className="bo-home">
    <div className="bo-home__hero">
      <div className="bo-home__molten" aria-hidden="true">
        <div className="bo-home__molten-frame">
          <MoltenMetal
            color1="#ffffff"
            color2="#ffffff"
            color3="#ffffff"
            colorMode="frost"
            speed={0.1}
            scale={5}
            detail={7}
            glow={2}
            coreSize={0.08}
            swirl={1}
            fold={-0.2}
            blackPoint={0}
            brightness={1.3}
            opacity={1}
            grain
            grainIntensity={0}
            mouseInteraction
            mouseStrength={0.1}
          />
        </div>
      </div>
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
      <section className="bo-home__center">
        {/**
         * Counted, not claimed.
         *
         * The number is `capabilityIds.length` rather than a figure typed into the markup, so it is
         * whatever the catalog actually holds on the day somebody reads it and cannot drift into
         * being a lie the next time a capability is added or removed.
         */}
        <h1>
          <span>Say what you are managing.</span>

          <span>I'll build the system around it.</span>
        </h1>
        <div className="bo-home__interaction">
          {!promptOpen && <div className="bo-home__actions">
            <div className="bo-home__get-started-wrap">
              <GlassSurface
                displace={15}
                distortionScale={-150}
                redOffset={5}
                greenOffset={15}
                blueOffset={25}
                brightness={60}
                opacity={0.8}
                mixBlendMode="screen"
              >
                <button type="button" className="bo-home__get-started" onClick={getStarted} data-testid="get-started">
                  Get started <ArrowRight size={17}/>
                </button>
              </GlassSurface>
            </div>
            <button type="button" className="bo-home__learn-more" onClick={() => explain.current?.scrollIntoView({ behavior: 'smooth' })} data-testid="learn-more">
              Learn more <ChevronDown size={17}/>
            </button>
          </div>}
          {promptOpen && <div className={`bo-home__prompt-stage${promptClosing ? ' is-closing' : ''}`} data-testid="prompt-stage">
            <div className="bo-home__prompt-shell">
              <button type="button" className="bo-home__prompt-back" onClick={closePrompt} aria-label="Back to start" data-testid="close-prompt">
                <ArrowLeft size={14}/>
              </button>
              <Suspense fallback={<div className="bo-home__prompt-loading" aria-hidden="true"/>}>
                <CompanyPrompt initialValue={initialValue} onSubmit={onSubmit} testId="company-brief"/>
              </Suspense>
            </div>
          </div>}
        </div>
      </section>
      {/* Where a company with customers would put their logos. Wesify has none yet, and a row of
          borrowed or invented marks is the one thing on a landing page that cannot be walked back —
          so this carries what is true instead: the trades Wesify knows before the first question. */}
      <GradualBlur
        target="parent"
        position="bottom"
        height="6rem"
        strength={2}
        divCount={5}
        curve="bezier"
        exponential={true}
        opacity={1}
      />
    </div>

    <section className="bo-home__trusted">
      <h2>Trusted by...</h2>
      <div className="bo-home__logo-loop">
        <LogoLoop
          logos={trustedLogoPlaceholders}
          speed={120}
          direction="left"
          logoHeight={48}
          gap={40}
          hoverSpeed={0}
          scaleOnHover
          fadeOut
          fadeOutColor="var(--bg)"
          ariaLabel="Trusted companies"
        />
      </div>
    </section>

    <section className="bo-home__explain" ref={explain}>
      <div className="bo-home__explain-intro">
        <small>HOW IT WORKS</small>
        <h2>From one sentence to a working system</h2>
      </div>

      <div className="bo-bento">
        <BorderGlow {...howItWorksGlow} className="bo-bento__card bo-bento__card--wide">
          <LazyCardImage src={wave04}/>
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
        </BorderGlow>

        <BorderGlow {...howItWorksGlow} className="bo-bento__card">
          <LazyCardImage src={wave05}/>
          <h3>It only asks what it cannot work out</h3>
          <div className="bo-shot bo-shot--interview" aria-hidden="true">
            <div className="bo-shot__frame">
              <div className="bo-shot__turn bo-shot__turn--bo">Do you sell direct to shoppers, or to shops and restaurants?</div>
              <div className="bo-shot__turn bo-shot__turn--you">To shops and restaurants, and we keep stock in Madrid.</div>
              <div className="bo-shot__turn bo-shot__turn--bo bo-shot__turn--asking">How do the shops pay you?</div>
              <div className="bo-shot__meta"><span>Question 4</span><i/><span>62% understood</span></div>
            </div>
          </div>
        </BorderGlow>

        <BorderGlow {...howItWorksGlow} className="bo-bento__card">
          <LazyCardImage src={wave06}/>
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
        </BorderGlow>

        <BorderGlow {...howItWorksGlow} className="bo-bento__card">
          <LazyCardImage src={wave07}/>
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
        </BorderGlow>

        <BorderGlow {...howItWorksGlow} className="bo-bento__card">
          <LazyCardImage src={wave08}/>
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
        </BorderGlow>

        <BorderGlow {...howItWorksGlow} className="bo-bento__card bo-bento__card--full">
          <LazyCardImage src={wave09}/>
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
        </BorderGlow>
      </div>
    </section>
    <footer className="bo-home__footer">
      <div className="bo-home__footer-aurora" aria-hidden="true">
        <Aurora
          colorStops={['#a0a0a0', '#ffffff', '#777777']}
          blend={0.5}
          amplitude={1.0}
          speed={0.5}
        />
      </div>
      <div className="bo-home__footer-content">
        <Brand />
        <small>&copy; {new Date().getFullYear()} Wesify</small>
      </div>
    </footer>
  </main>
}
