-- Accounts, sessions, and who owns which workspace.
--
-- Until now a workspace belonged to whoever first presented a token for it, which made BO a
-- single-browser tool: no second device, no colleague, and no way to tell two people apart. This is
-- the smallest schema that fixes that, and nothing more — teams and invitations are a later migration
-- rather than columns nobody writes to yet.

create table if not exists users (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Only the hash of a session token is stored. A stolen database therefore yields no usable session,
-- for the same reason it yields no usable password.
create table if not exists sessions (
  token_hash   text primary key,
  user_id      text not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions (user_id);

-- The id is the one the client already generates for a workspace, so existing workspaces keep working.
create table if not exists workspaces (
  id         text primary key,
  owner_id   text not null references users(id) on delete cascade,
  name       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists workspaces_owner_id_idx on workspaces (owner_id);

-- Membership is separate from ownership from the start. One row per person today; the table is what
-- lets a second person be added later without moving any data.
create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id      text not null references users(id) on delete cascade,
  role         text not null default 'owner',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
