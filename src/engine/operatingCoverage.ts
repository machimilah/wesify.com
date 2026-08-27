import { detectArchetypes, reconcileArchetypes, type DetectedArchetype } from './archetypes'
import type { ArchitectureUnknown } from './businessDiscovery'
import { completenessGaps, runCompletenessTests, type CompletenessResult } from './completeness'
import { classifyProcessCoverage, withRoleAwareControls, type ProcessCoverage } from './processCoverage'
import { scenarioFailures, simulateBusinessEvents, type ScenarioResult } from './scenarios'
import type { WorkspaceConfiguration } from './workspaceSchema'

/**
 * One report answering the only question that matters before a build is handed over: is this the
 * company, and can it be run in here?
 *
 * The three passes underneath it look at different things and have to be read together. Process
 * coverage asks what a company of this shape must do; the completeness tests ask whether each flow
 * arrives somewhere; the scenario simulation asks whether the workspace survives contact with a bad
 * week. A build can pass any one of them and fail the business — a workspace with a purchasing
 * module, a supplier table and nothing that reacts when a supplier is late has full coverage, a
 * closed cost flow, and no answer to the first thing that will actually go wrong.
 *
 * What comes out is evidence rather than a verdict Wesify acts on alone: `blocking` is what a build
 * should be repaired against, `questions` is what is worth interrupting an operator for, and
 * `verify` is what nobody may assert without checking. The three are deliberately separate, because
 * they have three different costs — a capability is free, a question costs somebody's attention, and
 * a regulatory claim asserted wrongly costs them a wasted week.
 */

export interface OperatingCoverage {
  version: 1
  archetypes: DetectedArchetype[]
  processes: ProcessCoverage
  completeness: CompletenessResult[]
  scenarios: ScenarioResult[]
  /** Gaps a build should close before it is handed over, worst first. */
  blocking: Array<{ id: string; label: string; because: string; capabilityIds: string[] }>
  /** What Wesify does not know and cannot default, phrased for an operator. */
  questions: Array<{ id: string; text: string; because: string }>
  /** Regulatory subjects that must be confirmed with the competent authority, never asserted. */
  verify: Array<{ id: string; label: string; authorities: string[]; obligations: string[] }>
  /** Share of what this company must do that the build actually carries. */
  coverage: number
  ready: boolean
  at: string
}

export interface CoverageContext {
  /** Everything known about the company in its own words. */
  text: string
  capabilityIds: string[]
  archetypes?: DetectedArchetype[]
  /** What the architect had to assume, carried through as an assumption rather than a fact. */
  unknowns?: ArchitectureUnknown[]
}

/**
 * Coverage for a proposal that has not been compiled into a workspace yet.
 *
 * The architecture pass returns capabilities and entity names, not a configuration, and that is the
 * moment where a missing process is cheapest to fix: adding a capability before the compile costs
 * nothing, while adding one after it means rebuilding the workspace somebody has already seen.
 */
export function coverageForProposal(context: CoverageContext): ProcessCoverage {
  return classifyProcessCoverage({ text: context.text, capabilityIds: context.capabilityIds, archetypes: context.archetypes })
}

