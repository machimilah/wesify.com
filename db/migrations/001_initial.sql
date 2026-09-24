-- Migration 001: initial schema (identical to db/schema.sql at the time V1 work began).
-- Wesify target PostgreSQL schema (spec §28, §35).
-- The simulated milestone persists the same shapes to .data/main.json (src/server/store.ts);
-- this migration is the destination when moving to managed Postgres.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  username text unique not null,
  avatar_url text,
  credits_balance numeric(14,2) not null default 0 check (credits_balance >= 0),
  is_bot boolean not null default false,
  referral_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  platform text not null,
  platform_user_id text not null,
  handle text not null,
  mode text not null default 'live' check (mode in ('live','simulated')),
  status text not null default 'active' check (status in ('active','error','revoked')),
  status_message text,
  follower_count bigint not null default 0,
  access_token_encrypted text,   -- AES-256-GCM, never returned to clients
  refresh_token_encrypted text,
  expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, platform_user_id)
);
-- One connected account per platform per Wesify user.
create unique index on social_accounts (user_id, platform) where status <> 'revoked';

-- Creator program: markets are opened by approved creators only (§51). A user applies, an admin
-- decides, and an approved creator signs the current agreement before connecting an account.
create table creator_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  status text not null check (status in ('pending','approved','rejected','revoked')),
  platform text not null,
  handle text not null,
  profile_url text not null,
  follower_count bigint not null default 0,
  about text not null default '',
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  decision_note text,
  contract_version text,
  contract_signed_at timestamptz,
  contract_signed_name text
);
-- At most one open application per user; decided ones stay for the record.
create unique index on creator_applications (user_id) where status in ('pending','approved');
create index on creator_applications (status, submitted_at);

-- Creator uploads Wesify watches until they qualify for a market or pass the 6h window.
create table creator_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  social_account_id uuid not null references social_accounts(id),
  platform text not null,
  platform_video_id text not null,
  canonical_url text not null,
  caption text not null default '',
  published_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  likes bigint not null default 0,
  follower_count bigint not null default 0,
  threshold bigint not null,
  status text not null check (status in ('tracking','eligible','market_created','expired','dismissed')),
  eligible_at timestamptz,
  market_id uuid,
  unique (social_account_id, platform_video_id)
);
create index on creator_videos (status, published_at);

create table videos (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  platform_video_id text not null,
  canonical_url text not null,
  creator_handle text not null,
  thumbnail_url text,
  provider text not null,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (platform, platform_video_id)
);

create table video_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id),
  likes bigint not null,
  views bigint,
  comments bigint,
  shares bigint,
  captured_at timestamptz not null,
  source text not null
);
create index on video_metric_snapshots (video_id, captured_at);

create table markets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references videos(id), -- one market per video (§54)
  question text not null,
  status text not null check (status in ('DRAFT','OPEN','PAUSED','LOCKED','SETTLING','SETTLED','CANCELLED')),
  opened_at timestamptz,
  locks_at timestamptz not null,
  settles_at timestamptz not null,
  final_metric bigint,
  winning_outcome_id uuid,
  liquidity_parameter numeric not null,
  trading_paused boolean not null default false,
  paused_reason text,
  momentum_score numeric not null default 0,
  risk_score numeric not null default 0,
  creator_user_id uuid references users(id), -- set when the creator opened it from a connected account
  created_at timestamptz not null default now()
);
-- Enforces the rolling 24h creator limit query efficiently.
create index on markets (creator_user_id, created_at) where creator_user_id is not null;

create table market_outcomes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id),
  label text not null,
  min_value bigint,
  max_value bigint,
  sort_order int not null,
  quantity numeric not null default 0,          -- LMSR q_i
  current_price numeric not null,
  model_probability numeric not null,
  market_probability numeric not null,
  created_at timestamptz not null default now(),
  unique (market_id, sort_order)
);
alter table markets add foreign key (winning_outcome_id) references market_outcomes(id);

create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  market_id uuid not null references markets(id),
  outcome_id uuid not null references market_outcomes(id),
  side text not null check (side in ('BUY','SELL')),
  shares numeric not null check (shares > 0),
  price numeric not null,
  credits numeric(14,2) not null,
  realized_pnl numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index on trades (market_id, created_at);
create index on trades (user_id, created_at);

create table positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  market_id uuid not null references markets(id),
  outcome_id uuid not null references market_outcomes(id),
  shares numeric not null default 0 check (shares >= 0),
  average_entry_price numeric not null default 0,
  realized_pnl numeric(14,2) not null default 0,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, market_id, outcome_id)
);

create table market_price_history (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id),
  outcome_id uuid not null references market_outcomes(id),
  price numeric not null,
  model_probability numeric not null,
  recorded_at timestamptz not null
);
create index on market_price_history (market_id, recorded_at);

-- Unique per market: settlement and cancellation are idempotent (§64).
create table settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null unique references markets(id),
  kind text not null check (kind in ('SETTLED','CANCELLED')),
  final_metric bigint,
  winning_outcome_id uuid references market_outcomes(id),
  source text not null,
  settled_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null check (type in ('WELCOME_BONUS','BUY','SELL','SETTLEMENT','CANCELLATION_REFUND','ADMIN_ADJUSTMENT','ADMIN_REFUND','REFERRAL')),
  amount numeric(14,2) not null,
  reference_type text,
  reference_id uuid,
  balance_after numeric(14,2) not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);
create index on credit_ledger (user_id, created_at);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null,
  title text not null,
  body text not null,
  market_id uuid references markets(id),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table risk_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('market','user')),
  entity_id uuid not null,
  reason text not null,
  severity numeric not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
