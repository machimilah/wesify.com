import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  LOGIN_LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  MIN_PASSWORD_LENGTH,
  SESSION_IDLE_MS,
  SESSION_MAX_AGE_MS,
  WELCOME_CREDITS,
} from "@/lib/shared/constants";
import { hashString, newId } from "@/lib/shared/random";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/shared/rules";
import type { UserRow, UserStatus } from "@/lib/shared/types";
import { enqueueEmail } from "../email/outbox";
import { DEFAULT_NOTIFICATION_PREFS, audit, track, type Ctx } from "./context";
import { Errors } from "./errors";
import { postLedger } from "./ledger";

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Usernames must be moderatable (§49): reserved words that impersonate staff or the platform and a
 * short list of slurs/obscenities are refused at signup, and admins can rename anyone later.
 */
const RESERVED = ["admin", "administrator", "wesify", "support", "moderator", "mod", "staff", "official", "system", "root", "help", "security", "tiktok", "instagram", "youtube"];
const BLOCKED_FRAGMENTS = ["fuck", "shit", "cunt", "nigg", "fagg", "rape", "nazi", "hitler", "porn", "whore", "slut", "kkk"];

export function usernameAllowed(username: string): boolean {
  const u = username.toLowerCase().replace(/[_.]/g, "");
  if (RESERVED.some((r) => u === r || u.startsWith(`${r}team`) || u.startsWith(`${r}official`) || u === `the${r}`)) return false;
  const leet = u.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  return !BLOCKED_FRAGMENTS.some((b) => leet.includes(b));
}

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12", "letmein123", "wesify1234", "welcome123", "abcdefghij", "0987654321", "qwerty1234",
]);

export function passwordIssue(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) return "weak";
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) return "weak";
  return null;
}

