-- =====================================================================================
-- Wesify — complete Supabase setup
--
-- Paste the whole file into the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- and run it once. Safe to run again: every statement is idempotent, so re-running only
-- adds what is missing and never destroys anything.
--
-- WHAT THIS CREATES
--
--   Identity and ownership
--     users                one row per person, keyed by their Clerk user id
--     workspaces           a Command Center, owned by exactly one account
--
--   What a workspace is
--     discovery_sessions   the interview: what was asked, what was answered, how far in
--     business_profile     what the company is — industry, how it makes money, how it runs
--     business_dimensions  the lists that profile is made of — locations, products,
--                          customers, suppliers, departments, regulations
--     workspace_builds     the generated Command Center, versioned
--     workspace_settings   what the operator changed by hand afterwards
--     records              every record typed in — clients, invoices, work orders
--
--   What happened
--     event_history        who did what and when, the AI included
--
--   How the business runs
--     operating_nodes      every step and thing — Customer, Order, Production, Invoice
--     operating_edges      what follows what, in named flows like order-to-cash
--
--   Money (switched off, recording anyway)
--     subscriptions        what plan an account is on, and what Stripe last said
--     stripe_events        every webhook already handled, so a retry does no work twice
--     rebuilds             one row per rebuild, because rebuilds are what plans meter
--
--   Platform learning
--     industry_knowledge   what companies in an industry kept, removed and added — counts
--                          only, never traceable to the company it was learned from
--
--   schema_migrations      Wesify's own ledger, so the server does not re-run this
--
-- WHAT THIS DELIBERATELY DOES NOT CREATE
--
--   No membership or invite table. A workspace belongs to one account and is visible to
--   that account alone. Isolation is a column, not a join that somebody can forget.
--
--   Not the generated runtime files. The service and page files Wesify writes per build stay
--   on local disk under generated-projects/ — regenerable output, not anything a person
--   typed, so losing them costs a rebuild rather than costing anyone their records.
--
-- AFTER RUNNING THIS
--   Put the Session pooler connection string in .env.local as DATABASE_URL, then start the
--   server. It should log "listening on 127.0.0.1:8787 with accounts".
-- =====================================================================================


-- -------------------------------------------------------------------------------------
-- 1. Tables
--
-- Ids are `text`, not `uuid`. Wesify mints them in JavaScript with crypto.randomUUID(), and
-- a workspace id in particular is minted by the browser before there is any database in
-- the picture at all.
-- -------------------------------------------------------------------------------------

