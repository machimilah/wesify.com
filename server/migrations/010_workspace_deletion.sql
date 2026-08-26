-- A deleted workspace stays deleted.
--
-- Deleting used to remove the workspaces row outright, and the row is the only thing that says an id
-- has been spoken for. So the id went back to being unclaimed, and the next request that mentioned
-- it — a tab still open on the old workspace, a retry, a poller that had not noticed — was treated
-- exactly like the first request for a brand new workspace: claimed, owned, and back in the list. The
-- workspace an operator deleted kept reappearing, empty, as if it had refused to go.
--
-- The fix is a tombstone. The row survives its own deletion carrying `deleted_at`, everything the
-- workspace held is still really deleted, and the id can never be claimed again. Nothing else needs
-- to know how a workspace was disposed of: the queries that list workspaces ask for the ones with no
-- date on them, and claiming refuses any id that has one.

alter table workspaces add column if not exists deleted_at timestamptz;