/** scrypt with a per-user salt (node:crypto). Format: `scrypt$N$salt$hash`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) {
    // Spend comparable time so response timing doesn't reveal which emails exist.
    scryptSync(password, "timing-equalizer", 64, { N: 16384, r: 8, p: 1 });
    return false;
  }
  const [, n, saltHex, hashHex] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type CreateUserInput = {
  username: string;
  isBot?: boolean;
  email?: string | null;
  password?: string | null;
  clerkUserId?: string | null;
  ageConfirmed?: boolean;
  acceptTerms?: boolean;
  cohort?: string | null;
};

export function createUser(ctx: Ctx, input: CreateUserInput): UserRow {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw Errors.invalid("Usernames are 3–20 characters: letters, numbers, _ or .");
  }
  if (!input.isBot && username.startsWith("sim.")) throw Errors.usernameTaken();
  if (!input.isBot && !usernameAllowed(username)) throw Errors.usernameNotAllowed();
  if (ctx.state.usernames[username]) throw Errors.usernameTaken();
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    if (!EMAIL_RE.test(email)) throw Errors.invalid("Enter a valid email address.");
    if (ctx.state.emails?.[email]) throw Errors.emailTaken();
  }
  if (input.password !== undefined && input.password !== null && passwordIssue(input.password)) throw Errors.weakPassword(MIN_PASSWORD_LENGTH);
  const now = ctx.now();
  const user: UserRow = {
    id: newId("usr"),
    username,
    avatarHue: 200 + (hashString(username) % 90),
    creditsBalance: 0,
    isBot: Boolean(input.isBot),
    referralCode: randomBytes(4).toString("hex").toUpperCase(),
    createdAt: now,
    updatedAt: now,
    email,
    emailVerifiedAt: null,
    passwordHash: input.password ? hashPassword(input.password) : null,
    clerkUserId: input.clerkUserId ?? null,
    role: "user",
    status: "active",
    statusReason: null,
    termsAcceptedAt: input.acceptTerms ? now : null,
    termsVersion: input.acceptTerms ? TERMS_VERSION : null,
    privacyAcceptedAt: input.acceptTerms ? now : null,
    privacyVersion: input.acceptTerms ? PRIVACY_VERSION : null,
    ageConfirmedAt: input.ageConfirmed ? now : null,
    onboardingCompletedAt: null,
    tutorialCompletedAt: null,
    lastActiveAt: now,
    cohort: input.cohort ?? null,
    referredByUserId: null,
    riskScore: 0,
    failedLogins: 0,
    lockedUntil: null,
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
    showOnLeaderboard: true,
    consent: null,
    deletedAt: null,
  };
  ctx.state.users[user.id] = user;
  ctx.state.usernames[username] = user.id;
  if (email) (ctx.state.emails ??= {})[email] = user.id;
  postLedger(ctx, { userId: user.id, type: "WELCOME_BONUS", amount: WELCOME_CREDITS, referenceType: "user", referenceId: user.id, description: "Welcome credits (play money)" });
  if (!user.isBot) {
    track(ctx, "signup", user.id, { method: input.clerkUserId ? "clerk" : email ? "password" : "username", cohort: user.cohort });
    if (email) enqueueEmail(ctx, user, { template: "welcome" });
  }
  return user;
}

// ---------------------------------------------------------------------------
// Sessions (§4)
// ---------------------------------------------------------------------------

export function createSession(ctx: Ctx, userId: string, meta: { deviceId?: string | null; ipHash?: string | null; userAgent?: string | null } = {}): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  ctx.state.sessions[hashToken(token)] = {
    tokenHash: hashToken(token),
    userId,
    createdAt: ctx.now(),
    expiresAt: now + SESSION_MAX_AGE_MS,
    lastSeenAt: now,
    deviceId: meta.deviceId ?? null,
    ipHash: meta.ipHash ?? null,
    userAgent: meta.userAgent?.slice(0, 200) ?? null,
  };
  return token;
}

/** Resolves a session cookie. Expired, idle, suspended and deleted sessions resolve to nobody. */
export function userForToken(ctx: Ctx, token: string | undefined | null): UserRow | null {
  if (!token) return null;
  const key = hashToken(token);
  const session = ctx.state.sessions[key];
  if (!session) return null;
  const now = Date.now();
  if ((session.expiresAt && now > session.expiresAt) || (session.lastSeenAt && now - session.lastSeenAt > SESSION_IDLE_MS)) {
    delete ctx.state.sessions[key];
    return null;
  }
  const user = ctx.state.users[session.userId];
  if (!user || user.status === "suspended" || user.status === "deleted") return null;
  if (!session.lastSeenAt || now - session.lastSeenAt > 60_000) session.lastSeenAt = now;
  return user;
}

export function sessionForToken(ctx: Ctx, token: string | undefined | null) {
  return token ? (ctx.state.sessions[hashToken(token)] ?? null) : null;
}

export function destroySession(ctx: Ctx, token: string) {
  delete ctx.state.sessions[hashToken(token)];
}

/** Signs a user out everywhere, optionally keeping the current session (§43 session invalidation). */
export function destroyUserSessions(ctx: Ctx, userId: string, keepTokenHash?: string) {
  for (const [k, s] of Object.entries(ctx.state.sessions)) if (s.userId === userId && k !== keepTokenHash) delete ctx.state.sessions[k];
}

export function listSessions(ctx: Ctx, userId: string, currentHash?: string) {
  return Object.entries(ctx.state.sessions)
    .filter(([, s]) => s.userId === userId)
    .map(([k, s]) => ({ id: k.slice(0, 16), createdAt: s.createdAt, lastSeenAt: s.lastSeenAt ?? null, userAgent: s.userAgent ?? null, current: k === currentHash }))
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
}

export function revokeSession(ctx: Ctx, userId: string, idPrefix: string) {
  for (const [k, s] of Object.entries(ctx.state.sessions)) if (s.userId === userId && k.startsWith(idPrefix)) delete ctx.state.sessions[k];
}

// ---------------------------------------------------------------------------
// Password login, lockout, verification and reset (§4, §43)
// ---------------------------------------------------------------------------

export function findUserByLogin(ctx: Ctx, login: string): UserRow | null {
  const l = login.trim().toLowerCase();
  const id = l.includes("@") ? ctx.state.emails?.[l] : ctx.state.usernames[l];
  const user = id ? ctx.state.users[id] : null;
  return user && !user.isBot ? user : null;
}

