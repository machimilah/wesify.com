# Wesify company base models

## Product decision

Wesify should classify the initial company sentence into an operating archetype, install a stable structural base, and then ask only the questions that can change that base. A base contains workflows and record types, never invented customers, transactions, employees, metrics, or performance data.

The shared operating primitives are:

1. Acquire demand and convert it into a customer or order.
2. Deliver work, products, care, or service.
3. Bill and collect according to the commercial model.
4. Assign people and ownership.
5. Move inventory when physical goods or parts exist.
6. Resolve customer requests when ongoing service exists.

This follows the cross-functional logic of APQC's Process Classification Framework and the lead-to-cash pattern documented by Salesforce and Microsoft: leads become opportunities, quotes, orders, delivery, invoices, and post-sale service. The important design implication is that CRM is one operating process inside Wesify, not the whole company system.

## Initial archetypes

| Base | Default workspace | Default operating flow | Questions that customize it |
| --- | --- | --- | --- |
| Marketing/creative agency | Sales, clients, projects, processes, finance, team | Lead → discovery → proposal → project brief → production → review → delivery | Sales stages, delivery stages, billing model, ownership, client support |
| Consulting/professional services | Sales, clients, engagements, projects, finance, team | Lead → scope → proposal → engagement → delivery; time/expense or milestone billing | Delivery method, sales stages, fixed/T&M/retainer billing, ownership |
| SaaS/subscription | Sales, accounts, onboarding, billing, team, support | Lead → demo/trial → won → onboarding → adoption → renewal; recurring billing and case management | Sales motion, onboarding, billing cadence, support flow, ownership |
| Manufacturing | Sales, customers, production, finance, team, inventory | RFQ → quote → order → materials → work order/routing → quality → finished goods → shipment | Inventory states, production routing, order process, terms, work centers |
| Retail/e-commerce | Customers, orders, finance, inventory, support | Order → payment → pick → pack → ship → delivery; return/refund path | Inventory movement, fulfillment, returns, payment timing, ownership |
| Field service | Customers, work orders, scheduling, finance, team, parts, support | Request → work order → schedule → dispatch → service → review → invoice | Job lifecycle, dispatch ownership, parts usage, billing, recurring agreements |
| Construction | Sales/bids, clients, projects, project controls, finance, team | Invitation → estimate/bid → award → planning → execution → inspection → handover | Project phases, roles, progress billing, bid process, change control |
| Healthcare clinic | Patients, appointments/care workflow, billing, team, requests | Appointment → registration/check-in → encounter → treatment → checkout → follow-up | Visit workflow, payer mix, roles, authorizations, patient requests |
| Generic fallback | Sales, customers, work, finance, team | Lead → proposal → work request → execution → review → invoice | Delivery flow first, then sales, billing, ownership, support |

## Evidence translated into Wesify structures

- CRM and lead-to-cash: Microsoft documents opportunity → quote → sales order → invoice, while Salesforce extends the pattern through delivery, billing, and post-sales service. Wesify therefore keeps customer, pipeline, commercial documents, delivery, and service linked rather than creating isolated cards.
- Service businesses: Odoo and NetSuite connect projects, tasks, time entries, expenses, approvals, and invoicing. Agency and professional-services bases therefore require projects/processes and finance, with billing model as an early customization question.
- Manufacturing: Oracle NetSuite defines routings as ordered operations tied to work centers, labor, machines, costs, and work orders; WIP tracks material issue, assembly, completion, and stock. Manufacturing therefore starts with inventory plus production routing, not a generic project board.
- Subscription businesses: Stripe distinguishes trialing, active, incomplete, past-due, canceled, unpaid, and paused subscriptions and generates invoices every billing period. SaaS therefore needs accounts, onboarding/adoption, recurring billing, renewal, and support.
- Retail/e-commerce: Shopify treats order management, payment, fulfillment, shipment, returns, exchanges, refunds, and inventory as one connected operating flow. Retail therefore starts from orders and fulfillment rather than a B2B opportunity pipeline.
- Customer service: Dynamics models cases from intake through routing, queue assignment, remediation, SLA tracking, and resolution. Support is therefore a workflow with ownership and status, not merely a message list.
- Field service: Dynamics documents create → schedule → dispatch → service → review → invoice, with technician resources, parts consumption, inventory adjustment, and agreements for recurring work. This becomes the field-service base.
- Construction: Procore's project model centers budgets, bidding, commitments, RFIs, submittals, change events, change orders, direct costs, and contracts. Wesify's construction base therefore prioritizes project phases, role ownership, progress billing, and change control.
- Healthcare administration: HealthIT.gov identifies scheduling, registration, practice management, coding/billing, patient identity, and authorization as connected administrative systems. Wesify's clinic base stays administrative and intentionally does not attempt to replace clinical/EHR functionality.

## Sources

- [APQC Process Classification Framework](https://www.apqc.org/process-frameworks)
- [Microsoft Dynamics: opportunity to quote, order, or invoice](https://learn.microsoft.com/en-us/dynamics365/sales/developer/convert-opportunity-quote-sales-order-invoice)
- [Salesforce lead-to-cash cycle](https://trailhead.salesforce.com/content/learn/modules/quotes-and-orders-with-enterprise-sales-management/get-to-know-sales-processes)
- [Odoo timesheets and billable projects](https://www.odoo.com/documentation/19.0/applications/services/timesheets.html)
- [NetSuite projects and time-and-materials billing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1205953.html)
- [NetSuite manufacturing routing and work orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2346224.html)
- [NetSuite manufacturing work in process](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2335392.html)
- [Stripe subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
- [Shopify order management](https://help.shopify.com/en/manual/fulfillment/managing-orders)
- [Shopify order fulfillment](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders)
- [Dynamics case management](https://learn.microsoft.com/en-gb/dynamics365/customer-service/administer/overview-cases)
- [Dynamics field-service work-order lifecycle](https://learn.microsoft.com/en-us/dynamics365/field-service/work-order-status-booking-status)
- [Procore construction project tools](https://support.procore.com/products/online/user-guide)
- [HealthIT.gov health-IT safety and administrative systems](https://www.healthit.gov/sites/default/files/How_to_Identify_and_Address_Unsafe_Conditions_Associated_with_Health_IT.pdf)

## Guardrails

- Template selection may create structure, but never sample records or fake KPIs.
- Defaults remain stable while building; questions modify fields and add modules, never randomly replace the base.
- A module can be removed only through an explicit user instruction later, not through model drift.
- Regulated workflows need integrations and compliance review before production use.
- Templates are starting hypotheses. Confirmed company answers always override defaults.

## Discovery-question policy

- Wesify has one canonical catalog of 50 questions across sales/payments, products/inventory, delivery/projects, customers/marketing, team/roles, and finance/admin/reporting.
- The selected company base provides a relevance-ranked subset. The local model chooses the next useful unanswered ID; it cannot invent alternate wording or ask outside the catalog.
- Only one question is shown at a time. Selectable answers are used wherever a bounded answer is possible; company-specific details use one short phrase.
- A base requires eight relevant discovery answers before the model can finish the initial workspace. Further capabilities can be added later through Wesify.
