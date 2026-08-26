# Wesify product repositioning

## Decision

Wesify is an **adaptive business operating suite** for companies that have outgrown flexible
workspaces but do not want to design and implement a traditional ERP.

The category is not "business management app" and not "AI workspace." The product promise is:

> Describe how the company works. Wesify builds the connected business system it needs, then keeps
> that system aligned as the company changes.

The clearest competitive frame is the space between Notion and Odoo:

- Notion provides flexible pages, databases and automations. The customer decides the data model and
  assembles the operating process.
- Odoo provides a broad integrated application suite and established end-to-end transactions. The
  customer selects and configures the applications.
- Wesify must provide Odoo-grade operational coherence with a radically different setup model: the
  company model selects, connects and configures the applications from evidence.

This decision supersedes earlier wording that described Wesify mainly as a Command Center or assumed
that it would remain only an overlay above systems of record. A capability may still be built or
connected, but the platform must be capable of owning operational records where that is the better
customer outcome.

## Product contract

Wesify has two simultaneous obligations:

1. **Suite completeness.** The platform can represent the main systems a real company runs.
2. **Company specificity.** A workspace activates only the systems, fields, controls and process
   depth supported by this company's operating model.

This preserves the original architectural rule: Wesify does not apply one fixed ERP schema to every
company. It compiles a coherent subset of a complete business platform.

## Business-suite surface

| Domain | Product responsibility | Current foundation | Required production depth |
| --- | --- | --- | --- |
| CRM | Accounts, contacts, activity, pipeline context | Capability catalog, relationships, pipeline views | Deduplication, communication timeline, ownership and forecasting |
| Sales | Quotes, pricing, contracts and orders | Quotes, orders and invoices with lines, discount/tax inputs, totals, lineage and duplicate-safe conversion | Revisions, signatures, price lists and jurisdiction-aware taxes |
| Invoicing | Receivables, collections, payments and credits | Payment allocation, balances, collection states, daily overdue scans and guarded refunds/deletes | Delivery, credit-note application, compliant numbering and statutory posting profiles |
| Inventory | Products, purchasing, stock, warehouses and delivery | Stock movement ledger, receipts/issues/adjustments/transfers, shipment consequences, reversals and negative-stock guards | Reservation, costing, replenishment planning and barcode operations |
| Employees | Directory, hiring, onboarding, leave and payroll inputs | Role-scoped people records and lifecycle capabilities | Account provisioning, manager hierarchy, policy accruals and jurisdiction connectors |
| Projects | Projects, tasks, time, capacity, milestones and field work | Projects, tasks, scheduling, time and resource records | Baselines, dependency scheduling, profitability and billable-work conversion |
| Accounting | Ledger, payables, reconciliation, assets and close | Balanced multi-line journal posting, account validation, idempotency and immutable posted entries | Period locks, localization, automated source posting and audited statements |
| Operations | Cross-functional processes, handoffs and exceptions | Process patterns, events, workflows, alerts and active flow map | Durable process instances, SLAs, retries, compensation and exception ownership |
| Automation | Triggers, conditions, approvals, actions and integrations | Versioned graphs, AI planning, schedules, simulations, approvals, encrypted webhooks, traces, idempotency receipts and retry | Durable queue, dead-letter controls, OAuth connector SDK and high-volume workers |
| Permissions | Roles, application access, record scope and audit | Server-assigned workspace roles, invitations, membership controls, action permissions and audit history | Record rules, enterprise SSO, export retention and formal separation-of-duties policy packs |
| Reporting | Operational KPIs and financial/management reports | Governed live KPIs, periods, role-aware views, exceptions, drilldown and CSV export | Saved report builder, statements and scheduled external delivery |

## The operational spine

An application list is not an ERP. The differentiating runtime is the chain of business documents,
state transitions and accounting or inventory consequences that connects the applications.

Wesify treats the following as first-class flows:

1. **Lead to cash:** lead -> quote -> order or contract -> delivery or project -> invoice -> payment.
2. **Project to cash:** project -> task and capacity plan -> time or milestone -> invoice -> payment.
3. **Procure to pay:** request or RFQ -> purchase order -> receipt -> supplier invoice -> payment.
4. **Inventory to delivery:** demand -> stock or production -> pick -> ship -> delivery.
5. **Hire to ready:** candidate -> onboarding -> employee -> schedule -> development.
6. **Record to report:** source transaction -> journal -> reconciliation -> close -> report.

The generated data model now adds upstream relationships only when both applications are active. A
service company can link projects to invoices without receiving warehouse fields; a distributor can
link orders, shipments, invoices and stock movements; a manufacturer can extend the same spine with
production and quality.

