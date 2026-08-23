-- Password resets: the way back in for someone who cannot get in.
--
-- Without this table BO's only answer to a forgotten password is "make another account", which loses
-- the person their workspace. It is the single missing feature most certain to generate support work
-- on the first day of real use.
--
-- Only the hash of the token is stored, for the same reason sessions store only a hash: a stolen
-- database must not hand anyone a working link into every account. `used_at` makes a link single-use,
-- and `expires_at` makes an old one worthless even if it is never used at all — a reset link sits in
-- an inbox forever, so it has to stop working on its own.

create table if not exists password_resets (
  token_hash text        primary key,
  user_id    text        not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- Issuing a new link invalidates the account's older ones, which is a lookup by user rather than by
-- token, and the primary key above cannot answer it.
create index if not exists password_resets_user_id_idx on password_resets (user_id);
