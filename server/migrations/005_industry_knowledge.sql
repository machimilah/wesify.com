-- What BO has learned about each industry, off local disk at last.
--
-- This is the only thing BO owns that a competitor cannot copy by reading the product: what real
-- companies in an industry kept, removed and added after being given a workspace. Every other part
-- of BO could be rebuilt by somebody with the same idea and enough time. This could not — it is the
-- accumulated behaviour of every operator who ever corrected it.
--
-- It was sitting in JSON files under generated-projects/.industry-knowledge, on the same local disk
-- that Render, Railway, Fly and Vercel wipe on every redeploy. Records were moved off it in 002 for
-- exactly that reason; this was left behind, which means the single most valuable thing BO holds was
-- also the least durable. One redeploy and BO would have forgotten everything it had ever learned,
-- with no error and nothing to restore from.
--
-- One row per NAICS subsector. `observed` and `researched` stay jsonb rather than becoming tables of
-- their own: capability ids are BO's own vocabulary and change with the catalog, and the verdict is
-- computed in code from the whole profile rather than queried by parts.

create table if not exists industry_knowledge (
  subsector  text        primary key,
  label      text        not null default '',
  -- How many distinct companies this profile speaks for. The threshold that decides whether an
  -- industry has spoken at all is a count of companies, never a count of requests.
  companies  integer     not null default 0,
  observed   jsonb       not null default '{}'::jsonb,
  researched jsonb,
  updated_at timestamptz not null default now()
);
