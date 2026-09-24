# Analytics taxonomy (§39)

First-party events are stored in `state.events` (180-day retention), visible as counts in the admin dashboards and used by `server/world/metrics.ts`.

**Consent:** client behavioural events are stored only with analytics consent. Essential events are kept regardless, because the product needs them: original video opened (creator traffic) and shares. Server events describe transactions the user made, so they're stored as necessary records.

**External tool:** to add PostHog or Amplitude, forward from `track()` in `server/world/context.ts` inside `after()`, only for users with analytics consent. Name the vendor in the Privacy Policy first.

## Events

| Event | Source | Properties | Checklist item |
|---|---|---|---|
| `signup`, `user_signed_up` | server | method, cohort, referred | User signed up |
| `login` | server | | |
| `email_verified` | server | | |
| `onboarding_step` | client | step | |
| `onboarding_completed` | server | | Onboarding completed |
| `app_opened` | client | | sessions |
| `visit_heartbeat` | client (not stored) | | session length (visits) |
| `market_viewed` | client | market_id, status | Market viewed; markets per session |
| `market_searched` | server | length, looks_like_url | Market searched |
| `original_video_opened` | client (essential) | market_id, surface | Original video opened |
| `trade_started` | client | market_id, outcome, price, mode | Trade started |
| `trade_completed` | server | market_id, outcome, price, trade_size, user_balance, video_age, momentum_score, first_trade, ms_since_signup | Trade completed; time to first trade |
| `trade_failed` | server | route, code | Trade failed |
| `position_sold` | server | market_id, outcome, price, trade_size | Position sold |
| `portfolio_viewed` | client | | Portfolio viewed |
| `share_clicked`, `market_shared` | client (essential) | market_id, surface | Market shared |
| `referral_signup` | server | referrer_id, status | Referral sent (attributed) |
| `referral_converted` | server | referee_id | Referral converted |
| `notification_opened` | client | kind | Notification opened |
| `market_opened`, `video_submitted` | server | market_id, source (paste/share), needs_review, duplicate | Markets from sharing |
| `market_settled` | server | market_id, platform, outcome | Market settled |
| `market_cancelled` | server | market_id, reason | Market cancelled |
| `creator_connected`, `creator_applied`, `creator_market_opened`, … | server | platform | Creator connected |
| `support_ticket_created`, `feedback_sent`, `account_deleted` | server | category / kind / reason | churn reasons |

## Derived metrics (computed, not events)

- DAU/WAU/MAU and D1/D7/D28 retention come from `state.activity` (days with any authenticated request).
- Cohorts are weekly sign-up cohorts × weeks active.
- The funnel is sign-up → onboarding → viewed a market → first trade → second trade.
- Trades per user, second-trade rate and median time to first trade come from trades.
- Session length and markets per session come from visits (30-minute inactivity gap).