export function login(ctx: Ctx, input: { login: string; password: string }): UserRow {
  const user = findUserByLogin(ctx, input.login);
  const now = Date.now();
  if (user?.lockedUntil && user.lockedUntil > now) throw Errors.accountLocked(Math.ceil((user.lockedUntil - now) / 60_000));
  const ok = verifyPassword(input.password, user?.passwordHash);
  if (!user || !ok || user.status === "deleted") {
    if (user) {
      user.failedLogins = (user.failedLogins ?? 0) + 1;
      if (user.failedLogins >= MAX_FAILED_LOGINS) {
        // Doubles for each further lockout, capped at 24h.
        const factor = 2 ** Math.min(6, user.failedLogins - MAX_FAILED_LOGINS);
        user.lockedUntil = now + Math.min(LOGIN_LOCKOUT_MS * factor, 86_400_000);
        audit(ctx, { actor: null, action: "user.locked", entityType: "user", entityId: user.id, metadata: { failedLogins: user.failedLogins } });
      }
    }
    throw Errors.invalidCredentials();
  }
  if (user.status === "suspended") throw Errors.accountSuspended();
  user.failedLogins = 0;
  user.lockedUntil = null;
  track(ctx, "login", user.id);
  return user;
}

export function issueEmailToken(ctx: Ctx, userId: string, kind: "verify" | "reset"): string {
  const token = randomBytes(32).toString("base64url");
  for (const [k, t] of Object.entries(ctx.state.emailTokens)) if (t.userId === userId && t.kind === kind && !t.usedAt) delete ctx.state.emailTokens[k];
  ctx.state.emailTokens[hashToken(token)] = { userId, kind, expiresAt: Date.now() + (kind === "verify" ? 48 : 1) * 3_600_000, usedAt: null };
  return token;
}

function consumeEmailToken(ctx: Ctx, token: string, kind: "verify" | "reset") {
  const row = ctx.state.emailTokens[hashToken(token)];
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < Date.now()) throw Errors.tokenInvalid();
  row.usedAt = Date.now();
  const user = ctx.state.users[row.userId];
  if (!user || user.status === "deleted") throw Errors.tokenInvalid();
  return user;
}

export function sendVerification(ctx: Ctx, user: UserRow) {
  if (!user.email || user.emailVerifiedAt) return;
  enqueueEmail(ctx, user, { template: "verify", token: issueEmailToken(ctx, user.id, "verify") });
}

export function verifyEmail(ctx: Ctx, token: string) {
  const user = consumeEmailToken(ctx, token, "verify");
  user.emailVerifiedAt ??= ctx.now();
  audit(ctx, { actor: user.id, action: "user.verify_email", entityType: "user", entityId: user.id });
  track(ctx, "email_verified", user.id);
  return user;
}

/** Always succeeds from the caller's point of view, so it can't be used to discover accounts. */
export function requestPasswordReset(ctx: Ctx, email: string) {
  const user = findUserByLogin(ctx, email);
  if (!user || !user.email || user.status === "deleted" || user.clerkUserId) return;
  enqueueEmail(ctx, user, { template: "reset", token: issueEmailToken(ctx, user.id, "reset") });
  audit(ctx, { actor: null, action: "user.password_reset_requested", entityType: "user", entityId: user.id });
}

export function resetPassword(ctx: Ctx, token: string, password: string) {
  if (passwordIssue(password)) throw Errors.weakPassword(MIN_PASSWORD_LENGTH);
  const user = consumeEmailToken(ctx, token, "reset");
  user.passwordHash = hashPassword(password);
  user.failedLogins = 0;
  user.lockedUntil = null;
  user.emailVerifiedAt ??= ctx.now(); // they proved they own the inbox
  destroyUserSessions(ctx, user.id);
  enqueueEmail(ctx, user, { template: "password-changed" });
  audit(ctx, { actor: user.id, action: "user.password_reset", entityType: "user", entityId: user.id });
  return user;
}

