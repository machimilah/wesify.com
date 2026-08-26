# Product Roadmap

> **Current product direction:** [PRODUCT_REPOSITIONING.md](PRODUCT_REPOSITIONING.md) defines Wesify
> as an adaptive business operating suite. This roadmap should be read through that decision: the
> generated Command Center is now the shell of a connected suite, not the final category.

## Artifact Inventory

| Artifact | Status | Canonical implementation |
| --- | --- | --- |
| Source concept mapping | Complete | `sourceMappings` in `src/data/platformEvolution.ts` |
| Universal platform primitives | Complete | Capability, process, schema, event, KPI, automation and diagnostic catalogs |
| Business Model schema | Implemented | `src/engine/businessModel.ts` |
| Capability catalog and dependencies | Implemented | `src/engine/capabilityCatalog.ts`, `src/engine/businessGraph.ts` |
| Process library | Implemented as design-time patterns | `src/data/operatingKnowledge.ts` |
| Generated data model | Implemented | `src/engine/workspaceSchema.ts` |
| Event catalog | Implemented with record and scheduled runtime triggers | `src/engine/eventArchitecture.ts`, `server/businessEvents.mjs`, `server/automationScheduler.mjs` |
| Automation library | Implemented with graphs, approvals, schedules, traces and idempotent retry | `server/automations.mjs`, `server/workflowGraph.mjs`, `server/automationAgent.mjs` |
| KPI library | Implemented | `src/engine/kpiEngine.ts` |
| Knowledge-gap engine | Implemented | `src/engine/knowledgeEngine.ts` |
| Agent catalog | Implemented as manifests; enforcement partial | `src/data/businessAgentCatalog.ts`, `src/engine/agentArchitecture.ts` |
| Permission model | Workspace enforcement, assigned roles and team administration implemented; record scope partial | `server/access.mjs`, `server/workspaceSetup.mjs` |
| Audit and versioning | Partial | Event journal, build metadata and migration ledger |
| Integration framework | Implemented foundation | Encrypted credential store, Stripe import and Make/n8n/HTTPS webhooks |
| Industry modules | Implemented selectively | `src/data/industryPacks.ts`, `src/data/operatingKnowledge.ts` |
| Anonymous learning loop | Implemented | Industry aggregate store, receipts, thresholds and client application |
| Technical architecture | Complete as implementation contract | `docs/IMPLEMENTATION_ARCHITECTURE.md` |
| Isolation and security model | Implemented foundation; hardening ongoing | Tenant guards, local receipts, security and industry tests |
| MVP definition | Complete | This document and `docs/MVP_V1.md` |
| Long-term vision | Complete as staged direction | `deliveryRoadmap` in `src/data/platformEvolution.ts` |

## MVP: Now

Outcome: generate an isolated, explainable Command Center from company discovery.

Included:

- Structured discovery and Business Model v2.
- Capability selection, dependencies and explicit exclusions.
- Evidence-selected records, fields, processes, KPIs and controls.
- Generated Command Center with persistent tenant records.
- Workspace authentication boundaries and guarded agent mutations.
- Industry research with sources and expiry.
- Anonymous capability and reusable-pattern learning after a five-company threshold.

MVP is complete when every module traces to evidence or a platform invariant, the configured workspace appears without a starter mockup, and all company endpoints enforce tenant access.

## Next

### Transactional operating spine hardening

- Versioned state machines for quotes, orders, delivery, invoices, payments, purchasing and receipts.
- Extend delivered line items, totals, source lineage and duplicate-safe conversion with document revisions and state-machine policies.
- Extend delivered stock movements and balanced journals with reservation, costing, source posting and period close.
- Role-scoped transition permissions, separation of duties and a unified approval queue.
- Drilldown from operational and financial reports to the source transaction and audit event.

### Durable runtime

- Transactional event outbox and replay-safe consumers.
- Versioned workflow instances with owners, deadlines and exceptions.
- Extend delivered idempotent retries and execution recovery with a durable queue and dead-letter administration.
- Unified human approval and exception queue.

### Governed intelligence

- Server-enforced agent tool and data scopes.
- Tenant-partitioned retrieval with citations and retention controls.
- Agent traces, test cases, evaluations and regression gates.
- Model and prompt registry with version history.

### Domain depth

- Product management and software delivery capability packs.
- Security operations, contract lifecycle and legal matter primitives.
- Data ownership, classification, lineage and retention.
- Connector SDK, webhooks, mappings and synchronization monitoring.

## Long Term

- Organization and legal-entity graph for multi-company operation.
- Cross-entity permissions and auditable consolidated views.
- Currency, timezone, locale and translation services.
- Realtime authorized collaboration.
- Governed extension SDK for industries and jurisdictions.
- Continuous-improvement analytics after runtime data is sufficiently trustworthy.

## Explicit Non-Goals

- A fixed ERP schema applied to every company.
- Sharing company content, records or prompts to improve other companies.
- Unsupervised money movement, legal commitments, employment decisions or destructive changes.
- Dominican payroll, labor, tax or filing calculations in Wesify core.
- Claiming planned runtime behavior is already implemented.
