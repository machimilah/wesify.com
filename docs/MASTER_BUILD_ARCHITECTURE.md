# Wesify master build architecture

The attached master prompt is the product specification. The product name remains **Wesify**.

## Two-layer system

### Universal operating engine

The universal layer renders configuration instead of containing one hardcoded ERP:

- Business profile and memory
- Modules and dynamic navigation
- Entities, configurable fields, and relationships
- Table and Kanban views
- Generated forms
- Dashboard metrics and basic analytics
- Workflows and role definitions
- Structured application actions
- Workspace persistence

### Company configuration

Onboarding answers and the selected company base generate a `WorkspaceConfiguration`. The AI and command layer modify this configuration, not arbitrary frontend code.

## Structured action boundary

Supported action contracts include:

- `create_record`
- `update_record`
- `delete_record`
- `query_business_data`
- `add_field`
- `activate_module`
- `deactivate_module`
- `create_workflow`
- `navigate`

Record creation and navigation can execute immediately. Destructive or structural changes are previewed before application.

## Current MVP slice

- Conversational onboarding and template intelligence
- Generated Business Profile
- Schema-generated agency and field-service workspaces
- Dynamic indexed navigation
- Customers, sales, projects, tasks, invoices, expenses, team, inventory, suppliers, support, campaigns, vehicles, and equipment where relevant
- Custom module proposal from ordinary business language
- Generated tables, Kanban boards, and forms
- Live data-derived KPI cards and basic charts
- Persistent AI command bar with controlled actions
- Today briefing derived from overdue invoices, tasks, and reorder thresholds
- Expandable Owner/Admin/Manager/Employee/Accountant role architecture
- Natural-language workflow creation stored as configuration

## Production work that remains explicit

- Replace browser storage with authenticated tenant data services.
- Add server-side action validation, permissions, audit events, and workflow execution workers.
- Expand local-model command planning beyond the deterministic no-key fallback.
- Add record detail pages, editing, relation pickers, additional view builders, and full manual workspace edit mode.
- Add file storage, notification delivery, integrations, payments, e-signature, and client portal services.
- Add forecasting and deeper cross-entity advisor analysis once sufficient real data exists.

Wesify must never display fabricated records, performance, cash values, alerts, or integration state to make a demo appear populated.
