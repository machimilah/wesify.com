import { describe, expect, it } from "vitest";
import type { ScenarioName } from "@/lib/shared/types";
import { checkIntegrity } from "@/server/world/integrity";
import { cancelMarket, recordSnapshot } from "@/server/world/markets";
import { setSimulatedAvailability } from "@/server/world/ingestion";
import { createSimulatedMarket, ensureBots } from "@/server/world/seed";
import { buy, sell } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { World } from "@/server/world/world";
import { HOUR, MIN, testWorld } from "../helpers";

/**
 * Market simulations (checklist §53). Each runs a full 24h+ market (or many) with simulated traders
 * and ends with the same assertion: balances equal the ledger, market state replays from trades,
 * settlement paid exactly once, and prices stayed a valid distribution throughout.
 */
function botWorld(chance = 0.8) {
  const t = testWorld();
  const world = new World(t.ctx.state, { realNow: t.now, bots: true, botChance: chance, minActiveMarkets: 0 });
  ensureBots(world.ctx, 12);
  return { ...t, world, ctx: world.ctx };
}

function assertHealthy(state: Parameters<typeof checkIntegrity>[0]) {
  const report = checkIntegrity(state);
  expect(report.issues).toEqual([]);
  for (const [id, outcomes] of Object.entries(state.outcomes)) {
    const sum = outcomes.reduce((s, o) => s + o.currentPrice, 0);
    expect(Math.abs(sum - 1), `prices of ${id}`).toBeLessThan(1e-6);
  }
}

async function runHours(t: { advance: (ms: number) => void; world: World }, hours: number, step = HOUR) {
  for (let h = 0; h < hours * (HOUR / step); h++) {
    t.advance(step);
    await t.world.tick();
  }
}

describe("§53 trajectory scenarios settle correctly with simulated traders", () => {
  const cases: [string, ScenarioName, number][] = [
    ["flat video", "flat", 1],
    ["slow growth", "slow-growth", 1],
    ["normal growth", "stable-mid", 1],
    ["early viral spike", "viral-spike", 1],
    ["late viral spike", "late-spike", 1],
    ["viral spike then decay", "spike-decay", 1],
    ["multiple spikes", "double-spike", 1],
    ["sudden fake-engagement spike", "fake-spike", 1],
  ];
  for (const [name, scenario, scale] of cases) {
    it(name, async () => {
      const t = botWorld();
      const { market } = createSimulatedMarket(t.ctx, { scenario, openedAt: t.ctx.now(), seed: scenario.length * 7, scale, ageHours: 1 });
      await runHours(t, 25);
      expect(market.status).toBe("SETTLED");
      expect(t.ctx.state.trades.filter((x) => x.marketId === market.id).length).toBeGreaterThan(10);
      assertHealthy(t.ctx.state);
    });
  }

  it("fake spike is flagged for review", async () => {
    const t = botWorld(0.3);
    const { market } = createSimulatedMarket(t.ctx, { scenario: "fake-spike", openedAt: t.ctx.now(), seed: 77, scale: 1, ageHours: 1 });
    await runHours(t, 8);
    expect(t.ctx.state.riskFlags.some((f) => f.entityId === market.id && /jump|velocity/i.test(f.reason))).toBe(true);
  });
});

describe("§53 data problems", () => {
  it("data gap: a missing stretch of readings doesn't corrupt the market", async () => {
    const t = botWorld(0.5);
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 41, ageHours: 1 });
    await runHours(t, 3);
    // Jump the clock 4 hours in one go (the tick backfills in 5-minute steps).
    t.advance(4 * HOUR);
    await t.world.tick();
    await runHours(t, 18);
    expect(market.status).toBe("SETTLED");
    assertHealthy(t.ctx.state);
  });

  it("incorrect metric: one absurd reading is quarantined, not priced", async () => {
    const t = botWorld(0.5);
    const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 42, ageHours: 1 });
    await runHours(t, 2);
    recordSnapshot(t.ctx, market.id, { likes: market.currentLikes * 100, capturedAt: market.lastPricedAt + 1000, source: "bad" });
    expect(t.ctx.state.snapshots[market.videoId].at(-1)!.suspicious).toBe(true);
    assertHealthy(t.ctx.state);
  });

  it("video deletion cancels and refunds everyone at cost", async () => {
    const t = botWorld(0.9);
    const { market } = createSimulatedMarket(t.ctx, { scenario: "viral-spike", openedAt: t.ctx.now(), seed: 43, ageHours: 1 });
    await runHours(t, 4);
    setSimulatedAvailability(t.ctx, { marketId: market.id, availability: "deleted", actor: "sim" });
    await runHours(t, 2, 10 * MIN);
    expect(market.status).toBe("CANCELLED");
    assertHealthy(t.ctx.state);
  });

  it("manual cancellation mid-market", async () => {
    const t = botWorld(0.9);
    const { market } = createSimulatedMarket(t.ctx, { scenario: "late-spike", openedAt: t.ctx.now(), seed: 44, ageHours: 1 });
    await runHours(t, 10);
    cancelMarket(t.ctx, market.id, { reason: "sim", code: "MANIPULATION", actor: "sim" });
    await runHours(t, 15);
    expect(market.status).toBe("CANCELLED");
    assertHealthy(t.ctx.state);
  });
});

