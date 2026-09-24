import { describe, expect, it } from "vitest";
import { WELCOME_CREDITS } from "@/lib/shared/constants";
import { newId } from "@/lib/shared/random";
import { ledgerBalance } from "@/server/world/ledger";
import { cancelMarket, lockMarket, settleMarket } from "@/server/world/markets";
import { createSimulatedMarket } from "@/server/world/seed";
import { positionKey } from "@/server/world/state";
import { buy, sell } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { testWorld } from "../helpers";

function setup() {
  const t = testWorld();
  const user = createUser(t.ctx, { username: "tester" });
  const { market } = createSimulatedMarket(t.ctx, { scenario: "viral-spike", openedAt: t.ctx.now(), seed: 42, handle: "maya.moves" });
  const outcomes = t.ctx.state.outcomes[market.id];
  /** The highest range (open-ended). New markets have four creator-sized ranges. */
  const top = outcomes[outcomes.length - 1];
  return { ...t, user, market, outcomes, top };
}

describe("ledger", () => {
  it("welcome bonus credits W$10,000 through the ledger", () => {
    const { ctx, user } = setup();
    expect(user.creditsBalance).toBe(WELCOME_CREDITS);
    expect(ledgerBalance(ctx, user.id)).toBe(WELCOME_CREDITS);
    expect(ctx.state.ledger.filter((l) => l.userId === user.id)[0].type).toBe("WELCOME_BONUS");
  });
});

describe("buy", () => {
  it("debits credits, issues shares, updates the position and moves the price", () => {
    const { ctx, user, market, outcomes, top } = setup();
    expect(outcomes).toHaveLength(4);
    const before = top.currentPrice;
    const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, credits: 100 });
    expect(r.balance).toBe(WELCOME_CREDITS - 100);
    expect(r.trade.shares).toBeGreaterThan(100); // price < 1
    expect(top.currentPrice).toBeGreaterThan(before);
    expect(r.receipt.tradeId).toBe(r.trade.id);
    expect(r.position.averageEntryPrice).toBeCloseTo(100 / r.trade.shares, 10);
    expect(ledgerBalance(ctx, user.id)).toBe(user.creditsBalance);
    expect(Object.values(ctx.state.outcomes[market.id]).reduce((s, o) => s + o.currentPrice, 0)).toBeCloseTo(1, 10);
  });

  it("averages entry price across multiple buys", () => {
    const { ctx, user, market, outcomes } = setup();
    const a = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 200 });
    const b = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 300 });
    const pos = ctx.state.positions[positionKey(user.id, market.id, outcomes[2].id)];
    expect(pos.shares).toBeCloseTo(a.trade.shares + b.trade.shares, 8);
    expect(pos.averageEntryPrice).toBeCloseTo(500 / pos.shares, 10);
  });

  it("rejects trades above 20% of balance", () => {
    const { ctx, user, market, outcomes } = setup();
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 2001 })).toThrow(/20% of balance/);
    expect(user.creditsBalance).toBe(WELCOME_CREDITS);
  });

  it("rejects more than 50% of portfolio in one market", () => {
    const { ctx, user, market, outcomes } = setup();
    buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 2000 });
    buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[1].id, credits: 1600 });
    buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 1280 });
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[3].id, credits: 1000 })).toThrow(/50% of portfolio/);
  });

  it("rejects insufficient credits", () => {
    const { ctx, user, market, outcomes } = setup();
    ctx.state.users[user.id].creditsBalance = 50; // simulate drained account (bypasses ledger for test)
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 60 })).toThrow(/Not enough W\$/);
  });

  it("rejects trades on locked markets", () => {
    const { ctx, user, market, outcomes } = setup();
    lockMarket(ctx, market.id);
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 10 })).toThrow(/Trading has ended/);
  });

  it("blocks creators from trading their own connected videos", () => {
    const { ctx, user, market, outcomes } = setup();
    ctx.state.socialAccounts.push({ id: newId(), userId: user.id, platform: "tiktok", platformUserId: "1", handle: "maya.moves", createdAt: 0 });
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[0].id, credits: 10 })).toThrow(/own videos/);
  });
});

