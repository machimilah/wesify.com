import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { query, queryOne } from './db.mjs'

/**
 * Wesify's own user management.
 *
 * Written rather than bought, deliberately: the account is where Wesify's data model starts, and handing
 * it to a provider means every later question about workspaces, membership and deletion is answered
 * on someone else's terms. The parts that are genuinely dangerous to write yourself are the parts
 * that are done here by the platform — scrypt for hashing, a CSPRNG for tokens, constant-time
 * comparison for both — rather than by hand.
 *
 * Two rules the rest of the server depends on:
 *   1. A plaintext password is never stored, logged, or returned.
 *   2. A session token exists exactly once, in the response that creates it. Only its hash is kept,
 *      so a stolen database yields no usable session.
 */

const scryptAsync = promisify(scrypt)

const KEY_LENGTH = 64
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const SESSION_DAYS = 30
/** Long enough that guessing is hopeless, short enough to sit in a header. */
const TOKEN_BYTES = 32

export const MIN_PASSWORD_LENGTH = 10
/** scrypt cost is paid per attempt, so an unbounded password is a way to make Wesify do work for free. */
export const MAX_PASSWORD_LENGTH = 200

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** Deliberately permissive: the only real test of an address is sending mail to it. */
export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) && value.length <= 254
}

export function checkPassword(password, email) {
  const value = String(password ?? '')
  if (value.length < MIN_PASSWORD_LENGTH) throw Object.assign(new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`), { status: 400 })
  if (value.length > MAX_PASSWORD_LENGTH) throw Object.assign(new Error(`Passwords are limited to ${MAX_PASSWORD_LENGTH} characters.`), { status: 400 })
  if (email && value.toLowerCase() === normalizeEmail(email)) throw Object.assign(new Error('Your password cannot be your email address.'), { status: 400 })
  return value
}

/** `scrypt$N$r$p$salt$hash` — the parameters travel with the hash so they can be raised later. */
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? '').split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const derived = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

const tokenHash = token => createHash('sha256').update(String(token)).digest('hex')

export async function registerUser(email, password) {
  const address = normalizeEmail(email)
  if (!looksLikeEmail(address)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 })
  checkPassword(password, address)
  const existing = await queryOne('select id from users where email = $1', [address])
  // Said plainly. Hiding it behind a generic message only moves the disclosure to the signup form,
  // which will refuse the address anyway.
  if (existing) throw Object.assign(new Error('That email already has an account. Sign in instead.'), { status: 409 })
  const id = randomUUID()
  await query('insert into users (id, email, password_hash) values ($1, $2, $3)', [id, address, await hashPassword(password)])
  return { id, email: address }
}

/**
 * One message for a wrong address and a wrong password.
 *
 * The work is done either way, so the two cases also take the same time: a login form that answers
 * faster for an unknown address is an endpoint for enumerating who has an account.
 */
const decoyHash = await hashPassword(randomBytes(24).toString('hex'))

export async function authenticate(email, password) {
  const address = normalizeEmail(email)
  const user = await queryOne('select id, email, password_hash from users where email = $1', [address])
  const ok = await verifyPassword(String(password ?? ''), user?.password_hash ?? decoyHash)
  if (!user || !ok) throw Object.assign(new Error('That email and password do not match.'), { status: 401 })
  return { id: user.id, email: user.email }
}

export async function createSession(userId) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash(token), userId, expiresAt])
  return { token, expiresAt }
}

/** The user behind a token, or null. Expired sessions are removed as they are met. */
export async function sessionUser(token) {
  if (!token) return null
  const hash = tokenHash(token)
  const row = await queryOne(
    'select s.token_hash, s.expires_at, u.id, u.email from sessions s join users u on u.id = s.user_id where s.token_hash = $1',
    [hash],
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await query('delete from sessions where token_hash = $1', [hash])
    return null
  }
  await query('update sessions set last_seen_at = now() where token_hash = $1', [hash])
  return { id: row.id, email: row.email }
}

export async function destroySession(token) {
  if (!token) return
  await query('delete from sessions where token_hash = $1', [tokenHash(token)])
}

/** Signing out everywhere: what a person expects after losing a laptop or changing a password. */
export async function destroyAllSessions(userId) {
  await query('delete from sessions where user_id = $1', [userId])
}

/**
 * A reset link is a session token that has not been earned yet, so it is treated like one.
 *
 * Stored as a hash, single use, and short-lived: a reset link lands in an inbox and stays there, so
 * the hour is what keeps a mailbox read two years from now from being a way into the account.
 */
const RESET_MINUTES = 60

/**
 * Issues a reset link for `email`, or nothing if no such account exists.
 *
 * Returning null rather than throwing is the point: the endpoint above answers the same way either
 * way, because an endpoint that says "no account with that address" is a way to find out who has one.
 */
export async function beginPasswordReset(email) {
  const address = normalizeEmail(email)
  const user = await queryOne('select id, email from users where email = $1', [address])
  if (!user) return null
  // The newest link is the only one that works. Someone who asks twice because the first mail was
  // slow should not be left with two live keys to their account.
  await query('delete from password_resets where user_id = $1 and used_at is null', [user.id])
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60 * 1000)
  await query('insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash(token), user.id, expiresAt])
  return { token, expiresAt, user: { id: user.id, email: user.email } }
}

/**
 * Spends a reset link: sets the new password, burns the link, and signs the account out everywhere.
 *
 * The sign-out is not politeness. Someone resetting a password may be doing it because another person
 * has their account, and leaving that person's session alive would make the reset pointless.
 */
export async function completePasswordReset(token, password) {
  const expired = Object.assign(new Error('That reset link has expired or has already been used. Ask for a new one.'), { status: 400 })
  if (!token) throw expired
  const row = await queryOne(
    'select r.token_hash, r.expires_at, r.used_at, u.id, u.email from password_resets r join users u on u.id = r.user_id where r.token_hash = $1',
    [tokenHash(token)],
  )
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) throw expired
  checkPassword(password, row.email)
  await query('update users set password_hash = $1 where id = $2', [await hashPassword(password), row.id])
  await query('update password_resets set used_at = now() where token_hash = $1', [row.token_hash])
  await destroyAllSessions(row.id)
  return { id: row.id, email: row.email }
}

export async function claimWorkspace(workspaceId, userId, name = '') {
  const existing = await queryOne('select id, owner_id from workspaces where id = $1', [workspaceId])
  if (existing) {
    if (existing.owner_id !== userId) throw Object.assign(new Error('That workspace belongs to someone else.'), { status: 403 })
    return existing
  }
  await query('insert into workspaces (id, owner_id, name) values ($1, $2, $3)', [workspaceId, userId, String(name).slice(0, 120)])
  await query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [workspaceId, userId, 'owner'])
  return { id: workspaceId, owner_id: userId }
}

/** Whether this person may act on this workspace at all, and as what. */
export async function membership(workspaceId, userId) {
  return queryOne('select role from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, userId])
}

export async function workspacesFor(userId) {
  const result = await query(
    'select w.id, w.name, m.role, w.created_at from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.created_at desc',
    [userId],
  )
  return result.rows
}
