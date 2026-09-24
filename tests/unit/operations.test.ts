import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decodeBackup, encodeBackup, readBackup, runBackup, verifyBackup } from "@/server/backup";
import { validateEnv } from "@/server/env";
import { flagEnabled, setFlag } from "@/server/world/flags";
import { checkIntegrity } from "@/server/world/integrity";
import { businessMetrics, cohorts, founderDashboard, funnel, modelAnalytics, recordActivity } from "@/server/world/metrics";
import { feed } from "@/server/world/queries";
import { createSimulatedMarket } from "@/server/world/seed";
import { migrate, emptyState } from "@/server/world/state";
import { createTicket } from "@/server/world/support";
import { buy } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { HOUR, testWorld } from "../helpers";

describe("integrity checks (§10 reconciliation)", () => {
  it("passes on a healthy world and catches a tampered balance", () => {
    const { ctx } = testWorld();
    const u = createUser(ctx, { username: "audited" });
    const { market } = createSimulatedMarket(ctx, { scenario: "stable-mid", openedAt: ctx.now(), seed: 4, ageHours: 1 });
    buy(ctx, { userId: u.id, marketId: market.id, outcomeId: ctx.state.outcomes[market.id][1].id, credits: 250 });
    expect(checkIntegrity(ctx.state).ok).toBe(true);
    u.creditsBalance += 5;
    const report = checkIntegrity(ctx.state);
    expect(report.ok).toBe(false);
    expect(report.issues[0].check).toBe("balance_mismatch");
  });

  it("catches market state that doesn't match the trade history", () => {
    const { ctx } = testWorld();
    const { market } = createSimulatedMarket(ctx, { scenario: "stable-mid", openedAt: ctx.now(), seed: 4, ageHours: 1 });
    ctx.state.outcomes[market.id][0].quantity += 10;
    expect(checkIntegrity(ctx.state).issues.some((i) => i.check === "market_state")).toBe(true);
  });
});

describe("backups (§55)", () => {
  it("round-trips compressed and encrypted backups and verifies them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wesify-backup-"));
    vi.stubEnv("BACKUP_DIR", dir);
    const { ctx } = testWorld();
    createUser(ctx, { username: "saved" });
    const plain = runBackup(ctx.state);
    expect(verifyBackup(plain.file).ok).toBe(true);
    vi.stubEnv("BACKUP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const enc = encodeBackup(JSON.stringify(ctx.state));
    expect(enc.subarray(0, 8).toString()).toBe("WSFYENC1");
    expect(JSON.parse(decodeBackup(enc)).users).toBeTruthy();
    const encrypted = runBackup(ctx.state, Date.now() + 1000);
    expect(readBackup(encrypted.file).users[Object.keys(ctx.state.users)[0]].username).toBe("saved");
    // A corrupted file fails its checksum.
    fs.appendFileSync(encrypted.file, "x");
    expect(() => readBackup(encrypted.file)).toThrow(/Checksum/);
    vi.unstubAllEnvs();
  });
});

describe("migrations (§34)", () => {
  it("upgrades a v1 state: paused flag becomes PAUSED status, new tables exist", () => {
    const old = emptyState("main", { epochReal: 0, epochWorld: 0, scale: 1 }) as unknown as Record<string, unknown>;
    delete old.schemaVersion;
    delete old.emails;
    delete old.featureFlags;
    (old.markets as Record<string, unknown>).m1 = { id: "m1", status: "OPEN", tradingPaused: true, pausedReason: "x" };
    const s = migrate(old as never);
    expect(s.schemaVersion).toBe(3);
    expect(s.markets.m1.status).toBe("PAUSED");
    expect("tradingPaused" in s.markets.m1).toBe(false);
    expect(s.emails).toEqual({});
    expect(s.featureFlags).toEqual({});
  });
});

describe("feature flags (§57)", () => {
  it("rolls out to a stable subset of users", () => {
    const { ctx } = testWorld();
    setFlag(ctx, "firstTradeTutorial", { rollout: 30 }, "admin");
    const hits = Array.from({ length: 1000 }, (_, i) => flagEnabled(ctx, "firstTradeTutorial", `usr_${i}`)).filter(Boolean).length;
    expect(hits).toBeGreaterThan(200);
    expect(hits).toBeLessThan(400);
    expect(flagEnabled(ctx, "firstTradeTutorial", "usr_7")).toBe(flagEnabled(ctx, "firstTradeTutorial", "usr_7"));
    expect(flagEnabled(ctx, "firstTradeTutorial", null)).toBe(false);
  });
});