export function compileOperatingCoverage(config: WorkspaceConfiguration, context: CoverageContext): OperatingCoverage {
  const archetypes = reconcileArchetypes(context.archetypes ?? detectArchetypes(context.text, context.capabilityIds))
  const capabilityIds = context.capabilityIds.length ? context.capabilityIds : config.capabilities ?? []
  const processes = withRoleAwareControls(
    classifyProcessCoverage({ text: context.text, capabilityIds, archetypes }),
    capabilityIds,
    config.roles.length,
  )
  const completeness = runCompletenessTests(config, processes)
  const scenarios = simulateBusinessEvents(config, processes)

  /**
   * What blocks a handover, deduplicated across the three passes.
   *
   * A missing procurement capability shows up as an APQC gap, a failed cost test and a supplier-delay
   * scenario. Listing it three times makes the report look like three problems and makes the one
   * real fix harder to see, so the process gap wins and the others fall in behind it.
   */
  const blocking: OperatingCoverage['blocking'] = []
  // Seeded from every process gap, not only the ones that block: a completeness test whose remedy is
  // a capability some lesser gap already names is the same finding, and saying it twice makes the
  // one real fix harder to see.
  const claimed = new Set(processes.gaps.flatMap(item => item.capabilityIds))
  for (const gap of processes.gaps.filter(item => item.criticality === 'critical' && item.capabilityIds.length)) {
    blocking.push({ id: gap.processId, label: gap.name, because: gap.because, capabilityIds: gap.capabilityIds })
  }
  for (const failure of completenessGaps(completeness)) {
    if (failure.capabilityIds.some(id => claimed.has(id))) continue
    blocking.push({ id: `completeness-${failure.id}`, label: failure.question, because: failure.because, capabilityIds: failure.capabilityIds })
    for (const id of failure.capabilityIds) claimed.add(id)
  }
  for (const failure of scenarioFailures(scenarios)) {
    /**
     * Only the event the workspace cannot see at all.
     *
     * A scenario that fails on `impact` or `recommend` is telling the operator their workspace could
     * report more about something it already holds — worth showing, not worth blocking a handover
     * over, and there are eleven more where that came from. `detect` failing is different in kind:
     * the thing this event happens to does not exist here.
     */
    if (!failure.missing.some(item => item.id === 'detect')) continue
    blocking.push({ id: `scenario-${failure.id}`, label: failure.label, because: failure.missing.find(item => item.id === 'detect')!.because, capabilityIds: [] })
  }

  /**
   * What is worth interrupting somebody for, the architect's own doubts first.
   *
   * An assumption the architect had to make about money, legal responsibility or a customer
   * commitment is a better question than one derived from a framework, because it is about this
   * company rather than about companies of this shape — and it is the only one of the two that
   * carries what was assumed in the meantime, so an operator can leave it alone and be right.
   */
  const stated = (context.unknowns ?? [])
    .filter(item => item.impact === 'money' || item.impact === 'legal')
    .map(item => ({ id: `assumed-${item.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, text: item.topic, because: item.assumption ? `${item.why} Wesify assumed: ${item.assumption}.` : item.why }))
  const questions = [
    ...stated,
    ...processes.gaps
      .filter(item => item.question)
      .map(item => ({ id: item.processId, text: item.question as string, because: item.because })),
  ].slice(0, 4)

  const verify = processes.regulatory.map(item => ({ id: item.id, label: item.label, authorities: item.authorities, obligations: item.obligations }))

  return {
    version: 1,
    archetypes,
    processes,
    completeness,
    scenarios,
    blocking: blocking.slice(0, 8),
    questions,
    verify,
    coverage: processes.coverage,
    // Ready means nothing this company must be able to do is missing a capability that would carry
    // it. A gap with no capability behind it is a note for the operator, not a reason to hold a build.
    ready: !blocking.some(item => item.capabilityIds.length),
    at: new Date().toISOString(),
  }
}

/**
 * The gaps written as an instruction the architect model can act on.
 *
 * Deliberately phrased as evidence rather than as orders: the model is told what a company of this
 * shape must be able to do and what the proposal currently has no answer for, and it decides. An
 * instruction that says "add these capabilities" produces the module bloat the whole product exists
 * to avoid — the model stops reading the interview and starts satisfying a checklist.
 */
export function coverageRepairInstruction(coverage: ProcessCoverage): string {
  const critical = coverage.gaps.filter(item => item.criticality === 'critical' && item.capabilityIds.length)
  if (!critical.length) return ''
  // Five, and each one short. The other end of this is a request field with a length limit, and an
  // instruction that arrives cut off mid-sentence tells the model a company needs something without
  // saying what.
  const lines = critical.slice(0, 5).map(item => `- ${item.name} (${item.framework.toUpperCase()} ${item.processId.split('-').slice(1).join('-')}): ${item.because.slice(0, 140)} Nothing selected carries it. Capabilities that would: ${item.capabilityIds.slice(0, 4).join(', ')}.`)
  return [
    'A completeness check against the APQC, SCOR and ISA-95 process frameworks found processes this company must be able to perform that nothing in your proposal carries:',
    ...lines,
    '',
    'For each one: select a capability that carries it where the conversation supports that the company does it, or leave it out and put the capability in excludedCapabilityIds. Do not select anything the operator gave you no evidence for — an unused page is worse than a missing one.',
  ].join('\n')
}
