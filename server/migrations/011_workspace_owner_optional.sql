-- The owner a workspace no longer has.
--
-- Migration 006 already drops this constraint, and on a database built from an empty schema it is
-- gone. It is still there on databases that ran 006 before that line was part of it: a migration is
-- ledgered by its filename, so changing the file afterwards changes nothing that has already run.
-- The result is two databases with the same migration history and different shapes, and code written
-- against one of them failing only on the other.
--
-- Which is what happened. Deleting a workspace nulls the owner on the row it leaves behind, that
-- update was refused by the constraint, and every deletion answered 500 — on the deployment that had
-- the older shape, and nowhere else.
--
-- Its own file rather than an edit to 006, for exactly the reason above.

alter table workspaces alter column owner_id drop not null;
