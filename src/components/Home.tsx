import { useEffect } from 'react'
import { prepareBusinessDiscoveryModel } from '../engine/discoveryModel'
import { Brand } from './Brand'
import { CompanyPrompt } from './CompanyPrompt'
import { ThemeToggle } from './ThemeToggle'

/**
 * Where a signed-in operator starts a new company.
 *
 * The same prompt as the public page, because it is the same act. What is different here is only
 * what surrounds it: someone on this page already has an account, so the page can say "build your
 * company" rather than explain what BO is.
 */
export function Home({ initialValue = '', onSubmit }: { initialValue?: string; onSubmit: (brief: string) => void }) {
  // Only on this side of the gate. The browser model is a large download, and starting it for every
  // stranger who lands on the public page would spend their bandwidth before they asked for anything.
  useEffect(() => { void prepareBusinessDiscoveryModel().catch(() => undefined) }, [])

  return <main className="bo-home">
    <header><Brand /><ThemeToggle className="bo-home__theme-toggle"/></header>
    <section className="bo-home__center">
      <h1>Build your company</h1>
      <p>Tell me how your business works. I’ll build the system you need to run it.</p>
      <CompanyPrompt initialValue={initialValue} onSubmit={onSubmit} testId="company-brief"/>
    </section>
  </main>
}
