-- =====================================================================================
-- BO — complete Supabase setup
--
-- Paste the whole file into the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- and run it once. Safe to run again — including if you already ran an earlier version of
-- this file: every statement is idempotent, so re-running it only adds what is missing and
-- never destroys anything.
--
-- What this creates
--   users              one row per person, keyed by their Clerk user id. Clerk holds the
--                      credential; this is what everything below points at
--   workspaces         a Command Center, owned by one account
--   workspace_members  who may open a workspace, and as what role
--   records            every record a workspace holds — clients, invoices, work orders,
--                      anything an operator creates — as one row per record
--   subscriptions      what plan an account is on, and what Stripe last said about it
--   stripe_events      every webhook already handled, so a retry does not do the work twice
--   rebuilds           one row per rebuild, because rebuilds are what the plans meter
--   industry_knowledge what companies in an industry kept, removed and added — counts only
--   schema_migrations  BO's own migration ledger, so the server does not re-run this
--
-- What this deliberately does NOT create
--   The generated Command Center itself — the versioned manifest, and the runtime.mjs /
--   service / page files BO writes per build — stays on local disk under
--   generated-projects/. Those are regenerable build output, not data an operator typed
--   in, so losing them costs a rebuild rather than costing anyone their records.
--
-- After running this
--   Put the Session pooler connection string in .env.local as DATABASE_URL, then start
--   the server. It should log "listening on 127.0.0.1:8787 with accounts".
-- =====================================================================================


-- -------------------------------------------------------------------------------------
-- 1. Tables
--
-- Ids are `text`, not `uuid`: BO generates them in JavaScript with crypto.randomUUID(),
-- and workspace ids in particular were already being minted by the browser before there
-- was a database at all. Keeping them text means existing workspaces keep working.
-- -------------------------------------------------------------------------------------

-- The id is the Clerk user id. Wesify stores no credential of any kind: Clerk authenticates
-- people, and this row exists so that a workspace, a membership and a subscription have
-- something stable to belong to. The email is a display detail, nullable because Clerk can
-- produce an account before it produces an address, and deliberately not unique — Clerk
-- decides who is who, and a second check here could only ever disagree with it.
create table if not exists users (
  id         text primary key,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id         text primary key,
  -- Nullable: BO's promise is that you describe a company and get a workspace before signing
  -- up for anything, so a workspace has to be able to exist before it belongs to anybody.
  -- Signing in claims it and fills this in.
  owner_id   text references users(id) on delete cascade,
  name       text not null default '',
  created_at timestamptz not null default now()
);

-- Membership is separate from ownership from the start. One row per person today; the
-- table is what lets a second person be added later without moving any data.
create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id      text not null references users(id) on delete cascade,
  role         text not null default 'owner',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- One generic table rather than one table per entity type, because an entity's shape —
-- its fields — is decided by BO's AI architect per workspace at build time, not known in
-- advance. BO already treats a record as an opaque JSON object everywhere except where it
-- checks required fields against the entity definition, so a jsonb payload keeps that
-- contract instead of fighting it with per-workspace dynamic DDL. `_notifications` is
-- stored the same way, as entity_id = '_notifications'.
create table if not exists records (
  workspace_id text        not null references workspaces(id) on delete cascade,
  entity_id    text        not null,
  id           text        not null,
  data         jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, entity_id, id)
);

