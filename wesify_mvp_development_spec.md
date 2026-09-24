# Wesify MVP Development Specification

## 0. Purpose

This document is the implementation blueprint for the first usable version of **Wesify**, a prediction-market-style product for social video performance.

The MVP has one job:

> Prove that users want to repeatedly trade the future performance of short-form videos.

The first version should not attempt to become a regulated real-money prediction market, a full social network, a creator analytics suite, or a multi-platform infrastructure company.

The core loop is simple:

> A user sees a video, chooses a future like range, buys that outcome with play money, watches the probability move as the video accelerates or slows down, and either sells before settlement or waits until the market resolves.

The product should create the feeling:

> “I saw this video early. I knew it would blow up. I bought the high range before everyone else.”

Everything in the MVP should reinforce that loop.

---

# 1. Product definition

## 1.1 One-line description

**Wesify lets users trade the future virality of social videos.**

## 1.2 MVP market question

For every supported video:

> **How many likes will this video have 24 hours after market creation?**

The MVP should support only this market type.

Do not add views, followers, comments, shares, watch time, creator growth, music streams, or other outcome types yet.

## 1.3 Default outcome ranges

Use five mutually exclusive ranges:

- `< 10K`
- `10K – 100K`
- `100K – 500K`
- `500K – 1M`
- `1M+`

These can become adaptive later. Fixed ranges are better for the first build because they are easier to understand, test, and compare.

## 1.4 Currency

Use **play money only**.

Suggested starting balance:

```text
10,000 W$
```

W$ means Wesify Credits.

No deposits.
No withdrawals.
No fiat.
No crypto.
No real-money payout.
No prizes with monetary value.

The MVP is a product-demand and market-mechanics experiment.

---

# 2. Product principles

## 2.1 Extremely low friction

A user should be able to:

1. Open Wesify
2. Tap a video
3. Select a range
4. Enter an amount
5. Confirm

Target:

```text
First trade in under 20 seconds.
```

## 2.2 The market is the product

Do not bury the core experience behind analytics.

The video, current engagement, outcome prices, movement, and trade controls should be visible immediately.

## 2.3 Dynamic prices are essential

The defining feature of Wesify is not simply “predict a video.”

The defining feature is:

> Market prices continuously change based on the actual trajectory of the video's engagement.

When a video suddenly accelerates, high-like outcomes become more probable and therefore more expensive.

When a video stalls, low-like outcomes become more probable.

## 2.4 Users should be able to exit early

The user should not need to wait 24 hours.

If a user buys the `1M+` range at W$0.08 and the market later reprices it to W$0.31, the user should be able to sell the position and realize a gain in play money.

That makes Wesify feel like a market rather than a static bet.

## 2.5 Avoid fake complexity

Do not add features because traditional financial products have them.

The MVP needs:

- Markets feed
- Market detail
- Portfolio
- Profile
- Basic leaderboard

Nothing else is mandatory.

---

# 3. Main navigation

Use three primary tabs:

```text
Markets
Portfolio
Profile
```

Optional fourth tab later:

```text
Leaderboard
```

The app should open directly into **Markets**.

---

# 4. Screen 1: Markets feed

## 4.1 Purpose

The feed answers:

> What can I trade right now?

## 4.2 Each market card should show

- Video thumbnail
- Creator handle
- Platform
- Time since market opened
- Current likes
- Momentum indicator
- Top two or three most probable ranges
- Current price for each displayed range
- Market closing countdown
- Trade button

Example:

```text
@creatorname
Current likes: 82.4K
+438% likes in 3h

24H LIKES

100K–500K     0.18
500K–1M       0.34
1M+           0.41

Closes in 16h 22m

[ Trade ]
```

## 4.3 Momentum labels

Use only five states:

```text
Cooling
Stable
Rising
Surging
Exploding
```

These labels should derive from the momentum score.

## 4.4 Feed ranking

For the first MVP, rank by:

```text
feed_score =
0.40 * market_activity_score
+ 0.35 * momentum_score
+ 0.15 * recency_score
+ 0.10 * liquidity_score
```

Do not over-optimize this initially.

---

# 5. Screen 2: Video market

This is the most important screen in the product.

## 5.1 Top section

Display:

- Video thumbnail or embedded preview
- Creator
- Platform
- Current likes
- Market creation time
- Time remaining
- Current momentum

## 5.2 Main market question

Large text:

> **How many likes will this video have after 24 hours?**

## 5.3 Outcome cards

Each range should show:

- Range
- Current price
- Implied probability
- Change over 1h
- Optional sparkline

Example:

```text
< 10K
W$0.02
2%
-68%

10K–100K
W$0.05
5%
-41%

100K–500K
W$0.17
17%
+12%

500K–1M
W$0.33
33%
+52%

1M+
W$0.43
43%
+124%
```

## 5.4 Buy interaction

When a user taps an outcome:

```text
Buy 1M+
Price: W$0.43

Amount:
[ 100 ]

Estimated shares:
232.56

Potential value if this range wins:
W$232.56

[ Confirm ]
```

Avoid language suggesting real financial return.

## 5.5 Sell interaction

If the user already owns a position:

```text
Your position
1M+

Shares: 232.56
Average price: W$0.21
Current price: W$0.43
Current value: W$100.00
Unrealized P&L: +W$51.16

[ Sell ]
```

---

# 6. Screen 3: Portfolio

## 6.1 Top metrics

Show only:

- Balance
- Open positions value
- Unrealized P&L
- Prediction accuracy

Example:

```text
Balance
W$8,420

Open positions
W$2,130

Unrealized P&L
+W$550

Accuracy
68%
```

## 6.2 Open positions

Each position should show:

