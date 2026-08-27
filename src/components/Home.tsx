import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowUp, Lock } from 'lucide-react'
import { loadSelectedTools, saveSelectedTools } from '../engine/toolSelection'
import Aurora from './Aurora'
import { Brand } from './Brand'
import BorderGlow from './BorderGlow'
import LogoLoop from './LogoLoop'
import { ThemeToggle } from './ThemeToggle'
import wave04 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_04.png'
import wave05 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_05.png'
import wave06 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_06.png'
import wave07 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_07.png'
import wave08 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_08.png'
import wave09 from '../../metallic_wave_webpage_images/varied_positions_and_angles/wave_09.png'
import './Home.css'

const CompanyPrompt = lazy(() => import('./CompanyPrompt').then(module => ({ default: module.CompanyPrompt })))
const LightPillar = lazy(() => import('./LightPillar').then(module => ({ default: module.LightPillar })))

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

const trustedTeams = [
  { node: <span className="bo-home__trusted-team">Professional services</span>, title: 'Professional services teams' },
  { node: <span className="bo-home__trusted-team">Field operations</span>, title: 'Field operations teams' },
  { node: <span className="bo-home__trusted-team">Distribution</span>, title: 'Distribution teams' },
  { node: <span className="bo-home__trusted-team">Commerce</span>, title: 'Commerce teams' },
  { node: <span className="bo-home__trusted-team">Project businesses</span>, title: 'Project-based businesses' },
  { node: <span className="bo-home__trusted-team">Agencies</span>, title: 'Agency teams' },
]

const howItWorksGlow = {
  edgeSensitivity: 30,
  glowColor: '40 80 80',
  backgroundColor: '#120F17',
  borderRadius: 28,
  glowRadius: 40,
  glowIntensity: 1,
  coneSpread: 25,
  animated: false,
  colors: ['#c084fc', '#f472b6', '#38bdf8'],
}

export function Home({ initialValue = '', onSubmit }: {
  initialValue?: string
  onSubmit: (brief: string) => void
}) {
  const [selectedTools, setSelectedTools] = useState(() => loadSelectedTools(initialValue))

  useEffect(() => saveSelectedTools(selectedTools), [selectedTools])

  return <main className="wes-home" data-testid="public-home">
    <div className="wes-home__hero">
      {/* One shaft of warm light across a near-black hero, leaning towards whoever is pointing at
          it. The page's own dark ground shows through everywhere the beam is not. */}
      <div className="wes-home__visual" aria-hidden="true">
        <Suspense fallback={<div className="wes-home__visual-loading"/>}>
          <LightPillar
            topColor="#ffca55"
            bottomColor="#ffffff"
            intensity={0.8}
            rotationSpeed={0.1}
            glowAmount={0.005}
            pillarWidth={2.2}
            pillarHeight={0.3}
            noiseIntensity={0.5}
            pillarRotation={22}
            interactive
            mixBlendMode="normal"
          />
        </Suspense>
      </div>
      <div className="wes-home__veil" aria-hidden="true"/>

      <header className="wes-home__header">
        <Brand inverse/>
      </header>

      <section className="wes-home__content" aria-labelledby="wes-home-title">
        <h1 id="wes-home-title">Build the operating system for your business.</h1>
        <p>Describe how your company works. Wesify turns it into connected CRM, ERP, workflows, finance, people, permissions, and reporting.</p>
        <div className="wes-prompt-shell wes-prompt-dark">
          <Suspense fallback={<div className="wes-prompt-shell__loading" aria-busy="true"/>}>
            <CompanyPrompt
              initialValue={initialValue}
              onSubmit={onSubmit}
              testId="company-brief"
              selectedTools={selectedTools}
              onToolsChange={setSelectedTools}
            />
          </Suspense>
        </div>
      </section>
    </div>

    <section className="bo-home__trusted" data-testid="trusted-section">
      <h2>Trusted by teams across</h2>
      <div className="bo-home__logo-loop">
        <LogoLoop
          logos={trustedTeams}
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

    <section className="bo-home__explain" data-testid="how-it-works">
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
                <p>We distribute specialty food to shops and restaurants.<i/></p>
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

        <BorderGlow {...howItWorksGlow} className="bo-bento__card bo-bento__card--full bo-bento__card--suite">
          <LazyCardImage src={wave09}/>
          <h3>One connected business suite</h3>
          <p className="bo-suite-card__summary">CRM, sales, projects, inventory, invoicing, accounting, people, automation, permissions, and reporting share one operating model built around your company.</p>
          <div className="bo-suite-card__domains" aria-hidden="true">
            <span>CRM</span><span>Sales</span><span>Projects</span><span>Inventory</span><span>Finance</span><span>People</span><span>Automation</span><span>Reporting</span>
          </div>
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
                  <div><small>Unpaid invoices</small><strong>EUR 12,480</strong></div>
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
          amplitude={1}
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
