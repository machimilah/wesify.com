import type { IndustryCapabilityPack } from '../engine/capabilityCatalog'

/**
 * Operating archetypes for the sectors BO's original packs did not reach.
 *
 * Together with the packs in `capabilityCatalog.ts` these cover all 20 NAICS sectors, so any business
 * a person can describe resolves to an operating model rather than falling through to a generic base.
 * Every capability id here must exist in the catalog and bring its dependencies — the catalog test
 * enforces both.
 */
export const extendedIndustryPacks: IndustryCapabilityPack[] = [
  {
    id: 'agriculture',
    label: 'Agriculture and primary production',
    signals: ['farm', 'farming', 'agriculture', 'agricultural', 'crop', 'livestock', 'orchard', 'vineyard', 'dairy', 'ranch', 'forestry', 'logging', 'fishery', 'aquaculture', 'grower'],
    capabilities: ['crm.contacts', 'sales.orders', 'commerce.products', 'inventory.stock', 'inventory.traceability', 'procurement.suppliers', 'procurement.purchasing', 'maintenance.assets', 'work.scheduling', 'quality.inspections', 'logistics.shipping', 'people.directory', 'people.attendance', 'finance.invoicing', 'finance.expenses'],
  },
  {
    id: 'extraction',
    label: 'Mining and extraction',
    signals: ['mining', 'quarry', 'quarrying', 'oil and gas', 'extraction', 'drilling', 'wellsite', 'minerals'],
    capabilities: ['crm.contacts', 'sales.orders', 'commerce.products', 'inventory.stock', 'procurement.suppliers', 'procurement.purchasing', 'maintenance.assets', 'work.scheduling', 'quality.inspections', 'logistics.shipping', 'compliance.controls', 'documents.repository', 'documents.approvals', 'people.directory', 'people.attendance', 'finance.invoicing', 'finance.expenses'],
  },
  {
    id: 'utilities',
    label: 'Utilities and network operations',
    signals: ['utility company', 'utilities', 'power company', 'water treatment', 'electricity supplier', 'pipeline operator', 'telecom operator', 'broadband provider'],
    capabilities: ['crm.contacts', 'subscriptions.billing', 'work.scheduling', 'service.field-work', 'service.assets', 'maintenance.assets', 'support.tickets', 'commerce.products', 'inventory.stock', 'procurement.suppliers', 'procurement.purchasing', 'compliance.controls', 'documents.repository', 'documents.approvals', 'people.directory', 'finance.invoicing', 'finance.payments'],
  },
  {
    id: 'media',
    label: 'Media and publishing',
    signals: ['publisher', 'publishing', 'broadcast', 'broadcasting', 'film production', 'media company', 'record label', 'magazine', 'newspaper', 'podcast', 'streaming service'],
    capabilities: ['crm.contacts', 'crm.pipeline', 'sales.contracts', 'work.projects', 'work.tasks', 'work.time', 'subscriptions.billing', 'marketing.campaigns', 'documents.repository', 'documents.templates', 'people.directory', 'finance.invoicing', 'finance.expenses'],
  },
  {
    id: 'financial-services',
    label: 'Financial services and insurance',
    signals: ['bank', 'lender', 'lending', 'mortgage', 'insurance', 'insurer', 'brokerage', 'investment firm', 'wealth management', 'credit union', 'fund manager'],
    capabilities: ['crm.contacts', 'crm.pipeline', 'crm.activities', 'sales.contracts', 'documents.repository', 'documents.esign', 'documents.approvals', 'compliance.controls', 'support.tickets', 'accounting.ledger', 'analytics.reporting', 'people.directory', 'finance.invoicing', 'finance.payments', 'finance.expenses'],
  },
  {
    id: 'events',
    label: 'Events, venues and recreation',
    signals: ['event company', 'venue', 'theatre', 'theater', 'museum', 'gallery', 'sports club', 'gym', 'fitness studio', 'recreation', 'amusement', 'festival', 'stadium'],
    capabilities: ['crm.contacts', 'work.scheduling', 'commerce.products', 'commerce.pos', 'subscriptions.billing', 'marketing.campaigns', 'inventory.stock', 'procurement.suppliers', 'procurement.purchasing', 'people.directory', 'people.attendance', 'finance.invoicing', 'finance.payments'],
  },
  {
    id: 'personal-services',
    label: 'Personal services',
    signals: ['salon', 'barber', 'spa', 'laundry', 'dry cleaning', 'funeral', 'pet grooming', 'nail salon', 'beauty', 'tailor', 'massage'],
    capabilities: ['crm.contacts', 'work.scheduling', 'commerce.products', 'commerce.pos', 'inventory.stock', 'marketing.email', 'people.directory', 'people.attendance', 'finance.invoicing', 'finance.payments'],
  },
  {
    id: 'facilities',
    label: 'Facilities and business support services',
    signals: ['cleaning company', 'janitorial', 'landscaping', 'security services', 'facilities management', 'staffing agency', 'waste collection', 'pest control', 'grounds maintenance'],
    capabilities: ['crm.contacts', 'sales.quotes', 'sales.contracts', 'work.scheduling', 'service.field-work', 'commerce.products', 'inventory.stock', 'procurement.suppliers', 'procurement.purchasing', 'documents.approvals', 'people.directory', 'people.attendance', 'people.time-off', 'finance.invoicing', 'finance.payments', 'finance.expenses'],
  },
  {
    id: 'membership',
    label: 'Membership organizations',
    signals: ['association', 'membership organization', 'trade union', 'church', 'religious organization', 'civic organization', 'chamber of commerce', 'members club'],
    capabilities: ['crm.contacts', 'subscriptions.billing', 'work.projects', 'work.scheduling', 'marketing.email', 'documents.repository', 'analytics.reporting', 'vertical.nonprofit', 'people.directory', 'finance.invoicing', 'finance.payments', 'finance.expenses', 'finance.budgets'],
  },
  {
    id: 'public-sector',
    label: 'Public administration',
    signals: ['government agency', 'municipality', 'public administration', 'city council', 'public sector', 'local authority'],
    capabilities: ['crm.contacts', 'work.projects', 'work.tasks', 'documents.repository', 'documents.approvals', 'compliance.controls', 'procurement.suppliers', 'procurement.purchasing', 'support.tickets', 'analytics.reporting', 'people.directory', 'people.attendance', 'finance.budgets', 'finance.expenses'],
  },
]
