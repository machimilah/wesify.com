import { describe, expect, it } from "vitest";
import { buy } from "@/server/world/trading";
import { createSimulatedMarket } from "@/server/world/seed";
import { setFlag } from "@/server/world/flags";
import { evaluateReferral, attachReferral } from "@/server/world/referrals";
import {
  changePassword,
  createSession,
  createUser,
  deleteAccount,
  exportUserData,
  issueEmailToken,
  login,
  requestPasswordReset,
  resetPassword,
  usernameAllowed,
  userForToken,
  verifyEmail,
  verifyPassword,
} from "@/server/world/users";
import { testWorld } from "../helpers";

const PW = "correct horse battery";

describe("accounts (§4)", () => {
  it("prevents duplicate emails and usernames, validates and moderates usernames", () => {
    const { ctx } = testWorld();
    createUser(ctx, { username: "first", email: "A@Example.com", password: PW });
    expect(() => createUser(ctx, { username: "second", email: "a@example.com", password: PW })).toThrow(/already exists/);
    expect(() => createUser(ctx, { username: "FIRST", email: "b@example.com", password: PW })).toThrow(/taken/);
    expect(() => createUser(ctx, { username: "x", email: "c@example.com", password: PW })).toThrow(/3–20/);
    expect(usernameAllowed("wesify_official")).toBe(false);
    expect(usernameAllowed("admin")).toBe(false);
    expect(usernameAllowed("maya.moves")).toBe(true);
    expect(() => createUser(ctx, { username: "sh1tposter", email: "d@example.com", password: PW })).toThrow(/isn't allowed/);
  });

  it("rejects weak passwords and stores only a hash", () => {
    const { ctx } = testWorld();
    expect(() => createUser(ctx, { username: "weak", email: "w@example.com", password: "password1" })).toThrow(/at least 10/);
    const u = createUser(ctx, { username: "strong", email: "s@example.com", password: PW });
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(u.passwordHash).not.toContain(PW);
    expect(verifyPassword(PW, u.passwordHash)).toBe(true);
    expect(verifyPassword("wrong password!!", u.passwordHash)).toBe(false);
  });

  it("records terms, privacy and age acceptance with versions and a creation timestamp", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "agreed", email: "ok@example.com", password: PW, ageConfirmed: true, acceptTerms: true });
    expect(u.termsAcceptedAt).toBe(u.createdAt);
    expect(u.termsVersion).toBeTruthy();
    expect(u.privacyAcceptedAt).toBe(u.createdAt);
    expect(u.ageConfirmedAt).toBe(u.createdAt);
    expect(ctx.state.ledger.find((l) => l.userId === u.id)?.type).toBe("WELCOME_BONUS");
  });

  it("locks an account after repeated failed logins", () => {
    const { ctx } = testWorld();
    createUser(ctx, { username: "target", email: "t@example.com", password: PW });
    for (let i = 0; i < 5; i++) expect(() => login(ctx, { login: "t@example.com", password: "nope nope nope" })).toThrow(/don't match/);
    expect(() => login(ctx, { login: "t@example.com", password: PW })).toThrow(/Too many attempts/);
  });

  it("logs in by email or username and blocks suspended accounts", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "normal", email: "n@example.com", password: PW });
    expect(login(ctx, { login: "N@example.com", password: PW }).id).toBe(u.id);
    expect(login(ctx, { login: "normal", password: PW }).id).toBe(u.id);
    const token = createSession(ctx, u.id);
    expect(userForToken(ctx, token)?.id).toBe(u.id);
    u.status = "suspended";
    expect(userForToken(ctx, token)).toBeNull();
    expect(() => login(ctx, { login: "normal", password: PW })).toThrow(/suspended/);
  });

  it("expires sessions", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "sleepy" });
    const token = createSession(ctx, u.id);
    const s = Object.values(ctx.state.sessions)[0];
    s.expiresAt = Date.now() - 1;
    expect(userForToken(ctx, token)).toBeNull();
    expect(Object.keys(ctx.state.sessions)).toHaveLength(0);
  });

  it("verifies email and resets passwords with single-use tokens", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "forgetful", email: "f@example.com", password: PW });
    const verify = issueEmailToken(ctx, u.id, "verify");
    verifyEmail(ctx, verify);
    expect(u.emailVerifiedAt).toBeTruthy();
    expect(() => verifyEmail(ctx, verify)).toThrow(/expired/);

    const s1 = createSession(ctx, u.id);
    requestPasswordReset(ctx, "f@example.com");
    expect(ctx.state.outbox.some((e) => e.template === "reset" && e.to === "f@example.com")).toBe(true);
    const reset = issueEmailToken(ctx, u.id, "reset");
    resetPassword(ctx, reset, "a brand new passphrase");
    expect(userForToken(ctx, s1)).toBeNull(); // every session signed out
    expect(login(ctx, { login: "forgetful", password: "a brand new passphrase" }).id).toBe(u.id);
    // Unknown emails get the same silent success.
    expect(() => requestPasswordReset(ctx, "nobody@example.com")).not.toThrow();
  });

  it("changing the password signs out other devices", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "mover", email: "m@example.com", password: PW });
    const keep = createSession(ctx, u.id);
    const other = createSession(ctx, u.id);
    const keepHash = Object.keys(ctx.state.sessions)[0];
    changePassword(ctx, u, { current: PW, next: "another long passphrase", keepTokenHash: keepHash });
    expect(userForToken(ctx, keep)?.id).toBe(u.id);
    expect(userForToken(ctx, other)).toBeNull();
  });

  it("deletes an account: erases personal data, frees the username, keeps the ledger consistent", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "leaving", email: "l@example.com", password: PW });
    const { market } = createSimulatedMarket(ctx, { scenario: "stable-mid", openedAt: ctx.now(), seed: 3, ageHours: 1 });
    buy(ctx, { userId: u.id, marketId: market.id, outcomeId: ctx.state.outcomes[market.id][0].id, credits: 100 });
    const token = createSession(ctx, u.id);
    const exported = exportUserData(ctx, u);
    expect(JSON.stringify(exported)).not.toContain("scrypt$");
    expect(exported.trades).toHaveLength(1);
    deleteAccount(ctx, u, u.id, "no time");
    expect(u.email).toBeNull();
    expect(u.passwordHash).toBeNull();
    expect(u.status).toBe("deleted");
    expect(userForToken(ctx, token)).toBeNull();
    expect(ctx.state.emails["l@example.com"]).toBeUndefined();
    expect(() => createUser(ctx, { username: "leaving", email: "l@example.com", password: PW })).not.toThrow();
    expect(ctx.state.trades.some((t) => t.userId === u.id)).toBe(true); // anonymized, not removed
  });
});

