import { saysSignal } from './shared'

/**
 * What kind of company this is — all of the kinds, not one of them.
 *
 * Wesify already classifies a company twice: `companyTemplates` picks the closest of sixteen
 * templates, and `industryResolver` places it in NAICS. Both answer "which one", and that is the
 * wrong question. A company that imports coffee, roasts it, sells wholesale to cafés and runs one
 * shop of its own is a manufacturer, an importer, a wholesaler and a retailer at once. Ask for the
 * single best label and you get "retailer", and the build then has a till and no customs file, no
 * production run and no wholesale price list — three whole operations missing because a fourth one
 * scored higher.
 *
 * So archetypes are additive. Each one that holds activates the processes, records, controls and
 * risks that operating model implies, and a company carries as many as its description supports.
 * The frameworks in `processFrameworks` are keyed on these ids: this is what decides whether SCOR
 * and ISA-95 apply at all, and which APQC processes are required rather than merely possible.
 */

export type ArchetypeKind = 'operating' | 'commercial' | 'structural'

export interface OperatingArchetype {
  id: string
  label: string
  kind: ArchetypeKind
  /** What this operating model means for how the company actually runs. */
  meaning: string
  signals: string[]
  /** Capabilities whose presence proves the archetype even when nobody used the word. */
  provenBy: string[]
}

const archetype = (id: string, label: string, kind: ArchetypeKind, meaning: string, signals: string[], provenBy: string[] = []): OperatingArchetype => ({ id, label, kind, meaning, signals, provenBy })

/**
 * The operating models Wesify knows how to build for.
 *
 * `operating` decides how value is produced, `commercial` decides how it is sold and paid for, and
 * `structural` describes the shape of the company rather than its work. A company normally holds one
 * or two of the first, one or two of the second, and any of the third.
 */
