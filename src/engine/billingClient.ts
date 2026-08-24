import { sessionHeaders } from './authClient'

/**
 * The plan, in the browser.
 *
 * Every limit shown here comes from the server rather than being repeated in the interface. A price
 * or a cap written down twice is one that will eventually disagree with itself, and the copy that
 * decides what actually happens is the server's.
 */

export interface PlanLimits {
  workspaces: number
  /** Null means no limit. Infinity does not survive JSON, and a number here would be enforced. */
  records: number | null
  rebuildsPerMonth: number
  connectedApps: boolean
  teamMembers: boolean
}

export interface Plan {
  id: string
  name: string
  priceUsd: number
  summary: string
  limits: PlanLimits
}

export interface BillingState {
  plan: string
  planName: string
  status: string
  currentPeriodEnd: string | null
  limits: PlanLimits
  billingAvailable: boolean
  plans: Plan[]
  rebuildsUsedThisMonth?: number
  workspaces?: number
}

async function readOrThrow(response: Response) {
  const detail = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(detail.error || 'Wesify could not complete that.')
  return detail
}

export async function billingState(): Promise<BillingState> {
  return readOrThrow(await fetch('/api/billing', { headers: sessionHeaders() }))
}

/** Returns Stripe's hosted checkout URL. BO never sees a card number. */
export async function startCheckout(plan: string): Promise<string> {
  const result = await readOrThrow(await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify({ plan }),
  }))
  return result.url as string
}

/** Stripe's own portal for changing a card, switching plan, or cancelling. BO rebuilds none of it. */
export async function billingPortal(): Promise<string> {
  const result = await readOrThrow(await fetch('/api/billing/portal', { method: 'POST', headers: sessionHeaders() }))
  return result.url as string
}
