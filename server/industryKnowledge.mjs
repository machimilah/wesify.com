import { allProfiles, checkSubsector, readProfile, writeProfile } from './industryStore.mjs'

/**
 * What Wesify knows about an industry, rather than what Wesify assumes about it.
 *
 * The taxonomy classifies a business; it contains no operating facts. Nothing in NAICS says whether a
 * social media agency bills by the hour, so Wesify's own ontology had to guess — and a guess is exactly
 * what should not decide the product.
 *
 * This store holds two better sources, keyed by NAICS subsector and shared across every company:
 *
 * - **researched** — what the frontier researcher found on the open web, with its sources.
 * - **observed** — what companies in this industry actually did with the workspace Wesify gave them:
 *   kept a system, removed it, or added one Wesify had missed.
 *
 * Observation outranks research, and research outranks the ontology. Only aggregate counts are
 * stored: never a company name, never a record, never anything that identifies who did what.
 *
 * Where any of it is kept is industryStore.mjs's problem rather than this file's: Postgres when Wesify
 * has a database, JSON files when it does not. What is decided from it is decided here, and is pure.
 */

/** Enough companies that a pattern is a pattern and not one opinionated operator. */
export const MIN_COMPANIES = 5
/** How lopsided the split must be before Wesify changes what it builds. */
export const VERDICT_SHARE = 0.6

/**
 * How long a researched answer speaks for.
 *
 * Research is a snapshot of what the open web said about an industry on one day. Industries change —
 * a payment rule, a platform everyone moved to, a licence that stopped being required — and research
 * with no expiry means a finding from years ago keeps deciding what today's operator is given, with
 * exactly the confidence it had when it was true. Past this it is still shown, marked stale, but it
 * no longer decides anything.
 */
export const RESEARCH_FRESH_DAYS = 180

export const readIndustryProfile = readProfile

/**
 * Records what one company did, as counts only.
 *
 * `kept` is every capability the company still had when its workspace was built; `removed` and
 * `added` are the corrections it made afterwards. A company is counted once, however many
 * capabilities it touched, so a single busy operator cannot outvote an industry.
 */
export async function recordObservations(subsector, { kept = [], removed = [], added = [], patterns = [], label = '', newCompany = false }) {
  checkSubsector(subsector)
  const profile = await readIndustryProfile(subsector)
  profile.patterns ??= {}
  const bump = (capabilityId, field) => {
    const entry = profile.observed[capabilityId] ?? { kept: 0, removed: 0, added: 0 }
    entry[field] += 1
    profile.observed[capabilityId] = entry
  }
  for (const id of new Set(kept)) bump(id, 'kept')
  for (const id of new Set(removed)) bump(id, 'removed')
  for (const id of new Set(added)) bump(id, 'added')
  for (const item of patterns) {
    const kind = String(item.kind)
    const id = String(item.id)
    const outcome = item.outcome === 'removed' ? 'removed' : 'adopted'
    const byKind = profile.patterns[kind] ?? {}
    const entry = byKind[id] ?? { adopted: 0, removed: 0 }
    entry[outcome] += 1
    byKind[id] = entry
    profile.patterns[kind] = byKind
  }
  if (newCompany) profile.companies += 1
  if (label && !profile.label) profile.label = label
  profile.updatedAt = new Date().toISOString()
  await writeProfile(profile)
  return profile
}

export async function saveResearch(subsector, research) {
  checkSubsector(subsector)
  const profile = await readIndustryProfile(subsector)
  profile.researched = {
    capabilityIds: research.capabilityIds ?? [],
    excludedCapabilityIds: research.excludedCapabilityIds ?? [],
    summary: String(research.summary ?? ''),
    sources: (research.sources ?? []).slice(0, 12),
    model: String(research.model ?? ''),
    at: new Date().toISOString(),
  }
  if (research.label && !profile.label) profile.label = research.label
  profile.updatedAt = profile.researched.at
  await writeProfile(profile)
  return profile
}

