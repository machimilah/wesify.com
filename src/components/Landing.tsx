import {
  ArrowRight, BadgeCheck, Boxes, CalendarDays, Check, CircleDollarSign, FolderKanban, HardHat,
  Link2, MessageSquare, Receipt, RefreshCw, Sparkles, TrendingUp, Users, Wrench,
} from 'lucide-react'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * The page someone lands on before they have an account.
 *
 * It has one job: make an operator believe BO will give them something narrower than the suite they
 * already refused to buy. The first version argued that in prose on a dark page, which is the least
 * convincing way to make a claim about restraint. This one shows the thing instead — a real-looking
 * workspace in the hero, and the actual output for six kinds of company further down.
 *
 * Every number here comes from BO's own planner and is asserted in `workspaceDifference.test.ts`, so
 * a planner that drifts fails a test rather than quietly turning this page into a lie.
 */

/** The launcher tiles in the hero, with the same faces and tints the real Command Center uses. */
const mockTiles = [
  { label: 'Work orders', icon: HardHat, tint: 'amber' },
  { label: 'Clients', icon: Users, tint: 'sky' },
  { label: 'Schedule', icon: CalendarDays, tint: 'amber' },
  { label: 'Invoices', icon: Receipt, tint: 'green' },
  { label: 'Parts', icon: Boxes, tint: 'olive' },
  { label: 'Team', icon: Users, tint: 'violet' },
]

const stats = [
  { value: '1,923', label: 'kinds of business BO recognises' },
  { value: '120', label: 'business systems it can build from' },
  { value: '25', label: 'operating models behind them' },
  { value: 'Zero', label: 'modules you have to switch off' },
]

const steps = [
  {
    icon: MessageSquare, tint: 'sky', number: '01',
    title: 'Describe your company',
    body: 'One sentence, in your own words. “We run a plumbing business, technicians visit homes, customers pay on completion.”',
  },
  {
    icon: Sparkles, tint: 'violet', number: '02',
    title: 'BO interviews you',
    body: 'Four or five questions, and only ones that change the result. It already knows what a plumbing company is, so it asks whether your vans carry stock — not what you sell.',
  },
  {
    icon: Check, tint: 'green', number: '03',
    title: 'Your Command Center is built',
    body: 'Records, pages, workflows and reports for how you actually operate. Nothing else. Change anything by asking.',
  },
]

const examples = [
  { company: 'Plumbing business', pages: 12, tint: 'amber', icon: Wrench, gets: ['Work orders', 'Schedule', 'Clients', 'Parts', 'Invoices'] },
  { company: 'Marketing agency', pages: 15, tint: 'indigo', icon: FolderKanban, gets: ['Clients', 'Projects', 'Retainers', 'Timesheets', 'Documents'] },
  { company: 'Restaurant', pages: 13, tint: 'rose', icon: CircleDollarSign, gets: ['Point of sale', 'Reservations', 'Shifts', 'Suppliers', 'Stock'] },
  { company: 'B2B SaaS', pages: 15, tint: 'teal', icon: RefreshCw, gets: ['Subscriptions', 'Pipeline', 'Customer success', 'Support', 'Invoices'] },
  { company: 'Manufacturer', pages: 18, tint: 'olive', icon: Boxes, gets: ['Production', 'Bills of materials', 'Warehouses', 'Quality', 'Orders'] },
  { company: 'Solo consultant', pages: 12, tint: 'sky', icon: BadgeCheck, gets: ['Clients', 'Projects', 'Contracts', 'Invoices', 'Expenses'] },
]

const differences = [
  {
    icon: Check, tint: 'green',
    title: 'Only what you run on',
    body: 'A business suite ships forty modules and asks you to switch off the thirty you will never open. BO builds the ten you need and leaves the rest out of the product entirely.',
  },
  {
    icon: TrendingUp, tint: 'indigo',
    title: 'It learns from your industry',
    body: 'When enough companies like yours remove a system, BO stops building it for the next one. Not an opinion held by us — what real companies actually kept. Counts only, never your data.',
  },
  {
    icon: Link2, tint: 'teal',
    title: 'It shows the apps you already use',
    body: 'BO does not replace your payment processor or your accountant. It connects to them and puts everything on one screen. Read-only, so nothing of yours can be changed by mistake.',
  },
]

