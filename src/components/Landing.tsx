import { ArrowRight, Check, Link2, MessageSquare, Sparkles, TrendingUp } from 'lucide-react'
import { Brand } from './Brand'

/**
 * The page someone lands on before they have an account.
 *
 * It has one job: make the operator believe BO will give them something narrower than the suite they
 * already refused to buy. That is a claim about restraint, and restraint is hard to show with
 * adjectives — so the page shows the actual output for six kinds of company instead of describing it.
 * Every number here comes from BO's own planner and is checked by a test, because a landing page that
 * drifts from the product is how a product starts lying about itself.
 */

const steps = [
  {
    icon: MessageSquare,
    title: 'Describe your company',
    body: 'One sentence, in your own words. “We run a plumbing business, technicians visit homes, customers pay on completion.”',
  },
  {
    icon: Sparkles,
    title: 'BO interviews you',
    body: 'Four or five questions, and only ones that change the result. It already knows what a plumbing company is, so it asks whether your vans carry stock — not what you sell.',
  },
  {
    icon: Check,
    title: 'Your Command Center is built',
    body: 'Records, pages, workflows and reports for how you actually operate. Nothing else. Change anything by asking.',
  },
]

/** From `workspaceDifference.test.ts`, which fails if the planner stops producing these. */
const examples = [
  { company: 'Plumbing business', pages: 12, gets: ['Work orders', 'Schedule', 'Clients', 'Parts', 'Invoices'] },
  { company: 'Marketing agency', pages: 15, gets: ['Clients', 'Projects', 'Retainers', 'Timesheets', 'Documents'] },
  { company: 'Restaurant', pages: 13, gets: ['Point of sale', 'Reservations', 'Shifts', 'Suppliers', 'Stock'] },
  { company: 'B2B SaaS', pages: 15, gets: ['Subscriptions', 'Pipeline', 'Customer success', 'Support', 'Invoices'] },
  { company: 'Manufacturer', pages: 18, gets: ['Production', 'Bills of materials', 'Warehouses', 'Quality', 'Orders'] },
  { company: 'Solo consultant', pages: 12, gets: ['Clients', 'Projects', 'Contracts', 'Invoices', 'Expenses'] },
]

const differences = [
  {
    icon: Check,
    title: 'Only what you run on',
    body: 'A business suite ships forty modules and asks you to switch off the thirty you will never open. BO builds the ten you need and leaves the rest out of the product entirely.',
  },
  {
    icon: TrendingUp,
    title: 'It learns from your industry',
    body: 'When enough companies like yours remove a system, BO stops building it for the next one. Not an opinion held by us — what real companies actually kept. Counts only, never your data.',
  },
  {
    icon: Link2,
    title: 'It shows the apps you already use',
    body: 'BO does not replace your payment processor or your accountant. It connects to them and puts everything on one screen. Read-only, so nothing of yours can be changed by mistake.',
  },
]

export function Landing({ onStart, signedIn }: { onStart: () => void; signedIn: boolean }) {
  const cta = signedIn ? 'Open BO' : 'Get started for free'
  return <main className="bo-landing">
    <header>
      <Brand/>
      <button onClick={onStart} data-testid="landing-nav-start">{signedIn ? 'Open BO' : 'Sign in'}</button>
    </header>

    <section className="bo-landing-hero">
      <small>BUSINESS COMMAND CENTER</small>
      <h1>Describe your company.<br/>Get the software to run it.</h1>
      <p>BO asks how your business actually works, then builds the administration platform for it — your records, your workflows, your language. Not a suite you have to cut down.</p>
      <button className="bo-landing-cta" onClick={onStart} data-testid="landing-get-started">{cta} <ArrowRight size={17}/></button>
      <em>No credit card. Your workspace is built before you pay for anything.</em>
    </section>

    <section className="bo-landing-steps">
      {steps.map((step, index) => {
        const Icon = step.icon
        return <article key={step.title}>
          <span><Icon size={18}/></span>
          <b>{index + 1}</b>
          <strong>{step.title}</strong>
          <p>{step.body}</p>
        </article>
      })}
    </section>

    <section className="bo-landing-examples" data-testid="landing-examples">
      <h2>Six companies, six different systems</h2>
      <p>This is what BO's planner actually produces today. No two of these workspaces are the same.</p>
      <div>
        {examples.map(example => <article key={example.company}>
          <header><strong>{example.company}</strong><span>{example.pages} pages</span></header>
          <ul>{example.gets.map(page => <li key={page}><Check size={11}/>{page}</li>)}</ul>
        </article>)}
      </div>
    </section>

    <section className="bo-landing-difference">
      {differences.map(item => {
        const Icon = item.icon
        return <article key={item.title}>
          <span><Icon size={17}/></span>
          <strong>{item.title}</strong>
          <p>{item.body}</p>
        </article>
      })}
    </section>

    <section className="bo-landing-close">
      <h2>It takes one sentence to find out.</h2>
      <button className="bo-landing-cta" onClick={onStart} data-testid="landing-get-started-footer">{cta} <ArrowRight size={17}/></button>
    </section>

    <footer>
      <Brand/>
      <span>BO is in alpha. It builds real workspaces and stores real records; treat it as software still being finished.</span>
    </footer>
  </main>
}