- Video
- Outcome range
- Average entry price
- Current price
- Position value
- P&L
- Time remaining
- Sell button

## 6.3 Settled positions

Show:

- Won or lost
- Entry price
- Settlement value
- Net W$ result

---

# 7. Screen 4: Profile

Minimum data:

- Username
- Join date
- W$ balance
- Markets traded
- Win rate
- Best trade
- Current streak

Optional:

- Avatar
- Referral code

Do not build follower systems yet.

---

# 8. Leaderboard

A lightweight leaderboard can improve retention.

Show:

```text
Top Traders
Today
7 Days
All Time
```

Rank by a score that rewards realized performance and consistent prediction quality.

Example:

```text
risk_adjusted_score =
realized_profit
* accuracy_multiplier
* minimum_trade_count_factor
```

Do not rank purely by W$ balance because users could game it by barely trading.

---

# 9. Market lifecycle

Every video market follows the same state machine:

```text
DRAFT
  ↓
OPEN
  ↓
LOCKED
  ↓
SETTLING
  ↓
SETTLED
```

Optional terminal state:

```text
CANCELLED
```

## 9.1 DRAFT

Market exists internally but users cannot trade.

Required before opening:

- Valid video
- Valid platform
- Valid creation timestamp
- Initial like count
- Outcome ranges
- Initial probability distribution
- Settlement time

## 9.2 OPEN

Users can buy and sell.

Prices update continuously.

## 9.3 LOCKED

Trading stops.

Recommended:

```text
Lock 1 minute before settlement timestamp.
```

## 9.4 SETTLING

Fetch final engagement metric.

Run integrity checks.

## 9.5 SETTLED

Exactly one outcome wins.

Winning outcome:

```text
settlement_price = 1.00
```

Losing outcomes:

```text
settlement_price = 0.00
```

Update all portfolios.

---

# 10. Core pricing concept

## 10.1 Key principle

If an outcome becomes more probable:

```text
price ↑
potential upside ↓
```

If an outcome becomes less probable:

```text
price ↓
potential upside ↑
```

## 10.2 Probability and price

For the MVP:

```text
price_i ≈ probability_i
```

Prices are normalized:

```text
Σ price_i = 1.00
```

Example:

```text
<10K          0.03
10K–100K      0.07
100K–500K     0.20
500K–1M       0.30
1M+           0.40

TOTAL         1.00
```

## 10.3 Settlement

A correct W$0.40 share becomes W$1.00.

A wrong W$0.40 share becomes W$0.00.

---

# 11. Virality engine

The virality engine is the core technical differentiator.

Its goal is not to perfectly predict virality.

Its goal is to produce a continuously updated probability distribution that is:

- responsive
- explainable
- stable enough to trade
- difficult to manipulate
- improvable with data

---

# 12. Signals to collect

For each video snapshot:

```text
timestamp
likes
views if available
comments if available
shares if available
followers if available
video_age
```

For the MVP, likes alone are enough if platform access is limited.

Minimum viable signal:

```text
likes over time
```

---

# 13. Time windows

Calculate growth over:

```text
5 minutes
15 minutes
30 minutes
1 hour
3 hours
6 hours
```

For a video at time `t`:

```text
velocity_5m
velocity_15m
velocity_30m
velocity_1h
velocity_3h
velocity_6h
```

Where:

```text
velocity_window =
(new_likes - old_likes) / elapsed_minutes
```

---

# 14. Acceleration

Virality is more about acceleration than absolute velocity.

Example:

```text
20 likes/min
40 likes/min
120 likes/min
600 likes/min
```

The important event is not 600 likes/min alone.

It is the acceleration into 600 likes/min.

Calculate:

```text
acceleration =
current_velocity - previous_velocity
```

Normalize relative to previous velocity:

```text
relative_acceleration =
(current_velocity - previous_velocity)
/
max(previous_velocity, epsilon)
```

---

# 15. Momentum score

Start with a transparent heuristic.

Example:

```text
momentum_score =
0.30 * normalized_velocity_5m
+ 0.20 * normalized_velocity_30m
+ 0.20 * normalized_velocity_1h
+ 0.15 * normalized_acceleration_30m
+ 0.10 * normalized_acceleration_1h
+ 0.05 * normalized_velocity_3h
```

Map score into:

```text
0.00–0.20 = Cooling
0.20–0.40 = Stable
0.40–0.60 = Rising
0.60–0.80 = Surging
0.80–1.00 = Exploding
```

Do not let one data point cause extreme repricing.

Use smoothing.

---

# 16. Price smoothing

Apply an exponentially weighted moving average.

```text
smoothed_probability =
alpha * new_probability
+ (1 - alpha) * previous_probability
```

Suggested initial alpha:

```text
0.20
```

During major spikes:

```text
alpha can temporarily increase to 0.35
```

This prevents prices from looking erratic while preserving responsiveness.

---

# 17. Initial prediction model

Do not begin with an enormous ML model.

Use a simple statistical baseline first.

## 17.1 Inputs

```text
current_likes
video_age_minutes
velocity_5m
velocity_30m
velocity_1h
velocity_3h
acceleration_30m
acceleration_1h
creator_baseline if known
```

## 17.2 Basic forecast

Estimate final likes:

```text
projected_likes =
current_likes
+
weighted_future_growth
```

A rough first model can estimate remaining growth from decay-adjusted velocity.

Example:

```text
future_velocity(t) =
current_velocity * exp(-decay_rate * t)
```

Then integrate future velocity until settlement.

Do not overfit.

---

# 18. Outcome probability distribution

Do not convert the forecast into a single deterministic number.

Generate a distribution.

Example:

```text
forecast_mean = 710,000
forecast_std = 280,000
```

Then compute probability mass within each outcome range.

Example:

