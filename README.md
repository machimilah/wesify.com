# wesify

Trade the future of virality. A play-money prediction market on short-form video likes. Wesify Credits (W$) have no monetary value.

V1 launch readiness is tracked in [docs/launch-readiness-status.md](docs/launch-readiness-status.md), mapped to [the checklist](wesify_v1_launch_readiness_checklist.md).

## Run locally

```bash
npm install
cp .env.example .env.local     # optional: everything works with no values set
npm run dev                    # http://localhost:3000
```

- **Accounts:** email + password by default. Set the Clerk keys to use Clerk instead.
- **Demo:** `/?demo=true` starts a private sandbox where 24 hours pass in 3 minutes.
- **Admin:** `/admin`, signed in as an `admin`/`support` user or with the owner token (`ADMIN_TOKEN`, default `dev-admin` in development).
- **Emails:** without `RESEND_API_KEY`, emails are logged to the console and listed in Admin → Health → Recent email, so you can copy verification and reset links.
- **Creator connections:** simulated unless the platform credentials are set.

| Command | What it does |
|---|---|
| `npm run check` | Typecheck + lint + all unit, integration and simulation tests |
| `npm test` | Vitest: engines, ledger, trading, settlement, accounts, HTTP layer, §53 simulations |
| `npm run test:e2e` | Playwright critical paths (`npx playwright install chromium` first). `E2E_PROD=1` runs against `npm run build` output |
| `npm run build` / `npm start` | Production build / server |
| `npm run reconcile [-- file]` | Prove every balance, the ledger, market state and settlements agree |
| `npm run backup` · `backup:verify` · `backup -- --restore <file>` | Backups ([runbook](docs/runbooks/backup-and-restore.md)) |
| `npm run load-test -- --url … --users 50` | Load test a running server, then audit balances |
| `npm run backtest -- [--runs 40] [--sweep]` | Model accuracy vs a naive baseline on synthetic trajectories |
| `npm run simulate-market -- --scenario viral-spike [--bots]` | Hour-by-hour prices for one scenario |
| `npm run seed` | Reset `.data/main.json` with fresh simulated markets (stop the server first) |
| `npm run lint` · `format` | ESLint · Prettier |

## How it works

- **Architecture:** one Next.js 16 app; engines are plain TypeScript. See [architecture](docs/architecture.md).
- **State and persistence:** state lives in memory and is saved atomically to `WESIFY_DATA_DIR`, with versioned migrations and hourly encrypted backups. `db/migrations/` is the Postgres destination.
- **Correctness:** balances change only through the ledger. Every mutation validates, then commits synchronously. Settlement and cancellation are idempotent. `checkIntegrity` proves the books.
- **Markets:** four ranges sized to each creator; LMSR prices with a virality-model prior; settlement after reviewer confirmation. See [market engine](docs/market-engine.md), [virality engine](docs/virality-engine.md) and [settlement rules](docs/settlement-rules.md).
- **Data:** a pluggable provider layer. Pasted-link likes are simulated until a licensed source exists; connected creator accounts use official APIs. See [social providers](docs/social-providers.md).

## Docs

| Topic | Docs |
|---|---|
| Build | [API & error codes](docs/api.md) · [design system](docs/design-system.md) · [analytics taxonomy](docs/analytics-taxonomy.md) · [database schema](db/schema.sql) |
| Run | [deployment & rollback](docs/deployment.md) · [admin handbook](docs/admin-handbook.md) · [operations routine](docs/operations.md) · [incident handbook](docs/incident-handbook.md) · [backup & restore](docs/runbooks/backup-and-restore.md) · [security](docs/security.md) · [support playbook](docs/support-playbook.md) |
| Launch | [QA checklist](docs/qa-checklist.md) · [beta program](docs/beta-program.md) · [content policy & supply](docs/content-policy.md) · [legal & platform review](docs/legal-review.md) · [launch comms](docs/launch-comms.md) |
| Legal pages (live) | `/terms` · `/privacy` · `/rules` · `/community` · `/faq` · `/security` |

## Deliberate decisions

- **Dark theme, crimson accent.** The spec's blue/purple is the secondary brand gradient.
- **W$10,000 welcome credits**, trade caps of 20% per trade and 50% per market, liquidity b = 2,500.
- **JSON store, one instance.** Run on a host with a persistent disk, not serverless (see deployment).
- **Clerk when configured**, built-in auth otherwise.
- **Simulated traders** (`sim.*`, labelled SIM) supply crowd prices in simulation.
- **Pasted-link metrics are simulated** and labelled "Simulated video" until official data access exists.
