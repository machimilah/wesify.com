import { describe, expect, it } from 'vitest'
import { apqcProcesses, isa95Processes, scorProcesses } from '../data/processFrameworks'
import { classifyProcessCoverage, withRoleAwareControls } from './processCoverage'

/**
 * The check that catches what nobody mentioned, without inventing a company nobody described.
 *
 * Both halves matter and they pull against each other. A bakery that never talked about buying flour
 * still has to buy flour, and a build with no way to do it is broken however faithfully it followed
 * the interview. A student tracking coursework does not have suppliers, and telling them they are
 * missing procurement is how a workspace turns into somebody else's software.
 */

const verdictFor = (coverage: ReturnType<typeof classifyProcessCoverage>, id: string) =>
  coverage.processes.find(item => item.processId === id)!

const bakery = 'We are a bakery. We bake bread and pastries every morning and sell them to cafes and to people at the counter.'
const consultancy = 'I am a solo consultant. I run strategy projects for corporate clients and invoice each client per milestone.'
const coursework = 'I want to keep track of my school work: assignments, classes and deadlines.'

describe('process coverage', () => {
  it('finds the operations a bakery has and the build does not', () => {
    const coverage = classifyProcessCoverage({ text: bakery, capabilityIds: ['commerce.products', 'sales.orders', 'crm.contacts'] })
    const critical = coverage.gaps.filter(item => item.criticality === 'critical').map(item => item.processId)
    // Buying flour, baking it, being paid for it, paying for the flour, and proving the food is safe.
    expect(critical).toEqual(expect.arrayContaining(['apqc-4.2', 'apqc-4.3', 'apqc-9.2', 'apqc-9.6', 'apqc-11.2']))
    for (const gap of coverage.gaps) expect(gap.because.length, gap.processId).toBeGreaterThan(10)
    expect(coverage.gaps.find(item => item.processId === 'apqc-4.2')?.capabilityIds).toContain('procurement.suppliers')
  })

  it('reports one missing thing once, however many frameworks noticed it', () => {
    const coverage = classifyProcessCoverage({ text: bakery, capabilityIds: ['commerce.products', 'sales.orders'] })
    // SCOR Source and APQC 4.2 are the same absent purchasing, seen twice.
    expect(coverage.gaps.map(item => item.processId)).toContain('apqc-4.2')
    expect(coverage.gaps.map(item => item.processId)).not.toContain('scor-Source')
  })

  it('requires nothing at all of a workspace that is not a business', () => {
    const coverage = classifyProcessCoverage({ text: coursework, capabilityIds: ['work.tasks'] })
    expect(coverage.trading).toBe(false)
    expect(coverage.gaps).toEqual([])
    expect(verdictFor(coverage, 'apqc-4.2').classification).toBe('unknown')
    expect(JSON.stringify(coverage.gaps)).not.toMatch(/supplier|invoice|payroll/i)
  })

  it('rules out manufacturing for a company that sells work rather than goods, and says why', () => {
    const coverage = classifyProcessCoverage({ text: consultancy, capabilityIds: ['crm.contacts', 'work.projects', 'finance.invoicing', 'work.time'] })
    for (const item of isa95Processes) expect(verdictFor(coverage, item.id).classification, item.id).toBe('not-applicable')
    expect(verdictFor(coverage, 'isa95-Quality').because).toMatch(/sells work rather than goods|converts inputs into output/)
    expect(coverage.gaps.map(item => item.processId)).not.toContain('apqc-4.3')
  })

  it('keeps the supply chain for a company that sells software and hardware both', () => {
    const coverage = classifyProcessCoverage({
      text: 'We sell a subscription web app, and we also assemble and ship the sensor units our customers install.',
      capabilityIds: ['subscriptions.billing', 'manufacturing.production'],
    })
    expect(verdictFor(coverage, 'apqc-4.4').classification).not.toBe('not-applicable')
    for (const item of scorProcesses) expect(verdictFor(coverage, item.id).classification, item.id).not.toBe('not-applicable')
  })

  it('leaves payroll out for one person and keeps it in for a company with staff', () => {
    const solo = classifyProcessCoverage({ text: 'Just me, I work alone, invoicing clients for consulting.', capabilityIds: ['finance.invoicing'] })
    expect(verdictFor(solo, 'apqc-9.5').classification).toBe('not-applicable')
    const team = classifyProcessCoverage({ text: 'We have eight staff on shifts and run payroll every month for our restaurant.', capabilityIds: ['people.directory'] })
    expect(verdictFor(team, 'apqc-9.5').classification).not.toBe('not-applicable')
  })

  it('names the regulatory subject and never the regulation', () => {
    const coverage = classifyProcessCoverage({ text: bakery, capabilityIds: ['commerce.products'] })
    const food = coverage.regulatory.find(item => item.id === 'food')!
    expect(food.verify).toBe(true)
    expect(food.authorities.join(' ')).toMatch(/authority|inspectorate|FDA|USDA/)
    expect(food.obligations.length).toBeGreaterThan(2)
    // Nothing asserted: no article, no deadline, no certificate number anybody could act on.
    expect(JSON.stringify(food.obligations)).not.toMatch(/\barticle\b|\bregulation \d|\bwithin \d+ days\b/i)
  })

  it('says a control is missing only where the company does the thing it protects', () => {
    const spending = classifyProcessCoverage({ text: 'We raise purchase orders with our suppliers every week.', capabilityIds: ['procurement.purchasing', 'procurement.suppliers'] })
    const approval = spending.controls.find(item => item.id === 'spend-approval')!
    expect(approval.applies).toBe(true)
    expect(approval.satisfied).toBe(false)
    expect(approval.missingCapabilityIds).toContain('documents.approvals')

    const noSpending = classifyProcessCoverage({ text: coursework, capabilityIds: ['work.tasks'] })
    expect(noSpending.controls.find(item => item.id === 'spend-approval')?.applies).toBe(false)
  })

  it('judges segregation of duties on the roles a build actually has', () => {
    const coverage = classifyProcessCoverage({ text: 'We invoice customers and pay suppliers.', capabilityIds: ['finance.invoicing', 'finance.payments'] })
    expect(withRoleAwareControls(coverage, ['finance.invoicing', 'finance.payments'], 1).controls.find(item => item.id === 'duty-separation')?.satisfied).toBe(false)
    expect(withRoleAwareControls(coverage, ['finance.invoicing', 'finance.payments'], 5).controls.find(item => item.id === 'duty-separation')?.satisfied).toBe(true)
  })

  it('gives every process a verdict and a reason, whichever way it went', () => {
    const coverage = classifyProcessCoverage({ text: bakery, capabilityIds: ['commerce.products'] })
    expect(coverage.processes).toHaveLength(apqcProcesses.length + scorProcesses.length + isa95Processes.length)
    for (const item of coverage.processes) {
      expect(['required', 'applicable', 'potentially-applicable', 'not-applicable', 'unknown'], item.processId).toContain(item.classification)
      expect(item.because.length, item.processId).toBeGreaterThan(10)
    }
  })

  it('asks only questions an operator could answer off the top of their head', () => {
    const coverage = classifyProcessCoverage({ text: bakery, capabilityIds: ['commerce.products', 'sales.orders', 'crm.contacts'] })
    for (const gap of coverage.gaps.filter(item => item.question)) {
      expect(gap.question, gap.processId).toMatch(/\?$/)
      // Never the framework's own wording read back at somebody.
      expect(gap.question, gap.processId).not.toMatch(/process group|enterprise|APQC|capability/i)
    }
  })
})
