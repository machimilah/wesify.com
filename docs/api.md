# API

All endpoints are JSON under `/api`.

- **Success:** `{ "data": …, "meta": { "kind": "main"|"demo", "worldNow": ms, "scale": n } }`
- **Error:** `{ "error": { "code": "STABLE_CODE", "message": "User-facing copy", "details"?: {…} } }`

Every response carries `X-Request-Id`. State-changing requests must be same-origin (CSRF). Auth is the session cookie, or Clerk when it's configured.

## Public and user

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/me` | optional | Current user, `null`, or `{needsProfile:true}` (Clerk without a profile) |
| GET | `/api/auth/config` | — | Auth provider, Turnstile key, client feature flags |
| POST | `/api/auth/signup` | — | `{email,password,username,ageConfirmed,acceptTerms,inviteCode?,referralCode?,website,renderedAt,turnstileToken?}` |
| POST | `/api/auth/login` | — | `{login,password}`; rate limited per IP, account lockout |
| POST | `/api/auth/logout` | — | `?all=1` signs out every device |
| POST | `/api/auth/email` | — | `action`: `verify` · `resend-verification` · `forgot-password` · `reset-password` |
| POST | `/api/auth/complete-profile` | Clerk | Creates the Wesify profile after Clerk sign-up |
| GET/PATCH/DELETE | `/api/account` | user | Settings; PATCH `action`: `preferences`, `consent`, `onboarding-complete`, `tutorial-complete`, `change-password`, `revoke-session`, `upgrade`, `set-email`. DELETE `{confirm:"DELETE",password?}` |
| GET | `/api/account/export` | user | Everything we hold about the user |
| GET | `/api/wallet` | user | Ledger history, `?cursor=` paging |
| GET | `/api/markets` | — | `?q&sort=trending\|new\|closing\|movers\|volume&limit≤100&offset` |
| POST | `/api/markets` | user | Submit a link `{url, source:"paste"\|"share"}` → `{marketId, created, status}` (`DRAFT` = awaiting review) |
| GET | `/api/markets/:id` | optional | Market detail with rules, data source, positions |
| GET | `/api/markets/:id/history` | — | `?range=1H\|3H\|6H\|ALL` |
| POST | `/api/markets/:id/buy` | user | `{outcomeId, credits, expectedPrice?, tolerance?}`; send `Idempotency-Key` |
| POST | `/api/markets/:id/sell` | user | `{outcomeId, shares, expectedPrice?, tolerance?}`; send `Idempotency-Key` |
| GET | `/api/portfolio`, `/api/profile`, `/api/notifications` | user | |
| GET | `/api/leaderboard` | — | `?period=today\|7d\|all` |
| POST | `/api/support` · GET | — / user | Tickets and reports |
| POST | `/api/feedback` | — | |
| POST | `/api/events` | — | Product analytics (stored only with consent, except essential events) |
| POST | `/api/client-errors` | — | Frontend error reports |
| GET | `/api/health` | — | Uptime check; 503 when down. Admin token adds detail |
| GET | `/api/email/unsubscribe` | signed link | |
| GET | `/r/:code` | — | Referral link |
| — | `/api/social/*` | user | Connect/disconnect accounts, creator program |

## Admin (`support` role reads, `admin` role writes; owner token = admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/overview` | Founder dashboard, launch gate, alerts |
| GET | `/api/admin/metrics` | Business metrics, cohorts, funnel; `?part=model` for model analytics |
| GET/POST | `/api/admin/health` | Jobs, providers, errors, latency, env, costs, outbox; `?integrity=1` runs the audit; POST acknowledges alerts |
| GET/POST | `/api/admin/markets` | Search (`?q&status=live\|review\|all\|OPEN…`); create simulated/manual |
| GET/POST | `/api/admin/markets/:id` | Detail; actions (see `server/admin/marketActions.ts`) |
| POST | `/api/admin/bulk` | `pause-all`, `resume-all`, `trading-kill-switch`, `approve-clean-settlements` |
| GET | `/api/admin/users`, `/api/admin/users/:id` | Search and detail |
| POST | `/api/admin/users/:id` | `adjust`, `refund`, `freeze`, `suspend`, `reinstate`, `rename`, `role`, `resend-verification`, `delete` |
| GET/POST | `/api/admin/risk` | Flag queue, resolve or dismiss |
| GET/POST | `/api/admin/support` | Tickets, replies, canned responses, feedback |
| GET/POST | `/api/admin/flags` | Feature flags |
| GET/POST | `/api/admin/invites` | Beta invites |
| GET | `/api/admin/audit` | Audit log search |

Destructive actions need `confirm`:

- the word `CANCEL`, `TAKEDOWN`, `RESET`, `SUSPEND`, `DELETE`, `ROLE`, `PAUSE ALL`, `APPROVE` or `CONFIRM`, depending on the action;
- the final like count for a settlement;
- the amount for adjustments of W$1,000 or more.

## Internal (scheduler: `Authorization: Bearer $CRON_SECRET`, or the admin token)

`GET|POST /api/internal/cron` runs every job. `/api/internal/markets/:id/settle` only *proposes* a result, so a forged call can never pay anyone. Others: `/api/internal/markets/:id/reprice`, `/api/internal/videos/:id/refresh`, `/api/internal/creators/sync`.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Not signed in |
| `FORBIDDEN` | 403 | Not allowed (role, CSRF) |
| `NOT_FOUND` | 404 | |
| `INVALID` | 400 | Validation error (message says what) |
| `RATE_LIMITED` | 429 | Too many requests |
| `MARKET_CLOSED` / `MARKET_FINISHED` / `MARKET_NOT_OPEN` / `TRADING_PAUSED` | 409 | Market not in OPEN |
| `TRADING_DISABLED` / `SELLING_DISABLED` | 503 | Kill switch or global pause |
| `INSUFFICIENT_CREDITS`, `TRADE_LIMIT`, `MARKET_LIMIT`, `EXPOSURE_LIMIT`, `PRICE_BOUND` | 400 | Trade limits |
| `PRICE_CHANGED` | 409 | Price moved beyond tolerance since review; `details.from/to` |
| `TRADE_RATE_LIMIT` | 429 | Over 60 trades/hour |
| `NO_POSITION` | 400 | Selling more than owned |
| `SELF_TRADING` | 403 | Creator trading their own market |
| `ACCOUNT_FROZEN` / `ACCOUNT_SUSPENDED` | 403 | |
| `INVALID_URL`, `UNSUPPORTED_PLATFORM`, `VIDEO_PRIVATE`, `VIDEO_DELETED`, `VIDEO_UNAVAILABLE`, `VIDEO_TOO_OLD`, `VIDEO_TOO_NEW`, `NOT_ELIGIBLE` | 400/422 | Ingestion |
| `MARKET_CAPACITY`, `MARKET_CREATION_DISABLED` | 503 | Supply cap, flag |
| `USERNAME_TAKEN`, `USERNAME_NOT_ALLOWED`, `EMAIL_TAKEN`, `WEAK_PASSWORD`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `TOKEN_INVALID`, `VERIFICATION_FAILED`, `USE_CLERK` | various | Accounts |
| `REGISTRATIONS_CLOSED`, `INVITE_REQUIRED`, `BETA_FULL` | 403/503 | Beta gates |
| `INVALID_TRANSITION` | 409 | Lifecycle rule |
| `SETTLEMENT_ISSUES` | 409 | Proposal has integrity issues; confirm with `acknowledgeIssues` |
| `CREATOR_NOT_APPROVED`, `CREATOR_LIMIT` | 403/429 | Creator program |
| `INTERNAL` | 500 | Unexpected; `requestId` included, error captured |
