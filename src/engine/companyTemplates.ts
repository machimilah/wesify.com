import type { AIBlueprint, ModuleId } from './blueprint'
import { saysSignal } from './shared'

export type CompanyTemplateId = 'agency' | 'professional-services' | 'saas' | 'manufacturing' | 'retail' | 'field-service' | 'construction' | 'healthcare' | 'property' | 'hospitality' | 'logistics' | 'education' | 'nonprofit' | 'wholesale' | 'rental' | 'generic'

export interface CompanyTemplate {
  id: CompanyTemplateId
  label: string
  signals: string[]
  blueprint: AIBlueprint
  coreRecords: string[]
}

const template = (
  id: CompanyTemplateId,
  label: string,
  signals: string[],
  modules: ModuleId[],
  startView: AIBlueprint['startView'],
  pipelineStages: string[],
  processSteps: string[],
  billingCadence: string,
  inventoryStages: string[],
  supportStages: string[],
  coreRecords: string[],
): CompanyTemplate => ({ id, label, signals, blueprint: { modules, startView, moduleConfig: { pipelineStages, processSteps, billingCadence, inventoryStages, supportStages } }, coreRecords })

// These are reusable workspace references for the legacy dashboard compiler. They never select or generate discovery questions.
export const companyTemplates: CompanyTemplate[] = [
  template('agency', 'Marketing or creative agency', ['marketing agency', 'creative agency', 'advertising agency', 'branding agency', 'design agency', 'seo agency'], ['sales', 'customers', 'projects', 'processes', 'finance', 'team'], 'projects', ['Lead', 'Qualified', 'Discovery', 'Proposal', 'Won'], ['Brief', 'Plan', 'Produce', 'Review', 'Deliver'], 'Project, retainer, or milestone', [], [], ['Lead', 'Client', 'Proposal', 'Project', 'Task', 'Deliverable', 'Invoice', 'Time entry']),
  template('professional-services', 'Consulting or professional services', ['consulting', 'consultancy', 'professional services', 'accounting firm', 'law firm', 'advisory'], ['sales', 'customers', 'projects', 'processes', 'finance', 'team'], 'projects', ['Lead', 'Qualified', 'Scoping', 'Proposal', 'Engaged'], ['Discovery', 'Plan', 'Execute', 'Review', 'Complete'], 'Fixed fee, time and materials, or retainer', [], [], ['Lead', 'Client', 'Engagement', 'Project', 'Task', 'Time entry', 'Expense', 'Invoice']),
  template('saas', 'SaaS or subscription software', ['saas', 'software as a service', 'subscription software', 'b2b software', 'software platform'], ['sales', 'customers', 'projects', 'processes', 'finance', 'team', 'support'], 'sales', ['Lead', 'Qualified', 'Demo', 'Trial', 'Negotiation', 'Won'], ['Onboarding', 'Implementation', 'Adoption', 'Renewal'], 'Recurring subscription', [], ['New', 'Triage', 'In progress', 'Waiting', 'Resolved'], ['Lead', 'Account', 'Contact', 'Opportunity', 'Subscription', 'Onboarding', 'Ticket', 'Invoice']),
  template('manufacturing', 'Manufacturing', ['manufacturing', 'manufacturer', 'factory', 'production line', 'assembly', 'fabrication'], ['sales', 'customers', 'processes', 'finance', 'team', 'inventory'], 'processes', ['RFQ', 'Qualified', 'Quote', 'Order'], ['Plan', 'Issue materials', 'Production', 'Quality', 'Finished goods'], 'Per order or agreed terms', ['Raw material', 'Allocated', 'Work in progress', 'Finished', 'Shipped'], [], ['Customer', 'RFQ', 'Quote', 'Sales order', 'Item', 'BOM', 'Work order', 'Inventory movement', 'Invoice']),
  template('retail', 'Retail or e-commerce', ['ecommerce', 'e-commerce', 'online store', 'retail store', 'retailer', 'shopify'], ['customers', 'processes', 'finance', 'inventory', 'support'], 'processes', [], ['Order received', 'Paid', 'Pick', 'Pack', 'Ship', 'Delivered'], 'At checkout or invoice', ['In stock', 'Reserved', 'Picked', 'Shipped', 'Returned'], ['New', 'Review', 'Action', 'Resolved'], ['Customer', 'Product', 'Variant', 'Order', 'Payment', 'Fulfillment', 'Shipment', 'Return', 'Refund']),
  template('field-service', 'Field service company', ['field service', 'maintenance company', 'repair service', 'installation service', 'hvac', 'plumbing', 'electrician', 'landscaping'], ['customers', 'projects', 'processes', 'finance', 'team', 'inventory', 'support'], 'processes', [], ['Create', 'Schedule', 'Dispatch', 'Service', 'Review', 'Invoice'], 'On completion or service agreement', ['Warehouse', 'Vehicle', 'Reserved', 'Used', 'Returned'], ['Request', 'Triage', 'Scheduled', 'In progress', 'Resolved'], ['Customer', 'Asset', 'Service request', 'Work order', 'Booking', 'Technician', 'Part usage', 'Invoice']),
  template('construction', 'Construction company', ['construction', 'general contractor', 'contractor', 'building projects', 'civil engineering', 'home builder'], ['sales', 'customers', 'projects', 'processes', 'finance', 'team', 'inventory'], 'projects', ['Invitation', 'Estimating', 'Bid submitted', 'Negotiation', 'Awarded'], ['Preconstruction', 'Planning', 'Execution', 'Inspection', 'Handover'], 'Progress billing or milestones', [], [], ['Client', 'Bid', 'Project', 'Budget', 'Commitment', 'RFI', 'Submittal', 'Change order', 'Invoice']),
  template('healthcare', 'Healthcare clinic or practice', ['clinic', 'medical practice', 'dental practice', 'healthcare provider', 'therapy practice', 'patient care'], ['customers', 'processes', 'finance', 'team', 'support'], 'processes', [], ['Appointment', 'Check-in', 'Consultation', 'Treatment', 'Checkout', 'Follow-up'], 'Patient, insurer, or mixed billing', [], ['Request', 'Triage', 'Scheduled', 'Resolved'], ['Patient', 'Appointment', 'Encounter', 'Care task', 'Authorization', 'Claim', 'Payment', 'Follow-up']),
  template('property', 'Property management', ['property management', 'rental property', 'landlord', 'real estate management'], ['customers', 'processes', 'finance', 'documents', 'maintenance'], 'processes', [], ['List', 'Lease', 'Collect rent', 'Inspect', 'Renew'], 'Recurring rent', [], ['New', 'Scheduled', 'Resolved'], ['Property', 'Unit', 'Tenant', 'Lease', 'Rent invoice', 'Maintenance request']),
  template('hospitality', 'Restaurant or hospitality', ['restaurant', 'hotel', 'hospitality', 'cafe', 'bar'], ['commerce', 'inventory', 'procurement', 'scheduling', 'team', 'finance'], 'commerce', [], ['Reserve', 'Serve', 'Pay', 'Close'], 'At service or checkout', ['Available', 'Low stock', 'Out of stock'], [], ['Product', 'Reservation', 'POS session', 'Stock item', 'Purchase order', 'Shift']),
  template('logistics', 'Logistics or transportation', ['logistics', 'trucking', 'freight', 'delivery company', 'transport company'], ['sales', 'customers', 'logistics', 'scheduling', 'maintenance', 'finance', 'team'], 'logistics', ['Inquiry', 'Quoted', 'Booked', 'Won'], ['Plan', 'Dispatch', 'In transit', 'Deliver', 'Close'], 'Per shipment or contract', [], ['Exception', 'Investigating', 'Resolved'], ['Customer', 'Quote', 'Shipment', 'Vehicle', 'Driver', 'Invoice']),
  template('education', 'Education or training', ['school', 'training company', 'course provider', 'education business'], ['customers', 'processes', 'scheduling', 'finance', 'documents', 'team'], 'processes', [], ['Enroll', 'Schedule', 'Deliver', 'Assess', 'Complete'], 'Course fee or subscription', [], [], ['Student', 'Course', 'Enrollment', 'Session', 'Invoice', 'Document']),
  template('nonprofit', 'Nonprofit or charity', ['nonprofit', 'charity', 'foundation', 'ngo'], ['customers', 'projects', 'finance', 'documents', 'team'], 'projects', ['Prospect', 'Applied', 'Awarded'], ['Plan', 'Deliver', 'Measure', 'Report'], 'Donations and grants', [], [], ['Donor', 'Grant', 'Donation', 'Program', 'Expense', 'Report']),
  template('wholesale', 'Wholesale or distribution', ['wholesale', 'distributor', 'distribution company'], ['sales', 'customers', 'commerce', 'procurement', 'inventory', 'logistics', 'finance'], 'sales', ['Inquiry', 'Quote', 'Order', 'Won'], ['Order', 'Pick', 'Pack', 'Ship'], 'Order terms', ['Available', 'Allocated', 'Shipped'], [], ['Customer', 'Product', 'Sales order', 'Supplier', 'Purchase order', 'Inventory', 'Shipment']),
  template('rental', 'Rental business', ['equipment rental', 'vehicle rental', 'rental company', 'hire business'], ['sales', 'customers', 'scheduling', 'maintenance', 'finance'], 'scheduling', ['Inquiry', 'Quoted', 'Booked'], ['Reserve', 'Handover', 'Active rental', 'Return', 'Inspect'], 'Per rental period', [], ['Damage reported', 'Review', 'Resolved'], ['Customer', 'Rental asset', 'Booking', 'Contract', 'Payment', 'Maintenance']),
  template('generic', 'General business', [], ['sales', 'customers', 'processes', 'finance', 'team'], 'processes', ['Lead', 'Qualified', 'Proposal', 'Won'], ['Requested', 'Planned', 'In progress', 'Review', 'Complete'], 'To be confirmed', [], [], ['Customer', 'Opportunity', 'Work item', 'Task', 'Invoice']),
]

export function selectCompanyTemplate(brief: string): CompanyTemplate {
  const normalized = brief.toLowerCase()
  let best = companyTemplates.find(item => item.id === 'generic')!
  let bestScore = 0
  for (const candidate of companyTemplates) {
    if (candidate.id === 'generic') continue
    const score = candidate.signals.reduce((total, signal) => total + (saysSignal(normalized, signal) ? signal.split(' ').length + 1 : 0), 0)
    if (score > bestScore) { best = candidate; bestScore = score }
  }
  return best
}

export function cloneTemplateBlueprint(selected: CompanyTemplate): AIBlueprint {
  return { ...selected.blueprint, modules: [...selected.blueprint.modules], moduleConfig: { ...selected.blueprint.moduleConfig, pipelineStages: [...selected.blueprint.moduleConfig.pipelineStages], processSteps: [...selected.blueprint.moduleConfig.processSteps], inventoryStages: [...selected.blueprint.moduleConfig.inventoryStages], supportStages: [...selected.blueprint.moduleConfig.supportStages] } }
}
