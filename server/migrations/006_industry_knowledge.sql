-- What Wesify has learned about each industry, across every company that ever used it.
--
-- The only thing here that a competitor cannot obtain by reading the product. Every other part of
-- Wesify could be rebuilt by somebody with the same idea and enough time; this could not, because it
-- is the accumulated behaviour of every operator who ever corrected a build — what they kept, what
-- they removed, and what they had to add themselves.
--
-- Not scoped to a workspace, and that is the whole design. One row per NAICS subsector, holding
-- counts and Wesify's own capability ids and nothing else: no company names, no records, nothing
-- traceable to the business it was learned from. It is what makes the tenth plumbing company's first
-- build better than the first one's, without any of them being able to see each other.
--
-- `observed`, `researched` and `patterns` stay jsonb rather than becoming tables of their own.
-- Capability ids are Wesify's own vocabulary and change with the catalog, and the verdict is computed
-- in code from the whole profile rather than queried by its parts.

create table if not exists industry_knowledge (
  subsector  text        primary key,
  label      text        not null default '',
  -- How many distinct companies this profile speaks for. The threshold that decides whether an
  -- industry has spoken at all is a count of companies, never a count of requests — one enthusiastic
  -- operator rebuilding forty times has not taught Wesify anything about their trade.
  companies  integer     not null default 0,
  -- What real companies did with what they were given.
  observed   jsonb       not null default '{}'::jsonb,
  -- What Wesify went and found out on its own, where no company has spoken yet.
  researched jsonb,
  -- Reusable structure worth repeating, aggregated to counts so it stays untraceable.
  patterns   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
