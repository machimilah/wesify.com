-- Who did what, when — including everything Wesify did on its own.
--
-- This used to be `audit.jsonl`, appended to local disk under generated-projects/. Every hosting
-- platform Wesify runs on wipes local disk on redeploy, so the history of a workspace lasted until the
-- next deploy and then silently became an empty file. Nothing errored. The record simply stopped
-- existing, which is the worst possible failure for the one table whose entire job is remembering.
--
-- The AI is a first-class actor here, not a footnote. Wesify creates records, changes configuration,
-- runs automations and rewrites the operating graph without being asked each time, and an operator
-- who cannot tell their own edit from the system's has no way to trust either. `actor_type` is what
-- separates them, and it is not nullable.
--
-- Append-only by convention: nothing in the server updates a row here. A correction is a new event
-- that refers to the old one, never a rewrite of what was recorded at the time.

create table if not exists event_history (
  id           text        primary key,
  -- Nullable, because not every event belongs to a workspace. A subscription changing, an account
  -- being created and a sign-in are all things that happened to a person across all of theirs.
  workspace_id text,
  -- The account this happened on behalf of, kept even when the actor was the AI: Wesify acting inside
  -- somebody's workspace is still something done for that person, and "show me everything that
  -- happened in my company" has to include it.
  user_id      text        references users(id) on delete set null,
  actor_type   text        not null default 'system',
  -- Which agent, connector or process — 'discovery-agent', 'automation-scheduler', 'stripe'. Null
  -- where actor_type is 'user', because user_id already says it.
  actor_id     text,
  -- Dotted and past tense: 'record.created', 'workspace.built', 'profile.updated', 'invoice.sent'.
  action       text        not null,
  -- What was acted on. 'record' + the record id, 'workspace' + its id, 'business_profile' + null.
  subject_type text        not null default '',
  subject_id   text        not null default '',
  -- One line a person can read without decoding the detail: "Added client La Pampa".
  summary      text        not null default '',
  -- Everything else: the fields that changed, the before and after, the model's reasoning.
  detail       jsonb       not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  constraint event_history_actor_check check (actor_type in ('user', 'ai', 'system', 'connector'))
);

-- The history screen, and the only read that matters: this workspace, newest first.
create index if not exists event_history_workspace_idx on event_history (workspace_id, occurred_at desc);

-- "What have I done lately", across every workspace an account has.
create index if not exists event_history_user_idx on event_history (user_id, occurred_at desc);

-- Narrowing a workspace's history to one kind of thing — every invoice event, everything the AI did.
create index if not exists event_history_action_idx on event_history (workspace_id, action, occurred_at desc);
