import { describe, expect, it } from "vitest";
import { registerProvider, ProviderUnavailableError, type SocialProvider } from "@/lib/social-providers";
import { checkIntegrity } from "@/server/world/integrity";
import { METRICS_DELAYED, UNDER_REVIEW, recordSnapshot } from "@/server/world/markets";
import { setSimulatedAvailability } from "@/server/world/ingestion";
import { createSimulatedMarket } from "@/server/world/seed";
import { buy } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { HOUR, MIN, testWorld } from "../helpers";

describe("video deleted or made private (§1, §26)", () => {
  it("pauses right away, cancels after the grace period, and refunds at cost", async () => {
    const t = testWorld();
    const user = createUser(t.ctx, { username: "unlucky" });
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 5, ageHours: 1 });
    const o = t.ctx.state.outcomes[market.id][1];
    buy(t.ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, credits: 500 });
    setSimulatedAvailability(t.ctx, { marketId: market.id, availability: "deleted", actor: "test" });
    t.advance(10 * MIN);
    await t.world.tick();
    expect(market.status).toBe("PAUSED");
    expect(market.pausedReason).toMatch(/no longer available/);
    t.advance(HOUR);
    await t.world.tick();
    expect(market.status).toBe("CANCELLED");
    expect(market.cancellation?.reason).toBe("DELETED_CONTENT");
    expect(user.creditsBalance).toBeCloseTo(10_000, 1);
    expect(checkIntegrity(t.ctx.state).ok).toBe(true);
  });

  it("resumes if a private video comes back within the grace period", async () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 6, ageHours: 1 });
    setSimulatedAvailability(t.ctx, { marketId: market.id, availability: "private", actor: "test" });
    t.advance(10 * MIN);
    await t.world.tick();
    expect(market.status).toBe("PAUSED");
    setSimulatedAvailability(t.ctx, { marketId: market.id, availability: "available", actor: "test" });
    t.advance(10 * MIN);
    await t.world.tick();
    expect(market.status).toBe("OPEN");
    expect(market.unavailableSince).toBeNull();
  });
});

describe("provider failure and late data (§1, §16, §25)", () => {
  let failing = true;
  const flaky: SocialProvider = {
    name: "flaky-test",
    resolveVideo: async () => {
      throw new Error("unused");
    },
    getMetrics: async (video, at) => {
      if (failing) throw new ProviderUnavailableError("down");
      return { likes: 5_000 + Math.round((at - video.createdAt) / 60_000), capturedAt: at, source: "flaky-test" };
    },
  };
  registerProvider(flaky);

  it("pauses when data stops, resumes when it returns, and alerts after repeated failures", async () => {
    const t = testWorld();
    const { market, created } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 7, ageHours: 1 });
    expect(created).toBe(true);
    // Point the video at the flaky provider (as if METRICS_PROVIDER had switched it).
    (t.ctx.state.videos[market.videoId] as { provider: string }).provider = "flaky-test";
    failing = true;
    for (let i = 0; i < 4; i++) {
      t.advance(10 * MIN);
      await t.world.tick();
    }
    expect(market.status).toBe("PAUSED");
    expect(market.pausedReason).toBe(METRICS_DELAYED);
    expect(t.ctx.state.providers["flaky-test"].consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(t.ctx.state.alerts.some((a) => a.message.includes("flaky-test"))).toBe(true);
    failing = false;
    t.advance(5 * MIN);
    await t.world.tick();
    expect(market.status).toBe("OPEN");
  });

  it("cancels when no reliable final count arrives within 12 hours", async () => {
    const t = testWorld();
    const user = createUser(t.ctx, { username: "waiting" });
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 8, ageHours: 1 });
    buy(t.ctx, { userId: user.id, marketId: market.id, outcomeId: t.ctx.state.outcomes[market.id][2].id, credits: 300 });
    t.advance(23 * HOUR);
    await t.world.tick();
    (t.ctx.state.videos[market.videoId] as { provider: string }).provider = "flaky-test";
    failing = true;
    t.advance(1 * HOUR + MIN);
    await t.world.tick();
    expect(market.status).toBe("SETTLING");
    t.advance(12 * HOUR);
    await t.world.tick();
    expect(market.status).toBe("CANCELLED");
    expect(market.cancellation?.reason).toBe("PLATFORM_OUTAGE");
    expect(user.creditsBalance).toBeCloseTo(10_000, 1);
  });
});

describe("suspicious metrics (§18, §27)", () => {
  it("excludes an impossible jump from pricing and pauses the market for review", () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 9, ageHours: 1 });
    const likesBefore = market.currentLikes;
    const pricesBefore = t.ctx.state.outcomes[market.id].map((o) => o.currentPrice);
    recordSnapshot(t.ctx, market.id, { likes: likesBefore * 50 + 1_000_000, capturedAt: market.lastPricedAt + 60_000, source: "test" });
    const last = t.ctx.state.snapshots[market.videoId].at(-1)!;
    expect(last.suspicious).toBe(true);
    expect(market.currentLikes).toBe(likesBefore);
    expect(market.status).toBe("PAUSED");
    expect(market.pausedReason).toBe(UNDER_REVIEW);
    expect(t.ctx.state.riskFlags.some((f) => f.reason === "Impossible like velocity")).toBe(true);
    // Prices barely move (only smoothing noise), because the bad reading isn't priced.
    t.ctx.state.outcomes[market.id].forEach((o, i) => expect(Math.abs(o.currentPrice - pricesBefore[i])).toBeLessThan(0.05));
  });

  it("accepts a downward correction once three readings agree", () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 10, ageHours: 1 });
    const base = market.currentLikes;
    let at = market.lastPricedAt;
    for (let i = 0; i < 3; i++) {
      at += 5 * 60_000;
      recordSnapshot(t.ctx, market.id, { likes: Math.round(base * 0.5) + i, capturedAt: at, source: "test" });
    }
    const tail = t.ctx.state.snapshots[market.videoId].slice(-3);
    expect(tail.every((s) => !s.suspicious)).toBe(true);
    expect(market.currentLikes).toBe(Math.round(base * 0.5) + 2);
    expect(t.ctx.state.riskFlags.some((f) => f.reason.startsWith("Like count corrected"))).toBe(true);
  });

  it("ignores duplicate or out-of-order snapshots", () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 12, ageHours: 1 });
    const n = t.ctx.state.snapshots[market.videoId].length;
    expect(recordSnapshot(t.ctx, market.id, { likes: 1, capturedAt: market.lastPricedAt, source: "test" })).toBe(false);
    expect(t.ctx.state.snapshots[market.videoId].length).toBe(n);
  });
});