```text
P(500K–1M) =
CDF(1M) - CDF(500K)
```

Use log-normal or negative-binomial distributions later if they fit viral data better.

For the MVP, normal or log-normal is acceptable.

---

# 19. Hybrid market pricing

The MVP should not rely exclusively on the prediction model.

Use a hybrid:

```text
market_probability =
model_weight * model_probability
+
trader_weight * crowd_probability
```

Suggested early values:

```text
model_weight = 0.70
trader_weight = 0.30
```

As liquidity increases:

```text
model_weight ↓
trader_weight ↑
```

Eventually:

```text
model_weight = 0.20
trader_weight = 0.80
```

This lets the market become increasingly user-driven.

---

# 20. Play-money liquidity model

A completely empty order book is bad UX.

For the MVP, use a **virtual automated market maker**.

Do not require real users to take every opposite side.

Recommended:

- Internal virtual liquidity
- No real financial exposure
- Deterministic pricing curve
- Users can always enter and exit

A good option for the MVP is LMSR.

---

# 21. LMSR overview

For outcome quantities `q_i`:

```text
C(q) = b * ln(Σ exp(q_i / b))
```

Price of outcome `i`:

```text
p_i =
exp(q_i / b)
/
Σ exp(q_j / b)
```

Where:

```text
b = liquidity parameter
```

Higher `b`:

```text
more liquidity
smaller price movement
```

Lower `b`:

```text
less liquidity
larger price movement
```

Suggested initial `b`:

```text
1000
```

Tune during testing.

---

# 22. Combining virality pricing with market activity

Maintain two components:

```text
model_prior
market_state
```

The model prior moves when engagement changes.

The market state moves when users trade.

A practical MVP approach:

```text
effective_logits =
model_logits
+
trade_logits
```

Then:

```text
probabilities = softmax(effective_logits)
```

Model updates adjust `model_logits`.

User trades adjust `trade_logits`.

This keeps the behavior intuitive.

---

# 23. Pricing update loop

Every 1 to 5 minutes:

```text
1. Fetch latest like count
2. Add snapshot
3. Calculate growth metrics
4. Calculate momentum score
5. Forecast final likes
6. Generate outcome probabilities
7. Smooth probabilities
8. Update model prior
9. Recalculate market prices
10. Persist price history
11. Push update to clients
```

The MVP does not require second-by-second pricing.

---

# 24. Video ingestion

The MVP should support at least one of these paths.

## Path A: Manual URL submission

User pastes:

```text
TikTok URL
```

System:

```text
extract video identifier
validate URL
create or locate market
```

## Path B: Share-to-Wesify

User:

```text
TikTok → Share → Wesify
```

Wesify receives the URL and opens the video market.

This is a strong feature because it reduces friction.

## Path C: Creator-connected accounts

Creators authenticate their social account.

New videos are automatically detected and can become markets.

This is ideal when official API access supports it.

---

# 25. Data access architecture

Do not make the product dependent on brittle unauthorized scraping.

Create a provider abstraction:

```ts
interface SocialProvider {
  resolveVideo(url: string): Promise<VideoMetadata>
  getMetrics(videoId: string): Promise<VideoMetrics>
}
```

Possible providers:

```text
TikTokOfficialProvider
InstagramOfficialProvider
MockProvider
ManualSettlementProvider
LicensedDataProvider
```

The rest of the app should never care where the metric came from.

---

# 26. Manual fallback

For early testing, allow trusted admins to update or settle video metrics manually.

This is not scalable.

It is acceptable for an MVP.

Admin actions:

```text
Set current likes
Set final likes
Settle market
```

Every manual action must be audit logged.

---

# 27. Database

Recommended:

```text
PostgreSQL
```

Use Supabase, Neon, Railway, or another managed Postgres service.

---

# 28. Core tables

## users

```sql
id uuid primary key
email text unique
username text unique
avatar_url text
credits_balance numeric
created_at timestamptz
updated_at timestamptz
```

## social_accounts

```sql
id uuid primary key
user_id uuid
platform text
platform_user_id text
handle text
access_token_encrypted text
refresh_token_encrypted text
expires_at timestamptz
created_at timestamptz
```

## videos

```sql
id uuid primary key
platform text
platform_video_id text
canonical_url text
creator_handle text
thumbnail_url text
published_at timestamptz
created_at timestamptz
```

Unique:

```text
(platform, platform_video_id)
```

## video_metric_snapshots

```sql
id uuid primary key
video_id uuid
likes bigint
views bigint null
comments bigint null
shares bigint null
captured_at timestamptz
source text
```

Index:

```text
(video_id, captured_at)
```

## markets

```sql
id uuid primary key
video_id uuid
question text
status text
opened_at timestamptz
locks_at timestamptz
settles_at timestamptz
final_metric bigint null
winning_outcome_id uuid null
liquidity_parameter numeric
created_at timestamptz
```

## market_outcomes

```sql
id uuid primary key
market_id uuid
label text
min_value bigint null
max_value bigint null
sort_order int
current_price numeric
model_probability numeric
market_probability numeric
created_at timestamptz
```

## trades

```sql
id uuid primary key
user_id uuid
market_id uuid
outcome_id uuid
side text
shares numeric
price numeric
credits numeric
created_at timestamptz
```

`side`:

```text
BUY
SELL
```

## positions

```sql
id uuid primary key
user_id uuid
market_id uuid
outcome_id uuid
shares numeric
average_entry_price numeric
realized_pnl numeric
updated_at timestamptz
```

Unique:

```text
(user_id, market_id, outcome_id)
```

## market_price_history

```sql
id uuid primary key
market_id uuid
outcome_id uuid
price numeric
model_probability numeric
recorded_at timestamptz
```

## settlements

