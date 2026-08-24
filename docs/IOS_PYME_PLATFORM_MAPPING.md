# IOS-PYME Platform Mapping

## Purpose

The source document is an input to BO, not a replacement specification. BO remains an AI-native platform that discovers one company, compiles a structured Business Model, and generates an isolated Command Center. Source ideas are accepted only when they strengthen that mechanism.

The executable source of truth is `src/data/platformEvolution.ts`. Every source concept there has one disposition, a platform primitive, implementation references, user value, and rationale.

## Dispositions

| Disposition | Meaning |
| --- | --- |
| `use-directly` | The principle fits BO and already has a valid platform implementation. |
| `generalize` | Keep the reusable principle, but make the data and behavior configurable. |
| `adapt` | Keep the idea only after adding BO controls, evidence, permissions, or versioning. |
| `industry-module` | Activate only when business evidence shows that the industry behavior applies. |
| `jurisdiction-module` | Isolate from core and require independent legal or professional validation. |
| `do-not-use` | The concept conflicts with personalization, safety, or accountable operation. |
| `future` | Useful direction, but not safe or valuable enough for the current runtime. |

## Source Decisions

| Source idea | Decision | BO primitive | Result |
| --- | --- | --- | --- |
| Capability ontology | Use directly | Capability catalog and dependency graph | Each module traces to a business need. |
| Structured company model | Use directly | Business Model v2 | Company facts remain separate from generated software. |
| Diagnostic gaps | Use directly | Typed unknowns, confidence and exclusions | BO exposes missing knowledge instead of guessing. |
| Master data | Generalize | Evidence-selected schema patterns | Companies receive only relevant records and fields. |
| Operating processes | Generalize | Composable process patterns | Work, owners, handoffs and exceptions become explicit. |
| Business events | Use directly | Typed event catalog | State changes can drive alerts, tasks and automation. |
| Trigger/action rules | Adapt | Governed automation patterns | Approval, idempotency, monitoring and audit are mandatory. |
| KPI library | Generalize | Governed KPI patterns | Measures connect to decisions and source capabilities. |
| Knowledge graph | Adapt | Compiled business graph | Dependencies are traceable without requiring a graph database now. |
| Generated UI | Use directly | Schema-driven Command Center | The interface follows the configured operating model. |
| Conversational changes | Adapt | Validated mutation plans | AI proposes typed changes; validators remain authoritative. |
| Specialized agents | Adapt | Agent manifests and tool policy | Agents receive bounded jobs and authority. |
| Human approval | Use directly | Risk-based autonomy modes | Consequential actions remain accountable. |
| Integrated planning | Generalize | Planning process pattern | Demand, capacity, cash and commitments can be connected. |
| MRP and production | Industry module | Manufacturing capability pack | Only producing businesses receive production structures. |
| Quality and SPC | Industry module | Quality and traceability pack | Applicable companies receive specifications, evidence and containment. |
| Asset maintenance | Industry module | Maintenance capability pack | Asset-heavy businesses can plan and control availability. |
| OEE, SMED and lean analytics | Future | Improvement analytics | Added only after trustworthy event and measurement data exists. |
| Dominican payroll calculations | Jurisdiction module | External connector contract only | BO does not calculate payroll or labor obligations. |
| Country tax and labor filing | Jurisdiction module | Versioned jurisdiction extension | No local legal rule enters universal defaults. |
| Unsupervised legal/employment decisions | Do not use | Prohibited action policy | AI may prepare analysis, never execute binding decisions alone. |
| One fixed ERP schema | Do not use | Schema compiler with invariants | BO preserves company-specific construction. |
| Learning from corrections | Adapt | Anonymous thresholded pattern aggregates | Later builds improve without exposing company data. |
| External industry research | Adapt | Cited, expiring evidence | Stale research stops deciding what BO builds. |
| Multi-company management | Future | Organization and entity graph | Added after entity, accounting and permission boundaries are sound. |

## Modern Capability Gaps

The complete machine-readable registry is `capabilityGaps` in `src/data/platformEvolution.ts`.

### Implemented in the MVP

- SaaS commercial operations, ecommerce, professional services and subscriptions.
- Company discovery, capability selection, generated schemas, records and Command Center UI.
- Basic human approval patterns and isolated workspaces.
- Anonymous industry capability and reusable-pattern evidence.

### Partial, Next

- Marketing attribution and experimentation.
- Cybersecurity operations, legal/contract lifecycle, knowledge management and data governance.
- API and connector lifecycle management.
- AI governance, server-enforced agent permissions, evaluation, monitoring and a unified human review queue.

### Planned

- Product management and software engineering operating models.
- Multi-company, international, multi-currency and localization foundations.
- Realtime collaboration and governed extension packages.

## Guardrails

1. A source recommendation never bypasses company discovery evidence.
2. Industry and jurisdiction concepts are opt-in modules, not universal defaults.
3. Unknowns stay explicit and are not converted into invented company facts.
4. Payroll, labor, tax and binding legal calculations stay outside BO core.
5. Only platform-owned IDs and aggregate counts can improve later companies.
