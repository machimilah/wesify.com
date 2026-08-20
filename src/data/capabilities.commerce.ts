import type { CapabilityDefinition } from '../engine/capabilityCatalog'
import { capability, currency, date, email, entity, file, long, number, relation, select, text } from './capabilityHelpers'

/**
 * Selling, serving and supporting customers.
 *
 * Signals are deliberately narrow. A signal fires whenever its phrase appears anywhere in what the
 * company said, so a broad word like "order" or "price" would attach a system to businesses that
 * never asked for it. Each phrase here should only occur when the capability is genuinely relevant.
 */
export const commerceCapabilities: CapabilityDefinition[] = [
  capability({
    id: 'sales.cpq', label: 'Configure, price, quote', module: 'sales',
    description: 'Configured products, price rules and discount approval before a quote goes out.',
    signals: ['configure price quote', 'cpq', 'configured product', 'price rules', 'discount approval', 'custom configuration'],
    dependencies: ['sales.quotes', 'commerce.products'],
    entities: [entity('quote-lines', 'Quote line', 'Quote lines', 'name', [
      text('name', 'Line', true), relation('quote', 'Quote', 'quotes'), relation('product', 'Product', 'products'),
      number('quantity', 'Quantity'), currency('listPrice', 'List price'), number('discountPercent', 'Discount %'),
      currency('netPrice', 'Net price'), select('status', 'Status', ['Draft', 'Needs approval', 'Approved', 'Rejected']), long('configuration', 'Configuration'),
    ], 'table')],
    pages: [{ id: 'quote-lines', label: 'Quote lines', entityId: 'quote-lines' }],
    metrics: [{ id: 'quote-lines-pending', label: 'Discounts awaiting approval', entityId: 'quote-lines', operation: 'count', statusNotEquals: 'Approved' }],
    workflows: [{ id: 'discount-approval', name: 'Discount approval required', entityId: 'quote-lines', event: 'updated', field: 'status', equals: 'Needs approval', message: 'A quote line needs discount approval.' }],
  }),
  capability({
    id: 'sales.commissions', label: 'Sales commissions', module: 'sales',
    description: 'Commission plans, attainment and what is owed to each seller.',
    signals: ['commission', 'commissions', 'sales incentive', 'quota attainment', 'bonus on sales'],
    dependencies: ['crm.pipeline', 'people.directory'],
    entities: [entity('commissions', 'Commission', 'Commissions', 'name', [
      text('name', 'Commission', true), relation('employee', 'Seller', 'employees'), relation('opportunity', 'Deal', 'opportunities'),
      currency('dealValue', 'Deal value'), number('ratePercent', 'Rate %'), currency('amount', 'Commission'),
      select('status', 'Status', ['Accrued', 'Approved', 'Paid', 'Clawed back']), date('period', 'Period'),
    ])],
    pages: [{ id: 'commissions', label: 'Commissions', entityId: 'commissions' }],
    metrics: [{ id: 'commission-owed', label: 'Commission owed', entityId: 'commissions', operation: 'sum', field: 'amount', format: 'currency', statusNotEquals: 'Paid' }],
  }),
  capability({
    id: 'sales.territories', label: 'Territories and quotas', module: 'sales',
    description: 'Who owns which market, and the number each owner is carrying.',
    signals: ['territory', 'territories', 'sales quota', 'patch', 'account assignment'],
    dependencies: ['crm.pipeline', 'people.directory'],
    entities: [entity('territories', 'Territory', 'Territories', 'name', [
      text('name', 'Territory', true), relation('owner', 'Owner', 'employees'), text('region', 'Region'),
      currency('quota', 'Quota'), currency('attainment', 'Attainment'), select('status', 'Status', ['Active', 'Under review', 'Retired']),
    ])],
    pages: [{ id: 'territories', label: 'Territories', entityId: 'territories' }],
  }),
  capability({
    id: 'crm.partners', label: 'Channel partners and resellers', module: 'customers',
    description: 'Resellers, referrers and distributors who sell on the company behalf.',
    signals: ['reseller', 'channel partner', 'distributor network', 'referral partner', 'affiliate'],
    dependencies: ['crm.contacts'],
    entities: [entity('partners', 'Partner', 'Partners', 'name', [
      text('name', 'Partner', true), select('tier', 'Tier', ['Registered', 'Silver', 'Gold', 'Strategic']),
      email('email', 'Email'), number('marginPercent', 'Margin %'), currency('sourcedRevenue', 'Sourced revenue'),
      select('status', 'Status', ['Prospect', 'Active', 'Inactive']),
    ])],
    pages: [{ id: 'partners', label: 'Partners', entityId: 'partners' }],
    metrics: [{ id: 'partner-revenue', label: 'Partner-sourced revenue', entityId: 'partners', operation: 'sum', field: 'sourcedRevenue', format: 'currency' }],
  }),
  capability({
    id: 'crm.loyalty', label: 'Loyalty and rewards', module: 'customers',
    description: 'Points, tiers and rewards that bring customers back.',
    signals: ['loyalty', 'rewards program', 'points scheme', 'stamp card', 'repeat customer program'],
    dependencies: ['crm.contacts'],
    entities: [entity('loyalty-accounts', 'Loyalty account', 'Loyalty', 'name', [
      text('name', 'Member', true), relation('customer', 'Customer', 'customers'), number('points', 'Points'),
      select('tier', 'Tier', ['Bronze', 'Silver', 'Gold']), date('lastActivity', 'Last activity'),
      select('status', 'Status', ['Active', 'Dormant', 'Closed']),
    ])],
    pages: [{ id: 'loyalty', label: 'Loyalty', entityId: 'loyalty-accounts' }],
  }),
  capability({
    id: 'commerce.pricelists', label: 'Price lists and discounts', module: 'commerce',
    description: 'Different prices for different customers, volumes, channels or seasons.',
    signals: ['price list', 'pricelist', 'tiered pricing', 'volume discount', 'customer pricing', 'trade price'],
    dependencies: ['commerce.products'],
    entities: [entity('price-lists', 'Price list', 'Price lists', 'name', [
      text('name', 'Price list', true), relation('product', 'Product', 'products'), text('appliesTo', 'Applies to'),
      currency('price', 'Price'), number('minimumQuantity', 'Minimum quantity'), date('validFrom', 'Valid from'),
      date('validUntil', 'Valid until'), select('status', 'Status', ['Draft', 'Active', 'Expired']),
    ])],
    pages: [{ id: 'price-lists', label: 'Price lists', entityId: 'price-lists' }],
  }),
  capability({
    id: 'commerce.marketplace', label: 'Marketplace channels', module: 'commerce',
    description: 'Listings and orders from third-party marketplaces alongside direct sales.',
    signals: ['marketplace', 'amazon seller', 'ebay', 'etsy', 'third-party channel', 'multichannel selling'],
    dependencies: ['commerce.products', 'sales.orders'],
    entities: [entity('channel-listings', 'Listing', 'Channel listings', 'name', [
      text('name', 'Listing', true), relation('product', 'Product', 'products'), text('channel', 'Channel'),
      currency('channelPrice', 'Channel price'), number('channelStock', 'Channel stock'),
      select('status', 'Status', ['Draft', 'Live', 'Paused', 'Ended']), date('lastSynced', 'Last synced'),
    ])],
    pages: [{ id: 'channel-listings', label: 'Channels', entityId: 'channel-listings' }],
  }),
  capability({
    id: 'commerce.dropship', label: 'Dropshipping', module: 'commerce',
    description: 'Orders fulfilled directly by a supplier without ever holding the stock.',
    signals: ['dropship', 'drop ship', 'dropshipping', 'supplier ships direct', 'fulfilled by supplier'],
    dependencies: ['sales.orders', 'procurement.suppliers'],
    entities: [entity('dropship-orders', 'Dropship order', 'Dropship orders', 'number', [
      text('number', 'Reference', true), relation('order', 'Sales order', 'orders'), relation('supplier', 'Supplier', 'suppliers'),
      select('status', 'Status', ['Placed', 'Acknowledged', 'Shipped', 'Delivered', 'Failed']),
      text('trackingNumber', 'Tracking number'), date('expectedDate', 'Expected date'),
    ], 'kanban', 'status')],
    pages: [{ id: 'dropship', label: 'Dropship', entityId: 'dropship-orders', view: 'kanban' }],
    metrics: [{ id: 'dropship-open', label: 'Open dropship orders', entityId: 'dropship-orders', operation: 'count', statusNotEquals: 'Delivered' }],
  }),
  capability({
    id: 'commerce.consignment', label: 'Consignment stock', module: 'inventory',
    description: 'Stock held at a customer or supplier site that is only invoiced when it is used.',
    signals: ['consignment', 'consigned stock', 'stock on loan', 'vendor managed inventory', 'sale or return'],
    dependencies: ['inventory.stock', 'procurement.suppliers'],
    entities: [entity('consignments', 'Consignment', 'Consignment', 'reference', [
      text('reference', 'Reference', true), relation('product', 'Product', 'products'), text('heldAt', 'Held at'),
      number('quantity', 'Quantity'), number('consumed', 'Consumed'), date('placedDate', 'Placed'),
      select('status', 'Status', ['Placed', 'Partly consumed', 'Consumed', 'Returned']),
    ])],
    pages: [{ id: 'consignment', label: 'Consignment', entityId: 'consignments' }],
  }),
  capability({
    id: 'service.warranty', label: 'Warranty and service contracts', module: 'field-service',
    description: 'What is covered, until when, and what the company owes under each agreement.',
    signals: ['warranty', 'service contract', 'service agreement', 'maintenance plan', 'extended cover', 'amc'],
    dependencies: ['service.assets'],
    entities: [entity('warranties', 'Warranty', 'Warranties', 'number', [
      text('number', 'Agreement', true), relation('asset', 'Asset', 'service-assets'), relation('customer', 'Customer', 'customers'),
      select('coverage', 'Coverage', ['Parts', 'Labour', 'Parts and labour', 'Full service']),
      date('startDate', 'Start date'), date('endDate', 'Expires'), currency('value', 'Contract value'),
      select('status', 'Status', ['Active', 'Expiring', 'Expired', 'Void']),
    ])],
    pages: [{ id: 'warranties', label: 'Warranties', entityId: 'warranties' }],
    metrics: [{ id: 'active-warranties', label: 'Active agreements', entityId: 'warranties', operation: 'count', statusNotEquals: 'Expired' }],
    workflows: [{ id: 'warranty-expiring', name: 'Warranty expiring', entityId: 'warranties', event: 'updated', field: 'status', equals: 'Expiring', message: 'A service agreement is about to expire.' }],
  }),
  capability({
    id: 'service.rma', label: 'Returns for repair', module: 'field-service',
    description: 'Goods returned for repair or replacement, tracked from authorization to despatch.',
    signals: ['rma', 'return merchandise', 'repair centre', 'repair center', 'send it back for repair', 'depot repair'],
    dependencies: ['sales.orders', 'service.assets'],
    entities: [entity('repair-orders', 'Repair', 'Repairs', 'number', [
      text('number', 'RMA number', true), relation('customer', 'Customer', 'customers'), relation('asset', 'Asset', 'service-assets'),
      select('status', 'Status', ['Requested', 'Authorized', 'Received', 'In repair', 'Awaiting parts', 'Repaired', 'Returned', 'Rejected']),
      long('fault', 'Reported fault'), long('workDone', 'Work done'), currency('cost', 'Repair cost'), date('dueDate', 'Promised date'),
    ], 'kanban', 'status')],
    pages: [{ id: 'repairs', label: 'Repairs', entityId: 'repair-orders', view: 'kanban' }],
    metrics: [{ id: 'open-repairs', label: 'Repairs in progress', entityId: 'repair-orders', operation: 'count', statusNotEquals: 'Returned' }],
  }),
  capability({
    id: 'support.sla', label: 'Service levels and escalation', module: 'support',
    description: 'Response and resolution promises, and what happens when one is about to be missed.',
    signals: ['sla', 'service level agreement', 'response time guarantee', 'escalation policy', 'priority response'],
    dependencies: ['support.tickets'],
    entities: [entity('service-levels', 'Service level', 'Service levels', 'name', [
      text('name', 'Service level', true), select('priority', 'Priority', ['Low', 'Normal', 'High', 'Urgent']),
      number('responseHours', 'Response hours'), number('resolutionHours', 'Resolution hours'),
      text('appliesTo', 'Applies to'), select('status', 'Status', ['Active', 'Paused']),
    ])],
    pages: [{ id: 'service-levels', label: 'Service levels', entityId: 'service-levels' }],
  }),
  capability({
    id: 'support.csat', label: 'Customer satisfaction', module: 'support',
    description: 'What customers said after the work was done, tied to the request it followed.',
    signals: ['csat', 'customer satisfaction survey', 'nps', 'feedback score', 'review after service'],
    dependencies: ['support.tickets'],
    entities: [entity('satisfaction-responses', 'Response', 'Satisfaction', 'reference', [
      text('reference', 'Response', true), relation('ticket', 'Request', 'tickets'), relation('customer', 'Customer', 'customers'),
      number('score', 'Score'), long('comment', 'Comment'), date('receivedDate', 'Received'),
      select('status', 'Follow-up', ['None needed', 'Follow up', 'Followed up']),
    ])],
    pages: [{ id: 'satisfaction', label: 'Satisfaction', entityId: 'satisfaction-responses' }],
    metrics: [{ id: 'satisfaction-average', label: 'Satisfaction responses', entityId: 'satisfaction-responses', operation: 'count' }],
  }),
  capability({
    id: 'documents.proposals', label: 'Proposal building', module: 'documents',
    description: 'Reusable proposal content assembled per prospect and tracked to a decision.',
    signals: ['proposal template', 'pitch document', 'tender response', 'bid document', 'statement of work'],
    dependencies: ['documents.repository', 'crm.contacts'],
    entities: [entity('proposals', 'Proposal', 'Proposals', 'name', [
      text('name', 'Proposal', true), relation('customer', 'Client', 'customers'), currency('value', 'Value'),
      select('status', 'Status', ['Drafting', 'Internal review', 'Sent', 'Won', 'Lost']),
      date('dueDate', 'Submission date'), file('document', 'Document'), long('summary', 'Summary'),
    ], 'kanban', 'status')],
    pages: [{ id: 'proposals', label: 'Proposals', entityId: 'proposals', view: 'kanban' }],
    metrics: [{ id: 'proposals-open', label: 'Proposals in play', entityId: 'proposals', operation: 'count', statusNotEquals: 'Won' }],
  }),
  capability({
    id: 'commerce.bundles', label: 'Bundles and packages', module: 'commerce',
    description: 'Several products sold together as one thing, priced as a package.',
    signals: ['bundle', 'product bundle', 'package deal', 'sold together as a set', 'combo offer'],
    dependencies: ['commerce.products'],
    entities: [entity('bundles', 'Bundle', 'Bundles', 'name', [
      text('name', 'Bundle', true), long('contents', 'What is included'), currency('bundlePrice', 'Bundle price'),
      currency('componentValue', 'Value if bought separately'), number('savingPercent', 'Saving %'),
      select('status', 'Status', ['Draft', 'Active', 'Retired']),
    ])],
    pages: [{ id: 'bundles', label: 'Bundles', entityId: 'bundles' }],
  }),
]