```sql
id uuid primary key
market_id uuid
final_metric bigint
winning_outcome_id uuid
source text
settled_at timestamptz
metadata jsonb
```

## audit_logs

```sql
id uuid primary key
actor_user_id uuid null
action text
entity_type text
entity_id uuid
metadata jsonb
created_at timestamptz
```

---

# 29. Recommended technical stack

## Frontend

```text
Next.js
TypeScript
React
Tailwind CSS
```

Optional:

```text
shadcn/ui
Framer Motion
```

## Backend

Simplest option:

```text
Next.js route handlers / server actions
```

If a separate backend is desired:

```text
FastAPI
```

or:

```text
NestJS
```

Do not split into microservices yet.

## Database

```text
PostgreSQL
```

## Authentication

```text
Supabase Auth
Clerk
Auth.js
```

## Realtime

For MVP:

```text
poll every 5–10 seconds
```

Later:

```text
SSE or WebSockets
```

## Background jobs

Use one of:

```text
Trigger.dev
Inngest
BullMQ
simple cron workers
```

Jobs needed:

```text
metric refresh
pricing update
market lock
settlement
leaderboard refresh
```

---

# 30. Suggested repository structure

```text
wesify/
│
├── apps/
│   └── web/
│
├── packages/
│   ├── db/
│   ├── market-engine/
│   ├── virality-engine/
│   ├── social-providers/
│   ├── ui/
│   └── shared/
│
├── scripts/
│   ├── seed.ts
│   ├── simulate-market.ts
│   └── backtest.ts
│
├── docs/
│   ├── MVP_SPEC.md
│   ├── MARKET_ENGINE.md
│   └── API.md
│
└── README.md
```

If speed matters more than architecture, a single Next.js app is acceptable.

---

# 31. Internal module boundaries

## virality-engine

Responsibilities:

```text
calculate velocities
calculate acceleration
calculate momentum
forecast final likes
generate outcome probabilities
```

## market-engine

Responsibilities:

```text
manage pricing
execute virtual buys
execute virtual sells
calculate positions
settle outcomes
```

## social-providers

Responsibilities:

```text
resolve video
fetch metrics
normalize platform data
```

## settlement-engine

Responsibilities:

```text
fetch final metric
validate
select winning outcome
settle positions
```

---

# 32. API routes

## Markets

```http
GET /api/markets
GET /api/markets/:id
POST /api/markets
```

## Trading

```http
POST /api/markets/:id/buy
POST /api/markets/:id/sell
```

## Portfolio

```http
GET /api/portfolio
GET /api/positions
```

## Video ingestion

```http
POST /api/videos/resolve
POST /api/videos/create-market
```

## Pricing

Internal only:

```http
POST /api/internal/markets/:id/reprice
```

## Metrics

Internal:

```http
POST /api/internal/videos/:id/refresh
```

## Settlement

Internal:

```http
POST /api/internal/markets/:id/settle
```

---

# 33. Example market response

```json
{
  "id": "market_123",
  "question": "How many likes will this video have after 24 hours?",
  "status": "OPEN",
  "currentLikes": 82410,
  "momentum": {
    "label": "SURGING",
    "score": 0.76,
    "change3h": 4.38
  },
  "settlesAt": "2026-09-14T14:00:00Z",
  "outcomes": [
    { "id": "o1", "label": "<10K", "price": 0.01 },
    { "id": "o2", "label": "10K–100K", "price": 0.02 },
    { "id": "o3", "label": "100K–500K", "price": 0.09 },
    { "id": "o4", "label": "500K–1M", "price": 0.36 },
    { "id": "o5", "label": "1M+", "price": 0.52 }
  ]
}
```

---

# 34. Trade execution

## Buy

Input:

```json
{
  "outcomeId": "o5",
  "credits": 100
}
```

Server:

```text
1. Verify user
2. Verify market OPEN
3. Verify enough credits
4. Calculate shares from AMM
5. Debit credits
6. Update AMM state
7. Update position
8. Record trade
9. Recalculate prices
10. Return result
```

Use a database transaction.

## Sell

Input:

```json
{
  "outcomeId": "o5",
  "shares": 100
}
```

Server:

```text
1. Verify position
2. Verify market OPEN
3. Calculate W$ received
4. Reduce shares
5. Credit user
6. Update AMM state
7. Record trade
8. Recalculate prices
```

---

# 35. Balance integrity

Never trust the frontend.

Credits should change only through ledger events.

Add:

## credit_ledger

```sql
id uuid primary key
user_id uuid
type text
amount numeric
reference_type text
reference_id uuid
balance_after numeric
created_at timestamptz
```

Types:

```text
WELCOME_BONUS
BUY
SELL
SETTLEMENT
ADMIN_ADJUSTMENT
REFERRAL
```

This prevents silent balance corruption.

---

# 36. Settlement logic

At settlement:

```text
1. Lock market
2. Fetch final likes
3. Validate data
4. Find matching outcome
5. Mark that outcome winner
6. Winning shares become W$1 each
7. Losing shares become W$0
8. Credit winning users
9. Close positions
10. Record settlement
11. Notify users
```

Example:

```text
Final likes = 712,428

Winning range:
500K–1M
```

---

# 37. Push notifications

Implement only high-value notifications.

## Price movement

```text
Your 1M+ position is up 82%.
```

## Virality spike

```text
This video is surging.
1M+ moved from 0.14 to 0.31.
```

## Settlement

```text
You won W$418 on @creator.
```

## Market close

```text
This market closes in 30 minutes.
```

---

# 38. Product analytics

Instrument everything.

Recommended:

```text
PostHog
Amplitude
Mixpanel
```

Events:

