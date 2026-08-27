-- What an account is entitled to, and what Stripe has already told Wesify.
--
-- Billing is switched off. Nothing in the product charges anybody today, every account behaves as
-- though it were on the free plan, and these tables sit empty. They exist now rather than later
-- because the day billing is switched on is the day Wesify needs to already know who has been using
-- it and how much — a meter that starts counting on the day it is installed has nothing to say about
-- the month before, and `rebuilds` in particular is only useful if it has been recording all along.
--
-- One row per account, not per workspace. A plan is something a person buys; pinning it to a
-- workspace would leave an operator with two workspaces holding two half-answers to "what am I
-- paying for". The plan says how many workspaces they may have. It does not live inside one.
--
-- No prices and no plan definitions here. Those live in billing.mjs, in code, because they change
-- with product decisions rather than with data, and a plan whose meaning is spread across a table
-- and a file is one that will eventually disagree with itself.

create table if not exists subscriptions (
  user_id                text primary key references users(id) on delete cascade,
  plan                   text        not null default 'free',
  status                 text        not null default 'active',
  stripe_customer_id     text,
  stripe_subscription_id text,
  -- What Wesify checks to decide whether a lapsed subscription still has time left on it. Null on
  -- free, which never lapses because it was never paid for.
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Finding the account a webhook is about. Stripe's events name its own customer, not Wesify's user.
create index if not exists subscriptions_stripe_customer_idx on subscriptions (stripe_customer_id);

-- Every webhook Stripe has delivered, by its own id.
--
-- Stripe promises at-least-once delivery, not exactly-once: a retry after a timeout is normal, and
-- the same event arriving twice must not do the work twice. Recording the id first and refusing
-- duplicates is what makes the handler idempotent, and it is the entire reason this table exists.
create table if not exists stripe_events (
  id          text primary key,
  type        text        not null,
  received_at timestamptz not null default now()
);

-- One row per rebuild, because rebuilds are the metered thing.
--
-- The build history in workspace_builds would answer this, but it is regenerable output that a
-- redeploy is free to discard, and a quota that resets when the container restarts is not a quota.
create table if not exists rebuilds (
  id           text        primary key,
  user_id      text        not null references users(id) on delete cascade,
  workspace_id text        not null,
  created_at   timestamptz not null default now()
);

-- The only question ever asked of it: how many has this account used this month.
create index if not exists rebuilds_user_month_idx on rebuilds (user_id, created_at);
