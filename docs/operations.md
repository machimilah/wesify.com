# Operating routine (§68, §69, §70)

Everything below is visible in `/admin` without SQL (§67).

## Daily (about 20 minutes, same time every day)

- [ ] **Provider health:** Overview → "Failing metric providers"; Health → Metric providers
- [ ] **Failed jobs:** Overview → "Failed jobs (24h)"; Health → Jobs
- [ ] **Settling markets:** Review queue → confirm settlements (target: none older than 4 h)
- [ ] **Flagged markets:** Risk flags (markets)
- [ ] **Support tickets:** Support → high priority first
- [ ] **Suspicious accounts:** Risk flags (users) and Users → "Flagged"
- [ ] **Top markets:** Markets (sort by activity), check content quality, feature 1–2
- [ ] **Retention:** Overview → D1/D7
- [ ] **New-user funnel:** Metrics → Funnel (where do new users drop?)
- [ ] **Creator participation:** Creators tab + Metrics → shares per trader
- [ ] **Outages/errors:** Health → Errors (new fingerprints) and the latency p95 column
- [ ] **Costs:** Health → Costs & usage vs budget
- [ ] Acknowledge the alerts you handled

## Weekly (Monday, 1 hour)

- [ ] Cohort retention (Metrics → cohorts)
- [ ] Trades per user, second-trade conversion
- [ ] Market liquidity: markets with low liquidity, trades per market
- [ ] Market-model accuracy: Model tab (Brier vs naive, calibration, drift)
- [ ] User interviews: at least 3 (`docs/beta-program.md`)
- [ ] Creator interviews: at least 1
- [ ] Most shared markets, best acquisition source (referral vs share vs direct)
- [ ] Worst-performing product flow (biggest funnel drop)
- [ ] Top bugs (Health errors + bug feedback)
- [ ] Platform-policy changes (TikTok/Meta/Google developer changelogs)
- [ ] Infrastructure costs
- [ ] **Decide 1–2 experiments for next week**; roll out behind a flag (rollout %)
- [ ] Monthly: backup restore test (`docs/runbooks/backup-and-restore.md`)

## Financial controls even for play money (§70)

- **Budget alerts:** set billing alerts at 50/80/100% of the monthly budget on the host (cloud), database (later), Resend (email), analytics vendor (if added) and any data provider. Set `MONTHLY_BUDGET_USD` so Health shows it next to usage.
- **API cost guards (no unlimited loops):**
  - Provider calls are bounded to one per live market per 5 minutes (2.5 when hot), at most 10 creator syncs per tick, and 2 retries with backoff.
  - The `providers` flag cuts all provider traffic at once.
  - Email is capped at 5 notification emails per user per day, and oEmbed only runs at submission and for expiring thumbnails.
- **Spending permissions:** only the two founders can add paid services; every paid account uses the company card with per-vendor limits, and each service is noted in the ops log.
- **Cost per active user:** monthly total spend ÷ MAU (Metrics). Review in the weekly routine.