```text
app_opened
market_viewed
video_submitted
trade_started
trade_completed
position_sold
market_settled
portfolio_viewed
share_clicked
notification_opened
```

Properties:

```text
market_id
video_id
platform
outcome
price
trade_size
user_balance
video_age
momentum_score
```

---

# 39. MVP success metrics

The MVP is not successful because users sign up.

It is successful if users trade repeatedly.

## North-star metric

```text
Weekly Active Traders
```

## Activation

```text
% of new users completing first trade within 10 minutes
```

Target:

```text
> 40%
```

## Second trade

```text
% of first-time traders making another trade within 48h
```

Target:

```text
> 30%
```

## Weekly retention

```text
W1 trader retention
```

Target:

```text
> 25%
```

## Trades per active trader

Target:

```text
> 5 per week
```

## Early exits

If users actively sell positions before resolution, the product behaves more like a market than a betting slip.

Target:

```text
> 20% of positions exited before settlement
```

---

# 40. Product validation questions

The MVP should answer:

```text
Do users understand the concept immediately?
Do users enjoy predicting virality?
Do users return to monitor positions?
Do users trade multiple videos?
Do users sell before settlement?
Does dynamic pricing make the product more exciting?
Do creators want markets attached to their videos?
Do users share their wins?
Does a leaderboard increase retention?
```

---

# 41. Brand and visual design

Product name:

```text
wesify
```

Use the exact supplied logo asset.

Do not redraw it.
Do not reinterpret it.
Do not change letter proportions.
Do not alter the mark.

Store it as:

```text
/public/brand/wesify-logo.png
```

Use the uploaded original asset unchanged.

## Visual direction

```text
white background
black or very dark navy typography
blue gradients
light purple gradients
large whitespace
few containers
minimal text
soft borders
light shadows
simple charts
```

Avoid:

```text
heavy dark dashboards
crypto aesthetics
casino aesthetics
neon green
red-heavy betting UX
cluttered financial terminals
```

## Typography

Preferred:

```text
Google Sans
```

If Google Sans is not legally available in the runtime or repository, use a close modern sans fallback.

Do not package or redistribute proprietary font files without the appropriate license.

## Main gradient

Suggested:

```css
linear-gradient(
  90deg,
  #2F80FF 0%,
  #6C63FF 55%,
  #A56EFF 100%
)
```

## Background accents

Use blurred radial gradients:

```css
radial-gradient(
  circle,
  rgba(47,128,255,0.18),
  transparent 65%
)
```

and:

```css
radial-gradient(
  circle,
  rgba(165,110,255,0.16),
  transparent 65%
)
```

---

# 42. UI rules

Every screen should have:

```text
1 primary message
1 primary action
very little explanatory copy
```

For marketing and onboarding screens:

```text
title
subtitle
visual
```

Do not place many text blocks on one screen.

The app should feel closer to a consumer social product than a finance terminal.

---

# 43. Feed card design

Example:

```text
┌─────────────────────────────┐
│ VIDEO THUMBNAIL             │
│                             │
│ @creator                    │
│ 82.4K likes                 │
│ ↑ 438% in 3h                │
│                             │
│ 500K–1M      0.34           │
│ 1M+          0.41           │
│                             │
│ [ Trade ]                   │
└─────────────────────────────┘
```

Avoid showing all five ranges in the feed.

Full ranges appear inside the market screen.

---

# 44. Mobile-first

Build for mobile first.

Target widths:

```text
375px
390px
430px
```

Desktop should work, but mobile is the primary UX.

---

# 45. Share-to-Wesify

One important feature:

```text
Share → Wesify
```

## Web fallback

If native extension is not available yet:

```text
Paste a TikTok link
```

## Native later

iOS:

```text
Share Extension
```

Android:

```text
Share Target
```

The MVP can launch without a native extension if it slows development.

---

# 46. Onboarding

Three screens maximum.

## Screen 1

```text
Trade the future of virality.
```

## Screen 2

```text
Pick where a video will finish.
Prices move as attention moves.
```

## Screen 3

```text
You have W$10,000.
Make your first trade.
```

Then immediately open the feed.

---

# 47. Seed content

A marketplace with no markets feels dead.

Before inviting users:

```text
seed at least 20–50 active markets
```

Use:

- opted-in creators
- test creators
- manually managed demo content
- internal test videos

Do not launch with an empty feed.

---

# 48. Admin dashboard

Build a basic admin tool.

Admin can:

```text
create market
edit market
pause market
update metric
settle market
cancel market
adjust user balance
view suspicious trades
view market history
```

Authentication must restrict admin routes.

---

# 49. Market cancellation

A market may need cancellation if:

```text
video deleted
video becomes private
metric source fails
platform data becomes unreliable
market configured incorrectly
```

On cancellation:

```text
refund all open positions at cost basis
```

Do not settle arbitrarily.

---

# 50. Anti-manipulation

Even with play money, build the architecture correctly.

Flag:

```text
unusual metric jumps
sudden impossible growth
creator trading heavily on own market
many accounts from same device
coordinated trades
metric inconsistencies
```

For the MVP:

```text
flag only
do not automatically punish
```

Create:

```text
risk_score
```

for markets and users.

---

# 51. Creator self-trading

For the first MVP, use this simple rule:

```text
Creators cannot trade markets linked to their own connected accounts.
```

This avoids obvious conflicts.

---

# 52. Price history visualization

Show one simple line.

Default:

```text
1H
```

Optional:

```text
3H
6H
ALL
```

Do not build candlestick charts.

Wesify is not a stock brokerage.

---

# 53. Search

MVP search should support:

```text
creator handle
market URL
video URL
```

No advanced filtering required.

---

# 54. Market creation rules

For the MVP:

```text
one market per video
24-hour settlement window
likes only
five outcome ranges
```

