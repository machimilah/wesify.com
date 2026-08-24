import { useEffect } from 'react'
import { prepareBusinessDiscoveryModel } from '../engine/discoveryModel'
import { Brand } from './Brand'
import { CompanyPrompt } from './CompanyPrompt'
import { ThemeToggle } from './ThemeToggle'

/**
 * BO's home page, signed in or not.
 *
 * There used to be two of these: a landing page at `/` that argued for BO, and this page behind the
 * account. They had converged on the same thing — a sentence and the box to answer it in — so the
 * landing page is gone and this is what `/` serves.
 *
 * That makes the front door and the workbench the same door, which is the honest arrangement for a
 * product whose entire pitch is the thing it builds from one sentence. A stranger types; BO asks who
 * they are afterwards, at the moment there is something worth signing in for.
 */
export function Home({ initialValue = '', onSubmit, signedIn = false, accounts = false, onSignIn }: {
  initialValue?: string
  onSubmit: (brief: string) => void
  signedIn?: boolean
  accounts?: boolean
  onSignIn?: () => void
}) {
  /**
   * Only warmed up for somebody who is already in.
   *
   * The in-browser model is a large download, and starting it for every stranger who lands spends
   * their bandwidth before they have asked BO for anything. With no accounts configured there are no
   * strangers — BO is a single-browser prototype — so it warms up then too.
   */
  useEffect(() => {
    if (accounts && !signedIn) return
    void prepareBusinessDiscoveryModel().catch(() => undefined)
  }, [accounts, signedIn])

  return <main className="bo-home">
    <video
      className="bo-home__background"
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
    >
      <source src={new URL('../../wavesblack.mp4', import.meta.url).href} type="video/mp4" />
    </video>
    <div className="bo-home__scrim" aria-hidden="true" />
    <header>
      <Brand />
      <ThemeToggle className="bo-home__theme-toggle"/>
      {/* Only where it means something: with no accounts there is nothing to sign in to, and
          somebody already signed in does not need to be offered it. */}
      {accounts && !signedIn && <button type="button" className="bo-home__signin" onClick={onSignIn} data-testid="open-signin">Sign in</button>}
    </header>
    <section className="bo-home__center">
      <h1>Build your company</h1>
      <p>Tell me how your business works. I’ll build the system you need to run it.</p>
      <CompanyPrompt initialValue={initialValue} onSubmit={onSubmit} testId="company-brief"/>
    </section>
  </main>
}
