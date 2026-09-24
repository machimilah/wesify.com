# Security (§43, §28)

| Control | Implementation |
|---|---|
| HTTPS everywhere | Host TLS + HSTS (`next.config.ts`, production); `upgrade-insecure-requests` in CSP |
| Secure headers | CSP, X-Frame-Options DENY, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy, COOP (`next.config.ts`) |
| CSRF | Same-origin Origin check + reject `Sec-Fetch-Site: cross-site` on every state change (`server/http.ts`); SameSite=Lax cookies |
| XSS | React escaping; no user HTML rendered; JSON-LD `<` escaped; CSP |
| SQL injection | No SQL at runtime (file store). Postgres migration must use parameterized queries only |
| Parameter validation | zod schemas on every route body; engine re-validates |
| Secrets | Env vars only, validated at boot; `.env*` git-ignored; `.env.example` has no values. Rotate on staff changes |
| Token encryption | AES-256-GCM for OAuth tokens and backups |
| Passwords | scrypt (N=16384) per-user salt, or Clerk. Lockout after 5 failures (15 min, doubling). Reset tokens single-use, 1 h |
| Sessions | Random 256-bit tokens, stored hashed; 30-day absolute / 14-day idle expiry; list/revoke devices; password change signs out other devices; suspension revokes all |
| Rate limits | Per IP and per user on auth, trading, creation, support, events |
| Bot protection | Honeypot + minimum form time + optional Turnstile; sign-up caps per device/network |
| Admin | Roles (`support` read, `admin` write), owner token for recovery, typed confirmations, every action in the audit log with the actor |
| Least privilege | Support can't move W$ or end markets; creators' OAuth scopes are read-only; staging tools refuse in production |
| Dependency scanning | `npm audit` in CI + Dependabot weekly |
| Audit log | `auditLogs` (50k newest), searchable in `/admin` → Audit log |
| Backups | Encrypted, checksummed, off-disk location |
| Production/staging separation | Separate hosts, data, secrets, Clerk instances and OAuth apps (`docs/deployment.md`) |
| Security contact | `/security`, `/.well-known/security.txt`, support category "Security issue" (alerts founders) |
| Incident response | `docs/incident-handbook.md` |

## Production access

- Only the founders have host, registrar, DNS, email and Clerk admin access. All of them require 2FA, and credentials live in a shared password manager.
- SSH/console access to production is for incidents and restores only; note each use in the ops log.
- Offboarding means rotating `ADMIN_TOKEN`, `CRON_SECRET` and provider secrets, and removing roles.