A market can be created only if:

```text
video age < 6 hours
```

This preserves enough uncertainty.

---

# 55. Range generation

Fixed ranges are simplest.

Later, generate ranges around expected performance.

Example projected final likes:

```text
140K
```

Adaptive ranges could be:

```text
<50K
50K–100K
100K–250K
250K–500K
500K+
```

For the first MVP, fixed ranges are easier to explain and compare.

---

# 56. Initial pricing

At market creation:

```text
1. Gather current likes
2. Gather recent trajectory
3. Calculate model forecast
4. Generate outcome probabilities
5. Normalize to 1
6. Set initial prices
```

If insufficient data exists, use broad priors.

Example:

```text
<10K        0.15
10K–100K    0.35
100K–500K   0.30
500K–1M     0.15
1M+         0.05
```

Then update quickly as real data arrives.

---

# 57. Trading limits

Even with play money:

```text
maximum 20% of account balance per single trade
```

and:

```text
maximum 50% of portfolio in one market
```

This prevents one accidental click from ending the experience.

---

# 58. Welcome credits

Give:

```text
W$10,000
```

Potential daily refill later:

```text
W$500
```

only if balance is below a threshold.

Do not make credits feel infinite.

Scarcity creates meaningful choices.

---

# 59. Referral loop

Optional MVP feature.

Example:

```text
Invite a friend.
Both receive W$1,000 after the friend completes 3 trades.
```

Reward activity, not signup alone.

---

# 60. Social sharing

After a profitable trade:

```text
I bought 1M+ at 8%.
Now it is at 41%.
```

Generate a clean share card.

Do not display real-money language.

Potential card:

```text
wesify
@creator

1M+
8% → 41%

I saw it early.
```

This could become a major growth loop.

---

# 61. Copy style

Use short direct copy.

Good:

```text
Trade the future of virality.
```

Good:

```text
This video is surging.
```

Good:

```text
1M+ moved to 42%.
```

Avoid:

```text
Our advanced artificial intelligence algorithm has detected...
```

---

# 62. Error handling

## Video unavailable

```text
We cannot track this video yet.
Try another link.
```

## Market closed

```text
Trading has ended.
Settlement is in progress.
```

## Insufficient credits

```text
Not enough W$ for this trade.
```

## Provider failure

```text
Metrics are temporarily delayed.
Trading is paused.
```

---

# 63. Security basics

Required:

```text
server-side authorization
rate limits
CSRF protection where applicable
encrypted tokens
environment-secret management
database row-level security if using Supabase
audit logs
input validation
idempotent settlement jobs
```

Do not expose platform tokens to clients.

---

# 64. Idempotency

Settlement must be idempotent.

Running:

```text
settleMarket(marketId)
```

twice must never pay users twice.

Use:

```text
settlement.status
unique constraints
database transaction
```

---

# 65. Background jobs

## Metric refresh

Every:

```text
5 minutes
```

for active markets.

Later, every:

```text
1 minute
```

for high-momentum markets.

## Repricing

Run after each metric refresh.

## Locking

Run continuously or via scheduled job.

## Settlement

Run immediately after settlement time.

---

# 66. Realtime client updates

Simple MVP:

```text
client refetch every 10 seconds
```

Better:

```text
SSE
```

Later:

```text
WebSockets
```

Do not delay launch for perfect realtime infrastructure.

---

# 67. Testing strategy

## Unit tests

Required for:

```text
velocity calculation
acceleration calculation
momentum score
probability normalization
LMSR price calculation
buy execution
sell execution
settlement
balance ledger
```

## Integration tests

Required:

```text
create market
place trade
update metrics
reprice
sell
settle
```

## End-to-end tests

Critical path:

```text
signup
receive W$10,000
open market
buy outcome
view portfolio
sell position
```

Use:

```text
Playwright
```

---

# 68. Market simulation tool

Create:

```text
scripts/simulate-market.ts
```

It should simulate a video trajectory.

Scenarios:

```text
flat
slow growth
viral spike
early spike then decay
late spike
fake spike
```

Example:

```bash
npm run simulate-market --scenario viral-spike
```

This is essential for developing the UI without depending on live social data.

---

# 69. Synthetic trajectory examples

## Scenario A: Flat

```text
0h   1K
3h   1.4K
6h   1.8K
12h  2.2K
24h  2.5K
```

## Scenario B: Viral

```text
0h   2K
3h   8K
6h   25K
9h   130K
12h  620K
18h  1.4M
24h  2.1M
```

## Scenario C: Spike then decay

```text
0h   5K
3h   20K
6h   250K
9h   620K
12h  810K
24h  940K
```

Use these to test repricing.

---

# 70. Backtesting

Once enough trajectories are collected:

```text
historical snapshot → predict final bucket → compare with actual
```

Track:

```text
Brier score
log loss
bucket calibration
top-outcome accuracy
```

The pricing model should improve continuously.

---

# 71. Calibration

If the system says:

```text
30%
```

roughly 30% of those outcomes should occur.

That matters more than pure accuracy.

Create calibration bins:

```text
0–10%
10–20%
20–30%
...
90–100%
```

Compare predicted and actual frequency.

---

# 72. Model roadmap

## V0

Heuristic growth projection.

## V1

Logistic regression or gradient boosting.

## V2

Sequence model over engagement trajectory.

## V3

Creator priors + content embeddings + market signals.

Do not start at V3.

---

# 73. Creator baseline

Later, include:

```text
creator typical first-hour likes
creator median 24h likes
creator volatility
creator hit rate
```

This helps distinguish:

```text
100K likes from a tiny creator
```

from:

```text
100K likes from a creator who normally gets 5M
```

Not mandatory for first launch.