export const operatingArchetypes: OperatingArchetype[] = [
  archetype('manufacturer', 'Manufacturer', 'operating', 'Inputs are converted into output, so production capacity and material availability govern what can be sold.', ['manufacture', 'manufacturing', 'factory', 'production line', 'assemble', 'assembly', 'fabricate', 'workshop', 'we make', 'we build', 'we produce'], ['manufacturing.production', 'manufacturing.bom']),
  archetype('food-processor', 'Food producer or handler', 'operating', 'Output is edible, so lots, expiry, hygiene and traceability are operating requirements rather than paperwork.', ['bakery', 'bake', 'brewery', 'brew', 'kitchen', 'catering', 'food production', 'dairy', 'butcher', 'roastery', 'cold chain', 'ingredient'], ['inventory.traceability']),
  archetype('distributor', 'Distributor', 'operating', 'The company buys finished goods and moves them on, so stock turn and supplier reliability are the business.', ['distribute', 'distributor', 'distribution', 'we resell', 'reseller', 'stockist'], ['inventory.warehouses']),
  archetype('wholesaler', 'Wholesaler', 'commercial', 'Sales are to trade buyers in quantity, so price lists, credit terms and order minimums matter more than checkout.', ['wholesale', 'wholesaler', 'trade customer', 'bulk order', 'case price', 'pallet'], ['commerce.pricelists']),
  archetype('retailer', 'Retailer', 'commercial', 'Selling happens at a counter or a shelf, so takings, stock on hand and shrinkage are the daily numbers.', ['shop', 'store', 'retail', 'till', 'counter', 'point of sale', 'walk in'], ['commerce.pos']),
  archetype('ecommerce', 'Online seller', 'commercial', 'Orders arrive without a conversation, so fulfilment speed and returns handling are the customer experience.', ['online store', 'webshop', 'ecommerce', 'e-commerce', 'shopify', 'online orders', 'website orders'], ['commerce.ecommerce']),
  archetype('marketplace', 'Marketplace', 'commercial', 'The company connects two sides it does not own, so commission, settlement and both-sided trust are the model.', ['marketplace', 'platform connecting', 'sellers and buyers', 'commission per transaction', 'listings'], ['commerce.marketplace']),
  archetype('importer', 'Importer', 'operating', 'Goods cross a border inward, so customs, duty, landed cost and clearance delays are operational facts.', ['import', 'importer', 'we bring in from', 'overseas supplier', 'customs clearance', 'container'], ['logistics.customs']),
  archetype('exporter', 'Exporter', 'operating', 'Goods cross a border outward, so export documentation and incoterms decide when risk transfers.', ['export', 'exporter', 'ship abroad', 'overseas customer', 'incoterm'], ['logistics.customs']),
  archetype('logistics', 'Logistics operator', 'operating', 'Movement itself is the product, so vehicles, routes and proof of delivery are the operation.', ['freight', 'haulage', 'courier', 'trucking', 'fleet', 'last mile', 'third party logistics'], ['logistics.transport', 'logistics.fleet']),
  archetype('saas', 'Software or digital product', 'operating', 'The product is delivered without physical fulfilment, so accounts, entitlements and support replace stock and shipping.', ['saas', 'software as a service', 'software platform', 'web app', 'mobile app', 'digital product', 'online course'], ['subscriptions.billing']),
  archetype('subscription', 'Subscription business', 'commercial', 'Revenue renews rather than repeats, so churn and renewal dates are the revenue risk.', ['subscription', 'retainer', 'membership', 'monthly plan', 'recurring', 'renewal'], ['subscriptions.billing']),
  archetype('professional-services', 'Professional services', 'operating', 'People sell their time and judgement, so utilisation and unbilled work are where the money is won or lost.', ['consultancy', 'consulting', 'law firm', 'accounting firm', 'architects', 'advisory', 'professional services', 'billable'], ['work.time']),
  archetype('agency', 'Agency', 'operating', 'Work is delivered as campaigns or creative projects against a retainer or a brief.', ['agency', 'creative studio', 'marketing agency', 'design studio', 'campaign work', 'client brief'], ['marketing.campaigns']),
  archetype('field-service', 'Field service', 'operating', 'Work happens at the customer location, so dispatch, van stock and travel are the constraint.', ['on site', 'callout', 'call out', 'technician', 'engineer visit', 'plumber', 'electrician', 'installer', 'we travel to'], ['service.field-work']),
  archetype('construction', 'Construction', 'operating', 'Work is a site with a programme, subcontractors, variations and retention.', ['construction', 'builder', 'building site', 'contractor', 'subcontractor', 'groundwork', 'renovation', 'refurbishment'], ['vertical.construction-controls']),
  archetype('project-based', 'Project based', 'operating', 'Work is committed in discrete engagements with their own scope, budget and end date.', ['project', 'engagement', 'milestone', 'scope of work', 'deliverable', 'fixed fee'], ['work.projects', 'work.milestones']),
  archetype('healthcare', 'Health or care provider', 'operating', 'Care is delivered to a person, so clinical records, consent and practitioner licensing govern the work.', ['clinic', 'patient', 'medical practice', 'dental', 'therapy', 'nursing', 'care home', 'treatment'], ['vertical.healthcare']),
  archetype('hospitality', 'Hospitality', 'operating', 'Capacity is perishable — a table or a room unsold tonight cannot be sold again.', ['restaurant', 'hotel', 'cafe', 'bar', 'guests', 'covers', 'rooms', 'reservation'], ['vertical.hospitality']),
  archetype('education', 'Education or training', 'operating', 'Delivery is by cohort or course, so enrolment, attendance and outcomes are the operation.', ['academy', 'training provider', 'we teach', 'our students', 'pupils', 'enrolment', 'enrollment', 'tuition', 'course fees', 'lesson plan'], ['vertical.education']),
  archetype('property', 'Property or rental', 'operating', 'Assets earn while occupied, so occupancy, tenancy dates and maintenance are the business.', ['landlord', 'tenant', 'rental', 'lettings', 'property management', 'lease', 'occupancy'], ['vertical.property']),
  archetype('nonprofit', 'Nonprofit', 'structural', 'Money arrives restricted to a purpose, so funds must be accounted for separately and reported on.', ['nonprofit', 'non profit', 'charity', 'ngo', 'foundation', 'donor', 'grant funded'], ['vertical.nonprofit', 'accounting.fund']),
  archetype('make-to-stock', 'Make to stock', 'operating', 'Output is produced before it is sold, so forecasting error becomes inventory rather than a missed order.', ['make to stock', 'produce for stock', 'stock the shelves', 'forecast production', 'standard products'], ['planning.demand']),
  archetype('make-to-order', 'Make to order', 'operating', 'Nothing is produced until it is sold, so lead time and capacity promises are what customers judge.', ['made to order', 'make to order', 'bespoke', 'custom build', 'per order production', 'commissioned'], ['manufacturing.production']),
  archetype('b2b', 'Sells to businesses', 'commercial', 'Buyers are organizations, so accounts outlive contacts and payment is on terms rather than at purchase.', ['b2b', 'trade customer', 'businesses buy', 'corporate client', 'other companies', 'purchase order from'], ['sales.contracts']),
  archetype('b2c', 'Sells to consumers', 'commercial', 'Buyers are individuals, so volume, repeat purchase and immediate payment shape the operation.', ['b2c', 'consumer', 'general public', 'homeowner', 'walk in customer', 'individual customers'], ['commerce.pos']),
  archetype('multi-location', 'Multi-location', 'structural', 'The same operation runs in more than one place, so stock, staff and results have to be separable by site.', ['branches', 'multiple locations', 'second site', 'our stores', 'each depot', 'per branch'], ['inventory.warehouses']),
  archetype('regulated', 'Regulated activity', 'structural', 'An authority can inspect and can stop the company, so evidence has to exist before it is asked for.', ['licence', 'license', 'regulator', 'inspection', 'certified', 'accredited', 'compliance requirement', 'audited'], ['compliance.audits', 'compliance.controls']),
  archetype('solo', 'Solo operator', 'structural', 'One person is every role, so anything built for coordination between people is pure overhead.', ['solo', 'just me', 'only me', 'i work alone', 'one person', 'sole trader', 'no employees', 'freelance'], []),
]

