import { describe, expect, it } from 'vitest'
import { emptyArchitecture, emptyBusinessState, architectureToBlueprint } from './businessDiscovery'
import { resilientArchitecture } from './discoveryModel'
import { generateWorkspaceConfigurationFromDiscovery } from './workspaceSchema'

/**
 * Do different companies actually get different Command Centers?
 *
 * This is the product's whole claim, and nothing else tests it. A planner regression that quietly
 * fell back to one generic base for everybody would pass every other suite in this repo while
 * destroying the reason Wesify exists. So: build several very different companies and compare.
 *
 * The shell is meant to be identical — Home, Today, Analytics, Links, Settings. Everything
 * between those is meant to differ.
 */

// The assistant left the rail: it is reachable from every page, so it is not a section any more.
const SHELL = ['home', 'today', 'analytics', 'links', 'settings']

function workspaceFor(summary: string, extra: Partial<ReturnType<typeof emptyBusinessState>> = {}) {
  const state = { ...emptyBusinessState(), companySummary: summary, industry: summary, ...extra }
  const architecture = resilientArchitecture(state, emptyArchitecture())
  return generateWorkspaceConfigurationFromDiscovery({ companyDescription: summary }, architectureToBlueprint(architecture), state, architecture)
}

const businesses = {
  agency: 'We run a marketing agency. We deliver campaigns for other businesses on monthly retainers with a small internal team.',
  plumber: 'We run a plumbing service business. Technicians visit customer homes, we buy parts from suppliers, and customers pay on completion.',
  factory: 'We manufacture industrial pumps in our factory. We buy raw materials, run production, inspect quality and ship customer orders.',
  restaurant: 'We run a restaurant with table reservations, suppliers, stock and shift staff. Customers pay at the till.',
  saas: 'We sell B2B SaaS subscriptions. Customers pay monthly, we run a sales pipeline and answer support tickets.',
  charity: 'We are a charity. We run funded programmes, track donors and grants, and report to funders on restricted funds.',
}

const pagesOf = (config: ReturnType<typeof workspaceFor>) =>
  config.navigation.filter(item => item.kind === 'entity').map(item => item.label)

const built = Object.fromEntries(Object.entries(businesses).map(([key, summary]) => [key, workspaceFor(summary)])) as Record<keyof typeof businesses, ReturnType<typeof workspaceFor>>

