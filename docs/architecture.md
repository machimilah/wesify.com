# Architecture

Wesify is one Next.js 16 app (App Router) with the engines kept as plain TypeScript modules. Everything runs in a single Node process; state lives in memory and is persisted to a JSON file.

```
src/
  app/                      pages and route handlers (API under app/api)
  components/               UI (design system in components/ui.tsx + app/globals.css)
  lib/                      shared, client-safe code
    market-engine/          LMSR pricing (lmsr.ts), client quotes, range formula (ranges.ts)
    virality-engine/        velocity, momentum, forecast, smoothing, validity checks
    social-providers/       provider interface, URL parsing, mock/manual providers, oEmbed
    simulation/             synthetic trajectories for tests, demo and seeding
    shared/                 types, DTOs, constants, plain-English rules (rules.ts), formatting
  server/
    world/                  the domain: markets, trading, ledger, users, lifecycle, settlement,
                            referrals, support, flags, metrics, integrity, queries
    admin/                  admin read models and market actions
    auth/                   Clerk bridge, sign-up gates, bot checks
    email/outbox.ts         queued email + templates
    creator/                OAuth connectors (TikTok, Instagram, YouTube)
    http.ts                 the request pipeline (see below)
    store.ts, backup.ts     persistence, migrations, backups
    env.ts, log.ts          env validation, structured logs
  proxy.ts                  Clerk middleware when configured (Next 16 "proxy")
  instrumentation.ts        env validation at boot, server error capture
db/                         target Postgres schema + ordered migrations
scripts/                    seed, simulate, backtest, reconcile, backup/restore, load test
tests/                      vitest unit + integration, Playwright e2e
```

## The world

A `World` owns one consistent `WorldState` (see `server/world/state.ts`). There is one main world and short-lived demo worlds (24 hours compressed into 3 minutes).

**Every mutation is synchronous.** Route handlers do their async work first (provider calls, reading the body), then run one synchronous function that validates everything and then commits. Node runs one synchronous block at a time, so a trade, a settlement or a cancellation can never interleave with another. This is the MVP's transaction and locking model (§8 atomic transaction, §20 transaction locking, §20 concurrent-order safety). When the store moves to Postgres, each of those functions becomes one `SERIALIZABLE` transaction with the same shape.

**Time moves by ticking.** Each request ticks its world. Background ticks from `/api/internal/cron` keep it moving when nobody is browsing. A tick:

1. Polls metrics for every live market in 5-minute steps (2.5 minutes when momentum is high), backfilling gaps, and records snapshots.
2. Reprices each market from its new trajectory.
3. Runs simulated traders (labelled `sim.*`).
4. Pauses markets whose data is stale, missing or deleted, resumes them when data returns, and cancels them after the grace period.
5. Locks markets at `locksAt` and proposes settlement at `settlesAt`.
6. Syncs connected creator accounts.
7. Tops up simulated supply.
8. Hourly: prunes, runs the integrity check, refreshes thumbnails, writes a backup.

## Request pipeline (`server/http.ts`)

`handle(req, options, fn)` is used by every API route. It runs these steps in order:

- CSRF check (Origin / Sec-Fetch-Site).
- Rate limit per IP or per user.
- Pick the world (main or demo).
- Tick.
- Resolve identity: Clerk if configured, otherwise the session cookie.
- Authorize: user, support, admin or cron.
- Set the device cookie.
- Idempotency replay.
- Run `fn` inside `world.mutate`.
- Record activity.
- Build a JSON envelope (`{ data, meta }` or `{ error: { code, message } }`).
- Record route latency and error rate.
- Schedule email, alert and analytics delivery with `after()`.

## Money: the W$ ledger

A balance only changes through `postLedger` (`server/world/ledger.ts`). It appends a row with the resulting balance and a human-readable description, and refuses to go negative. `checkIntegrity` (`server/world/integrity.ts`) proves the books from scratch:

- Balances equal ledger sums, and the ledger chain adds up.
- Market quantities replay from trades.
- At most one payout per user per market.
- Payouts equal the settlement record.
- Exactly one winner per settled market.
- Finished markets hold no open positions.

It runs hourly, in the admin balance audit, in `npm run reconcile`, in backup verification, and after every simulation test.

## Persistence

`server/store.ts` keeps the state in memory and writes it atomically (temp file + rename) 1.5 s after a change. Loads run versioned migrations (`migrate` in `state.ts`). A file that exists but can't be read stops the server instead of starting empty. Backups: `server/backup.ts`, runbook in `docs/runbooks/backup-and-restore.md`. Limits of this design, and the move to Postgres, are covered in `docs/deployment.md`.

## Identity

Clerk when its keys are set, otherwise built-in email/password. Both paths create the same local user row (username, W$, terms acceptance). Admin access uses roles (`user`, `support`, `admin`) on user rows, plus an owner token for bootstrapping.

## Where things are decided

| Question | File |
|---|---|
| Which states a market can move between | `server/world/lifecycle.ts` |
| How ranges are sized | `lib/market-engine/ranges.ts` |
| How prices are formed | `lib/market-engine/lmsr.ts`, `reprice()` in `server/world/markets.ts` |
| When a market settles, and how | `proposeSettlement`, `approveSettlement`, `settleMarket` in `markets.ts` |
| Plain-English rules shown to users | `lib/shared/rules.ts` |
| What users may do | `assertCanTrade` in `trading.ts`, feature flags in `flags.ts` |
