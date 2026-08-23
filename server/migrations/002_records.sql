-- Workspace records: the clients, invoices, work orders and every other row an operator creates.
--
-- These lived in one JSON file per workspace on local disk. That works for a single always-on
-- process with a persistent volume; it silently loses every record on most hosting platforms
-- (Render, Railway, Fly, Vercel and similar all wipe local disk on redeploy) and cannot be shared
-- across more than one server process. This table is the fix.
--
-- One generic table rather than one table per entity type, because an entity's shape is decided by
-- BO's AI architect per workspace at build time — arbitrary fields the schema cannot know in
-- advance — and because BO already treats a record as an opaque JSON object everywhere except at
-- the one point it validates required fields against the entity definition. A `jsonb` payload keeps
-- that contract instead of fighting it with dynamic DDL per workspace.

create table if not exists records (
  workspace_id text        not null references workspaces(id) on delete cascade,
  entity_id    text        not null,
  id           text        not null,
  data         jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, entity_id, id)
);

-- Every read is "every record of this entity in this workspace"; the primary key above already
-- leads with workspace_id and entity_id, so no separate index is needed for that access pattern.
