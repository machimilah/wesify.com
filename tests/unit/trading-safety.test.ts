import { describe, expect, it } from "vitest";
import * as lmsr from "@/lib/market-engine/lmsr";
import { setFlag } from "@/server/world/flags";
import { lmsrStateOf } from "@/server/world/markets";
import { createSimulatedMarket } from "@/server/world/seed";
import { buy, sell } from "@/server/world/trading";
import { createUser, setUserStatus } from "@/server/world/users";
import { testWorld } from "../helpers";

function setup() {
  const t = testWorld();
  const user = createUser(t.ctx, { username: "careful" });
  const { market } = createSimulatedMarket(t.ctx, { scenario: "stable-mid", openedAt: t.ctx.now(), seed: 21, ageHours: 1 });
  const outcomes = t.ctx.state.outcomes[market.id];
  return { ...t, user, market, outcomes };
}

describe("trading safety (§8, §9, §20, §27, §57)", () => {
  it("rejects an order when the price moved more than the tolerance since review", () => {
    const { ctx, user, market, outcomes } = setup();
    const o = outcomes[1];
    const seen = o.currentPrice;
    const whale = createUser(ctx, { username: "whale" });
    buy(ctx, { userId: whale.id, marketId: market.id, outcomeId: o.id, credits: 2000 });
    expect(Math.abs(o.currentPrice - seen)).toBeGreaterThan(0.03);
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, credits: 100, expectedPrice: seen })).toThrow(/price moved/);
    expect(user.creditsBalance).toBe(10_000);
    // Within tolerance it goes through.
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, credits: 100, expectedPrice: o.currentPrice + 0.01 })).not.toThrow();
  });

  it("keeps prices inside the bounds", () => {
    const { ctx, market, outcomes } = setup();
    // Push one outcome close to the ceiling with many buyers.
    for (let i = 0; i < 40; i++) {
      const u = createUser(ctx, { username: `pusher${i}` });
      try {
        buy(ctx, { userId: u.id, marketId: market.id, outcomeId: outcomes[3].id, credits: 2000 });
      } catch (err) {
        expect(String(err)).toMatch(/above 99%|win at most/);
      }
    }
    const prices = lmsr.prices(lmsrStateOf(market, outcomes));
    expect(Math.max(...prices)).toBeLessThanOrEqual(0.99 + 1e-9);
    expect(prices.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("caps what one user can win on a single outcome", () => {
    const { ctx, user, market, outcomes } = setup();
    // A long shot: 2,000 W$ buys well over 25,000 shares only if price < 8%. Force a cheap outcome.
    const cheap = [...outcomes].sort((a, b) => a.currentPrice - b.currentPrice)[0];
    const shares = lmsr.sharesForCredits(lmsrStateOf(market, outcomes), outcomes.indexOf(cheap), 2000);
    if (shares > 25_000) expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: cheap.id, credits: 2000 })).toThrow(/win at most/);
    else expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: cheap.id, credits: 2000 })).not.toThrow();
  });

  it("never creates W$ from a buy-then-sell loop (§28 exploit loops)", () => {
    const { ctx, user, market, outcomes } = setup();
    for (let i = 0; i < 25; i++) {
      const o = outcomes[i % outcomes.length];
      const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, credits: 137.37 });
      sell(ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, shares: r.trade.shares });
    }
    expect(user.creditsBalance).toBeLessThanOrEqual(10_000);
    expect(Object.values(ctx.state.positions).every((p) => p.shares >= 0)).toBe(true);
  });

  it("limits trades per hour", () => {
    const { ctx, user, market, outcomes } = setup();
    let error = "";
    for (let i = 0; i < 70; i++) {
      try {
        buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[i % 4].id, credits: 1 });
      } catch (err) {
        error = String(err);
        break;
      }
    }
    expect(error).toMatch(/a lot of trades/);
  });

  it("stops frozen and suspended users trading", () => {
    const { ctx, user, market, outcomes } = setup();
    setUserStatus(ctx, { userId: user.id, status: "frozen", reason: "review", actor: "admin" });
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 10 })).toThrow(/under review/);
    setUserStatus(ctx, { userId: user.id, status: "active", reason: "cleared", actor: "admin" });
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 10 })).not.toThrow();
  });

  it("honours the trading, selling and global-pause switches", () => {
    const { ctx, user, market, outcomes } = setup();
    const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[1].id, credits: 50 });
    setFlag(ctx, "trading", { enabled: false }, "admin");
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[1].id, credits: 10 })).toThrow(/maintenance/);
    expect(() => sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[1].id, shares: 1 })).not.toThrow();
    setFlag(ctx, "trading", { enabled: true }, "admin");
    setFlag(ctx, "selling", { enabled: false }, "admin");
    expect(() => sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[1].id, shares: 1 })).toThrow(/Selling is temporarily/);
    setFlag(ctx, "selling", { enabled: true }, "admin");
    setFlag(ctx, "globalPause", { enabled: true }, "admin");
    expect(() => sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[1].id, shares: r.trade.shares / 2 })).toThrow(/maintenance/);
  });

  it("flags accounts sharing a device that trade the same outcome", () => {
    const { ctx, market, outcomes } = setup();
    const a = createUser(ctx, { username: "twin_a" });
    const b = createUser(ctx, { username: "twin_b" });
    ctx.state.devices.dev1 = { userIds: [a.id, b.id], ipHashes: [], firstSeenAt: 0, lastSeenAt: 0 };
    buy(ctx, { userId: a.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 50 });
    buy(ctx, { userId: b.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 50 });
    expect(ctx.state.riskFlags.some((f) => f.entityId === b.id && /sharing a device/.test(f.reason))).toBe(true);
    expect(b.status).toBe("active"); // flags never punish on their own
  });

  it("sends trade confirmations and writes human-readable ledger lines", () => {
    const { ctx, user, market, outcomes } = setup();
    buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 75 });
    expect(ctx.state.notifications.some((n) => n.userId === user.id && n.kind === "TRADE")).toBe(true);
    const row = ctx.state.ledger.filter((l) => l.userId === user.id).at(-1)!;
    expect(row.description).toMatch(new RegExp(`Bought ${outcomes[2].label.replace(/[+]/g, "\\+")}`));
  });
});