describe("sell", () => {
  it("round trip without repricing returns the credits (minus cent flooring)", () => {
    const { ctx, user, market, outcomes } = setup();
    const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[3].id, credits: 500 });
    const s = sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[3].id, shares: r.trade.shares });
    expect(s.trade.credits).toBeGreaterThanOrEqual(499.99);
    expect(s.trade.credits).toBeLessThanOrEqual(500);
    expect(s.position.shares).toBe(0);
    expect(ledgerBalance(ctx, user.id)).toBe(user.creditsBalance);
    expect(user.creditsBalance).toBeLessThanOrEqual(WELCOME_CREDITS);
  });

  it("realizes profit after the price rises", () => {
    const { ctx, user, market, outcomes } = setup();
    const target = outcomes[2];
    const other = createUser(ctx, { username: "whale" });
    const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: target.id, credits: 200 });
    buy(ctx, { userId: other.id, marketId: market.id, outcomeId: target.id, credits: 2000 });
    const s = sell(ctx, { userId: user.id, marketId: market.id, outcomeId: target.id, shares: r.trade.shares });
    expect(s.trade.realizedPnl).toBeGreaterThan(0);
    expect(ctx.state.positionEvents.at(-1)!.kind).toBe("SELL");
  });

  it("supports partial sells and rejects overselling", () => {
    const { ctx, user, market, outcomes } = setup();
    const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 300 });
    sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, shares: r.trade.shares / 2 });
    const pos = ctx.state.positions[positionKey(user.id, market.id, outcomes[2].id)];
    expect(pos.shares).toBeCloseTo(r.trade.shares / 2, 8);
    expect(() => sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, shares: r.trade.shares })).toThrow(/enough shares/);
  });
});

describe("settlement", () => {
  it("pays W$1 per winning share, W$0 per losing share, and closes positions", () => {
    const { ctx, user, market, outcomes, top } = setup();
    const win = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 400 });
    buy(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, credits: 300 });
    const balanceBefore = user.creditsBalance;
    lockMarket(ctx, market.id);
    // Exactly on a boundary: belongs to the higher range (tie rule).
    const result = settleMarket(ctx, market.id, outcomes[2].minValue!, { source: "test", actor: null });
    expect(result.winningOutcomeId).toBe(outcomes[2].id);
    expect(user.creditsBalance).toBeCloseTo(balanceBefore + Math.floor(win.trade.shares * 100) / 100, 2);
    expect(market.status).toBe("SETTLED");
    expect(outcomes[2].currentPrice).toBe(1);
    expect(top.currentPrice).toBe(0);
    const positions = Object.values(ctx.state.positions).filter((p) => p.userId === user.id);
    expect(positions.every((p) => p.shares === 0 && p.settlement)).toBe(true);
    expect(ledgerBalance(ctx, user.id)).toBe(user.creditsBalance);
  });

  it("is idempotent: settling twice never pays twice", () => {
    const { ctx, user, market, top } = setup();
    buy(ctx, { userId: user.id, marketId: market.id, outcomeId: top.id, credits: 1000 });
    lockMarket(ctx, market.id);
    settleMarket(ctx, market.id, top.minValue! * 2, { source: "test", actor: null });
    const balance = user.creditsBalance;
    const ledgerRows = ctx.state.ledger.length;
    const again = settleMarket(ctx, market.id, 2_100_000, { source: "test", actor: null });
    expect(again.alreadySettled).toBe(true);
    expect(user.creditsBalance).toBe(balance);
    expect(ctx.state.ledger.length).toBe(ledgerRows);
    // A different final metric on retry must not change the outcome either.
    settleMarket(ctx, market.id, 5, { source: "test", actor: null });
    expect(market.winningOutcomeId).toBe(top.id);
  });

  it("blocks settlement when the final metric contradicts snapshots", () => {
    const { ctx, market } = setup();
    lockMarket(ctx, market.id);
    expect(() => settleMarket(ctx, market.id, 1, { source: "test", actor: null })).toThrow(/Settlement blocked/);
    expect(market.status).toBe("SETTLING");
    expect(ctx.state.riskFlags.length).toBeGreaterThan(0);
  });

  it("cancellation refunds open positions at cost basis", () => {
    const { ctx, user, market, outcomes } = setup();
    const r = buy(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, credits: 600 });
    sell(ctx, { userId: user.id, marketId: market.id, outcomeId: outcomes[2].id, shares: r.trade.shares / 3 });
    const balance = user.creditsBalance;
    const pos = ctx.state.positions[positionKey(user.id, market.id, outcomes[2].id)];
    const costBasis = Math.round(pos.shares * pos.averageEntryPrice * 100) / 100;
    cancelMarket(ctx, market.id, { reason: "video deleted", actor: "admin" });
    expect(user.creditsBalance).toBeCloseTo(balance + costBasis, 2);
    expect(market.status).toBe("CANCELLED");
    expect(cancelMarket(ctx, market.id, { reason: "again", actor: "admin" }).alreadyFinal).toBe(true);
    expect(ledgerBalance(ctx, user.id)).toBe(user.creditsBalance);
  });
});
