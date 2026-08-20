import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * What BO knows about an industry, rather than what BO assumes about it.
 *
 * The taxonomy classifies a business; it contains no operating facts. Nothing in NAICS says whether a
 * social media agency bills by the hour, so BO's own ontology had to guess — and a guess is exactly
 * what should not decide the product.
 *
 * This store holds two better sources, keyed by NAICS subsector and shared across every company:
 *
 * - **researched** — what the frontier researcher found on the open web, with its sources.
 * - **observed** — what companies in this industry actually did with the workspace BO gave them:
 *   kept a system, removed it, or added one BO had missed.
 *
 * Observation outranks research, and research outranks the ontology. Only aggregate counts are
 * stored: never a company name, never a record, never anything that identifies who did what.
 */

const root = () => path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.industry-knowledge')

/** Enough companies that a pattern is a pattern and not one opinionated operator. */
export const MIN_COMPANIES = 5
/** How lopsided the split must be before BO changes what it builds. */
export const VERDICT_SHARE = 0.6

const subsectorFile = subsector => {
  if (!/^\d{3}$/.test(String(subsector))) throw Object.assign(new Error('A NAICS subsector is three digits.'), { status: 400 })
  return path.join(root(), `${subsector}.json`)
}

const emptyProfile = subsector => ({ subsector, label: '', researched: null, observed: {}, companies: 0, updatedAt: '' })

export async function readIndustryProfile(subsector) {
  try { return JSON.parse(await readFile(subsectorFile(subsector), 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return emptyProfile(subsector)
    throw error
  }
}

async function writeIndustryProfile(profile) {
  const file = subsectorFile(profile.subsector)
  await mkdir(path.dirname(file), { recursive: true })
  const candidate = `${file}.${crypto.randomUUID()}.next`
  await writeFile(candidate, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  await rename(candidate, file)
}

/**
 * Records what one company did, as counts only.
 *
 * `kept` is every capability the company still had when its workspace was built; `removed` and
 * `added` are the corrections it made afterwards. A company is counted once, however many
 * capabilities it touched, so a single busy operator cannot outvote an industry.
 */
export async function recordObservations(subsector, { kept = [], removed = [], added = [], label = '', newCompany = false }) {
  const profile = await readIndustryProfile(subsector)
  const bump = (capabilityId, field) => {
    const entry = profile.observed[capabilityId] ?? { kept: 0, removed: 0, added: 0 }
    entry[field] += 1
    profile.observed[capabilityId] = entry
  }
  for (const id of new Set(kept)) bump(id, 'kept')
  for (const id of new Set(removed)) bump(id, 'removed')
  for (const id of new Set(added)) bump(id, 'added')
  if (newCompany) profile.companies += 1
  if (label && !profile.label) profile.label = label
  profile.updatedAt = new Date().toISOString()
  await writeIndustryProfile(profile)
  return profile
}

export async function saveResearch(subsector, research) {
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
  await writeIndustryProfile(profile)
  return profile
}

/**
 * What the evidence says BO should build for this industry.
 *
 * Pure so it can be reasoned about and tested. Each verdict carries why it was reached, so the
 * interface can show an operator that a system is there because other companies like theirs kept it —
 * not because BO decided.
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

  // Research only speaks where behaviour has not.
  const decided = new Set([...include, ...exclude].map(item => item.capabilityId))
  for (const capabilityId of profile.researched?.capabilityIds ?? []) {
    if (decided.has(capabilityId)) continue
    include.push({ capabilityId, reason: profile.researched.summary || 'Researched for this industry', basis: 'researched' })
  }
  for (const capabilityId of profile.researched?.excludedCapabilityIds ?? []) {
    if (decided.has(capabilityId)) continue
    exclude.push({ capabilityId, reason: 'Research found no evidence this industry needs it', basis: 'researched' })
  }

  const included = new Set(include.map(item => item.capabilityId))
  return {
    subsector: profile.subsector,
    label: profile.label,
    companies: profile.companies ?? 0,
    include: include.filter(item => !exclude.some(other => other.capabilityId === item.capabilityId)),
    exclude: exclude.filter(item => !(item.basis === 'researched' && included.has(item.capabilityId))),
    sources: profile.researched?.sources ?? [],
  }
}

/** Every industry BO has learned something about, for inspection. */
export async function listIndustries() {
  try {
    const files = await readdir(root())
    return (await Promise.all(files.filter(name => /^\d{3}\.json$/.test(name)).map(name => readIndustryProfile(name.slice(0, 3)))))
      .map(profile => ({ subsector: profile.subsector, label: profile.label, companies: profile.companies, researched: Boolean(profile.researched), capabilities: Object.keys(profile.observed ?? {}).length }))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}
