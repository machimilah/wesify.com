# V1 launch readiness: status

Tracks `wesify_v1_launch_readiness_checklist.md` section by section. Last updated 2026-09-24.

| Status | Meaning |
|---|---|
| ✅ | Built and tested in the app |
| 📄 | Process or policy written in `docs/`, carried out by people |
| 👤 | Needs you: an account, credentials, a decision, legal sign-off, or real users |

## Decisions made on 2026-09-24

- Keep the dark theme with crimson accent. The blue/purple gradient is the secondary brand gradient.
- Keep W$10,000 as the welcome bonus.
- Use Clerk when its keys are set, with the built-in email/password login as fallback.
- Harden the JSON store rather than move to Postgres now.

| § | Area | Status | Where / what's left |
|---|---|---|---|
| 1 | Core product definition | ✅ | Four creator-sized ranges (`lib/market-engine/ranges.ts`); likes only, 24 h after opening; settlement after reviewer confirmation. Rules for deleted/private videos, late data, missing metrics, wrong setup, manipulation, cancellation, refunds, rounding and ties are in plain English at `/rules` (`lib/shared/rules.ts`) and enforced in `server/world/markets.ts` / `world.ts` |
| 2 | Brand & visual identity | ✅ 👤 | Tokens, states, typography, spacing, radius, shadows and components in `globals.css` + `docs/design-system.md`. Favicon, app icon and social image are generated from the logo. 👤 High-res master logo and an official light-on-dark version |
| 3 | Landing popup | ✅ | "How Wesify works" dialog for first-time visitors (`components/HowItWorks.tsx`) |
| 4 | Authentication | ✅ 👤 | Built-in sign-up, login, logout, verification, reset, change password, sessions with expiry and revocation, secure cookies, unique emails and usernames, username validation and moderation, 18+ confirmation, terms/privacy acceptance with versions, deletion, export, suspension, rate limits, lockout, honeypot, optional Turnstile. Clerk path in `server/auth/clerk.ts` + `proxy.ts`. 👤 Clerk keys (enable Google/Apple login in the Clerk dashboard); Turnstile keys |
| 5 | Onboarding | ✅ | 3 screens (`/welcome`), W$10,000 via ledger, straight to markets, skippable first-trade walkthrough (rollout flag), connected accounts in Profile and Settings (TikTok, Instagram, YouTube) |
| 6 | Markets feed | ✅ | Thumbnail, handle, platform, likes, age, time left, momentum, top odds, 1 h movement, trade/watch buttons, search, sorting, Trending/New/Biggest movers/Closing soon/Settled, loading, empty and error states, paused/settled states, live polling |
| 7 | Market page | ✅ | Everything listed, including 1 h/3 h change, velocity, rules, settlement definition, data source, review, settling and cancelled states, share, report |
| 8 | Trading interface | ✅ | Review → confirm → receipt; balance; resulting average entry; price-changed, closed and insufficient states; idempotency keys; server validation; atomic commit |
| 9 | Selling | ✅ | Partial and full, value, unrealized P&L, proceeds, realized P&L, oversell and price guards |
| 10 | Virtual wallet | ✅ | `/wallet` with descriptions and links; reconciliation (`npm run reconcile`, hourly job, admin audit). 👤 Referral credits are off until you enable the `referrals` flag |
| 11 | Portfolio | ✅ | Adds realized P&L; open and settled filters |
| 12 | Profile | ✅ | Stats, rank, settings, privacy, logout, delete, connected accounts |
| 13 | Leaderboard | ✅ | Periods, methodology, 5 trades in 2 markets to qualify, tie-breaks, badges, exclusions, 60 s recompute |
| 14 | Video ingestion | ✅ | Parse and normalize (TikTok, short links), clear errors for unsupported/private/deleted/old, duplicate detection, oEmbed metadata, admin override |
| 15 | Share-to-Wesify | ✅ 👤 | Web paste, PWA share target, `/share-target` deep link, immediate status, source tracking. 👤 Native iOS/Android share extensions are post-launch (§76) |
| 16 | Social data layer | ✅ 👤 | Provider interface and registry, mock/manual/creator providers, retries and backoff, health and alerts, auto-pause, switchable provider. 👤 A licensed metrics source for arbitrary public videos |
| 17 | Thumbnails & media rights | ✅ | Linked, not hosted; provenance, refresh, broken fallback, attribution, takedown |
| 18 | Metric collection | ✅ | 5 min (2.5 min when hot), dedupe, suspicious readings, corrections, freshness, retention |
| 19 | Virality engine | ✅ | All velocity windows, model version, stored forecasts, cold-start prior, validity guard, backtest vs naive (Brier, log loss, calibration, accuracy) |
| 20 | Market engine | ✅ | LMSR, bounds, reconstruction, simulation and extreme-case tests, staging reset |
| 21 | Model ↔ market | ✅ | Max move per update, logged repricings explained in admin, emergency pause |
| 22 | Market creation | ✅ | Eligibility rules, generated question/ranges/prices, stored rules version, admin review, notify interested traders |
| 23 | Supply management | ✅ | Min 20 / max 100 live, diversity, featured markets, stale de-ranking, low-liquidity metric |
| 24 | Lifecycle | ✅ | DRAFT → OPEN ⇄ PAUSED → LOCKED → SETTLING → SETTLED / CANCELLED, validated and audited |
| 25 | Settlement engine | ✅ | Auto lock, retries, freshness and suspicion checks, one winner, review, idempotent, engine version |
| 26 | Cancellation | ✅ | Reason codes, public explanations, refunds, notifications |
| 27 | Anti-manipulation | ✅ | Self-trading ban, shared device/network detection, velocity and jump checks, repeated/identical trades, new-account clusters, position/exposure/rate limits, risk scores, review queue, freeze. Nothing punishes automatically |
| 28 | Abuse prevention | ✅ | Rate limits, CAPTCHA option, device tracking, sign-up caps, referral farming, exploit loops, replay (idempotency), server pricing, proposal-only internal settle, admin roles, audit |
| 29 | Notifications | ✅ 👤 | All listed kinds, preferences, email, deep links, spam caps. 👤 Web push (post-launch) |
| 30 | Sharing & virality | ✅ | Share market/position, generated social cards with logo, creator and odds; referral code, link and source; reward after real usage |
| 31 | Creator experience | ✅ 👤 | OAuth for 3 platforms, permissions explained, status, dashboard with market activity and traffic back, disconnect with revocation, data deletion, support. 👤 Platform app reviews |
| 32 | Search | ✅ | Creator, market, URL, caption; ranking; bounded queries. Recent searches skipped (optional) |
| 33 | Admin dashboard | ✅ | Every listed item, with typed confirmations |
| 34 | Database | ✅ 👤 | Versioned migrations, integrity checks, backups; Postgres schema + `db/migrations/`. 👤 Separate staging/production volumes when you deploy |
| 35 | Backend | ✅ | APIs, jobs + cron endpoint, error codes, zod validation, structured logs, env validation |
| 36 | Frontend | ✅ 👤 | Responsive, states, offline banner, skeletons, a11y basics, reduced motion, long names, thumbnails. 👤 Real-device browser pass (`docs/qa-checklist.md`) |
| 37 | Performance | ✅ 👤 | Stats indexed per request, pagination, lazy images, lazy Clerk, SSR metadata, latency stats, bundle report in CI. 👤 CDN, Lighthouse run |
| 38 | Realtime | ✅ | Polling (10 s), live status, "updated … ago" and stale warnings, reconnect on focus/online |
| 39 | Analytics | ✅ 👤 | First-party events, consent-gated, cohorts, funnel (`docs/analytics-taxonomy.md`). 👤 Optional external tool |
| 40 | Business metrics | ✅ | Admin → Metrics |
| 41 | Model analytics | ✅ | Admin → Model |
| 42 | Observability | ✅ 👤 | Error groups (server/client/job/provider), job and provider health, latency and error rate, disk and costs, alert webhook, `/api/health`. 👤 Webhook URL, uptime monitor |
| 43 | Security | ✅ 📄 | Headers/CSP, CSRF, encryption, roles, audit, scanning, `/security` (`docs/security.md`) |
| 44 | Privacy | ✅ 👤 | Policy, data map, consent, export/deletion. 👤 Counsel review |
| 45 | Terms & rules | ✅ 👤 | Terms, community rules, market rules, disclaimers. 👤 Governing law by counsel |
| 46 | Platform compliance | 📄 👤 | Checklist in `docs/legal-review.md` §B |
| 47 | Legal review | 📄 👤 | Brief in `docs/legal-review.md` |
| 48 | Customer support | ✅ 📄 | Form, tickets, canned replies, SLA, escalation (`docs/support-playbook.md`). 👤 Monitored support inbox |
| 49 | Moderation | ✅ | No comments; username moderation; report user/market; freeze/suspend; appeals |
| 50 | Email | ✅ 👤 | Templates, outbox, transactional vs marketing, unsubscribe. 👤 Resend account, SPF/DKIM/DMARC, deliverability test (`docs/deployment.md`) |
| 51 | Domains & environments | 📄 👤 | `docs/deployment.md` |
| 52 | Testing | ✅ 👤 | 137 unit/integration/simulation tests + 6 Playwright E2E runs. 👤 Real mobile/desktop browsers |
| 53 | Simulations | ✅ | `tests/integration/simulations.test.ts` (all 17 scenarios) |
| 54 | Load testing | ✅ 👤 | `npm run load-test` + settlement-under-load test. 👤 Run against staging |
| 55 | Backups | ✅ 👤 | Hourly, encrypted, verified, runbook, RPO 1 h / RTO 15 min. 👤 Off-disk location, monthly restore test |
| 56 | Incident response | ✅ 📄 | Kill switch, pause all, emergency owner token; templates and postmortems (`docs/incident-handbook.md`) |
| 57 | Feature flags | ✅ | Admin → Controls, with gradual rollout |
| 58 | Beta management | ✅ 📄 👤 | Invites, beta cap, cohorts, feedback. 👤 Run interviews (`docs/beta-program.md`) |
| 59 | Launch-market supply | ✅ 📄 | Launch gate checks; `docs/content-policy.md` |
| 60 | Content safety | ✅ 📄 | Admin approval + policy |
| 61 | Product copy | ✅ 👤 | Copy rewritten in plain English with no casino language. 👤 Final proofread |
| 62 | Mobile UX | ✅ 👤 | Bottom nav, sticky trade bar, sheet sizing, keyboard, safe areas. 👤 Device pass |
| 63 | Accessibility | ✅ 👤 | Labels, focus, dialogs, sr text, no color-only signals. 👤 axe/VoiceOver pass |
| 64 | SEO | ✅ | Canonicals, OG/Twitter, social images, sitemap, robots, JSON-LD, private pages excluded; markets `noindex` (24 h lifetime) |
| 65 | Cookies & consent | ✅ | Banner, necessary vs analytics, stored and editable. No marketing cookies exist |
| 66 | Launch comms | 📄 👤 | `docs/launch-comms.md` |
| 67 | Founder dashboard | ✅ | Admin → Overview |
| 68–70 | Routines & financial controls | 📄 👤 | `docs/operations.md`. 👤 Billing alerts |
| 71 | Engineering hygiene | ✅ 👤 | Git repo initialized, CI (GitHub Actions), ESLint, Prettier, typecheck, lockfile, Dependabot, docs. 👤 Push to GitHub, enable branch protection + required reviews |
| 72 | Documentation | ✅ | `docs/` + README |
| 73 | Pre-launch QA | 📄 👤 | `docs/qa-checklist.md` |
| 74 | Private alpha | 📄 👤 | `docs/beta-program.md` |
| 75 | Launch gate | ✅ 👤 | Live checks in Admin → Overview; manual rows need you |
| 76 | After first users | — | Deliberately not built |