-- Billing. One row per account, not per workspace: a plan is something a person buys,
-- and pinning it to a workspace means an operator with two has two half-answers to
-- "what am I paying for". No prices or entitlements here — those live in server/billing.mjs,
-- because they change with product decisions rather than with data.
create table if not exists subscriptions (
  user_id                text primary key references users(id) on delete cascade,
  plan                   text        not null default 'free',
  status                 text        not null default 'active',
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Every webhook Stripe has delivered, by its own id. Stripe promises at-least-once
-- delivery, not exactly-once: a retry after a timeout is normal, and the same event
-- arriving twice must not do the work twice.
create table if not exists stripe_events (
  id          text primary key,
  type        text        not null,
  received_at timestamptz not null default now()
);

-- One row per rebuild, because rebuilds are the metered thing. The build history on local
-- disk would have answered this, but a redeploy is free to lose it, and a quota that resets
-- when the container restarts is not a quota.
create table if not exists rebuilds (
  id           text        primary key,
  user_id      text        not null references users(id) on delete cascade,
  workspace_id text        not null,
  created_at   timestamptz not null default now()
);

-- What BO has learned about each industry: what real companies kept, removed and added
-- after being handed a workspace. It is the only thing BO owns that cannot be copied by
-- reading the product, and it was sitting in JSON files on the same local disk a redeploy
-- wipes. One row per NAICS subsector; only aggregate counts, never who did what.
create table if not exists industry_knowledge (
  subsector  text        primary key,
  label      text        not null default '',
  companies  integer     not null default 0,
  observed   jsonb       not null default '{}'::jsonb,
  patterns   jsonb       not null default '{}'::jsonb,
  researched jsonb,
  updated_at timestamptz not null default now()
);


-- The interview that produced the workspace. It is what BO re-reads to explain a decision,
-- what a returning operator continues from mid-question, and what the opening records in a
-- new workspace are written from. No foreign key to workspaces on purpose: the interview is
-- what produces a workspace, and it starts before anyone has signed in.
create table if not exists discovery_sessions (
  workspace_id text        primary key,
  session      jsonb       not null,
  updated_at   timestamptz not null default now()
);

-- What a Command Center is: its entities, their fields, its pages. This lived only in
-- project.json on local disk, with a copy cached in the browser — which is why nobody
-- noticed that a redeploy could leave every record intact in Postgres while the description
-- of what those records meant was gone.
create table if not exists workspace_builds (
  workspace_id text        not null,
  version      integer     not null,
  manifest     jsonb       not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, version)
);

create index if not exists workspace_builds_workspace_idx on workspace_builds (workspace_id, version desc);

-- BO's migration ledger. The server creates this itself on first start, but creating it
-- here lets the last section record every migration as already applied, so the server does
-- not try to redo work you have just done by hand.
create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);


-- -------------------------------------------------------------------------------------
-- 2. Indexes
--
-- Every one of these backs a query BO actually runs. Foreign keys do not create indexes
-- in Postgres, so without them a cascade delete or a lookup by parent is a table scan.
-- -------------------------------------------------------------------------------------

-- Listing the workspaces an account owns.
create index if not exists workspaces_owner_id_idx on workspaces (owner_id);

-- The primary key above leads with workspace_id, so it cannot answer "which workspaces
-- does this person belong to" — which is exactly what /api/auth/me asks on every page
-- load for a signed-in operator.
create index if not exists workspace_members_user_id_idx on workspace_members (user_id);

-- records needs no extra index: every query BO makes is "every record of this entity in
-- this workspace" or "every record in this workspace", and the primary key above already
-- leads with (workspace_id, entity_id) — exactly what both access patterns filter on.

-- Finding the account a Stripe webhook is about: its events name the customer, not BO's id.
create index if not exists subscriptions_stripe_customer_id_idx on subscriptions (stripe_customer_id);

-- The only question ever asked of rebuilds: how many has this account used this month.
create index if not exists rebuilds_user_id_created_at_idx on rebuilds (user_id, created_at);


-- -------------------------------------------------------------------------------------
-- 3. Keep these tables off the public API
--
-- This section is the one that matters most on Supabase specifically, and it is easy to
-- miss. Supabase exposes the `public` schema through PostgREST, and its default
-- privileges grant every new table in that schema to the `anon` and `authenticated`
-- roles. `anon` is reachable by anyone holding the publishable key — which is public by
-- design and ships in the browser bundle.
--
-- So without this section, a stranger could read every row of `users` (who has an account)
-- and `records` (every client and invoice every workspace holds) over HTTP. BO never uses
-- PostgREST: it connects straight to Postgres as the table owner, and RLS does not apply
-- to the owner, so locking these down costs the application nothing.
--
-- Two independent locks, because either one alone can be undone by accident later:
--   RLS with no policies  → the API can see the table but never any rows
--   REVOKE                → the API cannot see the table at all
-- -------------------------------------------------------------------------------------

