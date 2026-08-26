-- What a Command Center is called, what it looks like, and who else is meant to be in it.
--
-- All three are asked before the build now, in the onboarding dialog, and all three used to have
-- nowhere durable to go. The name lived in a workspace configuration cached in one browser, the logo
-- did not exist, and "add your colleague" was a promise the schema could not keep: workspace_members
-- can only hold somebody who already has a users row, and an invited colleague by definition does
-- not yet.
--
-- So: two columns on the workspace for its identity, and one table for the people who have been
-- asked but have not arrived. An invite is keyed by address because that is all the inviter knows
-- about them; it becomes a membership the first time somebody signs in holding that address, and the
-- row stays behind as the record of who asked and when.

alter table workspaces add column if not exists logo text not null default '';

create table if not exists workspace_invites (
  workspace_id text        not null references workspaces(id) on delete cascade,
  email        text        not null,
  role         text        not null default 'employee',
  invited_by   text        references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  text        references users(id) on delete set null,
  primary key (workspace_id, email)
);

-- The one question asked of it at sign-in: which workspaces has this address been invited to.
create index if not exists workspace_invites_email_idx on workspace_invites (email);