---

# 74. Platform abstraction

Define:

```ts
type Platform = "tiktok" | "instagram" | "youtube";
```

Initially enable only:

```text
TikTok
```

Keep the architecture extensible without exposing multiple platforms in the UI yet.

---

# 75. MVP legal/product positioning

Because the MVP uses play money, use language like:

```text
prediction market
forecast
trade
Wesify Credits
virtual balance
```

Avoid implying:

```text
cash winnings
investment returns
real-money profits
```

Add:

```text
Wesify Credits have no monetary value.
```

in Terms and onboarding.

---

# 76. Privacy

Collect only what is necessary.

Do not request:

```text
contacts
precise location
unnecessary social permissions
```

For creators, clearly explain which social account permissions are needed.

---

# 77. Accessibility

Minimum:

```text
WCAG-aware contrast
44px touch targets
keyboard navigation on web
screen-reader labels
reduced-motion support
```

Do not encode up/down movement only by color.

Use arrows and labels too.

---

# 78. Performance goals

Target:

```text
LCP < 2.5s
initial JS as small as practical
market interaction < 200ms perceived latency
```

Use optimistic UI only after server validation design is safe.

---

# 79. Build phases

## Phase 0: Foundation

Build:

```text
repo
auth
database
W$ ledger
brand system
mobile shell
```

## Phase 1: Static product

Build with fake markets:

```text
feed
market screen
portfolio
trading UI
```

No live data yet.

## Phase 2: Market engine

Implement:

```text
buy
sell
positions
LMSR
price history
settlement
```

## Phase 3: Virality engine

Implement:

```text
metric snapshots
velocity
acceleration
momentum
forecast
probability distribution
model-driven repricing
```

## Phase 4: Video ingestion

Implement:

```text
URL resolve
provider abstraction
manual admin metrics
creator connection where available
```

## Phase 5: Growth loop

Implement:

```text
share cards
leaderboard
notifications
referrals
```

## Phase 6: Private beta

Invite:

```text
50–200 users
```

Observe behavior before scaling.

---

# 80. Suggested 4-week sprint

## Week 1

```text
Project setup
Auth
Database
W$ ledger
Feed UI
Market UI
Portfolio UI
Seed fake markets
```

## Week 2

```text
Trading engine
Positions
LMSR
Price history
Settlement
Admin market controls
```

## Week 3

```text
Metric snapshots
Virality calculations
Dynamic repricing
Simulation tool
Notifications
Analytics
```

## Week 4

```text
TikTok URL flow
Provider abstraction
Manual fallback
Leaderboard
Share cards
E2E tests
Private beta deployment
```

---

# 81. Definition of done

The MVP is ready for private beta when a new user can:

```text
1. Create account
2. Receive W$10,000
3. See at least 20 active video markets
4. Open a market
5. Buy a like range
6. See position in portfolio
7. See price change as video metrics change
8. Sell before settlement
9. Hold through settlement
10. Receive correct W$ settlement
11. View trade history
12. Share a result
```

All without admin intervention in the user flow.

---

# 82. Explicit non-goals

Do not build before product validation:

```text
real-money deposits
withdrawals
crypto wallets
KYC
full regulatory stack
multi-country compliance
multi-platform feed
advanced creator dashboards
advertiser dashboards
options
leverage
margin
short selling
complex order books
limit orders
copy trading
messaging
social followers
live chat
creator subscriptions
NFTs
token issuance
```

These can destroy speed.

---

# 83. Core hypotheses

## Hypothesis 1

People enjoy predicting virality enough to trade repeatedly.

## Hypothesis 2

Dynamic pricing makes the activity more compelling than static bets.

## Hypothesis 3

Users understand “price = probability” quickly.

## Hypothesis 4

Users return to monitor open positions.

## Hypothesis 5

Early discovery creates social status.

## Hypothesis 6

Creators benefit from having markets attached to their videos.

The MVP exists to test these.

---

# 84. Important UX experiment

Test two wordings.

## Version A

```text
Price
0.42
```

## Version B

```text
Probability
42%
```

Potential final interface:

```text
42%
W$0.42
```

Determine which users understand faster.

---

# 85. Important market experiment

Test:

```text
fixed ranges
```

against:

```text
adaptive ranges
```

Do not run this experiment until basic behavior is stable.

---

# 86. Data objects in TypeScript

```ts
export type Outcome = {
  id: string;
  marketId: string;
  label: string;
  minValue: number | null;
  maxValue: number | null;
  price: number;
  modelProbability: number;
  marketProbability: number;
};

export type Market = {
  id: string;
  videoId: string;
  question: string;
  status: "DRAFT" | "OPEN" | "LOCKED" | "SETTLING" | "SETTLED" | "CANCELLED";
  currentLikes: number;
  openedAt: string;
  locksAt: string;
  settlesAt: string;
  momentumScore: number;
  momentumLabel: "COOLING" | "STABLE" | "RISING" | "SURGING" | "EXPLODING";
  outcomes: Outcome[];
};

export type Position = {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: number;
  averageEntryPrice: number;
  currentPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
};
```

---

# 87. Virality engine interface

```ts
export type MetricSnapshot = {
  capturedAt: Date;
  likes: number;
  views?: number;
  comments?: number;
  shares?: number;
};

export type ViralityFeatures = {
  velocity5m: number;
  velocity30m: number;
  velocity1h: number;
  velocity3h: number;
  acceleration30m: number;
  acceleration1h: number;
  momentumScore: number;
};

export type Forecast = {
  expectedFinalLikes: number;
  uncertainty: number;
  probabilities: Record<string, number>;
};

export interface ViralityEngine {
  features(history: MetricSnapshot[]): ViralityFeatures;
  forecast(
    currentLikes: number,
    ageMinutes: number,
    history: MetricSnapshot[],
    outcomes: Outcome[]
  ): Forecast;
}
```

