import { naicsSearchIndex, naicsSectors, naicsSubsectors, naicsSubsectorOf } from '../data/naics.generated'
import { subsectorArchetypes } from '../data/industryTaxonomy'

/**
 * Resolves a company description to a place in the industry taxonomy.
 *
 * BO's signal lists recognise the businesses someone thought to write a signal for. The taxonomy
 * recognises every business there is: 1,923 industry titles, from "Nail Salons" to "Title Abstract
 * and Settlement Offices". Matching against those titles is what lets an unusual company still land
 * on a real operating model instead of a generic base.
 */

export interface IndustryMatch {
  code: string
  title: string
  subsector: string
  subsectorTitle: string
  sectorTitle: string
  archetype: string
  confidence: number
  /** The phrase in the description that matched, so the conclusion can be shown with its evidence. */
  evidence: string
}

const STOP = new Set([
  'and', 'the', 'for', 'with', 'other', 'services', 'service', 'all', 'not', 'elsewhere', 'classified',
  'except', 'related', 'activities', 'products', 'product', 'general', 'miscellaneous', 'company',
  'business', 'businesses', 'our', 'we', 'run', 'a', 'an', 'of', 'in', 'to', 'that', 'their', 'goods',
])

/** Industry titles are written in US English; operators are not. */
const SPELLING: Record<string, string> = {
  centre: 'center', centres: 'centers', theatre: 'theater', theatres: 'theaters', organisation: 'organization',
  organisations: 'organizations', licence: 'license', labour: 'labor', jewellery: 'jewelry', tyre: 'tire',
  tyres: 'tires', speciality: 'specialty', analogue: 'analog', programme: 'program', programmes: 'programs',
}

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)

/**
 * Light stemming, applied identically to both sides so the forms meet in the middle: NAICS says
 * "Quarrying" and "Bowling Centers" where an operator says "quarry" and "bowling centre".
 */
function stem(word: string) {
  const spelled = SPELLING[word] ?? word
  if (spelled.endsWith('ying') && spelled.length > 5) return `${spelled.slice(0, -4)}y`
  if (spelled.endsWith('ing') && spelled.length > 5) return spelled.slice(0, -3)
  if (spelled.endsWith('ies') && spelled.length > 4) return `${spelled.slice(0, -3)}y`
  if (spelled.endsWith('s') && spelled.length > 3) return spelled.slice(0, -1)
  return spelled
}

const terms = (value: string) => new Set(words(value).map(stem).filter(word => word.length > 2 && !STOP.has(word)))

const sectorTitles = new Map(naicsSectors.map(entry => [entry.code, entry.title]))
const subsectorTitles = new Map(naicsSubsectors.map(entry => [entry.code, entry.title]))

/** A sector code can be a range such as "31-33"; resolve a subsector to the range that contains it. */
function sectorTitleFor(subsector: string) {
  const prefix = subsector.slice(0, 2)
  const direct = sectorTitles.get(prefix)
  if (direct) return direct
  for (const [code, title] of sectorTitles) {
    const [from, to] = code.split('-')
    if (to && prefix >= from && prefix <= to) return title
  }
  return ''
}

const indexed = naicsSearchIndex.map(([code, title]) => ({ code, title, terms: terms(title) }))

/**
 * How informative each term is. "Dairy" appears in a handful of titles and all but identifies the
 * business; "production" appears in hundreds and identifies nothing. Weighting by rarity is what
 * lets a single strong word classify a company while a common one never can.
 */
const documentFrequency = new Map<string, number>()
for (const entry of indexed) for (const term of entry.terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
const weightOf = (term: string) => Math.log(indexed.length / (1 + (documentFrequency.get(term) ?? 0)))
const totalWeight = new Map(indexed.map(entry => [entry.code, [...entry.terms].reduce((sum, term) => sum + weightOf(term), 0)]))

/**
 * A description is matched against whole subsectors, not individual titles.
 *
 * Picking the single best-matching title rewards short titles: "dairy farm" scores higher against
 * "Dairy Product Manufacturing" (three words, one hit) than against "Dairy Cattle and Milk
 * Production" (four words, one hit) — and lands a farm in a factory. Pooling every title in a
 * subsector fixes it, because "farm" and "dairy" both appear somewhere under Animal Production while
 * only "dairy" appears under Food Manufacturing. It is also the level BO maps at, so nothing is lost.
 */
const subsectorTerms = new Map<string, Set<string>>()
for (const entry of indexed) {
  const code = naicsSubsectorOf(entry.code)
  const bucket = subsectorTerms.get(code) ?? new Set<string>()
  for (const term of entry.terms) bucket.add(term)
  subsectorTerms.set(code, bucket)
}

/** Roughly "one reasonably distinctive word". Below it, the description says nothing identifying. */
const MIN_EVIDENCE = 4

export function resolveIndustry(description: string): IndustryMatch | null {
  // Terms the taxonomy has never seen carry no evidence, however unusual they look.
  const spoken = [...terms(description)].filter(term => (documentFrequency.get(term) ?? 0) > 0)
  if (!spoken.length) return null

  let best: { code: string; weight: number; hits: string[] } | null = null
  for (const [code, bucket] of subsectorTerms) {
    const hits = spoken.filter(term => bucket.has(term))
    if (!hits.length) continue
    const weight = hits.reduce((sum, term) => sum + weightOf(term), 0)
    if (!best || weight > best.weight) best = { code, weight, hits }
  }
  if (!best || best.weight < MIN_EVIDENCE) return null

  const archetype = subsectorArchetypes[best.code]
  if (!archetype) return null
  // Report the most specific title inside the winning subsector that the description supports.
  const hitSet = new Set(best.hits)
  const titles = indexed
    .filter(entry => naicsSubsectorOf(entry.code) === best!.code)
    .map(entry => ({ entry, matched: [...entry.terms].filter(term => hitSet.has(term)).reduce((sum, term) => sum + weightOf(term), 0) / (totalWeight.get(entry.code) || 1) }))
    .sort((left, right) => right.matched - left.matched)
  const label = titles[0]?.matched ? titles[0].entry : { code: best.code, title: subsectorTitles.get(best.code) ?? '' }

  return {
    code: label.code,
    title: label.title,
    subsector: best.code,
    subsectorTitle: subsectorTitles.get(best.code) ?? label.title,
    sectorTitle: sectorTitleFor(best.code),
    archetype,
    confidence: Math.min(0.92, 0.45 + Math.min(1, best.weight / 14) * 0.45),
    evidence: best.hits.join(', '),
  }
}

export const taxonomySize = { sectors: naicsSectors.length, subsectors: naicsSubsectors.length, titles: naicsSearchIndex.length }
