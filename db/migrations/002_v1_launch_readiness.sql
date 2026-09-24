-- Migration 002: V1 launch readiness (checklist §34).
-- Applies on top of db/schema.sql (migration 001). Mirrors src/server/world/state.ts schema v3.
-- The running app still persists to the JSON store; this is the Postgres destination.

begin;

-- ---- Identity (§4) --------------------------------------------------------
alter table users
  add column email_verified_at timestamptz,
  add column password_hash text,                       -- scrypt; null when Clerk owns credentials
  add column clerk_user_id text unique,
  add column role text not null default 'user' check (role in ('user','support','admin')),
  add column status text not null default 'active' check (status in ('active','frozen','suspended','deleted')),
  add column status_reason text,
  add column terms_accepted_at timestamptz,
  add column terms_version text,
  add column privacy_accepted_at timestamptz,
  add column privacy_version text,
  add column age_confirmed_at timestamptz,
  add column onboarding_completed_at timestamptz,
  add column tutorial_completed_at timestamptz,
  add column last_active_at timestamptz,
  add column cohort text,
  add column referred_by_user_id uuid references users(id),
  add column risk_score numeric not null default 0,
  add column failed_logins int not null default 0,
  add column locked_until timestamptz,
  add column notification_prefs jsonb not null default '{}',
  add column show_on_leaderboard boolean not null default true,
  add column consent jsonb,
  add column deleted_at timestamptz;
-- Emails are unique case-insensitively (§4 prevent duplicate email accounts).
create unique index users_email_lower on users (lower(email)) where email is not null;

create table sessions (
  token_hash text primary key,                          -- sha256 of the cookie token
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  device_id text,
  ip_hash text,                                         -- salted hash; raw IPs are never stored
  user_agent text
);
create index on sessions (user_id);
create index on sessions (expires_at);

create table email_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify','reset')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table devices (
  device_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  ip_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (device_id, user_id)
);
create index on devices (ip_hash);

create table signups (
  at timestamptz not null default now(),
  ip_hash text,
  device_id text,
  user_id uuid not null references users(id) on delete cascade
);
create index on signups (at);

-- ---- Social accounts (§5, §31) ----------------------------------------------
alter table social_accounts add column avg_likes bigint;

-- ---- Videos & metrics (§17, §18) ---------------------------------------------
alter table videos
  add column caption text not null default '',
  add column thumbnail_source text,                     -- provenance, e.g. 'tiktok-oembed'
  add column thumbnail_fetched_at timestamptz,
  add column thumbnail_expires_at timestamptz,
  add column thumbnail_broken boolean not null default false,
  add column author_name text,
  add column creator_followers bigint,
  add column creator_avg_likes bigint,
  add column social_account_id uuid references social_accounts(id),
  add column taken_down_at timestamptz;

alter table video_metric_snapshots add column suspicious boolean not null default false;
-- One reading per video per instant (§18 prevent duplicate snapshots).
create unique index on video_metric_snapshots (video_id, captured_at);

-- ---- Markets (§1, §22, §24, §25, §26) ------------------------------------------
alter table markets
  add column source text not null default 'system' check (source in ('system','admin','paste','share','creator')),
  add column created_by_user_id uuid references users(id),
  add column rules_version text not null default '2026-09-v1',
  add column range_basis jsonb,
  add column review jsonb,
  add column proposed_settlement jsonb,
  add column settlement_attempts int not null default 0,
  add column cancellation_reason text check (cancellation_reason in ('DELETED_CONTENT','PRIVATE_CONTENT','PLATFORM_OUTAGE','METRIC_CORRUPTION','MANIPULATION','INCORRECT_SETUP','CONTENT_REMOVED','ADMIN')),
  add column cancellation_explanation text,
  add column unavailable_since timestamptz,
  add column unavailable_reason text,
  add column featured boolean not null default false,
  add column hidden boolean not null default false,
  add column last_priced_at timestamptz,
  add column momentum_label text,
  add column current_likes bigint not null default 0;
create index on markets (status, settles_at);

alter table positions
  add column total_bought numeric(14,2) not null default 0,
  add column settlement jsonb,
  add column notified_gain_level numeric not null default 0,
  add column notified_loss_level numeric not null default 0,
  add column created_at timestamptz not null default now();
create index on positions (market_id) where shares > 0;

alter table trades
  add column price_before numeric not null default 0,
  add column price_after numeric not null default 0;

alter table credit_ledger add column description text;

create table position_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  market_id uuid not null references markets(id),
  outcome_id uuid not null references market_outcomes(id),
  kind text not null check (kind in ('SELL','SETTLE','REFUND')),
  pnl numeric(14,2) not null,
  won boolean,
  entry_price numeric not null,
  exit_price numeric not null,
  created_at timestamptz not null default now()
);
create index on position_events (user_id, created_at);
create index on position_events (created_at);

-- Every model run (§19 store forecasts + model version, §21 log each repricing).
create table forecasts (
  market_id uuid not null references markets(id),
  at timestamptz not null,
  model_version text not null,
  expected_final_likes bigint not null,
  uncertainty numeric not null,
  momentum numeric not null,
  probabilities numeric[] not null,
  prices_before numeric[] not null,
  prices_after numeric[] not null,
  capped boolean not null default false,
  video_age_min int not null,
  primary key (market_id, at)
);

-- ---- Idempotency (§8, §28) ----------------------------------------------------
create table idempotency_keys (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  route text not null,
  status int not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---- Risk, support, community (§27, §48, §49) -----------------------------------
alter table risk_flags
  add column status text not null default 'open' check (status in ('open','resolved','dismissed')),
  add column resolved_at timestamptz,
  add column resolved_by text,
  add column resolution text;
create index on risk_flags (status, created_at);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  email text,
  category text not null,
  subject text not null,
  body text not null,
  entity_type text check (entity_type in ('market','user','video')),
  entity_id text,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  priority text not null default 'normal' check (priority in ('normal','high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on support_tickets (status, priority, created_at);

create table support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author text not null,
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  rating int check (rating between 1 and 5),
  kind text not null check (kind in ('general','bug','idea','churn')),
  body text not null,
  page text,
  created_at timestamptz not null default now()
);

-- ---- Growth (§30, §58) ------------------------------------------------------------
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references users(id),
  referee_id uuid not null unique references users(id),
  status text not null check (status in ('pending','rewarded','rejected')),
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table invites (
  code text primary key,
  cohort text not null,
  max_uses int not null,
  uses int not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- ---- Operations (§39, §42, §50, §57) -----------------------------------------------
create table feature_flags (
  name text primary key,
  enabled boolean not null,
  rollout int not null default 100 check (rollout between 0 and 100),
  value int,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id uuid references users(id) on delete set null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on analytics_events (name, created_at);
create index on analytics_events (user_id, created_at);

create table user_activity_days (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  "to" text not null,
  subject text not null,
  text text not null,
  category text not null check (category in ('transactional','marketing')),
  template text not null,
  status text not null check (status in ('queued','sent','failed','suppressed')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
create index on email_outbox (status, created_at);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info','warning','critical')),
  message text not null,
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create table error_groups (
  fingerprint text primary key,
  source text not null,
  message text not null,
  stack text,
  context jsonb not null default '{}',
  count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table job_status (
  name text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  runs int not null default 0,
  failures int not null default 0,
  last_duration_ms int
);

create table provider_status (
  name text primary key,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  calls bigint not null default 0,
  failures bigint not null default 0
);

commit;
