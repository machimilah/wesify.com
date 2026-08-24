import {
  automationPatterns,
  knowledgeRequirementSpecs,
  kpiPatterns,
  masterDataTemplates,
  processPatterns,
} from './operatingKnowledge'
import platformPatternIds from './platformPatternIds.json'

export type SourceDisposition =
  | 'use-directly'
  | 'generalize'
  | 'adapt'
  | 'industry-module'
  | 'jurisdiction-module'
  | 'do-not-use'
  | 'future'

export interface SourceMappingEntry {
  id: string
  sourceConcept: string
  principle: string
  disposition: SourceDisposition
  platformPrimitive: string
  implementationRefs: string[]
  userCapability: string
  rationale: string
}

export const sourceMappings: SourceMappingEntry[] = [
  { id: 'capability-ontology', sourceConcept: 'Business capability ontology', principle: 'Describe what a company must be able to do before choosing screens.', disposition: 'use-directly', platformPrimitive: 'Capability catalog and dependency graph', implementationRefs: ['src/engine/capabilityCatalog.ts', 'src/engine/businessGraph.ts'], userCapability: 'Receives a coherent Command Center instead of a generic template.', rationale: 'This is already the central compiler input and works across industries.' },
  { id: 'business-model', sourceConcept: 'Structured company model', principle: 'Separate company facts from generated software.', disposition: 'use-directly', platformPrimitive: 'Versioned Business Model v2', implementationRefs: ['src/engine/businessModel.ts'], userCapability: 'Can update how the company operates without rebuilding from scratch.', rationale: 'The model is the durable source for regeneration and explanation.' },
  { id: 'knowledge-gaps', sourceConcept: 'Diagnostic knowledge requirements', principle: 'Unknown facts must remain explicit.', disposition: 'use-directly', platformPrimitive: 'Typed gaps, confidence and exclusions', implementationRefs: ['src/engine/knowledgeEngine.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Sees what Wesify still needs to know and why.', rationale: 'Prevents guesses from silently becoming configuration.' },
  { id: 'master-data', sourceConcept: 'Master-data templates', principle: 'Operational records require stable identities and fields.', disposition: 'generalize', platformPrimitive: 'Evidence-selected schema patterns', implementationRefs: ['src/engine/workspaceSchema.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Gets useful record types and fields suited to the company.', rationale: 'The source idea is reusable when schemas remain configurable rather than fixed ERP tables.' },
  { id: 'process-library', sourceConcept: 'End-to-end operating processes', principle: 'A Command Center should represent work, handoffs and exceptions.', disposition: 'generalize', platformPrimitive: 'Composable process patterns', implementationRefs: ['src/engine/operatingArchitecture.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Can run work from request to completion with visible ownership.', rationale: 'Process primitives generalize; exact sequences remain company-specific.' },
  { id: 'event-driven', sourceConcept: 'Business events and reactions', principle: 'State changes should trigger explicit consequences.', disposition: 'use-directly', platformPrimitive: 'Typed business event catalog', implementationRefs: ['src/engine/eventArchitecture.ts', 'server/businessEvents.mjs'], userCapability: 'Gets timely alerts, tasks and automations when business state changes.', rationale: 'Events decouple records, workflows, analytics and agents.' },
  { id: 'automation-shape', sourceConcept: 'Trigger-condition-action automation', principle: 'Automation must include controls, monitoring and audit.', disposition: 'adapt', platformPrimitive: 'Governed automation pattern', implementationRefs: ['src/engine/governanceArchitecture.ts', 'server/automations.mjs'], userCapability: 'Can automate routine work while keeping approvals and exceptions visible.', rationale: 'The basic pattern is retained but expanded with authorization, idempotency and audit.' },
  { id: 'kpi-library', sourceConcept: 'Operational KPI library', principle: 'Measures need purpose, owners and governed definitions.', disposition: 'generalize', platformPrimitive: 'KPI pattern and definition compiler', implementationRefs: ['src/engine/kpiEngine.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Gets metrics connected to decisions rather than decorative charts.', rationale: 'Formula shapes generalize, while targets and source data stay company-specific.' },
  { id: 'graph-model', sourceConcept: 'Company knowledge graph', principle: 'Capabilities, processes, records, roles and events are related.', disposition: 'adapt', platformPrimitive: 'Compiled in-memory business graph', implementationRefs: ['src/engine/businessGraph.ts'], userCapability: 'Can trace why a module exists and what changing it affects.', rationale: 'The graph is valuable now; a dedicated graph database is not yet justified.' },
  { id: 'generated-interface', sourceConcept: 'Interface generated from business structure', principle: 'UI follows operating needs.', disposition: 'use-directly', platformPrimitive: 'Schema-driven Command Center', implementationRefs: ['src/engine/interfaceArchitecture.ts', 'src/components/SchemaDashboard.tsx'], userCapability: 'Receives navigation, records and controls tailored to the configured company.', rationale: 'This is the product experience, not an optional presentation layer.' },
  { id: 'conversational-mutation', sourceConcept: 'Change software through conversation', principle: 'Natural language proposes typed, reviewable changes.', disposition: 'adapt', platformPrimitive: 'Validated mutation plan', implementationRefs: ['src/engine/mutationArchitecture.ts', 'src/engine/workspaceAgent.ts'], userCapability: 'Can ask Wesify to change the Command Center without unsafe direct edits.', rationale: 'Conversation is an input method; deterministic validators remain authoritative.' },
  { id: 'agent-roles', sourceConcept: 'Specialized business agents', principle: 'Agents need bounded jobs, tools and authority.', disposition: 'adapt', platformPrimitive: 'Agent manifest and tool policy', implementationRefs: ['src/engine/agentArchitecture.ts', 'src/data/businessAgentCatalog.ts'], userCapability: 'Gets focused assistants that explain actions and respect permissions.', rationale: 'Role names are useful only when backed by enforceable scopes and approval rules.' },
  { id: 'human-control', sourceConcept: 'Human approval for consequential actions', principle: 'Autonomy is graduated by risk.', disposition: 'use-directly', platformPrimitive: 'Approval, exception and manual modes', implementationRefs: ['src/engine/governanceArchitecture.ts', 'src/engine/workspaceAgent.ts'], userCapability: 'Keeps control over money, access, legal commitments and destructive changes.', rationale: 'This is a required safety property.' },
  { id: 'planning', sourceConcept: 'Integrated planning across demand, capacity and cash', principle: 'Plans expose constraints and commitments.', disposition: 'generalize', platformPrimitive: 'Planning process pattern', implementationRefs: ['src/data/operatingKnowledge.ts'], userCapability: 'Can connect targets to available capacity and owned actions.', rationale: 'The planning frame applies broadly; algorithms differ by business model.' },
  { id: 'manufacturing-planning', sourceConcept: 'MRP and production planning', principle: 'Physical production needs materials and capacity feasibility.', disposition: 'industry-module', platformPrimitive: 'Manufacturing capability pack', implementationRefs: ['src/data/industryPacks.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Manufacturers receive BOM, production, inventory and constraint-aware flows.', rationale: 'Useful for producing businesses but harmful as a universal default.' },
  { id: 'quality', sourceConcept: 'Quality control, SPC and nonconformance', principle: 'Quality decisions require specifications, evidence and containment.', disposition: 'industry-module', platformPrimitive: 'Quality and traceability pack', implementationRefs: ['src/data/industryPacks.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Relevant companies can inspect output, contain failures and retain evidence.', rationale: 'Quality primitives generalize within regulated and production contexts.' },
  { id: 'maintenance', sourceConcept: 'Preventive and corrective maintenance', principle: 'Critical assets need controlled availability and release.', disposition: 'industry-module', platformPrimitive: 'Asset maintenance pack', implementationRefs: ['src/data/industryPacks.ts', 'src/data/operatingKnowledge.ts'], userCapability: 'Asset-heavy companies can schedule work and track downtime.', rationale: 'Only applies where physical assets constrain delivery.' },
  { id: 'lean-methods', sourceConcept: 'OEE, SMED and waste reduction', principle: 'Improvement methods require trustworthy operational evidence.', disposition: 'future', platformPrimitive: 'Continuous-improvement analytics', implementationRefs: ['src/data/operatingKnowledge.ts'], userCapability: 'Will compare losses and improvement actions when data quality supports it.', rationale: 'Premature optimization metrics would create false precision in the current MVP.' },
  { id: 'local-payroll', sourceConcept: 'Dominican payroll calculations', principle: 'Regulated calculations need jurisdiction-owned rules and verification.', disposition: 'jurisdiction-module', platformPrimitive: 'External payroll connector contract only', implementationRefs: ['docs/CONNECTED_APPS.md'], userCapability: 'Can connect a verified payroll provider without Wesify calculating payroll.', rationale: 'Explicitly excluded from the platform core and current delivery.' },
  { id: 'local-tax', sourceConcept: 'Country-specific tax and labor filings', principle: 'Jurisdiction rules must be isolated, versioned and professionally validated.', disposition: 'jurisdiction-module', platformPrimitive: 'Jurisdiction extension boundary', implementationRefs: ['docs/IMPLEMENTATION_ARCHITECTURE.md'], userCapability: 'Can add validated local compliance modules independently of core releases.', rationale: 'Local legal logic must never leak into universal defaults.' },
  { id: 'autonomous-legal', sourceConcept: 'Unsupervised legal or employment decisions', principle: 'High-impact decisions require accountable humans.', disposition: 'do-not-use', platformPrimitive: 'Prohibited action policy', implementationRefs: ['src/engine/governanceArchitecture.ts'], userCapability: 'Receives analysis and preparation, never an unapproved binding decision.', rationale: 'The accountability and harm risks exceed the value of full autonomy.' },
  { id: 'single-erp-schema', sourceConcept: 'One fixed schema for every company', principle: 'Different operating models need different records.', disposition: 'do-not-use', platformPrimitive: 'Schema compiler with invariants', implementationRefs: ['src/engine/workspaceSchema.ts'], userCapability: 'Avoids irrelevant modules and fields.', rationale: 'A monolithic ERP schema would diverge from BOs personalized construction model.' },
  { id: 'industry-learning', sourceConcept: 'Learn from repeated company configuration choices', principle: 'Only anonymous, thresholded platform IDs may compound.', disposition: 'adapt', platformPrimitive: 'Industry pattern aggregates', implementationRefs: ['server/industryKnowledge.mjs', 'server/routes/industries.mjs'], userCapability: 'Later companies start from better industry defaults without exposing earlier companies.', rationale: 'Receipts, minimum cohorts and aggregate counts preserve isolation.' },
  { id: 'research-evidence', sourceConcept: 'External industry research', principle: 'Research needs sources and expiration.', disposition: 'adapt', platformPrimitive: 'Cited, time-bounded industry evidence', implementationRefs: ['src/engine/businessResearch.ts', 'server/industryKnowledge.mjs'], userCapability: 'Gets researched defaults that stop deciding when stale.', rationale: 'Evidence must not become permanent hidden policy.' },
  { id: 'multi-company', sourceConcept: 'Multi-entity business management', principle: 'Legal entities and access boundaries are explicit.', disposition: 'future', platformPrimitive: 'Organization and entity graph', implementationRefs: ['docs/PRODUCT_ROADMAP.md'], userCapability: 'Will manage multiple entities with consolidated and entity-specific views.', rationale: 'Requires deeper tenancy, accounting and permission semantics than the current workspace model.' },
]

export type CapabilityStatus = 'implemented' | 'partial' | 'planned'
export type DeliveryHorizon = 'mvp' | 'next' | 'long-term'

export interface CapabilityGap {
  id: string
  area: string
  status: CapabilityStatus
  horizon: DeliveryHorizon
  capabilityIds: string[]
  primitives: string[]
  rationale: string
}

export const capabilityGaps: CapabilityGap[] = [
  { id: 'saas', area: 'SaaS operations', status: 'implemented', horizon: 'mvp', capabilityIds: ['crm.pipeline', 'subscriptions.plans', 'support.tickets'], primitives: ['customer lifecycle', 'subscription', 'support'], rationale: 'Core commercial, recurring revenue and support capabilities exist.' },
  { id: 'ecommerce', area: 'Ecommerce', status: 'implemented', horizon: 'mvp', capabilityIds: ['commerce.products', 'sales.orders', 'commerce.returns'], primitives: ['catalog', 'order', 'return'], rationale: 'Catalog-to-order and return workflows are represented.' },
  { id: 'professional-services', area: 'Professional services', status: 'implemented', horizon: 'mvp', capabilityIds: ['crm.pipeline', 'work.projects', 'finance.invoicing'], primitives: ['engagement', 'project', 'invoice'], rationale: 'Lead, engagement delivery and billing are covered.' },
  { id: 'subscriptions', area: 'Subscription businesses', status: 'implemented', horizon: 'mvp', capabilityIds: ['subscriptions.plans', 'finance.payments'], primitives: ['plan', 'renewal', 'payment'], rationale: 'Recurring commercial models are represented.' },
  { id: 'marketing', area: 'Marketing operations', status: 'partial', horizon: 'next', capabilityIds: ['marketing.campaigns', 'crm.contacts'], primitives: ['campaign', 'audience', 'attribution'], rationale: 'Campaign operations exist; attribution and governed experimentation need depth.' },
  { id: 'product-management', area: 'Product management', status: 'planned', horizon: 'next', capabilityIds: [], primitives: ['product strategy', 'discovery', 'roadmap', 'feedback'], rationale: 'Product records and decision loops are not yet first-class.' },
  { id: 'software-development', area: 'Software development', status: 'planned', horizon: 'next', capabilityIds: [], primitives: ['repository', 'work item', 'release', 'incident'], rationale: 'Projects are too generic for engineering delivery and release governance.' },
  { id: 'cybersecurity', area: 'Cybersecurity operations', status: 'partial', horizon: 'next', capabilityIds: ['compliance.controls'], primitives: ['asset', 'control', 'finding', 'incident', 'risk'], rationale: 'Security boundaries exist, but operational security management is incomplete.' },
  { id: 'legal-ops', area: 'Legal operations and contract lifecycle', status: 'partial', horizon: 'next', capabilityIds: ['documents.repository', 'documents.approvals'], primitives: ['matter', 'contract', 'clause', 'obligation', 'renewal'], rationale: 'Documents and approvals exist; obligations and lifecycle states do not.' },
  { id: 'knowledge-management', area: 'Knowledge management', status: 'partial', horizon: 'next', capabilityIds: ['documents.repository'], primitives: ['source', 'knowledge item', 'citation', 'retention'], rationale: 'Company documents exist but retrieval governance and provenance need depth.' },
  { id: 'data-governance', area: 'Data governance', status: 'partial', horizon: 'next', capabilityIds: ['compliance.controls'], primitives: ['data owner', 'classification', 'lineage', 'retention'], rationale: 'Access boundaries exist; field-level ownership and lineage are not complete.' },
  { id: 'api-integration', area: 'API and integration management', status: 'partial', horizon: 'next', capabilityIds: [], primitives: ['connector', 'credential', 'mapping', 'sync', 'webhook'], rationale: 'Connector contracts and Stripe sync exist; broader lifecycle tooling is needed.' },
  { id: 'ai-governance', area: 'AI governance', status: 'partial', horizon: 'next', capabilityIds: ['compliance.controls'], primitives: ['model', 'prompt', 'policy', 'evaluation', 'decision record'], rationale: 'Agent scopes exist; model inventory and evaluation records are incomplete.' },
  { id: 'agent-permissions', area: 'Agent permissions', status: 'partial', horizon: 'next', capabilityIds: [], primitives: ['agent', 'tool scope', 'data scope', 'approval'], rationale: 'Workspace actions are bounded, but policy needs server-enforced granularity.' },
  { id: 'agent-evaluation', area: 'Agent evaluation and monitoring', status: 'planned', horizon: 'next', capabilityIds: [], primitives: ['test case', 'trace', 'score', 'regression', 'incident'], rationale: 'Behavioral evaluation must precede wider autonomy.' },
  { id: 'human-in-loop', area: 'Human-in-the-loop operations', status: 'partial', horizon: 'mvp', capabilityIds: ['documents.approvals'], primitives: ['proposal', 'approval', 'exception', 'override'], rationale: 'Approval modes exist, while a unified review queue remains to be built.' },
  { id: 'multi-company', area: 'Multi-company operations', status: 'planned', horizon: 'long-term', capabilityIds: [], primitives: ['organization', 'entity', 'intercompany relation', 'consolidation'], rationale: 'Current workspaces isolate one company rather than model an entity group.' },
  { id: 'international', area: 'International operations', status: 'planned', horizon: 'long-term', capabilityIds: [], primitives: ['country', 'currency', 'timezone', 'legal entity'], rationale: 'Core records are not yet designed for multi-country governance.' },
  { id: 'localization', area: 'Localization', status: 'planned', horizon: 'long-term', capabilityIds: [], primitives: ['locale', 'translation', 'format', 'jurisdiction extension'], rationale: 'UI and domain terminology require an explicit localization layer.' },
  { id: 'realtime-collaboration', area: 'Realtime collaboration', status: 'planned', horizon: 'long-term', capabilityIds: [], primitives: ['presence', 'subscription', 'conflict resolution'], rationale: 'The current persistence API does not offer collaborative concurrency.' },
]

export type ReusablePatternKind = 'process' | 'kpi' | 'schema' | 'automation' | 'diagnostic'

export const reusablePlatformPatterns = [
  ...processPatterns.map(item => ({ kind: 'process' as const, id: item.id, capabilityIds: item.capabilityIds })),
  ...kpiPatterns.map(item => ({ kind: 'kpi' as const, id: item.id, capabilityIds: item.capabilityIds })),
  ...masterDataTemplates.map(item => ({ kind: 'schema' as const, id: item.id, capabilityIds: item.capabilityIds })),
  ...automationPatterns.map(item => ({ kind: 'automation' as const, id: item.id, capabilityIds: item.capabilityIds })),
  ...knowledgeRequirementSpecs.map(item => ({ kind: 'diagnostic' as const, id: item.id, capabilityIds: item.capabilityIds })),
]

export const platformPatternIdCatalog = platformPatternIds

export interface ArchitectureLayer {
  id: string
  responsibility: string
  current: string[]
  nextBoundary: string
  isolationRule: string
}

export const implementationArchitecture: ArchitectureLayer[] = [
  { id: 'frontend', responsibility: 'Discovery, generated workspace and governed user actions', current: ['React', 'SchemaDashboard', 'workspaceAction validators'], nextBoundary: 'Render only compiled schemas and server-authorized state.', isolationRule: 'A workspace token scopes every company API request.' },
  { id: 'backend', responsibility: 'Tenant enforcement, project compilation, records and integrations', current: ['Node HTTP service', 'route modules', 'project builder'], nextBoundary: 'Split domain services behind versioned contracts as load requires.', isolationRule: 'Tenant validation occurs before any company read or write.' },
  { id: 'database', responsibility: 'Durable accounts, projects, records, billing and anonymous aggregates', current: ['PostgreSQL with file fallback', 'ordered migrations'], nextBoundary: 'Add transactional event outbox and explicit schema versions.', isolationRule: 'Company rows carry workspace ownership; shared learning stores aggregates only.' },
  { id: 'business-model', responsibility: 'Canonical versioned description of one company', current: ['Business Model v2', 'architecture context'], nextBoundary: 'Persist immutable revisions and migration functions.', isolationRule: 'A company model is never copied into the platform pattern store.' },
  { id: 'events', responsibility: 'Typed facts emitted by business state changes', current: ['Event architecture', 'server event journal'], nextBoundary: 'Transactional outbox plus replay-safe consumers.', isolationRule: 'Payloads remain tenant-scoped; cross-company learning receives IDs and counts only.' },
  { id: 'workflow', responsibility: 'Long-running states, owners, deadlines and exceptions', current: ['Process patterns', 'task and approval capabilities'], nextBoundary: 'Durable workflow instances with versioned definitions.', isolationRule: 'Instances and evidence belong to one workspace.' },
  { id: 'automation', responsibility: 'Idempotent reactions to events under policy', current: ['Automation patterns', 'server automation execution'], nextBoundary: 'Retries, dead-letter handling and operator controls.', isolationRule: 'Credentials and executions are workspace-bound.' },
  { id: 'agents-llm', responsibility: 'Discovery, explanation and proposed changes', current: ['Discovery agent', 'workspace agent', 'provider adapters'], nextBoundary: 'Server-enforced tool scopes, trace storage and evaluation gates.', isolationRule: 'No company context enters another workspace or aggregate prompt.' },
  { id: 'memory-retrieval', responsibility: 'Retrieve company knowledge with provenance', current: ['Structured discovery and project files'], nextBoundary: 'Tenant-partitioned document index and cited retrieval.', isolationRule: 'Separate indexes and authorization filters per workspace.' },
  { id: 'graph', responsibility: 'Connect capabilities, records, processes, roles and events', current: ['Compiled business graph'], nextBoundary: 'Persist graph projections only when traversal needs justify it.', isolationRule: 'Company graph nodes remain tenant-owned; platform graph contains definitions only.' },
  { id: 'permissions-auth', responsibility: 'Authenticate people and authorize workspace, action and tool access', current: ['Session auth', 'workspace access tokens', 'tenant guards'], nextBoundary: 'Role and attribute policies enforced server-side.', isolationRule: 'Deny by default and check the target workspace on every operation.' },
  { id: 'audit-versioning', responsibility: 'Explain who changed what, when and under which model or rule', current: ['Event journal', 'migration ledger', 'build metadata'], nextBoundary: 'Immutable audit events and versioned business-model revisions.', isolationRule: 'Audit visibility follows workspace permissions.' },
  { id: 'apis-connectors', responsibility: 'Versioned external contracts and source-of-truth synchronization', current: ['REST routes', 'connector registry', 'Stripe adapter'], nextBoundary: 'Connector SDK, webhooks, mapping UI and sync observability.', isolationRule: 'Secrets are server-side and credentials are never shared across workspaces.' },
  { id: 'realtime', responsibility: 'Notify clients of durable state changes', current: ['Polling and request-response updates'], nextBoundary: 'Authorized event subscriptions after outbox delivery exists.', isolationRule: 'Subscription topics are workspace-scoped.' },
  { id: 'observability-security', responsibility: 'Detect failures, abuse, unsafe actions and regressions', current: ['Structured logs', 'rate limits', 'security tests'], nextBoundary: 'Metrics, traces, alerting, threat review and AI evaluations.', isolationRule: 'Telemetry redacts secrets and company content by default.' },
]

export interface RoadmapItem {
  id: string
  horizon: DeliveryHorizon
  outcome: string
  artifacts: string[]
  exitCriteria: string[]
}

export const deliveryRoadmap: RoadmapItem[] = [
  { id: 'mvp-command-center', horizon: 'mvp', outcome: 'Generate an isolated, explainable Command Center from structured discovery.', artifacts: ['Business Model v2', 'capability compiler', 'schema-driven dashboard', 'workspace access controls'], exitCriteria: ['Every generated module traces to evidence or a platform invariant.', 'No starter mockup flashes before the configured workspace.', 'Tenant tests cover every company endpoint.'] },
  { id: 'mvp-learning', horizon: 'mvp', outcome: 'Improve industry defaults from privacy-safe repeated choices.', artifacts: ['aggregate pattern store', 'workspace contribution receipts', 'minimum cohort verdicts'], exitCriteria: ['Only allowlisted platform IDs cross the company boundary.', 'One workspace contributes once per signal.', 'No verdict is produced below five companies.'] },
  { id: 'next-runtime', horizon: 'next', outcome: 'Turn compiled designs into durable event, workflow and automation runtime behavior.', artifacts: ['transactional outbox', 'workflow instances', 'retry and dead-letter controls', 'unified approval queue'], exitCriteria: ['Every side effect is idempotent.', 'Operators can inspect and recover failed work.', 'Consequential actions require configured approval.'] },
  { id: 'next-intelligence', horizon: 'next', outcome: 'Govern agents, company retrieval and model changes as production systems.', artifacts: ['tool policy service', 'tenant retrieval index', 'agent traces', 'evaluation suites', 'model registry'], exitCriteria: ['Permissions are server-enforced.', 'Answers cite company sources.', 'Model or prompt changes pass regression evaluations.'] },
  { id: 'next-domain-depth', horizon: 'next', outcome: 'Add first-class product, engineering, security, legal and data-governance primitives.', artifacts: ['new capability packs', 'record schemas', 'event definitions', 'workflow templates'], exitCriteria: ['Each pack has applicability evidence and exclusions.', 'Packs reuse platform primitives rather than adding parallel runtimes.'] },
  { id: 'long-organization', horizon: 'long-term', outcome: 'Support multi-company and international organizations without weakening isolation.', artifacts: ['organization/entity graph', 'cross-entity permission model', 'currency and locale services', 'consolidated read models'], exitCriteria: ['Entity boundaries are auditable.', 'Consolidation never bypasses source permissions.', 'Jurisdiction extensions are separately versioned and validated.'] },
  { id: 'long-ecosystem', horizon: 'long-term', outcome: 'Offer a governed extension ecosystem and deeper improvement analytics.', artifacts: ['extension SDK', 'jurisdiction modules', 'industry analytics', 'continuous-improvement packs'], exitCriteria: ['Extensions declare permissions and data use.', 'Installation is reversible.', 'Local payroll and legal calculations remain outside core unless independently certified.'] },
]
