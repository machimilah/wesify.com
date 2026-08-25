-- Identity moved to Clerk.
--
-- Wesify wrote its own: scrypt hashes, session tokens, reset links, the mail that carries them. All of
-- it worked, and all of it was work that is not Wesify's product. Clerk holds the credential now, and
-- what remains here is a mirror row per person so that everything Wesify does own — workspaces,
-- membership, subscriptions, rebuilds — keeps pointing at a `users.id` exactly as before.
--
-- `users.id` is the Clerk user id from this migration on. Nothing else in the schema changes, which
-- is the entire reason for keeping the table rather than rewriting six foreign keys.

-- No account outlived the change. Every row was a test account against a database that had been
-- configured hours earlier, and a scrypt hash is worthless to Clerk anyway: an account kept here
-- would be one nobody could sign in to. Cascades take sessions, resets, workspaces and memberships
-- with them, which is correct — a workspace whose owner cannot sign in is not a workspace anybody has.
delete from users;

drop table if exists password_resets;
drop table if exists sessions;

-- Wesify never sees a password again, so there is nowhere to put one.
alter table users drop column if exists password_hash;

-- Clerk can produce an account before it can produce an address — a social sign-in whose profile is
-- still loading, an instance configured for usernames — so the address is allowed to be absent.
--
-- The unique constraint goes with it, because it was never really about addresses: it was how Wesify
-- stopped one person having two accounts back when the address was the thing they signed in with.
-- Clerk decides that now, and enforcing it a second time here can only produce a disagreement Wesify
-- would lose — two Clerk identities that legitimately share an address would be refused by a
-- constraint Wesify has no business holding.
alter table users alter column email drop not null;
alter table users drop constraint if exists users_email_key;
