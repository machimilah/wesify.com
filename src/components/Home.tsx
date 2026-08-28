import { lazy, Suspense, useEffect, useState } from 'react'
import { loadSelectedTools, saveSelectedTools } from '../engine/toolSelection'
import Aurora from './Aurora'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'
import './Home.css'

const CompanyPrompt = lazy(() => import('./CompanyPrompt').then(module => ({ default: module.CompanyPrompt })))
const LightPillar = lazy(() => import('./LightPillar').then(module => ({ default: module.LightPillar })))

export function Home({ initialValue = '', onSubmit, accounts = false, signedIn = false, onSignIn }: {
  initialValue?: string
  onSubmit: (brief: string) => void
  /** Whether this deployment has accounts at all. False in the infrastructure-free test/dev mode. */
  accounts?: boolean
  signedIn?: boolean
  onSignIn?: () => void
}) {
  const [selectedTools, setSelectedTools] = useState(() => loadSelectedTools(initialValue))
  const [selectedStat, setSelectedStat] = useState(0)

  useEffect(() => saveSelectedTools(selectedTools), [selectedTools])

  /**
   * Whether a stranger has to sign up before they can describe their company here.
   *
   * Deployments with no accounts configured (accounts === false — the CI and local dev path, no
   * Clerk key set) never gate: there is nothing to sign up for, so the prompt is the whole page, as
   * it always was. Where accounts exist, a signed-out visitor gets the pitch and one button rather
   * than a text box asking them to describe their business before they have even agreed to use
   * Wesify — the box is what they land on the moment they are signed in.
   */
  const requiresSignIn = accounts && !signedIn

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
        <a href="#solutions" className="wes-home__nav-link">Solutions</a>
        <Brand inverse/>
        <a href="#pricing" className="wes-home__nav-link">Pricing</a>
        <ThemeToggle className="wes-home__theme-toggle"/>
      </header>

      <section className="wes-home__content" aria-labelledby="wes-home-title">
        <h1 id="wes-home-title">Don't pay for what you don't need</h1>
        <p>Describe how your company works. Wesify creates the workplace you need.</p>
        {requiresSignIn
          ? <button type="button" className="wes-home__get-started-button" onClick={onSignIn} data-testid="get-started">
              Get started for Free
            </button>
          : <div className="wes-prompt-shell wes-prompt-dark">
              <Suspense fallback={<div className="wes-prompt-shell__loading" aria-busy="true"/>}>
                <CompanyPrompt
                  initialValue={initialValue}
                  onSubmit={onSubmit}
                  testId="company-brief"
                  selectedTools={selectedTools}
                  onToolsChange={setSelectedTools}
                />
              </Suspense>
            </div>}
        <div style={{ marginTop: '80px', color: '#fff', fontSize: '18px' }}>This is an MVP :D</div>
      </section>
    </div>

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
