import { Brand } from './Brand'
import { CompanyPrompt } from './CompanyPrompt'
import { ThemeToggle } from './ThemeToggle'

/**
 * The page someone lands on before they have an account.
 *
 * The prompt is the page. BO's argument was never going to be made by a landing page describing what
 * BO does — it is made by the workspace BO builds out of one sentence — so the fastest thing this
 * page can do is take that sentence. A stranger types, and BO asks who they are afterwards, at the
 * moment there is something worth signing in for.
 *
 * Nothing here is behind the account: the box, the starters and the typing are all public. The
 * product still is not. `signin.test.mjs` tells the two apart by test id and proves it.
 */
export function Landing({ onStart, onSubmit, signedIn }: {
  onStart: () => void
  onSubmit: (brief: string) => void
  signedIn: boolean
}) {
  return <main className="bo-landing">
    <nav>
      <Brand/>
      <ThemeToggle/>
      <button onClick={onStart} data-testid="landing-nav-start">{signedIn ? 'Open BO' : 'Sign in'}</button>
    </nav>

    <section>
      <h1>Describe your company.<br/><i>Get the software to run it.</i></h1>
      <CompanyPrompt onSubmit={onSubmit} testId="landing-brief" starterTestId="landing-starter"/>
    </section>
  </main>
}