-- Keyed by the Clerk user id. Wesify stores no credential of any kind: Clerk authenticates
-- people, and this row exists so a workspace, a subscription and an event have something
-- stable to belong to. The address is nullable because Clerk can produce an account before
-- it produces an address, and deliberately not unique — Clerk decides who is who, and a
-- second check here could only ever disagree with it.
create table if not exists users (
  id         text primary key,
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `owner_id` is nullable: Wesify's promise is that you describe a company and watch it get
-- built before signing up for anything, so a workspace exists before it belongs to anyone.
-- Signing in claims it.
--
-- `deleted_at` is a tombstone. The row survives its own deletion so the id can never be
-- claimed a second time by a stale tab or a retry, which is how deleted workspaces used to
-- come back from the dead, empty, in somebody's list.
create table if not exists workspaces (
  id         text primary key,
  owner_id   text references users(id) on delete cascade,
  name       text not null default '',
  logo       text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists workspaces_owner_idx on workspaces (owner_id, created_at desc) where deleted_at is null;

-- No foreign key to workspaces, deliberately: the interview is what produces a workspace
-- and begins before anybody has signed in, so it must be able to exist for a workspace no
-- account owns yet.
create table if not exists discovery_sessions (
  workspace_id text        primary key,
  session      jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- What the company is. The named columns are the questions asked often enough to deserve
-- being queryable; `detail` keeps the model's full state so nothing the interview learned
-- is lost to a column list decided today.
create table if not exists business_profile (
  workspace_id    text        primary key,
  industry        text        not null default '',
  subsector       text        not null default '',
  summary         text        not null default '',
  revenue_model   text        not null default '',
  operating_model text        not null default '',
  currency        text        not null default '',
  detail          jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists business_profile_subsector_idx on business_profile (subsector);

-- The lists a profile is made of, one row each, so they can be counted and corrected
-- individually instead of buried in a blob.
--
-- Note what `customer` and `supplier` mean here: what the company says about who it sells
-- to and buys from — "independent grocers in Madrid" — which is what shapes the build. The
-- actual customer rows an operator types in live in `records`.
create table if not exists business_dimensions (
  workspace_id text        not null,
  dimension    text        not null,
  id           text        not null,
  label        text        not null default '',
  detail       jsonb       not null default '{}'::jsonb,
  source       text        not null default 'ai',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, dimension, id),
  constraint business_dimensions_dimension_check check (dimension in (
    'location', 'product', 'service', 'customer', 'supplier',
    'department', 'regulation', 'channel', 'tool', 'goal', 'risk'
  )),
  constraint business_dimensions_source_check check (source in ('user', 'ai', 'interview', 'connector', 'system'))
);

-- Versioned rather than replaced: records are written against the shape that existed when
-- they were created, so a rebuild that overwrote the only copy would leave every existing
-- record described by a schema it never matched.
create table if not exists workspace_builds (
  workspace_id text        not null,
  version      integer     not null,
  manifest     jsonb       not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, version)
);

create index if not exists workspace_builds_latest_idx on workspace_builds (workspace_id, version desc);

-- Kept apart from the manifest so a rebuild, which replaces the manifest wholesale, cannot
-- take the operator's own preferences with it.
create table if not exists workspace_settings (
  workspace_id text        not null,
  key          text        not null,
  value        jsonb       not null,
  updated_at   timestamptz not null default now(),
  updated_by   text        references users(id) on delete set null,
  primary key (workspace_id, key)
);

-- One generic table rather than one per entity, because an entity's shape is decided per
-- workspace by the architect at build time — arbitrary fields no schema can know ahead.
create table if not exists records (
  workspace_id text        not null references workspaces(id) on delete cascade,
  entity_id    text        not null,
  id           text        not null,
  data         jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, entity_id, id)
);

-- Who did what, when — the AI included, which is what `actor_type` exists to separate. An
-- operator who cannot tell their own edit from the system's has no way to trust either.
create table if not exists event_history (
  id           text        primary key,
  workspace_id text,
  user_id      text        references users(id) on delete set null,
  actor_type   text        not null default 'system',
  actor_id     text,
  action       text        not null,
  subject_type text        not null default '',
  subject_id   text        not null default '',
  summary      text        not null default '',
  detail       jsonb       not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  constraint event_history_actor_check check (actor_type in ('user', 'ai', 'system', 'connector'))
);

create index if not exists event_history_workspace_idx on event_history (workspace_id, occurred_at desc);
create index if not exists event_history_user_idx on event_history (user_id, occurred_at desc);
create index if not exists event_history_action_idx on event_history (workspace_id, action, occurred_at desc);

-- Every step and thing in the business. `entity_id` is the thread back to `records`: a node
-- called "Invoice" says this business issues invoices; the invoices are rows over there.
create table if not exists operating_nodes (
  workspace_id text        not null,
  id           text        not null,
  kind         text        not null default 'process',
  label        text        not null default '',
  entity_id    text,
  module       text        not null default '',
  position     jsonb       not null default '{}'::jsonb,
  detail       jsonb       not null default '{}'::jsonb,
  source       text        not null default 'ai',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint operating_nodes_kind_check check (kind in ('entity', 'process', 'actor', 'event', 'system')),
  constraint operating_nodes_source_check check (source in ('user', 'ai', 'interview', 'connector', 'system'))
);

create index if not exists operating_nodes_entity_idx on operating_nodes (workspace_id, entity_id);

-- What follows what. The composite foreign keys are the point: an edge cannot name a step
-- that does not exist, and cannot reach into another company's graph.
create table if not exists operating_edges (
  workspace_id text        not null,
  id           text        not null,
  from_node    text        not null,
  to_node      text        not null,
  relation     text        not null default 'flows-to',
  label        text        not null default '',
  flow         text        not null default '',
  sequence     integer     not null default 0,
  detail       jsonb       not null default '{}'::jsonb,
  source       text        not null default 'ai',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint operating_edges_from_fk foreign key (workspace_id, from_node) references operating_nodes (workspace_id, id) on delete cascade,
  constraint operating_edges_to_fk foreign key (workspace_id, to_node) references operating_nodes (workspace_id, id) on delete cascade,
  constraint operating_edges_relation_check check (relation in ('flows-to', 'triggers', 'produces', 'requires', 'owns', 'references')),
  constraint operating_edges_source_check check (source in ('user', 'ai', 'interview', 'connector', 'system'))
);

create index if not exists operating_edges_from_idx on operating_edges (workspace_id, from_node);
create index if not exists operating_edges_to_idx on operating_edges (workspace_id, to_node);
create index if not exists operating_edges_flow_idx on operating_edges (workspace_id, flow, sequence);

-- Billing is switched off. These tables exist now because the day it is switched on is the
-- day Wesify needs to already know who has been using it and how much.
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

create index if not exists subscriptions_stripe_customer_idx on subscriptions (stripe_customer_id);

-- Stripe promises at-least-once delivery, not exactly-once. Recording the id first and
-- refusing duplicates is what makes the webhook handler idempotent.
create table if not exists stripe_events (
  id          text primary key,
  type        text        not null,
  received_at timestamptz not null default now()
);

create table if not exists rebuilds (
  id           text        primary key,
  user_id      text        not null references users(id) on delete cascade,
  workspace_id text        not null,
  created_at   timestamptz not null default now()
);

create index if not exists rebuilds_user_month_idx on rebuilds (user_id, created_at);

-- Not scoped to a workspace, and that is the design. Counts and Wesify's own capability ids
-- and nothing else — no company names, nothing traceable to the business it was learned
-- from. It is what makes the tenth plumbing company's first build better than the first
-- one's, without any of them being able to see each other.
create table if not exists industry_knowledge (
  subsector  text        primary key,
  label      text        not null default '',
  companies  integer     not null default 0,
  observed   jsonb       not null default '{}'::jsonb,
  researched jsonb,
  patterns   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);


-- -------------------------------------------------------------------------------------
-- 2. Lock the Supabase API out entirely
--
-- Every one of these tables is reached only by Wesify's own server, over the DATABASE_URL
-- connection, as the owning role. Nothing in the browser talks to Supabase directly.
--
-- So the safe configuration is the strictest one available: row level security ON with no
-- policy at all. RLS with zero policies matches zero rows, for everybody it applies to.
-- There is no policy to get wrong, no JWT claim to line up with Clerk, and no clever
-- predicate that quietly stops being correct when a column is renamed.
--
-- The owning role bypasses RLS, which is why the server keeps working. `force row level
-- security` is deliberately NOT set — setting it would lock out the server too.
--
-- This is the backstop, not the isolation. A person sees only their own workspace because
-- every query in the server is scoped to `owner_id`. This is what stands behind that if a
-- key ever leaks or somebody points the REST API at the project.
-- -------------------------------------------------------------------------------------

alter table users               enable row level security;
alter table workspaces          enable row level security;
alter table discovery_sessions  enable row level security;
alter table business_profile    enable row level security;
alter table business_dimensions enable row level security;
alter table workspace_builds    enable row level security;
alter table workspace_settings  enable row level security;
alter table records             enable row level security;
alter table event_history       enable row level security;
alter table operating_nodes     enable row level security;
alter table operating_edges     enable row level security;
alter table subscriptions       enable row level security;
alter table stripe_events       enable row level security;
alter table rebuilds            enable row level security;
alter table industry_knowledge  enable row level security;
alter table schema_migrations   enable row level security;

-- Belt as well as braces: revoke the API roles' table privileges outright, so the tables
-- are not merely empty to the API but invisible to it.
--
-- Guarded on the roles existing. `anon` and `authenticated` are created by Supabase, so on
-- a Supabase project this always runs. On a plain Postgres a bare REVOKE would abort the
-- script and leave every table above created but unprotected, which is the one outcome
-- genuinely worth engineering against.
do $$
declare
  guarded text;
begin
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise notice 'Supabase API roles (anon, authenticated) not found: not a Supabase project, so there are no API grants to revoke. Tables are created and RLS is enabled.';
    return;
  end if;

  foreach guarded in array array[
    'users', 'workspaces', 'discovery_sessions', 'business_profile', 'business_dimensions',
    'workspace_builds', 'workspace_settings', 'records', 'event_history',
    'operating_nodes', 'operating_edges', 'subscriptions', 'stripe_events', 'rebuilds',
    'industry_knowledge', 'schema_migrations'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', guarded);
  end loop;

  -- The same protection for tables a future migration adds, so table seventeen is not
  -- silently published the moment it is created.
  execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
end
$$;

-- `service_role` is left alone on purpose. It bypasses RLS by design, it is a secret that
-- must never reach a browser, and parts of the Supabase dashboard rely on it.


-- -------------------------------------------------------------------------------------
-- 3. Record every migration as applied
--
-- The server runs pending migrations from server/migrations/ on start, tracked by filename.
-- This file does the same work, so recording them all prevents a duplicate run. ON CONFLICT
-- keeps this file safe to run twice.
-- -------------------------------------------------------------------------------------

insert into schema_migrations (name)
values ('001_identity_and_workspaces.sql'),
       ('002_workspace_configuration.sql'),
       ('003_billing.sql'),
       ('004_event_history.sql'),
       ('005_operating_graph.sql'),
       ('006_industry_knowledge.sql')
on conflict (name) do nothing;


-- -------------------------------------------------------------------------------------
-- 4. Verify
--
-- Expect sixteen rows, and on every one of them:
--   rls_enabled     = true    row level security is on
--   policy_count    = 0       no policy, so the API matches no rows
--   anon_can_select = false   the API cannot read the table at all
--
-- Anything else means a step above did not take effect — most likely the DO block found no
-- anon role, which on a real Supabase project should never happen.
-- -------------------------------------------------------------------------------------

select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
  case when to_regrole('anon') is null then null
       else has_table_privilege('anon', c.oid, 'SELECT') end as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
