import { ArrowRight } from 'lucide-react'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * The page someone lands on before they have an account.
 *
 * One sentence and one button. The previous version argued the case across six sections — a hero
 * mockup, a stats row, three steps, six example companies, three reasons — and every one of them was
 * a claim asking to be believed by someone who had not yet seen anything. BO's actual argument is the
 * workspace it builds in about a minute, which no landing page can make on its behalf.
 *
 * So this page stops trying. It says what BO does in one line and gets out of the way. Everything it
 * used to assert is still true and still tested — `workspaceDifference.test.ts` proves different
 * companies really do get different Command Centers — it simply is not argued here any more.
 */
export function Landing({ onStart, signedIn }: { onStart: () => void; signedIn: boolean }) {
  return <main className="bo-landing">
    <nav>
      <Brand/>
      <ThemeToggle/>
      <button onClick={onStart} data-testid="landing-nav-start">{signedIn ? 'Open BO' : 'Sign in'}</button>
    </nav>

    <h1>Describe your company.<br/><i>Get the software to run it.</i></h1>

    <button className="bo-landing-cta" onClick={onStart} data-testid="landing-get-started">
      {signedIn ? 'Open BO' : 'Start'} <ArrowRight size={17}/>
    </button>
  </main>
}
