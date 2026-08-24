import { describe, expect, it } from 'vitest'
import { excludedOperatingKnowledge } from '../data/operatingKnowledge'
import { capabilityKnowledgeFor, enrichEntityFieldsFromKnowledge, evaluateOperatingKnowledge, knowledgeRequirementsFor } from './knowledgeEngine'

describe('operating knowledge', () => {
  it('activates manufacturing knowledge from evidence without importing payroll calculations', () => {
    const evaluation = evaluateOperatingKnowledge('We manufacture pumps in batches, inspect quality, and buy raw materials from certified suppliers.')
    expect(evaluation.requirements.map(item => item.id)).toEqual(expect.arrayContaining(['supply-continuity', 'quality-and-exceptions']))
    expect(evaluation.recommendedCapabilityIds).toEqual(expect.arrayContaining(['procurement.suppliers', 'quality.inspections']))
    expect(JSON.stringify(evaluation)).not.toMatch(/payroll|overtime|holiday|labor calculation/i)
    expect(excludedOperatingKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'do-payroll-and-labor-calculations', executable: false })]))
  })

  it('does not add industry knowledge to a solo consultancy', () => {
    const evaluation = evaluateOperatingKnowledge('I run a solo consultancy delivering strategy projects and invoice each client per milestone.')
    expect(evaluation.requirements.map(item => item.id)).not.toEqual(expect.arrayContaining(['inventory-control', 'quality-and-exceptions', 'asset-continuity']))
    expect(evaluation.recommendedCapabilityIds).not.toEqual(expect.arrayContaining(['manufacturing.production', 'quality.inspections', 'people.payroll']))
  })

  it('adds optional master-data fields only when the company supplies evidence', () => {
    const suppliers = [{ id: 'suppliers', label: 'Supplier', pluralLabel: 'Suppliers', fields: [{ id: 'name', label: 'Supplier', type: 'text' as const }] }]
    const withoutEvidence = enrichEntityFieldsFromKnowledge(suppliers, 'We buy materials from suppliers.', ['procurement.suppliers'])
    const withEvidence = enrichEntityFieldsFromKnowledge(suppliers, 'Every supplier must hold a current certification.', ['procurement.suppliers'])
    expect(withoutEvidence[0].fields.map(item => item.id)).not.toContain('certifications')
    expect(withEvidence[0].fields.map(item => item.id)).toContain('certifications')
  })

  it('classifies capability knowledge and marks payroll knowledge non-executable', () => {
    expect(capabilityKnowledgeFor('manufacturing.production')).toEqual(expect.objectContaining({ layer: 'industry', source: 'mixed', executable: true }))
    expect(capabilityKnowledgeFor('crm.contacts')).toEqual(expect.objectContaining({ layer: 'universal', executable: true }))
    expect(capabilityKnowledgeFor('people.payroll')).toEqual(expect.objectContaining({ layer: 'jurisdiction', executable: false }))
  })

  it('ranks knowledge requirements and returns decision information instead of written questions', () => {
    const requirements = knowledgeRequirementsFor('We run a business with a small team.')
    expect(requirements[0].priority).toBe('critical')
    expect(requirements[0].informationNeeded.length).toBeGreaterThan(0)
    expect(requirements[0].decisionImpact).toBeInstanceOf(Array)
    expect(JSON.stringify(requirements)).not.toMatch(/questionText|suggestedAnswer/)
  })

  it('classifies contextual gaps and returns multidimensional recommendations', () => {
    const evaluation = evaluateOperatingKnowledge('We depend on one supplier for critical parts and purchases need approval.')
    const supplier = evaluation.gaps.find(item => item.id === 'supplier-control')
    expect(supplier).toEqual(expect.objectContaining({ classification: 'required' }))
    expect(supplier?.recommendations.capabilityIds).toEqual(expect.arrayContaining(['procurement.suppliers']))
    expect(supplier?.recommendations.processIds.length).toBeGreaterThan(0)
    expect(supplier?.recommendations.kpiPatternIds).toContain('supplier-reliability')
    expect(evaluation.gaps.find(item => item.id === 'approval-control')?.recommendations.controlIds).toContain('approval-threshold')
  })
})