---

# 88. Market engine interface

```ts
export interface MarketEngine {
  getPrices(marketId: string): Promise<Record<string, number>>;

  buy(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    credits: number;
  }): Promise<TradeResult>;

  sell(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    shares: number;
  }): Promise<TradeResult>;

  updateModelPrior(
    marketId: string,
    probabilities: Record<string, number>
  ): Promise<void>;

  settle(
    marketId: string,
    finalLikes: number
  ): Promise<SettlementResult>;
}
```

---

# 89. First fake-data demo

Before integrating any platform, create five simulated markets:

```text
1. Slow growth
2. Viral breakout
3. Viral decay
4. Stable mid-range
5. Late surge
```

Run the simulator automatically.

This lets an investor, designer, or tester see the entire product experience immediately.

---

# 90. Demo mode

Add:

```text
?demo=true
```

Demo mode should:

```text
compress 24 hours into 3 minutes
simulate metric updates
change probabilities visibly
allow buy/sell
settle at the end
```

This is extremely useful for presentations and testing.

---

# 91. First beta cohort

Ideal:

```text
100 users
```

Profile:

```text
heavy TikTok users
students
young creators
social media managers
people already using prediction markets
```

Do not recruit only finance users.

You need people who understand internet culture.

---

# 92. Beta feedback questions

Ask after 3+ trades:

```text
Did you understand what the price meant?
What made you choose a video?
Did you check the video again after trading?
Did you want to sell early?
Would you use this with real money if legally available?
Would you share your trade publicly?
What felt confusing?
What would make you come back tomorrow?
```

---

# 93. MVP launch criteria

Do not move toward real money until the play-money MVP shows:

```text
strong repeat trading
healthy retention
understood pricing
stable settlement
reliable data
manageable manipulation risk
organic sharing
```

The single most important proof:

> Users voluntarily return to trade new videos without being paid to do so.

---

# 94. Product positioning

Avoid:

```text
Bet on TikTok
```

Prefer:

```text
Trade the future of virality.
```

Alternative:

```text
The prediction market for social video.
```

Long-term:

```text
The exchange for internet attention.
```

---

# 95. Investor-facing thesis

The company starts with:

```text
short-form video prediction markets
```

The underlying technology becomes:

```text
real-time attention pricing
```

Potential future markets:

```text
videos
creators
songs
memes
hashtags
trailers
product launches
cultural events
```

But the MVP should not expose this complexity.

---

# 96. Moat hypothesis

If Wesify succeeds, defensibility can come from:

```text
historical engagement trajectory dataset
virality forecasting models
market behavior data
creator integrations
liquidity
settlement reliability
brand
distribution
```

The initial moat is not code.

It is:

```text
data + liquidity + behavior
```

---

# 97. Engineering priorities

Order:

```text
1. Correct ledger
2. Correct market engine
3. Correct settlement
4. Responsive UX
5. Dynamic pricing
6. Social data
7. Growth features
```

Never reverse this.

A beautiful interface with incorrect balances is useless.

---

# 98. Development philosophy

The first build should optimize for:

```text
learning speed
```

not:

```text
perfect architecture
```

Prefer:

```text
one deployable app
one database
one queue
one market type
one social platform
one currency
```

Complexity can be added after behavioral validation.

---

# 99. First development ticket list

## Foundation

```text
[ ] Initialize Next.js TypeScript repo
[ ] Configure Tailwind
[ ] Add database
[ ] Add authentication
[ ] Add Wesify brand asset unchanged
[ ] Create mobile app shell
```

## Data

```text
[ ] Create database schema
[ ] Add migrations
[ ] Add seed script
[ ] Add W$ ledger
```

## Markets

```text
[ ] Build markets feed
[ ] Build market detail screen
[ ] Build outcome cards
[ ] Add price history
```

## Trading

```text
[ ] Implement LMSR state
[ ] Implement buy
[ ] Implement sell
[ ] Implement positions
[ ] Implement portfolio
```

## Virality

```text
[ ] Add metric snapshots
[ ] Add velocity functions
[ ] Add acceleration functions
[ ] Add momentum score
[ ] Add forecast function
[ ] Add model prior updates
```

## Settlement

```text
[ ] Add lock job
[ ] Add final metric
[ ] Add outcome selection
[ ] Add settlement ledger events
[ ] Add idempotency test
```

## Data ingestion

```text
[ ] Add video URL resolver
[ ] Add provider interface
[ ] Add mock provider
[ ] Add manual provider
[ ] Add first TikTok integration path
```

## Growth

```text
[ ] Add notifications
[ ] Add leaderboard
[ ] Add share cards
[ ] Add referral experiment
```

## Quality

```text
[ ] Add unit tests
[ ] Add integration tests
[ ] Add Playwright E2E
[ ] Add analytics
[ ] Add error monitoring
```

---

# 100. Immediate implementation order

Do not start with TikTok integration.

Start with the complete simulated product.

The first internal milestone should be:

```text
A mobile-first Wesify web app with:
- exact Wesify logo asset
- markets feed
- market detail
- W$ balance
- buy/sell
- portfolio
- simulated video trajectories
- dynamic probability changes
- automatic settlement
```

Once that works end to end, connect real social data.

This sequence reduces dependency risk and gets the central product loop testable immediately.

---

# 101. Final MVP statement

The first Wesify release should feel like this:

> Open the app. See what is starting to go viral. Pick where the video will finish. Buy the range. Watch the odds move as the internet reacts. Sell early or hold until settlement.

If the first version does this cleanly, quickly, and repeatedly, the MVP is doing its job.