export function Landing({ onStart, signedIn }: { onStart: () => void; signedIn: boolean }) {
  const cta = signedIn ? 'Open BO' : 'Get started for free'
  return <main className="bo-landing">
    <nav>
      <Brand/>
      <div>
        <a href="#how">How it works</a>
        <a href="#examples">What you get</a>
      </div>
      <ThemeToggle/>
      <button onClick={onStart} data-testid="landing-nav-start">{signedIn ? 'Open BO' : 'Sign in'}</button>
    </nav>

    <header className="bo-landing-hero">
      <span className="bo-landing-eyebrow"><Sparkles size={13}/> Business Command Center</span>
      <h1>Describe your company.<br/><i>Get the software to run it.</i></h1>
      <p>BO asks how your business actually works, then builds the administration platform for it — your records, your workflows, your language. Not a suite you have to cut down.</p>
      <div className="bo-landing-actions">
        <button className="bo-landing-cta" onClick={onStart} data-testid="landing-get-started">{cta} <ArrowRight size={17}/></button>
        <span>No credit card. Your workspace is built before you pay for anything.</span>
      </div>

      {/* The product, not a description of it. Built in markup so it cannot go stale as a screenshot would. */}
      <div className="bo-landing-shot" aria-hidden="true">
        <div className="bo-landing-shot__prompt"><Sparkles size={15}/><em>We run a plumbing business. Technicians visit homes and customers pay on completion.</em></div>
        <div className="bo-landing-shot__window">
          <aside>
            <b><i/><i/><i/></b>
            {['Home', 'Work orders', 'Clients', 'Schedule', 'Invoices', 'Parts', 'Team'].map((item, index) => (
              <span key={item} className={index === 0 ? 'active' : ''}>{item}</span>
            ))}
          </aside>
          {/* A div, not a <section>: this is a visual panel inside a mockup, not a page section, and
              the global `.bo-landing section` rule (max-width, centering) would otherwise apply to
              it too and squeeze it to its content width inside the grid track. */}
          <div className="bo-landing-shot__panel">
            <h4>Plumbing Command Center</h4>
            <div className="bo-landing-shot__tiles">
              {mockTiles.map(tile => {
                const Icon = tile.icon
                return <article key={tile.label} className={`tint-${tile.tint}`}>
                  <span><Icon size={19} strokeWidth={1.7}/></span>
                  <strong>{tile.label}</strong>
                </article>
              })}
            </div>
          </div>
        </div>
      </div>
    </header>

    <section className="bo-landing-stats">
      {stats.map(stat => <article key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></article>)}
    </section>

    <section className="bo-landing-steps" id="how">
      <h2>Three steps, about a minute</h2>
      <div>
        {steps.map(step => {
          const Icon = step.icon
          return <article key={step.title}>
            <span className={`tint-${step.tint}`}><Icon size={19}/></span>
            <b>{step.number}</b>
            <strong>{step.title}</strong>
            <p>{step.body}</p>
          </article>
        })}
      </div>
    </section>

    <section className="bo-landing-examples" id="examples" data-testid="landing-examples">
      <h2>Six companies, six different systems</h2>
      <p className="bo-landing-lede">This is what BO's planner produces today — not a mock-up. No two of these workspaces are the same.</p>
      <div>
        {examples.map(example => {
          const Icon = example.icon
          return <article key={example.company}>
            <header>
              <span className={`tint-${example.tint}`}><Icon size={17}/></span>
              <strong>{example.company}</strong>
              <em>{example.pages} pages</em>
            </header>
            <ul>{example.gets.map(page => <li key={page}><Check size={12}/>{page}</li>)}</ul>
          </article>
        })}
      </div>
    </section>

    <section className="bo-landing-difference">
      <h2>Why it is not another suite</h2>
      <div>
        {differences.map(item => {
          const Icon = item.icon
          return <article key={item.title}>
            <span className={`tint-${item.tint}`}><Icon size={19}/></span>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        })}
      </div>
    </section>

    <section className="bo-landing-close">
      <h2>It takes one sentence to find out.</h2>
      <p>Describe your company and watch the workspace build itself. If it is wrong, tell BO and it changes.</p>
      <button className="bo-landing-cta" onClick={onStart} data-testid="landing-get-started-footer">{cta} <ArrowRight size={17}/></button>
    </section>

    <footer>
      <Brand/>
      <span>BO is in alpha. It builds real workspaces and stores real records; treat it as software still being finished.</span>
    </footer>
  </main>
}