export const archetypeById = new Map(operatingArchetypes.map(item => [item.id, item]))

export interface DetectedArchetype {
  id: string
  label: string
  kind: ArchetypeKind
  meaning: string
  confidence: number
  /** The operator's own words that put this archetype on the list. */
  evidence: string[]
  basis: 'stated' | 'derived'
}

/**
 * Every operating model this company appears to hold.
 *
 * `stated` means the description says it. `derived` means a capability already selected can only
 * exist in a company of that shape — a workspace holding production orders belongs to a manufacturer
 * whether or not the operator used the word. Nothing here is a guess dressed as a fact: an archetype
 * with no evidence of either kind is not returned at all, and the caller sees a shorter list rather
 * than a confident wrong one.
 */
export function detectArchetypes(text: string, capabilityIds: string[] = []): DetectedArchetype[] {
  const selected = new Set(capabilityIds)
  const detected: DetectedArchetype[] = []
  for (const item of operatingArchetypes) {
    const evidence = item.signals.filter(signal => saysSignal(text, signal))
    const proven = item.provenBy.filter(id => selected.has(id))
    if (!evidence.length && !proven.length) continue
    // Two independent phrases is as certain as reading a description ever gets; one is a strong hint.
    const stated = evidence.length > 0
    const confidence = Math.min(0.95, (stated ? 0.6 + Math.min(evidence.length - 1, 3) * 0.1 : 0.5) + (proven.length ? 0.15 : 0))
    detected.push({ id: item.id, label: item.label, kind: item.kind, meaning: item.meaning, confidence: Number(confidence.toFixed(2)), evidence, basis: stated ? 'stated' : 'derived' })
  }
  return detected.sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
}

/**
 * The archetypes the architect named itself, resolved to the ids the frameworks are keyed on.
 *
 * The model writes them in the company's language — "sells to trade buyers", "we import" — so they
 * are matched against each archetype's id, label and signals rather than expected to be one of a
 * list. A phrase that matches nothing is dropped: an unrecognised archetype would activate no
 * process and no control, and carrying it around would only make the report look more certain than
 * it is.
 */
export function archetypesFromLabels(labels: string[]): DetectedArchetype[] {
  const resolved: DetectedArchetype[] = []
  for (const label of labels) {
    const normalized = label.toLowerCase().trim()
    if (!normalized) continue
    const match = operatingArchetypes.find(item => item.id === normalized || item.label.toLowerCase() === normalized)
      ?? operatingArchetypes.find(item => normalized.includes(item.id.replace(/-/g, ' ')) || item.label.toLowerCase().includes(normalized))
      ?? operatingArchetypes.find(item => item.signals.some(signal => saysSignal(normalized, signal)))
    if (!match || resolved.some(item => item.id === match.id)) continue
    resolved.push({ id: match.id, label: match.label, kind: match.kind, meaning: match.meaning, confidence: 0.8, evidence: [label], basis: 'stated' })
  }
  return resolved
}

/** The architect's own conclusions first, then anything the description evidences that it missed. */
export function mergeArchetypes(stated: DetectedArchetype[], detected: DetectedArchetype[]): DetectedArchetype[] {
  const held = new Set(stated.map(item => item.id))
  return [...stated, ...detected.filter(item => !held.has(item.id))].sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
}

/**
 * A solo operator and a shift rota cannot both be true.
 *
 * The only contradiction worth resolving automatically: "just me" is stated so plainly, and so often,
 * that letting a stray word add an archetype implying colleagues produces a workspace full of
 * assignment fields for a person who has nobody to assign to.
 */
export function reconcileArchetypes(detected: DetectedArchetype[]): DetectedArchetype[] {
  const solo = detected.find(item => item.id === 'solo' && item.basis === 'stated')
  if (!solo) return detected
  return detected.filter(item => item.id === 'solo' || item.confidence >= solo.confidence || !['multi-location'].includes(item.id))
}
