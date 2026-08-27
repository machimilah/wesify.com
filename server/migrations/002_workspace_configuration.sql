-- What a workspace is, in the four ways Wesify knows it.
--
-- A Command Center is described in layers, and they are not interchangeable:
--
--   discovery_sessions   the interview. What was asked, what was answered, and how far in it got.
--                        Re-read by the architect every time it thinks, and by a returning operator
--                        continuing mid-question.
--   business_profile     what the company *is*. Its industry, how it makes money, how it operates.
--                        One row, rewritten as understanding improves.
--   business_dimensions  the lists that profile is made of — locations, products, customers,
--                        suppliers, departments, regulations — one row each, so they can be counted,
--                        filtered and corrected individually instead of buried in a blob.
--   workspace_builds     what was generated from all of the above: pages, entities, fields. Versioned,
--                        because a rebuild must never destroy the shape the previous records were
--                        written against.
--   workspace_settings   what the operator changed afterwards, by hand, inside their own workspace.
--                        Deliberately separate from the build: a rebuild replaces the build and must
--                        leave these standing.
--   records              the actual rows. Clients, invoices, work orders, everything typed in.

-- No foreign key to workspaces, and that is deliberate. The interview is what *produces* a workspace
-- and it begins before anybody has signed in, so a session has to be able to exist for a workspace
-- that no account owns yet. The server scopes every read by workspace id regardless.
create table if not exists discovery_sessions (
  workspace_id text        primary key,
  session      jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One row per workspace: the answer to "what does this company do", in the shape the architect and
-- every later screen actually ask for.
--
-- The named columns are the questions asked of this table often enough to deserve being queryable —
-- an industry can be counted across workspaces, a revenue model decides which capabilities are built.
-- `detail` keeps the model's complete state alongside them so that nothing the interview learned is
-- lost to a column list decided today.
create table if not exists business_profile (
  workspace_id     text        primary key,
  -- Plain language, as the operator would say it: "specialty food distribution".
  industry         text        not null default '',
  -- The NAICS subsector it was classified into. The join key to industry_knowledge, which is how one
  -- company's corrections improve the next company's first build.
  subsector        text        not null default '',
  summary          text        not null default '',
  -- How it makes money: retainers, per job, per unit shipped, subscription.
  revenue_model    text        not null default '',
  -- How the work actually flows: make to order, hold stock and ship, dispatch technicians.
  operating_model  text        not null default '',
  currency         text        not null default '',
  -- Everything the interview holds, including whatever has no column above.
  detail           jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists business_profile_subsector_idx on business_profile (subsector);

-- The lists a business profile is made of, one row per thing.
--
-- A row rather than an array inside `business_profile.detail`, because these are the parts an
-- operator corrects one at a time — a location closes, a regulation starts applying, a product line
-- is dropped — and because "how many locations does this company have" should be a count rather than
-- a JSON traversal.
--
-- `dimension` is constrained rather than free text. A typo here is invisible until a screen quietly
-- shows nothing, which is the worst way to find out; widening the vocabulary is one line of SQL.
--
-- Note what this is not: `customers` and `suppliers` here are what the company *says* about who it
-- sells to and buys from — "independent grocers in Madrid" — which is what shapes the build. The
-- actual customer and supplier rows an operator later types in live in `records`, like every other
-- record. The two are different questions and answering them from one table would confuse both.
create table if not exists business_dimensions (
  workspace_id text        not null,
  dimension    text        not null,
  id           text        not null,
  label        text        not null default '',
  detail       jsonb       not null default '{}'::jsonb,
  -- Where this came from, because it decides who may silently overwrite it. Wesify may correct its own
  -- guess; it must never quietly overwrite something a person stated.
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

-- The generated Command Center: its pages, its entities, the fields on each.
--
-- Versioned rather than replaced. Records are written against the shape that existed when they were
-- created, so a rebuild that overwrote the only copy would leave every existing record described by
-- a schema it never matched. No foreign key, for the same reason as discovery_sessions: a build can
-- finish before anybody has signed in to own it.
create table if not exists workspace_builds (
  workspace_id text        not null,
  version      integer     not null,
  manifest     jsonb       not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, version)
);

-- Always "the newest build for this workspace", never a scan.
create index if not exists workspace_builds_latest_idx on workspace_builds (workspace_id, version desc);

-- What the operator changed inside their own workspace after it was built.
--
-- Separate from the manifest above so that a rebuild — which replaces the manifest wholesale — cannot
-- take their preferences with it. Key/value rather than columns because these are product decisions
-- that change weekly, and a settings column added per preference is a migration per preference.
create table if not exists workspace_settings (
  workspace_id text        not null,
  key          text        not null,
  value        jsonb       not null,
  updated_at   timestamptz not null default now(),
  updated_by   text        references users(id) on delete set null,
  primary key (workspace_id, key)
);

-- Every record a workspace holds: clients, invoices, work orders, anything typed in.
--
-- One generic table rather than one table per entity, because an entity's shape is decided per
-- workspace by the architect at build time — arbitrary fields no schema can know in advance — and
-- because Wesify already treats a record as an opaque object everywhere except the single point where
-- it validates required fields against the entity definition.
create table if not exists records (
  workspace_id text        not null references workspaces(id) on delete cascade,
  entity_id    text        not null,
  id           text        not null,
  data         jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, entity_id, id)
);