describe("environment validation (§35)", () => {
  it("requires production secrets and paired keys", () => {
    const prod = validateEnv({ NODE_ENV: "production" });
    expect(prod.ok).toBe(false);
    expect(prod.errors.join()).toMatch(/SESSION_SECRET/);
    const half = validateEnv({ NODE_ENV: "development", CLERK_SECRET_KEY: "sk_test" });
    expect(half.errors.join()).toMatch(/Clerk/);
    expect(validateEnv({ NODE_ENV: "development" }).ok).toBe(true);
  });
});

describe("feed and search (§6, §23, §32)", () => {
  it("ranks exact handle matches first, paginates, and limits one creator's share of the top", () => {
    const { ctx } = testWorld();
    for (let i = 0; i < 6; i++) createSimulatedMarket(ctx, { scenario: "viral-spike", openedAt: ctx.now(), seed: 200 + i, handle: "samecreator", ageHours: 1 });
    for (let i = 0; i < 6; i++) createSimulatedMarket(ctx, { scenario: "flat", openedAt: ctx.now(), seed: 300 + i, handle: `other${i}`, ageHours: 1 });
    createSimulatedMarket(ctx, { scenario: "flat", openedAt: ctx.now(), seed: 400, handle: "maya", ageHours: 1 });
    createSimulatedMarket(ctx, { scenario: "flat", openedAt: ctx.now(), seed: 401, handle: "mayamoves", ageHours: 1 });
    const top = feed(ctx, { sort: "trending" }).open.slice(0, 6);
    expect(top.filter((m) => m.video.creatorHandle === "samecreator").length).toBeLessThanOrEqual(2);
    const search = feed(ctx, { q: "@maya" }).open;
    expect(search[0].video.creatorHandle).toBe("maya");
    const page = feed(ctx, { limit: 5 });
    expect(page.open).toHaveLength(5);
    expect(page.nextOffset).toBe(5);
    expect(feed(ctx, { q: "nothing-matches-this" }).open).toHaveLength(0);
  });
});

describe("support and reports (§48, §49)", () => {
  it("reporting a market opens a ticket and a review flag", () => {
    const { ctx } = testWorld();
    const { market } = createSimulatedMarket(ctx, { scenario: "flat", openedAt: ctx.now(), seed: 9, ageHours: 1 });
    const t = createTicket(ctx, { userId: null, email: "a@b.co", category: "report_market", subject: "fake likes", body: "looks bought to me", entityType: "market", entityId: market.id });
    expect(t.priority).toBe("high");
    expect(ctx.state.riskFlags.some((f) => f.entityId === market.id && f.reason === "Reported by a user")).toBe(true);
  });
});

describe("metrics (§39–§41, §67)", () => {
  it("computes business, cohort, funnel, founder and model metrics", async () => {
    const t = testWorld();
    const u = createUser(t.ctx, { username: "measured" });
    recordActivity(t.ctx, u.id, "visit1", { marketView: true });
    const { market } = createSimulatedMarket(t.ctx, { scenario: "viral-spike", openedAt: t.ctx.now(), seed: 31, ageHours: 1 });
    buy(t.ctx, { userId: u.id, marketId: market.id, outcomeId: t.ctx.state.outcomes[market.id][2].id, credits: 100 });
    buy(t.ctx, { userId: u.id, marketId: market.id, outcomeId: t.ctx.state.outcomes[market.id][3].id, credits: 100 });
    t.advance(25 * HOUR);
    await t.world.tick();
    const b = businessMetrics(t.ctx);
    expect(b.registeredUsers).toBe(1);
    expect(b.firstTradeConversion).toBe(1);
    expect(b.secondTradeConversion).toBe(1);
    expect(funnel(t.ctx).find((f) => f.step === "Second trade")?.users).toBe(1);
    expect(cohorts(t.ctx).length).toBe(8);
    expect(founderDashboard(t.ctx).marketsLive).toBe(0);
    const model = modelAnalytics(t.ctx);
    expect(model.overall.n).toBeGreaterThan(10);
    expect(model.overall.brier).not.toBeNull();
    expect(model.naiveBaseline.n).toBe(model.overall.n);
  });
});
