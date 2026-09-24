# Deployment, environments and rollback (§51, §71)

## Constraints of the current design

Wesify keeps its state in one process and writes it to a file (the decision was to harden this store, not move to Postgres yet). That means:

- Run **exactly one instance** per environment, on a host with a **persistent disk**: a VM, Fly.io machine with a volume, Railway/Render with a disk, or a container with a mounted volume. Serverless platforms such as Vercel functions **won't work**, because each function has its own memory and no shared disk.
- Rate limits and latency stats are per instance (fine at one instance).
- When the single instance becomes the bottleneck, move to Postgres (`db/migrations/`), and move rate limits to Redis. See "Scaling out" below.

## Environments

| | Development | Staging | Production |
|---|---|---|---|
| `APP_ENV` | development | staging | production |
| Domain | localhost | staging.wesify.app | wesify.app |
| Data dir | `.data` | separate volume | separate volume |
| Secrets | defaults ok | **own set** | **own set**, in the host's secret manager |
| Clerk | none / dev instance | Clerk *development* instance | Clerk *production* instance |
| OAuth apps | simulated | sandbox apps | production apps |
| Indexing | — | `noindex` (robots disallow all) | indexed |
| Staging-only tools (simulate availability, reset market) | on | on | refused |

Never copy production data to staging without removing emails and tokens.

## First deploy checklist

1. Buy the domain; point DNS (A/AAAA or CNAME) at the host. Enable **DNSSEC** and **registrar lock**. Keep the registrar login in the founders' password manager with 2FA (backup admin access recovery, §51).
2. TLS: the host's managed certificates (Let's Encrypt). HSTS is sent by the app in production.
3. CDN: put Cloudflare (proxied) or the host's CDN in front. Static assets under `/_next/static` are immutable; `/brand/*` is cached for a day.
4. Set every variable in `.env.example` for the environment. `npm run build && npm start` fails fast on missing production secrets (`src/instrumentation.ts`).
5. Persistent volume mounted at `WESIFY_DATA_DIR`. Backups go to a **different** volume or a synced bucket mount (`BACKUP_DIR`).
6. Scheduler: every 2 minutes, `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://wesify.app/api/internal/cron`. Use the host's cron, GitHub Actions `schedule`, or cron-job.org.
7. Uptime monitor: `GET /api/health` every minute, alert on non-200 (Better Stack, UptimeRobot). An optional public status page can come from the same monitor.
8. Email domain, as below.
9. Create your admin account: sign up normally, then `POST /api/admin/users/<id>` `{action:"role", role:"admin", confirm:"ROLE"}` with the owner token. Keep the owner token only for recovery.

## Email domain (§50)

Use a sending subdomain, e.g. `mail.wesify.app`, in Resend.

| Record | Value |
|---|---|
| SPF | TXT `v=spf1 include:amazonses.com ~all` (use the value Resend shows) |
| DKIM | the three CNAMEs Resend provides |
| DMARC | TXT `_dmarc.wesify.app` → `v=DMARC1; p=quarantine; rua=mailto:dmarc@wesify.app; adkim=s; aspf=s` (start with `p=none` for two weeks, then tighten) |
| Return path / MX | as Resend instructs |

- Transactional mail (verification, reset, settlement results) and marketing mail (product news, consent only, with an unsubscribe link) can use different senders: `EMAIL_FROM` and `EMAIL_FROM_MARKETING`.
- **Test deliverability** with mail-tester.com (aim for 9/10+), and send to Gmail, Outlook and iCloud before launch.

## Releases and rollback

1. PR → CI (typecheck, lint, unit + integration tests, dependency audit, build, E2E) → review → merge to `main`.
2. Deploy `main` to staging and run `docs/qa-checklist.md` smoke tests.
3. Deploy the same commit to production. Before deploying, run `npm run backup` on the server (or rely on the hourly one if it's < 15 minutes old).
4. **Rollback:** redeploy the previous commit or image. State migrations only add fields, so older code ignores new fields and keeps working. If a release corrupted data, stop the app, restore the last good backup (`docs/runbooks/backup-and-restore.md`) and reconcile.

## Connection pooling

Not applicable while the store is a file. After the Postgres move, use the provider's pooler (PgBouncer / Neon pooler) and keep one Prisma or pg pool per instance.

## Scaling out (later)

1. Apply `db/migrations/*.sql` to managed Postgres.
2. Implement a store that maps `WorldState` collections to tables. Every mutation function is already a single synchronous unit, so each becomes one transaction with `SELECT … FOR UPDATE` on the market row.
3. Move rate limits and idempotency keys to Redis/Postgres.
4. Run the tick as a dedicated worker and serve requests from stateless web instances.