describe('every company gets its own Command Center', () => {
  it('gives every company the same shell', () => {
    for (const [name, config] of Object.entries(built)) {
      const shell = config.navigation.filter(item => item.kind !== 'entity').map(item => item.id)
      expect(shell, `${name} lost part of the shell`).toEqual(SHELL)
    }
  })

  it('gives no two companies the same set of pages', () => {
    const signatures = Object.entries(built).map(([name, config]) => [name, pagesOf(config).slice().sort().join('|')] as const)
    const seen = new Map<string, string>()
    for (const [name, signature] of signatures) {
      const clash = seen.get(signature)
      expect(clash, `${name} and ${clash} got identical Command Centers`).toBeUndefined()
      seen.set(signature, name)
    }
  })

  it('gives each business pages no other business gets', () => {
    // Raw overlap is the wrong measure. Every company has clients, invoices and a team, so a focused
    // ten-page workspace shares most of itself with any other by arithmetic alone.
    //
    // The bar is deliberately one page, not several: a marketing agency really is clients, projects,
    // tasks and retainers, and has no agency-only record type the way a factory has bills of
    // materials. Service businesses differ by which pages they combine, which the identical-set test
    // above already covers. Specialist operations are held to a higher bar just below.
    const all = Object.entries(built).map(([name, config]) => ({ name, pages: new Set(pagesOf(config)) }))
    for (const business of all) {
      const others = all.filter(item => item.name !== business.name)
      const unique = [...business.pages].filter(page => !others.some(other => other.pages.has(page)))
      expect(unique.length, `${business.name} has nothing of its own: ${[...business.pages].join(', ')}`).toBeGreaterThanOrEqual(1)
    }
    // A business with real physical or regulated operations must be clearly its own thing.
    for (const name of ['factory', 'restaurant', 'charity', 'saas'] as const) {
      const others = all.filter(item => item.name !== name)
      const unique = [...new Set(pagesOf(built[name]))].filter(page => !others.some(other => other.pages.has(page)))
      expect(unique.length, `${name} is not distinctive enough: only ${unique.join(', ') || 'nothing'}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('shares only a small universal core', () => {
    // The pages every business genuinely has. If this grows, Wesify has started bloating everyone.
    const all = Object.values(built).map(config => new Set(pagesOf(config)))
    const everywhere = [...all[0]].filter(page => all.every(pages => pages.has(page)))
    expect(everywhere.sort()).toEqual(['Clients', 'Invoices', 'Team'])
  })

  it('gives each business the pages its work actually needs', () => {
    const has = (key: keyof typeof businesses, page: string) => pagesOf(built[key]).some(label => label.toLowerCase().includes(page))
    expect(has('factory', 'production'), 'a factory needs production').toBe(true)
    expect(has('plumber', 'work order') || has('plumber', 'schedule'), 'a plumber needs dispatch or a schedule').toBe(true)
    expect(has('restaurant', 'reservation'), 'a restaurant needs reservations').toBe(true)
    expect(has('charity', 'grant') || has('charity', 'donation'), 'a charity needs grants or donations').toBe(true)
    expect(has('saas', 'subscription'), 'a SaaS company needs subscriptions').toBe(true)
  })

  it('keeps each business free of what it does not do', () => {
    const has = (key: keyof typeof businesses, page: string) => pagesOf(built[key]).some(label => label.toLowerCase().includes(page))
    expect(has('agency', 'production'), 'an agency should not get a factory floor').toBe(false)
    expect(has('saas', 'inventory'), 'a SaaS company should not get stock').toBe(false)
    expect(has('charity', 'production'), 'a charity should not get production orders').toBe(false)
  })

  it('varies the shape of the work, not only the words', () => {
    // Different businesses should get different view types and different numbers of moving parts,
    // not the same table five times with the nouns swapped.
    const shapes = Object.entries(built).map(([name, config]) => ({
      name,
      pages: pagesOf(config).length,
      views: new Set(config.views.map(view => view.type)).size,
      metrics: config.metrics.length,
    }))
    for (const shape of shapes) {
      expect(shape.pages, `${shape.name} has too few pages to be a real system`).toBeGreaterThan(2)
    }
    expect(new Set(shapes.map(shape => shape.pages)).size, 'every company got the same number of pages').toBeGreaterThan(2)
  })

  /**
   * A first workspace has to be a usable size, whoever describes their company.
   *
   * Loose signal matching once gave a social media agency twenty-three pages including a till and a
   * chart of accounts, while a solo consultant got three and nowhere to record the work. Both are the
   * same failure — the planner reacting to letters rather than to what the business does — and both
   * destroy the only promise Wesify makes.
   */
  it('never builds a workspace too big to learn or too small to use', () => {
    const awkward = {
      'social media agency': 'We are a social media agency. We manage client accounts, plan content calendars, publish posts and report on engagement.',
      'solo consultant': 'I am a solo consultant. I advise companies and invoice monthly.',
      'dog groomer': 'I run a dog grooming salon. People book appointments and pay when they collect their dog.',
      'gym': 'We run a gym with monthly memberships and classes.',
      'law firm': 'We are a law firm handling client matters and billing by the hour.',
    }
    for (const [name, summary] of Object.entries({ ...businesses, ...awkward })) {
      const pages = pagesOf(workspaceFor(summary))
      expect(pages.length, `${name} got ${pages.length} pages: ${pages.join(', ')}`).toBeGreaterThanOrEqual(6)
      expect(pages.length, `${name} got ${pages.length} pages: ${pages.join(', ')}`).toBeLessThanOrEqual(20)
    }
  })

  it('does not read one word inside another', () => {
    // "publish posts" selected point of sale, which pulled in products and payments behind it.
    const agency = pagesOf(workspaceFor('We are a social media agency. We manage client accounts, plan content calendars, publish posts and report on engagement.'))
    expect(agency, 'an agency that publishes posts is not a shop with a till').not.toContain('Point of sale')
    expect(agency, 'managing client accounts is not holding client money in trust').not.toContain('Client accounts')
    expect(agency.some(page => /chart of accounts|journal entries/i.test(page)), 'an agency does not keep its own ledger in Wesify').toBe(false)
  })
})
