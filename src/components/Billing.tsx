import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Minus } from 'lucide-react'
import { billingPortal, billingState, startCheckout, type BillingState, type Plan } from '../engine/billingClient'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/**
 * What this account is on, and how to be on something else.
 *
 * Every number on this page comes from the server. Prices and caps written down in the interface as
 * well would eventually disagree with the ones being enforced, and the operator would be told one
 * thing and refused another.
 *
 * There is no card form here and never will be: checkout is Stripe's own hosted page, so a card
 * number never reaches BO and cannot leak from it.
 */
function limitLine(plan: Plan) {
  return [
    plan.limits.records === null ? 'Unlimited records' : `${plan.limits.records} records`,
    `${plan.limits.workspaces} workspace${plan.limits.workspaces === 1 ? '' : 's'}`,
    plan.limits.rebuildsPerMonth === 0 ? 'No rebuilds' : `${plan.limits.rebuildsPerMonth} rebuilds a month`,
  ]
}

export function Billing({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<BillingState | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState('')

  // Stripe sends the operator back here after checkout. The subscription itself arrives by webhook,
  // which may land a moment after the redirect, so the page says what happened and re-reads.
  const outcome = new URLSearchParams(window.location.search).get('checkout')

  useEffect(() => {
    let cancelled = false
    const load = () => billingState().then(next => { if (!cancelled) setState(next) }).catch(reason => { if (!cancelled) setError(reason.message) })
    void load()
    // One re-read shortly after returning from checkout, for the case where the webhook has not
    // landed yet. Not a poll: if it is still not there, the page is honest about that instead.
    const timer = outcome === 'done' ? setTimeout(load, 2500) : undefined
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [outcome])

  const go = async (action: () => Promise<string>, label: string) => {
    setWorking(label); setError('')
    try { window.location.href = await action() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'BO could not open the payment page.'); setWorking('') }
  }

  return <main className="bo-billing">
    <header>
      <button type="button" className="bo-billing__back" onClick={onBack} data-testid="billing-back"><ArrowLeft size={15}/> Back</button>
      <Brand/>
      <ThemeToggle/>
    </header>

    {outcome === 'done' && <p className="bo-billing__notice" role="status" data-testid="billing-checkout-done">Payment received. Your new plan appears here as soon as Stripe confirms it.</p>}
    {outcome === 'cancelled' && <p className="bo-billing__notice" role="status">Checkout cancelled. Nothing was charged.</p>}
    {error && <p className="bo-signin-error" role="alert" data-testid="billing-error">{error}</p>}

    {!state ? <p className="bo-billing__loading">Loading…</p> : <>
      <section className="bo-billing__current" data-testid="billing-current">
        <small>Your plan</small>
        <h1>{state.planName}</h1>
        <p>
          {state.limits.records === null ? 'Unlimited records' : `Up to ${state.limits.records} records`}
          {typeof state.workspaces === 'number' && ` · ${state.workspaces} of ${state.limits.workspaces} workspace${state.limits.workspaces === 1 ? '' : 's'} used`}
          {state.limits.rebuildsPerMonth > 0 && ` · ${state.rebuildsUsedThisMonth ?? 0} of ${state.limits.rebuildsPerMonth} rebuilds used this month`}
        </p>
        {state.status === 'past_due' && <p className="bo-billing__warning" data-testid="billing-past-due">Your last payment did not go through. Stripe will try again — update your card to keep your plan.</p>}
        {state.plan !== 'free' && <button type="button" onClick={() => void go(billingPortal, 'portal')} disabled={Boolean(working)} data-testid="billing-portal">
          {working === 'portal' ? 'One moment…' : 'Manage subscription'}
        </button>}
      </section>

      {!state.billingAvailable && <p className="bo-billing__notice" data-testid="billing-unavailable">This BO has no payment provider configured, so every account is on the free plan.</p>}

      <section className="bo-billing__plans">
        {state.plans.map(plan => <article key={plan.id} className={plan.id === state.plan ? 'is-current' : ''} data-testid={`billing-plan-${plan.id}`}>
          <h2>{plan.name}</h2>
          <strong>{plan.priceUsd === 0 ? 'Free' : `$${plan.priceUsd}`}<em>{plan.priceUsd === 0 ? ' forever' : ' / month'}</em></strong>
          <p>{plan.summary}</p>
          <ul>
            {limitLine(plan).map(line => <li key={line}><Check size={13}/> {line}</li>)}
            <li>{plan.limits.connectedApps ? <Check size={13}/> : <Minus size={13}/>} Connected apps</li>
            <li>{plan.limits.teamMembers ? <Check size={13}/> : <Minus size={13}/>} Team members</li>
          </ul>
          {plan.id === state.plan
            ? <span className="bo-billing__on" data-testid={`billing-on-${plan.id}`}>Your plan</span>
            : plan.priceUsd > 0 && state.billingAvailable
              ? <button type="button" onClick={() => void go(() => startCheckout(plan.id), plan.id)} disabled={Boolean(working)} data-testid={`billing-choose-${plan.id}`}>
                  {working === plan.id ? 'Opening Stripe…' : `Choose ${plan.name}`}
                </button>
              : <span className="bo-billing__on">&nbsp;</span>}
        </article>)}
      </section>

      <p className="bo-billing__footnote">
        Nothing is ever deleted for non-payment. If a plan lapses, everything you have stays readable and exportable — you simply stop adding to it until you are back on a plan that covers it.
      </p>
    </>}
  </main>
}
