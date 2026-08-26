# Wesify V1 command center

The command center is the shared operational layer around each AI-generated company workspace. Company templates decide which operating modules appear; the command center, documents, access/audit, and automation surfaces remain available as platform infrastructure.

## Delivered operating suite

- Executive overview with role-specific KPI visibility.
- KPIs derived from actual local workspace records; unavailable financial connections display `Not connected`.
- Persistent central action queue for tasks, invoices, alerts, signatures, and approvals.
- CRM, project/process, finance, team, inventory, and support module surfaces selected by the company blueprint.
- Persistent record creation and company-specific pipeline/process stages.
- Document, access/audit, and automation/integration pages.
- Indexed routes such as `/dashboard/sales`, `/dashboard/documents`, and `/dashboard/governance`.
- Server-enforced tenant access, team invitations, assigned roles, approval permissions and audit history.
- Quote, order and invoice lines with discounts, tax inputs, totals, source lineage and duplicate-safe conversion.
- Payment allocation, receivable balances, stock movement integrity and balanced immutable journal batches.
- Versioned workflow graphs with conditions, record actions, approvals, encrypted webhooks, execution traces and retry receipts.
- Hourly, daily and weekly scheduled scans, including automatically provisioned finance controls.
- In-process scheduling for persistent servers and a bearer-protected cron endpoint for serverless deployments.

## Production services still required

Wesify must not be represented as providing the following controls until the deployment or specialist service exists:

- Production Clerk, Postgres, MFA, backup, restore and retention configuration for the target deployment.
- Object storage, file versioning and attachment access logs.
- Bank feeds, payment execution, invoice delivery, statutory tax engines and jurisdiction-specific numbering.
- E-signature provider and legally traceable proposal/contract workflows.
- Client portal authentication, uploads, comments, approvals, and notifications.
- Email delivery workers and a dead-letter queue beyond the built-in in-app notifications, execution history and guarded retry path.
- Calendar, communications, banking, storage and statutory-accounting connectors beyond Stripe import and encrypted Make/n8n/HTTPS webhooks.
- Security review, privacy operations, GDPR controls, and evidence required for any SOC 2 claim.

## Data integrity rule

Wesify never fabricates records, cash values, KPI performance, alerts, approvals, or integration state. A metric is calculated from stored operational data, shown as zero when the connected dataset is genuinely empty, or shown as unconfigured when its source does not exist.
