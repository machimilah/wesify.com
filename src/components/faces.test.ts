import { describe, expect, it } from 'vitest'
import { FileText } from 'lucide-react'
import { faceForNavigation } from './faces'
import { emptyArchitecture, emptyBusinessState, architectureToBlueprint } from '../engine/businessDiscovery'
import { resilientArchitecture } from '../engine/discoveryModel'
import { generateWorkspaceConfigurationFromDiscovery } from '../engine/workspaceSchema'

/**
 * A sidebar of twenty identical document icons is not navigation.
 *
 * The live build preview drew every page with the same generic file glyph while the finished Command
 * Center used the real icon map, so the same workspace wore two different faces on two screens — and
 * on the preview, none of them said anything. Both now resolve through `faceForNavigation`, and this
 * holds that: a generated workspace must come out visually distinguishable, not a stack of clones.
 */

const businesses = {
  agency: 'We run a marketing agency. We deliver campaigns for other businesses on monthly retainers with a small internal team.',
  plumber: 'We run a plumbing service business. Technicians visit customer homes, we buy parts from suppliers, and customers pay on completion.',
  factory: 'We manufacture industrial pumps in our factory. We buy raw materials, run production, inspect quality and ship customer orders.',
  restaurant: 'We run a restaurant with table reservations, suppliers, stock and shift staff. Customers pay at the till.',
  saas: 'We sell B2B SaaS subscriptions. Customers pay monthly, we run a sales pipeline and answer support tickets.',
}

function facesFor(summary: string) {
  const state = { ...emptyBusinessState(), companySummary: summary, industry: summary }
  const architecture = resilientArchitecture(state, emptyArchitecture())
  const config = generateWorkspaceConfigurationFromDiscovery({ companyDescription: summary }, architectureToBlueprint(architecture), state, architecture)
  return config.navigation.filter(item => item.kind === 'entity').map(item => ({ label: item.label, icon: faceForNavigation(config, item).icon }))
}

describe('every page has its own face', () => {
  for (const [name, summary] of Object.entries(businesses)) {
    it(`gives ${name} a legible sidebar`, () => {
      const faces = facesFor(summary)
      expect(faces.length, 'the workspace built no pages at all').toBeGreaterThan(3)

      // The generic document icon is the fallback. It is fine for a document page; it is a failure
      // when it is most of the sidebar, because then the icons carry no information.
      const generic = faces.filter(face => face.icon === FileText)
      expect(generic.length / faces.length, `${name} fell back to the generic icon for ${generic.map(face => face.label).join(', ')}`).toBeLessThan(0.4)

      // Repeats are legitimate — shipments and vehicles are both trucks. A column of clones is not.
      const distinct = new Set(faces.map(face => face.icon)).size
      expect(distinct, `${name} drew ${faces.length} pages with only ${distinct} icons`).toBeGreaterThanOrEqual(Math.ceil(faces.length * 0.6))
    })
  }

  it('never leaves a page without an icon', () => {
    for (const summary of Object.values(businesses)) {
      for (const face of facesFor(summary)) expect(face.icon, `${face.label} has no icon`).toBeTruthy()
    }
  })
})