/** Whether a profile's research is recent enough to still decide anything. */
export function researchIsFresh(profile, now = Date.now()) {
  const at = profile?.researched?.at
  if (!at) return false
  const age = now - new Date(at).getTime()
  return Number.isFinite(age) && age >= 0 && age <= RESEARCH_FRESH_DAYS * 24 * 60 * 60 * 1000
}

/**
 * What the evidence says Wesify should build for this industry.
 *
 * Pure so it can be reasoned about and tested. Each verdict carries why it was reached, so the
 * interface can show an operator that a system is there because other companies like theirs kept it —
 * not because Wesify decided.
 */
export function industryVerdict(profile) {
  const include = []
  const exclude = []
  const enoughCompanies = (profile.companies ?? 0) >= MIN_COMPANIES

  for (const [capabilityId, counts] of Object.entries(profile.observed ?? {})) {
    const kept = counts.kept ?? 0
    const removed = counts.removed ?? 0
    const added = counts.added ?? 0
    const decisions = kept + removed + added
    if (!enoughCompanies || decisions < MIN_COMPANIES) continue
    const keepShare = (kept + added) / decisions
    const dropShare = removed / decisions
    if (dropShare >= VERDICT_SHARE) exclude.push({ capabilityId, reason: `${removed} of ${decisions} companies in this industry removed it`, basis: 'observed' })
    else if (keepShare >= VERDICT_SHARE && added > 0) include.push({ capabilityId, reason: `${kept + added} of ${decisions} companies in this industry kept or added it`, basis: 'observed' })
  }

  // Research only speaks where behaviour has not, and only while it is still recent. Stale research
  // is kept and still shown — it remains the best account anyone has of how the industry once worked
  // — but it stops deciding, because an answer nobody has rechecked in half a year is not evidence.
  const decided = new Set([...include, ...exclude].map(item => item.capabilityId))
  if (researchIsFresh(profile)) {
    for (const capabilityId of profile.researched?.capabilityIds ?? []) {
      if (decided.has(capabilityId)) continue
      include.push({ capabilityId, reason: profile.researched.summary || 'Researched for this industry', basis: 'researched' })
    }
    for (const capabilityId of profile.researched?.excludedCapabilityIds ?? []) {
      if (decided.has(capabilityId)) continue
      exclude.push({ capabilityId, reason: 'Research found no evidence this industry needs it', basis: 'researched' })
    }
  }

  const included = new Set(include.map(item => item.capabilityId))
  const patterns = []
  if (enoughCompanies) for (const [kind, entries] of Object.entries(profile.patterns ?? {})) for (const [patternId, counts] of Object.entries(entries)) {
    const adopted = counts.adopted ?? 0
    const removed = counts.removed ?? 0
    const decisions = adopted + removed
    if (decisions < MIN_COMPANIES || adopted / decisions < VERDICT_SHARE) continue
    patterns.push({ kind, patternId, companies: decisions, adoptionShare: adopted / decisions, reason: `${adopted} of ${decisions} companies in this industry adopted this ${kind} pattern` })
  }
  return {
    subsector: profile.subsector,
    label: profile.label,
    companies: profile.companies ?? 0,
    include: include.filter(item => !exclude.some(other => other.capabilityId === item.capabilityId)),
    exclude: exclude.filter(item => !(item.basis === 'researched' && included.has(item.capabilityId))),
    patterns,
    sources: profile.researched?.sources ?? [],
    // Said plainly rather than left to be worked out from a date: research that has stopped
    // deciding anything should not look identical to research that still is.
    research: profile.researched
      ? { at: profile.researched.at, stale: !researchIsFresh(profile), summary: profile.researched.summary ?? '' }
      : null,
  }
}

/** Every industry Wesify has learned something about, for inspection. */
export async function listIndustries() {
  return (await allProfiles()).map(profile => ({
    subsector: profile.subsector,
    label: profile.label,
    companies: profile.companies,
    researched: Boolean(profile.researched),
    researchStale: Boolean(profile.researched) && !researchIsFresh(profile),
    capabilities: Object.keys(profile.observed ?? {}).length,
    patterns: Object.values(profile.patterns ?? {}).reduce((total, entries) => total + Object.keys(entries).length, 0),
  }))
}