export function changePassword(ctx: Ctx, user: UserRow, input: { current: string | null; next: string; keepTokenHash?: string }) {
  if (user.passwordHash && !verifyPassword(input.current ?? "", user.passwordHash)) throw Errors.invalid("Your current password is wrong.");
  if (passwordIssue(input.next)) throw Errors.weakPassword(MIN_PASSWORD_LENGTH);
  user.passwordHash = hashPassword(input.next);
  destroyUserSessions(ctx, user.id, input.keepTokenHash);
  enqueueEmail(ctx, user, { template: "password-changed" });
  audit(ctx, { actor: user.id, action: "user.change_password", entityType: "user", entityId: user.id });
}

/** Lets an account created before email login add an email (and optionally a password). */
export function setEmail(ctx: Ctx, user: UserRow, email: string) {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw Errors.invalid("Enter a valid email address.");
  const owner = ctx.state.emails[e];
  if (owner && owner !== user.id) throw Errors.emailTaken();
  if (user.email) delete ctx.state.emails[user.email];
  user.email = e;
  user.emailVerifiedAt = null;
  ctx.state.emails[e] = user.id;
  sendVerification(ctx, user);
  audit(ctx, { actor: user.id, action: "user.set_email", entityType: "user", entityId: user.id });
}

export function recordAcceptance(ctx: Ctx, user: UserRow, input: { ageConfirmed: boolean; acceptTerms: boolean }) {
  const now = ctx.now();
  if (input.ageConfirmed) user.ageConfirmedAt ??= now;
  if (input.acceptTerms) {
    user.termsAcceptedAt = now;
    user.termsVersion = TERMS_VERSION;
    user.privacyAcceptedAt = now;
    user.privacyVersion = PRIVACY_VERSION;
  }
  audit(ctx, { actor: user.id, action: "user.accept_terms", entityType: "user", entityId: user.id, metadata: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION } });
}

// ---------------------------------------------------------------------------
// Deletion and export (§4, §44)
// ---------------------------------------------------------------------------

/**
 * Deletes an account: personal data (email, password, sessions, connected accounts, tokens,
 * notifications, consent) is erased and the username is replaced. Ledger rows, trades and
 * positions stay, anonymized, because other users' settlements and market history depend on them.
 */
export function deleteAccount(ctx: Ctx, user: UserRow, actor: string, reason?: string | null) {
  if (user.status === "deleted") return;
  const email = user.email;
  if (email) enqueueEmail(ctx, user, { template: "account-deleted" }, { toOverride: email });
  delete ctx.state.usernames[user.username];
  if (email) delete ctx.state.emails[email];
  const placeholder = `deleted_${user.id.slice(-8)}`;
  user.username = placeholder;
  user.email = null;
  user.emailVerifiedAt = null;
  user.passwordHash = null;
  user.clerkUserId = null;
  user.status = "deleted";
  user.statusReason = "Deleted by request";
  user.deletedAt = ctx.now();
  user.consent = null;
  user.showOnLeaderboard = false;
  destroyUserSessions(ctx, user.id);
  for (const a of ctx.state.socialAccounts) {
    if (a.userId !== user.id) continue;
    a.status = "revoked";
    a.accessTokenEncrypted = null;
    a.refreshTokenEncrypted = null;
  }
  ctx.state.notifications = ctx.state.notifications.filter((n) => n.userId !== user.id);
  for (const [k, t] of Object.entries(ctx.state.emailTokens)) if (t.userId === user.id) delete ctx.state.emailTokens[k];
  for (const d of Object.values(ctx.state.devices)) d.userIds = d.userIds.filter((u) => u !== user.id);
  for (const t of Object.values(ctx.state.supportTickets)) if (t.userId === user.id) t.email = null;
  audit(ctx, { actor, action: "user.delete", entityType: "user", entityId: user.id, metadata: { reason: reason ?? null } });
  track(ctx, "account_deleted", user.id, { reason: reason ?? null });
}