## Data architecture

The suite requires five related data classes:

| Class | Examples | Runtime rule |
| --- | --- | --- |
| Master data | Customer, product, supplier, employee, account, warehouse | Stable identity, deduplication and effective dates |
| Business documents | Quote, order, purchase order, invoice, receipt, payment | Explicit states, revisions, line items and source lineage |
| Ledgers | Stock movement, journal line, time entry, audit event | Append-oriented, balanced or reconcilable, never silently overwritten |
| Process state | Workflow instance, task, approval, exception, SLA | Owner, deadline, transition rule, retry and recovery |
| Analytical projections | KPI, balance, forecast, operational report | Derived from governed sources with drilldown to records |

The company model remains the design-time source of truth. Operational records and ledgers are the
runtime source of truth. Neither should be confused with public research or anonymous industry
patterns.

## Product boundaries

Wesify should own a workflow when it can enforce its state, validation, permissions and audit rules.
It should connect an external system when legal, jurisdictional or ecosystem depth is not yet safe to
reproduce.

Near-term built systems:

- CRM, sales documents, projects, service operations, inventory records, approvals and operational
  reporting.
- Invoicing and receivables where compliant numbering, delivery and posting rules are available.

Connected or independently validated systems until the required depth exists:

- Statutory accounting, tax filing, bank movement and payment execution.
- Country-specific payroll and binding employment calculations.
- E-signature, regulated clinical systems and other jurisdiction-sensitive records.

"Connected" is not a permanent strategic retreat. It is a correctness boundary. A domain moves into
Wesify core only when its deterministic engine, audit model and localization can be defended.

## Delivery sequence

### Phase 1: adaptive suite foundation

- Canonical eleven-domain suite map.
- Business-function navigation instead of a generic page list.
- Cross-module record lineage and operator-visible operating flows.
- Role-aware reporting, automation surface and access/control center.
- Record continuation from one business document to the next.

### Phase 2: transactional runtime

- Versioned document state machines and transition permissions.
- Line items, pricing, tax inputs, totals and document revisions.
- Atomic multi-record commands such as confirm quote, fulfil order and register payment.
- Correlation IDs and complete event lineage across every transition.
- Unified approval and exception queue.

### Phase 3: inventory and finance correctness

- Reservation, availability, receipt, pick, delivery, return and adjustment ledgers.
- Double-entry posting rules, journals, reconciliation, close and immutable periods.
- Aged receivable/payable, profit and loss, balance sheet, cash flow and audit trail.
- Tested migration tools for opening balances, open documents and stock.

### Phase 4: ecosystem and localization

- Production connector SDK and sync observability.
- Accounting, banking, commerce, communications and storage connectors.
- Independently versioned fiscal and payroll localization modules.
- Multi-company, multi-currency, consolidated reporting and separation of duties.

## Positioning language

Primary:

> The business operating system that fits your company.

Supporting:

> CRM, sales, projects, inventory, invoicing, accounting, people, automation, permissions and
> reporting, connected around how your business actually works.

Competitive shorthand:

> For teams that have outgrown Notion and do not want to implement Odoo.

The shorthand is useful in sales conversations, but the product should lead with its own category and
outcome rather than naming a competitor in the main interface.

## Research basis

- [Odoo application documentation](https://www.odoo.com/documentation/19.0/applications.html) shows
  the breadth expected from an integrated business suite across finance, sales, supply chain, people,
  services, productivity, automation and administration.
- [Odoo Sales documentation](https://www.odoo.com/documentation/19.0/applications/sales/sales.html)
  describes the commercial chain from quotation through order, delivery and invoice.
- [Odoo Accounting documentation](https://www.odoo.com/documentation/19.0/applications/finance/accounting.html)
  makes transaction-generated journal entries and double-entry integrity part of the product core.
- [Odoo Inventory documentation](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory.html)
  treats receipts, locations, stock moves, replenishment, picking and delivery as one warehouse system.
- [Odoo access-rights documentation](https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html)
  separates application/model rights from record-level rules.
- [ERPNext Selling documentation](https://docs.frappe.io/erpnext/selling) provides a second primary
  reference for connected customer, quote, order, delivery, invoice and payment records.
- [Notion database documentation](https://www.notion.com/help/customize-your-database) demonstrates
  the flexible-workspace baseline: user-defined databases, properties, layouts and automations rather
  than a built-in operational transaction model.
- [APQC Process Classification Framework](https://www.apqc.org/process-frameworks) supports a
  cross-functional process view rather than treating CRM or project management as the whole company.