describe("referrals (§30)", () => {
  function twoMarkets(ctx: ReturnType<typeof testWorld>["ctx"]) {
    return [1, 2].map((seed) => createSimulatedMarket(ctx, { scenario: "stable-mid", openedAt: ctx.now(), seed: 100 + seed, ageHours: 1 }).market);
  }

  it("pays both sides only after the new user verifies and trades 3 times in 2 markets", () => {
    const { ctx } = testWorld();
    setFlag(ctx, "referrals", { enabled: true }, "test");
    const referrer = createUser(ctx, { username: "inviter" });
    const referee = createUser(ctx, { username: "invitee", email: "i@example.com", password: PW });
    attachReferral(ctx, referee.id, referrer.referralCode, { deviceId: "d-new", ipHash: "ip-new" });
    const [m1, m2] = twoMarkets(ctx);
    const o = (m: typeof m1, i: number) => ctx.state.outcomes[m.id][i].id;
    buy(ctx, { userId: referee.id, marketId: m1.id, outcomeId: o(m1, 0), credits: 20 });
    buy(ctx, { userId: referee.id, marketId: m1.id, outcomeId: o(m1, 1), credits: 20 });
    buy(ctx, { userId: referee.id, marketId: m2.id, outcomeId: o(m2, 0), credits: 20 });
    expect(ctx.state.referrals[0].status).toBe("pending"); // not verified yet
    referee.emailVerifiedAt = ctx.now();
    evaluateReferral(ctx, referee.id);
    expect(ctx.state.referrals[0].status).toBe("rewarded");
    expect(ctx.state.ledger.filter((l) => l.type === "REFERRAL")).toHaveLength(2);
  });

  it("rejects referrals from the same device", () => {
    const { ctx } = testWorld();
    const referrer = createUser(ctx, { username: "farmer" });
    ctx.state.devices.shared = { userIds: [referrer.id], ipHashes: [], firstSeenAt: 0, lastSeenAt: 0 };
    const referee = createUser(ctx, { username: "sock" });
    const r = attachReferral(ctx, referee.id, referrer.referralCode, { deviceId: "shared", ipHash: null });
    expect(r?.status).toBe("rejected");
  });
});