/** Everything Wesify holds about a user, as JSON (§4 data export, §44 data-access process). */
export function exportUserData(ctx: Ctx, user: UserRow) {
  const s = ctx.state;
  const strip = <T extends object>(o: T, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  return {
    exportedAt: new Date().toISOString(),
    note: "W$ (Wesify Credits) are play money with no monetary value.",
    account: strip(user, ["passwordHash", "failedLogins", "lockedUntil", "riskScore"]),
    sessions: listSessions(ctx, user.id),
    ledger: s.ledger.filter((l) => l.userId === user.id),
    trades: s.trades.filter((t) => t.userId === user.id),
    positions: Object.values(s.positions).filter((p) => p.userId === user.id),
    notifications: s.notifications.filter((n) => n.userId === user.id),
    connectedAccounts: s.socialAccounts
      .filter((a) => a.userId === user.id)
      .map((a) => strip(a, ["accessTokenEncrypted", "refreshTokenEncrypted", "simSeed"])),
    creatorApplications: Object.values(s.creatorApplications).filter((a) => a.userId === user.id),
    supportTickets: Object.values(s.supportTickets).filter((t) => t.userId === user.id).map((t) => ({ ...t, replies: t.replies.filter((r) => !r.internal) })),
    feedback: s.feedback.filter((f) => f.userId === user.id),
    referrals: s.referrals.filter((r) => r.referrerId === user.id || r.refereeId === user.id),
    events: s.events.filter((e) => e.userId === user.id),
  };
}

// ---------------------------------------------------------------------------
// Admin actions (§33)
// ---------------------------------------------------------------------------

export function setUserStatus(ctx: Ctx, input: { userId: string; status: Exclude<UserStatus, "deleted">; reason: string; actor: string }) {
  const user = ctx.state.users[input.userId];
  if (!user || user.isBot) throw Errors.notFound("User");
  if (user.status === "deleted") throw Errors.invalid("This account was deleted.");
  const before = user.status;
  user.status = input.status;
  user.statusReason = input.status === "active" ? null : input.reason;
  if (input.status === "suspended") destroyUserSessions(ctx, user.id);
  audit(ctx, { actor: input.actor, action: `user.${input.status === "active" ? "reinstate" : input.status}`, entityType: "user", entityId: user.id, metadata: { before, reason: input.reason } });
  return user;
}

export function renameUser(ctx: Ctx, input: { userId: string; username: string; actor: string }) {
  const user = ctx.state.users[input.userId];
  if (!user) throw Errors.notFound("User");
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw Errors.invalid("Usernames are 3–20 characters: letters, numbers, _ or .");
  if (ctx.state.usernames[username]) throw Errors.usernameTaken();
  const before = user.username;
  delete ctx.state.usernames[before];
  user.username = username;
  ctx.state.usernames[username] = user.id;
  audit(ctx, { actor: input.actor, action: "user.rename", entityType: "user", entityId: user.id, metadata: { before, after: username } });
}

export function adjustBalance(ctx: Ctx, input: { userId: string; amount: number; reason: string; actor: string; refund?: { tradeId?: string } }) {
  const user = ctx.state.users[input.userId];
  if (!user) throw Errors.notFound("User");
  if (!Number.isFinite(input.amount) || input.amount === 0) throw Errors.invalid("Amount must be non-zero.");
  if (Math.abs(input.amount) > 1_000_000) throw Errors.invalid("Adjustments are limited to W$1,000,000.");
  if (user.creditsBalance + input.amount < 0) throw Errors.invalid("Balance cannot go negative.");
  if (!input.reason.trim()) throw Errors.invalid("Give a reason.");
  const isRefund = Boolean(input.refund);
  if (isRefund && input.amount < 0) throw Errors.invalid("A refund must be positive.");
  const row = postLedger(ctx, {
    userId: user.id,
    type: isRefund ? "ADMIN_REFUND" : "ADMIN_ADJUSTMENT",
    amount: input.amount,
    referenceType: isRefund && input.refund?.tradeId ? "trade" : "admin",
    referenceId: input.refund?.tradeId ?? input.actor,
    description: `${isRefund ? "Refund" : "Adjustment"} by Wesify: ${input.reason.trim()}`,
  });
  audit(ctx, { actor: input.actor, action: isRefund ? "user.refund" : "user.adjust_balance", entityType: "user", entityId: user.id, metadata: { amount: input.amount, reason: input.reason, tradeId: input.refund?.tradeId ?? null } });
  return row;
}
