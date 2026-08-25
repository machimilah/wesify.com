# Implementation Architecture

## Architectural Rule

Wesify compiles a Command Center from a versioned company model. The model, runtime data and credentials belong to one workspace. Platform knowledge contains only definitions, public research and anonymous thresholded counts.

The machine-readable layer registry is `implementationArchitecture` in `src/data/platformEvolution.ts`.

## End-to-End Flow

1. Discovery collects explicit facts, uncertainties and evidence.
2. The architecture engine selects platform capabilities and records exclusions.
3. Operating knowledge contributes applicable processes, schemas, KPIs, controls and diagnostic requirements.
4. Fresh industry research and thresholded anonymous observations can adjust defaults.
5. The compiler produces the Business Model, interface schema, permissions, events and workspace manifest.
6. The backend stores the configured project and tenant-owned records.
7. User and agent changes pass through typed actions, authorization and audit boundaries.
8. Corrections contribute only allowlisted pattern IDs and counts to shared learning.

## Layers

| Layer | Current implementation | Required next boundary |
| --- | --- | --- |
| Frontend | React discovery, Builder and schema-driven dashboard | Render server-authorized, versioned compiled schemas only. |
| Backend | Node route modules, project builder, record and integration services | Keep domain contracts versioned; split deployment units only when needed. |
| Database | PostgreSQL with ordered migrations and local fallback | Transactional outbox, immutable model revisions and durable workflow state. |
| Business Model | Business Model v2 plus architecture context | Immutable revisions with explicit migration functions. |
| Events | Typed event architecture and server event journal | Transactional publishing and replay-safe consumers. |
| Workflow | Process patterns, tasks and approvals | Durable instances, deadlines, ownership, versioned definitions and recovery. |
| Automation | Governed patterns and server execution | Idempotency keys, retries, dead letters and operator controls. |
| Agents and LLM | Discovery agent, workspace agent and provider adapters | Server-enforced tools, traces, evaluations and model registry. |
| Memory and retrieval | Structured discovery and project artifacts | Tenant-partitioned indexes with source citations and retention. |
| Graph | Compiled capability and dependency graph | Persist projections only when traversal requirements justify it. |
| Auth and permissions | Sessions, workspace tokens and tenant guards | Role and attribute policy enforced for every action and agent tool. |
| Audit and versioning | Event journal, build metadata and migration ledger | Immutable audit events and Business Model revision history. |
| APIs and connectors | REST routes, provider registry and Stripe adapter | Connector SDK, webhook lifecycle, mapping tools and sync observability. |
| Realtime | Request/response and polling | Authorized workspace subscriptions after durable event delivery. |
| Observability and security | Structured logs, rate limits and regression tests | Metrics, traces, alerts, threat review and AI behavior evaluations. |

## Isolation Model

### Platform knowledge

Platform-owned and reusable:

- Capability, process, schema, KPI, automation and diagnostic definitions.
- Industry taxonomy and cited public research with an expiration date.
- Aggregate counts for allowlisted platform pattern IDs.
- Source dispositions, architecture boundaries and roadmap status.

Platform knowledge must not contain workspace IDs, company names, record values, conversation text, documents, credentials, prompts containing company context, or links back to contributors.

### Company knowledge

Tenant-owned and never shared:

- Discovery messages, facts, assumptions and Business Model revisions.
- Company records, documents, events, workflow instances and audit details.
- Users, roles, credentials, connectors and agent traces.
- Workspace contribution receipts that prevent duplicate aggregate reports.

Every company read, write, event subscription, connector operation and agent tool call must authorize the target workspace before accessing content.

## Privacy-Safe Compounding Intelligence

### Allowed signal

```text
subsector + platform pattern kind + platform pattern id + adopted/removed
```

No free text or company payload is accepted. IDs must pass route validation and resolve to the platform catalog before they can affect a later architecture.

### Learning controls

1. A workspace-local receipt records which signals that workspace has already contributed.
2. Duplicate IDs in one request are collapsed.
3. Shared storage contains aggregate adopted/removed counts only.
4. At least five companies must contribute before a pattern can decide anything.
5. At least 60 percent adoption is required for a reusable pattern verdict.
6. Explicit capability exclusions still override capabilities inferred from patterns.
7. Unknown pattern IDs are ignored by the client even if malformed data reaches it.
8. Public research expires after 180 days and never outranks observed behavior.

Current implementation: `server/routes/industries.mjs`, `server/industryKnowledge.mjs`, `server/industryStore.mjs`, `server/access.mjs`, `src/engine/industryClient.ts`, and migration `007_platform_patterns.sql`.

## Runtime Safety

- Deterministic code owns validation, authorization, calculations, persistence and side effects.
- LLMs may extract, classify, explain and propose typed changes.
- Money movement, legal commitments, access changes, destructive actions and employment decisions require explicit human approval.
- Automations must be idempotent, observable and recoverable before unattended execution.
- Jurisdiction modules must be independently versioned and professionally validated.
- Dominican payroll and labor calculations are not implemented.
