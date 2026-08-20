import { describe, expect, it } from 'vitest'
import { selectCompanyTemplate } from './companyTemplates'

describe('company base models', () => {
  it.each([
    ['We run a marketing agency for technology companies', 'agency'],
    ['A B2B SaaS platform for compliance teams', 'saas'],
    ['We manufacture industrial pumps in our factory', 'manufacturing'],
    ['An ecommerce store selling outdoor products', 'retail'],
    ['HVAC installation and maintenance company', 'field-service'],
    ['A general contractor building commercial offices', 'construction'],
    ['A dental clinic managing appointments and patients', 'healthcare'],
    ['Property management for 200 rental apartments', 'property'],
    ['A restaurant with table reservations and two locations', 'hospitality'],
    ['A trucking and freight logistics company', 'logistics'],
    ['A training company selling professional courses', 'education'],
    ['A nonprofit managing donors and grants', 'nonprofit'],
    ['A wholesale distributor of electrical parts', 'wholesale'],
    ['An equipment rental company for construction tools', 'rental'],
  ])('selects %s as %s', (brief, expected) => expect(selectCompanyTemplate(brief).id).toBe(expected))

  it('uses a conservative generic base for an unknown model', () => {
    expect(selectCompanyTemplate('We help organizations do specialist work').id).toBe('generic')
  })
})
