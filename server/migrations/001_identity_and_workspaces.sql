-- Who a person is, and which workspaces are theirs.
--
-- This is the baseline: the schema was rebuilt from nothing after every table was dropped, so there
-- is no upgrade path to preserve and no historical shape to apologise for. Eleven migrations of
-- accumulated correction collapse into four files that say what Wesify actually stores.
--
-- One owner per workspace, and only the owner. There is no membership table and no invite table,
-- which is the point rather than an omission: a workspace is visible to exactly one account, and
-- that is enforced by a column rather than by a join that could be forgotten. Every access check in
-- the server reduces to `owner_id = the person asking`.

-- The id is the Clerk user id. Wesify holds no credential of any kind — no password, no session
-- token, no reset link — because Clerk authenticates people and this row exists only so that a
-- workspace, a subscription and an event have something stable to point at.
--
-- The address is nullable and deliberately not unique. Clerk can produce an account before it
-- produces an address (a social sign-in whose profile is still loading), and Clerk alone decides who
-- is who: a uniqueness check here could only ever disagree with it, and Wesify would lose.
create table if not exists users (
  id         text primary key,
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `owner_id` is nullable because Wesify's promise is that you describe a company and watch it get
-- built before signing up for anything. The workspace therefore exists before anybody owns it, and
-- signing in claims it. Until that moment it belongs to no account and appears in no list.
--
-- `deleted_at` is a tombstone, not a flag. Deleting used to remove the row outright, which handed
-- the id back to the next request that mentioned it — a stale tab, a retry, a poller — and the
-- workspace somebody had just deleted was silently recreated, empty, in their list. The row survives
-- its own deletion so the id can never be claimed twice.
create table if not exists workspaces (
  id         text primary key,
  owner_id   text references users(id) on delete cascade,
  name       text not null default '',
  -- A data URL, capped in the server rather than here: it travels in the account's workspace list on
  -- every page load, so an unbounded one is paid for on every request.
  logo       text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The only question ever asked of this table: which workspaces belong to the person signed in. The
-- partial index matches that query exactly, including its `deleted_at is null`.
create index if not exists workspaces_owner_idx on workspaces (owner_id, created_at desc) where deleted_at is null;
