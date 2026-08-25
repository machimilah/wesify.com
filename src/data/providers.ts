import { saysSignal } from '../engine/shared'
/**
 * Outside systems Wesify knows how to stand in front of.
 *
 * Wesify does not have to *be* the accounting system. Most companies already have one and will not swap
 * it. What they lack is one screen. So a capability can be **built** (Wesify owns the records) or
 * **connected** (another app owns them and Wesify shows them) — same page, same shape, different backing.
 *
 * `provides` must name capability ids that exist; `providers.test.ts` enforces that.
 */

export interface ProviderDefinition {
  id: string
  label: string
  category: 'accounting' | 'payments' | 'commerce' | 'crm' | 'people' | 'work' | 'support' | 'field-service'
  /** Words that mean "we already use this". Matched against what the company said. */
  signals: string[]
  /** Capabilities this app can back instead of Wesify building them. */
  provides: string[]
  /** Whether the app's API can accept changes from Wesify, not only hand them out. */
  writable: boolean
  /** What the operator has to do to connect it. Shown honestly before anything is connected. */
  auth: 'oauth' | 'api-key'
  home: string
}

const provider = (definition: ProviderDefinition) => definition

export const providers: ProviderDefinition[] = [
  provider({
    id: 'xero', label: 'Xero', category: 'accounting', auth: 'oauth', writable: true, home: 'https://www.xero.com',
    signals: ['xero'],
    provides: ['finance.invoicing', 'finance.accounts-payable', 'finance.bank-reconciliation', 'accounting.ledger', 'finance.tax'],
  }),
  provider({
    id: 'quickbooks', label: 'QuickBooks', category: 'accounting', auth: 'oauth', writable: true, home: 'https://quickbooks.intuit.com',
    signals: ['quickbooks', 'quick books', 'qbo'],
    provides: ['finance.invoicing', 'finance.accounts-payable', 'finance.bank-reconciliation', 'accounting.ledger', 'finance.expenses'],
  }),
  provider({
    id: 'sage', label: 'Sage', category: 'accounting', auth: 'oauth', writable: true, home: 'https://www.sage.com',
    signals: ['sage accounting', 'sage 50', 'sage business cloud'],
    provides: ['finance.invoicing', 'accounting.ledger', 'finance.accounts-payable'],
  }),
  provider({
    id: 'stripe', label: 'Stripe', category: 'payments', auth: 'api-key', writable: true, home: 'https://stripe.com',
    signals: ['stripe'],
    provides: ['finance.payments', 'subscriptions.billing'],
  }),
  provider({
    id: 'square', label: 'Square', category: 'payments', auth: 'oauth', writable: true, home: 'https://squareup.com',
    signals: ['square pos', 'square terminal', 'square reader'],
    provides: ['commerce.pos', 'finance.payments'],
  }),
  provider({
    id: 'shopify', label: 'Shopify', category: 'commerce', auth: 'oauth', writable: true, home: 'https://www.shopify.com',
    signals: ['shopify'],
    provides: ['commerce.ecommerce', 'commerce.products', 'sales.orders', 'inventory.stock'],
  }),
  provider({
    id: 'woocommerce', label: 'WooCommerce', category: 'commerce', auth: 'api-key', writable: true, home: 'https://woocommerce.com',
    signals: ['woocommerce', 'woo commerce'],
    provides: ['commerce.ecommerce', 'commerce.products', 'sales.orders'],
  }),
  provider({
    id: 'hubspot', label: 'HubSpot', category: 'crm', auth: 'oauth', writable: true, home: 'https://www.hubspot.com',
    signals: ['hubspot', 'hub spot'],
    provides: ['crm.contacts', 'crm.pipeline', 'crm.activities', 'marketing.email'],
  }),
  provider({
    id: 'salesforce', label: 'Salesforce', category: 'crm', auth: 'oauth', writable: true, home: 'https://www.salesforce.com',
    signals: ['salesforce', 'sales force'],
    provides: ['crm.contacts', 'crm.pipeline', 'crm.activities', 'sales.quotes'],
  }),
  provider({
    id: 'pipedrive', label: 'Pipedrive', category: 'crm', auth: 'oauth', writable: true, home: 'https://www.pipedrive.com',
    signals: ['pipedrive', 'pipe drive'],
    provides: ['crm.contacts', 'crm.pipeline'],
  }),
  provider({
    id: 'gusto', label: 'Gusto', category: 'people', auth: 'oauth', writable: false, home: 'https://gusto.com',
    signals: ['gusto'],
    provides: ['people.payroll', 'people.directory'],
  }),
  provider({
    id: 'bamboohr', label: 'BambooHR', category: 'people', auth: 'api-key', writable: true, home: 'https://www.bamboohr.com',
    signals: ['bamboohr', 'bamboo hr'],
    provides: ['people.directory', 'people.time-off', 'people.onboarding'],
  }),
  provider({
    id: 'asana', label: 'Asana', category: 'work', auth: 'oauth', writable: true, home: 'https://asana.com',
    signals: ['asana'],
    provides: ['work.projects', 'work.tasks'],
  }),
  provider({
    id: 'jira', label: 'Jira', category: 'work', auth: 'oauth', writable: true, home: 'https://www.atlassian.com/software/jira',
    signals: ['jira'],
    provides: ['work.tasks'],
  }),
  provider({
    id: 'monday', label: 'monday.com', category: 'work', auth: 'oauth', writable: true, home: 'https://monday.com',
    signals: ['monday.com', 'monday com'],
    provides: ['work.projects', 'work.tasks'],
  }),
  provider({
    id: 'harvest', label: 'Harvest', category: 'work', auth: 'oauth', writable: true, home: 'https://www.getharvest.com',
    signals: ['harvest time', 'getharvest'],
    provides: ['work.time'],
  }),
  provider({
    id: 'calendly', label: 'Calendly', category: 'work', auth: 'oauth', writable: false, home: 'https://calendly.com',
    signals: ['calendly'],
    provides: ['work.scheduling'],
  }),
  provider({
    id: 'zendesk', label: 'Zendesk', category: 'support', auth: 'oauth', writable: true, home: 'https://www.zendesk.com',
    signals: ['zendesk'],
    provides: ['support.tickets', 'support.knowledge'],
  }),
  provider({
    id: 'intercom', label: 'Intercom', category: 'support', auth: 'oauth', writable: true, home: 'https://www.intercom.com',
    signals: ['intercom'],
    provides: ['support.tickets'],
  }),
  provider({
    id: 'servicetitan', label: 'ServiceTitan', category: 'field-service', auth: 'oauth', writable: true, home: 'https://www.servicetitan.com',
    signals: ['servicetitan', 'service titan'],
    provides: ['service.field-work', 'work.scheduling'],
  }),
]

export const providerById = new Map(providers.map(item => [item.id, item]))

/** Which known apps the company said it already uses. */
export function detectProviders(text: string) {
  const normalized = text.toLowerCase()
  return providers
    .map(item => ({ provider: item, signal: item.signals.find(signal => saysSignal(normalized, signal)) }))
    .filter((item): item is { provider: ProviderDefinition; signal: string } => Boolean(item.signal))
}