alter table users             enable row level security;
alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
alter table records           enable row level security;
alter table subscriptions     enable row level security;
alter table stripe_events     enable row level security;
alter table rebuilds          enable row level security;
alter table industry_knowledge enable row level security;
alter table discovery_sessions enable row level security;
alter table workspace_builds  enable row level security;
alter table schema_migrations enable row level security;

-- Note: no CREATE POLICY statements anywhere in this file. That is deliberate, not an
-- omission — with RLS on and no policy, the API roles match zero rows, which is what we
-- want. Adding a permissive policy here would undo the protection above.

-- Guarded on the roles existing. `anon` and `authenticated` are created by Supabase, so
-- on a Supabase project this always runs. Elsewhere — a local Postgres, a plain managed
-- instance — a bare REVOKE would abort the script and leave the tables above created but
-- unprotected, which is the one outcome worth engineering against.
do $$
begin
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise notice 'Supabase API roles (anon, authenticated) not found: this is not a Supabase project, so there are no API grants to revoke. Tables are created and RLS is enabled.';
    return;
  end if;

  execute 'revoke all on table users             from anon, authenticated';
  execute 'revoke all on table workspaces        from anon, authenticated';
  execute 'revoke all on table workspace_members from anon, authenticated';
  execute 'revoke all on table records           from anon, authenticated';
  execute 'revoke all on table subscriptions     from anon, authenticated';
  execute 'revoke all on table stripe_events     from anon, authenticated';
  execute 'revoke all on table rebuilds          from anon, authenticated';
  execute 'revoke all on table industry_knowledge from anon, authenticated';
  execute 'revoke all on table discovery_sessions from anon, authenticated';
  execute 'revoke all on table workspace_builds  from anon, authenticated';
  execute 'revoke all on table schema_migrations from anon, authenticated';

  -- The same protection for tables a future BO migration creates, so 003 and beyond are
  -- not silently published the moment they are added.
  -- To undo for a table you genuinely want public:
  --   grant select on table <name> to anon;  -- plus a suitable RLS policy
  execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
end
$$;

-- `service_role` is intentionally left alone. It bypasses RLS by design, is a secret that
-- must never reach a browser, and some Supabase dashboard features rely on it.


-- -------------------------------------------------------------------------------------
-- 4. Record every migration as applied
--
-- BO runs pending migrations from server/migrations/ on start, tracked by filename. This
-- file does the same work as every file in server/migrations/, so recording them all
-- prevents a duplicate run. ON CONFLICT keeps this file safe to run twice.
-- -------------------------------------------------------------------------------------

insert into schema_migrations (name)
values ('001_accounts.sql'), ('002_records.sql'), ('003_password_resets.sql'),
       ('004_billing.sql'), ('005_industry_knowledge.sql'), ('006_interview_and_builds.sql'),
       ('007_platform_patterns.sql'), ('008_clerk_identities.sql')
on conflict (name) do nothing;


-- -------------------------------------------------------------------------------------
-- 5. Verify
--
-- Expect exactly nine rows, and on every one of them:
--   rls_enabled     = true    row level security is on
--   policy_count    = 0       no policy, so the API matches no rows
--   anon_can_select = false   the API cannot read the table at all
--
-- Anything else means a step above did not take effect — most likely the DO block found
-- no anon role, which on a real Supabase project should never happen.
-- -------------------------------------------------------------------------------------

select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = c.relname) as policy_count,
  case
    when to_regrole('anon') is null then null
    else has_table_privilege('anon', c.oid, 'SELECT')
  end as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('users', 'workspaces', 'workspace_members', 'records',
                    'subscriptions', 'stripe_events', 'rebuilds',
                    'industry_knowledge', 'discovery_sessions', 'workspace_builds',
                    'schema_migrations')
order by c.relname;
