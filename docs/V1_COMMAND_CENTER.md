# BO V1 command center

The command center is the shared operational layer around each AI-generated company workspace. Company templates decide which operating modules appear; the command center, documents, access/audit, and automation surfaces remain available as platform infrastructure.

## Delivered frontend foundation

- Executive overview with role-specific KPI visibility.
- KPIs derived from actual local workspace records; unavailable financial connections display `Not connected`.
- Persistent central action queue for tasks, invoices, alerts, signatures, and approvals.
- CRM, project/process, finance, team, inventory, and support module surfaces selected by the company blueprint.
- Persistent record creation and company-specific pipeline/process stages.
- Document, access/audit, and automation/integration pages.
- Indexed routes such as `/dashboard/sales`, `/dashboard/documents`, and `/dashboard/governance`.

## Production services still required

The current browser prototype must not be represented as providing these controls until their services exist:

- Authentication, organizations, invitations, MFA, sessions, and password recovery.
- Server-enforced RBAC, tenant isolation, audit-event ingestion, retention, and export.
- Encrypted database and object storage, versioned files, access logs, backups, and recovery.
- Payment gateway, bank feeds, invoice delivery, reminders, refunds, taxes, and recurring billing.
- E-signature provider and legally traceable proposal/contract workflows.
- Client portal authentication, uploads, comments, approvals, and notifications.
- Email/in-app delivery workers, scheduled jobs, automation execution, retries, and dead-letter handling.
- Calendar, communications, banking, storage, and accounting connectors plus API credentials and webhooks.
- Security review, privacy operations, GDPR controls, and evidence required for any SOC 2 claim.

## Data integrity rule

BO never fabricates records, cash values, KPI performance, alerts, approvals, or integration state. A metric is calculated from stored operational data, shown as zero when the connected dataset is genuinely empty, or shown as unconfigured when its source does not exist.
