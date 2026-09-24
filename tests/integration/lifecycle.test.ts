import { describe, expect, it } from "vitest";
import { ledgerBalance } from "@/server/world/ledger";
import { createSimulatedMarket } from "@/server/world/seed";
import { buy, sell } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { HOUR, testWorld } from "../helpers";

describe("market lifecycle (simulated provider)", () => {
  it("create → trade → metrics update → reprice → sell → lock → settle", async () => {
    const t = testWorld();
    const { ctx, world } = t;
    const user = createUser(ctx, { username: "lifecycle" });
    const { market } = createSimulatedMarket(ctx, { scenario: "viral-spike", openedAt: ctx.now(), seed: 7, scale: 1, ageHours: 1 });
    const outcomes = ctx.state.outcomes[market.id];
    expect(market.status).toBe("OPEN");

    const top = outcomes[outcomes.length - 1];
    const hold = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, credits: 500 });
    const flip = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, credits: 500 });
    const priceAtEntry = top.currentPrice;

    // 10 hours in: the viral trajectory should have pushed 1M+ up.
    t.advance(10 * HOUR);
    await world.tick();
    expect(ctx.state.snapshots[market.videoId].length).toBeGreaterThan(100);
    expect(market.currentLikes).toBeGreaterThan(100_000);
    expect(top.currentPrice).toBeGreaterThan(priceAtEntry);
    expect(["SURGING", "EXPLODING", "RISING"]).toContain(market.momentumLabel);
    expect(outcomes[0].currentPrice).toBeLessThan(0.01); // the lowest range is already impossible

    const exit = sell(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, shares: flip.trade.shares });
    expect(exit.trade.realizedPnl).toBeGreaterThan(0);

    // Past lock but before settlement.
    t.advance(14 * HOUR - 30_000);
    await world.tick();
    expect(market.status).toBe("LOCKED");
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, credits: 10 })).toThrow();

    t.advance(60_000);
    await world.tick();
    expect(market.status).toBe("SETTLED");
    expect(market.finalMetric).toBeGreaterThan(1_000_000);
    expect(market.winningOutcomeId).toBe(top.id);
    expect(ctx.state.notifications.some((n) => n.userId === user.id && n.kind === "SETTLEMENT")).toBe(true);

    // Held shares paid W$1 each.
    const settle = ctx.state.ledger.find((l) => l.userId === user.id && l.type === "SETTLEMENT")!;
    expect(settle.amount).toBeCloseTo(Math.floor((hold.trade.shares + flip.trade.shares - flip.trade.shares) * 100) / 100, 1);
    expect(ledgerBalance(ctx, user.id)).toBe(user.creditsBalance);

    // Ticking again changes nothing.
    const balance = user.creditsBalance;
    t.advance(HOUR);
    await world.tick();
    expect(user.creditsBalance).toBe(balance);
  });

  it("a flat video settles in the lowest range and the model prices it that way", async () => {
    const t = testWorld();
    const { market } = createSimulatedMarket(t.ctx, { scenario: "flat", openedAt: t.ctx.now(), seed: 3, scale: 1, ageHours: 1 });
    const outcomes = t.ctx.state.outcomes[market.id];
    t.advance(6 * HOUR);
    await t.world.tick();
    expect(outcomes[0].currentPrice).toBeGreaterThan(0.6);
    t.advance(18 * HOUR);
    await t.world.tick();
    expect(market.status).toBe("SETTLED");
    expect(market.winningOutcomeId).toBe(outcomes[0].id);
  });

  it("every user's balance equals their ledger sum after a busy simulation with bots", async () => {
    const t = testWorld();
    const { ctx } = t;
    const { World } = await import("@/server/world/world");
    const world = new World(ctx.state, { realNow: t.world.realNow, bots: true, botChance: 1, minActiveMarkets: 0 });
    const { ensureBots } = await import("@/server/world/seed");
    ensureBots(world.ctx, 6);
    for (const scenario of ["viral-spike", "spike-decay", "stable-mid"] as const) {
      createSimulatedMarket(world.ctx, { scenario, openedAt: world.now(), seed: scenario.length, ageHours: 2 });
    }
    for (let h = 0; h < 25; h++) {
      t.advance(HOUR);
      await world.tick();
    }
    expect(ctx.state.trades.length).toBeGreaterThan(50);
    expect(Object.values(ctx.state.markets).every((m) => m.status === "SETTLED")).toBe(true);
    for (const u of Object.values(ctx.state.users)) {
      expect(ledgerBalance(ctx, u.id)).toBe(u.creditsBalance);
      expect(u.creditsBalance).toBeGreaterThanOrEqual(0);
    }
  });
});
