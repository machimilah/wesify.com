-- The two things BO still kept only on local disk.
--
-- Records moved to Postgres in 002 and industry knowledge in 005, both for the same reason: Render,
-- Railway, Fly and Vercel wipe the local disk on every redeploy. Two things were left behind, and
-- they are the two halves of what an operator actually paid attention to.
--
-- The interview is one. It is the entire reason the workspace looks the way it does, it is what BO
-- re-reads to answer "why is this page here", and it is what a returning operator continues from
-- mid-question. It lived in generated-projects/.discovery-sessions as one JSON file per workspace.
--
-- The build is the other. `project.json` on disk is the only description of what a Command Center
-- is — its entities, its fields, its pages. The browser cached a copy in localStorage, which is why
-- nobody noticed: clear the browser after a redeploy and the workspace could not be described at
-- all, though every record in it was safe in Postgres.

create table if not exists discovery_sessions (
  workspace_id text        primary key,
  session      jsonb       not null,
  updated_at   timestamptz not null default now()
);

-- Deliberately no foreign key to workspaces. The interview is what produces a workspace, and it
-- starts before anyone has signed in — a session must be able to exist for a workspace nobody owns
-- yet, or BO would have to demand an account before asking the first question.

create table if not exists workspace_builds (
  workspace_id text        not null,
  version      integer     not null,
  manifest     jsonb       not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, version)
);

create index if not exists workspace_builds_workspace_idx on workspace_builds (workspace_id, version desc);

-- A workspace can now exist before it belongs to anybody.
--
-- The records table references workspaces, and a workspaces row required an owner — so with a
-- database configured and no account, the first record written to an anonymous workspace failed on
-- a foreign key nobody could satisfy. BO's whole promise is that you describe a company and get a
-- workspace without signing up first, so the constraint was arguing with the product.
--
-- Claiming a workspace at sign-in fills the owner in; until then it is null, and every access check
-- still runs in the server exactly as before.
alter table workspaces alter column owner_id drop not null;