describe("§53 liquidity and load extremes", () => {
  it("very low liquidity (b = 200) keeps prices bounded and balances correct", async () => {
    const t = botWorld(1);
    const { market } = createSimulatedMarket(t.ctx, { scenario: "viral-spike", openedAt: t.ctx.now(), seed: 51, ageHours: 1 });
    market.liquidityParameter = 200;
    await runHours(t, 25);
    expect(market.status).toBe("SETTLED");
    assertHealthy(t.ctx.state);
  });

  it("very high trading volume across many markets", async () => {
    const t = botWorld(1);
    for (let i = 0; i < 10; i++) createSimulatedMarket(t.ctx, { scenario: (["viral-spike", "spike-decay", "stable-mid", "late-spike", "slow-growth"] as const)[i % 5], openedAt: t.ctx.now(), seed: 600 + i, ageHours: 1 });
    await runHours(t, 25, 30 * MIN);
    expect(t.ctx.state.trades.length).toBeGreaterThan(500);
    expect(Object.values(t.ctx.state.markets).every((m) => m.status === "SETTLED")).toBe(true);
    assertHealthy(t.ctx.state);
  });

  it("extreme one-sided market: everyone piles into one range", async () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "flat", openedAt: t.ctx.now(), seed: 52, ageHours: 1 });
    const top = t.ctx.state.outcomes[market.id].at(-1)!;
    for (let i = 0; i < 60; i++) {
      const u = createUser(t.ctx, { username: `herd${i}` });
      try {
        buy(t.ctx, { userId: u.id, marketId: market.id, outcomeId: top.id, credits: 2000 });
      } catch {
        /* price bound or exposure cap reached */
      }
    }
    expect(top.currentPrice).toBeLessThanOrEqual(0.99 + 1e-9);
    await runHours(t, 25);
    expect(market.status).toBe("SETTLED");
    // A flat video lands in the lowest range; the herd loses, nobody's balance goes negative.
    expect(market.winningOutcomeId).toBe(t.ctx.state.outcomes[market.id][0].id);
    assertHealthy(t.ctx.state);
  });

  it("hundreds of simultaneous users trading one market", async () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "viral-spike", openedAt: t.ctx.now(), seed: 53, ageHours: 1 });
    const outcomes = t.ctx.state.outcomes[market.id];
    const users = Array.from({ length: 300 }, (_, i) => createUser(t.ctx, { username: `crowd${i}` }));
    // All orders land "at once": interleave buys and partial sells.
    const fills = users.map((u, i) => {
      try {
        return buy(t.ctx, { userId: u.id, marketId: market.id, outcomeId: outcomes[i % outcomes.length].id, credits: 50 + (i % 7) * 30 });
      } catch {
        return null;
      }
    });
    users.forEach((u, i) => {
      const f = fills[i];
      if (f && i % 3 === 0) sell(t.ctx, { userId: u.id, marketId: market.id, outcomeId: f.trade.outcomeId, shares: f.trade.shares / 2 });
    });
    expect(fills.filter(Boolean).length).toBeGreaterThan(250);
    await runHours(t, 25);
    expect(market.status).toBe("SETTLED");
    assertHealthy(t.ctx.state);
  });

  it("settlement under load: 50 markets settle in the same tick", async () => {
    const t = testWorld();
    const trader = createUser(t.ctx, { username: "everywhere" });
    const now = t.ctx.now();
    for (let i = 0; i < 50; i++) {
      const { market } = createSimulatedMarket(t.ctx, { scenario: (["flat", "stable-mid", "viral-spike", "spike-decay"] as const)[i % 4], openedAt: now, seed: 900 + i, ageHours: 1 });
      const o = t.ctx.state.outcomes[market.id][i % 4];
      try {
        buy(t.ctx, { userId: trader.id, marketId: market.id, outcomeId: o.id, credits: 40 });
      } catch {
        /* market cap */
      }
    }
    t.advance(24 * HOUR + MIN);
    const started = Date.now();
    await t.world.tick();
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(Object.values(t.ctx.state.markets).every((m) => m.status === "SETTLED")).toBe(true);
    assertHealthy(t.ctx.state);
  });
});
