import { describe, expect, it } from "vitest";
import { checkIntegrity } from "@/server/world/integrity";
import { setFlag } from "@/server/world/flags";
import { canTransition, transition } from "@/server/world/lifecycle";
import { approveSettlement, cancelMarket, lockMarket, pauseMarket, resumeMarket, settleMarket } from "@/server/world/markets";
import { createSimulatedMarket } from "@/server/world/seed";
import { buy } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { HOUR, testWorld } from "../helpers";

describe("market lifecycle (§24)", () => {
  it("only allows valid transitions and audits each one", () => {
    const { ctx } = testWorld();
    const { market } = createSimulatedMarket(ctx, { scenario: "stable-mid", openedAt: ctx.now(), seed: 1, ageHours: 1 });
    expect(canTransition("SETTLED", "OPEN")).toBe(false);
    expect(canTransition("DRAFT", "LOCKED")).toBe(false);
    expect(() => transition(ctx, market, "SETTLED", { actor: "test" })).toThrow(/can't become/);
    pauseMarket(ctx, market.id, "Checking something", "admin");
    expect(market.status).toBe("PAUSED");
    expect(market.pausedReason).toBe("Checking something");
    resumeMarket(ctx, market.id, "admin");
    expect(market.status).toBe("OPEN");
    const transitions = ctx.state.auditLogs.filter((a) => a.action === "market.transition" && a.entityId === market.id).map((a) => `${a.metadata.from}->${a.metadata.to}`);
    expect(transitions).toEqual(["DRAFT->OPEN", "OPEN->PAUSED", "PAUSED->OPEN"]);
  });

  it("rejects trades outside OPEN", () => {
    const { ctx } = testWorld();
    const user = createUser(ctx, { username: "trader" });
    const { market } = createSimulatedMarket(ctx, { scenario: "stable-mid", openedAt: ctx.now(), seed: 2, ageHours: 1 });
    const o = ctx.state.outcomes[market.id][1];
    pauseMarket(ctx, market.id, "Review", "admin");
    expect(() => buy(ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, credits: 10 })).toThrow(/paused/);
  });
});

describe("settlement after review (§1, §25)", () => {
  function setup() {
    const t = testWorld(undefined, { reviewSettlements: true });
    const user = createUser(t.ctx, { username: "holder" });
    const { market } = createSimulatedMarket(t.ctx, { scenario: "slow-growth", openedAt: t.ctx.now(), seed: 11, ageHours: 1 });
    const outcomes = t.ctx.state.outcomes[market.id];
    const bought = outcomes.map((o) => buy(t.ctx, { userId: user.id, marketId: market.id, outcomeId: o.id, credits: 200 }));
    return { ...t, user, market, outcomes, bought };
  }

  it("records a proposal at the 24h mark and pays nothing until a reviewer confirms", async () => {
    const { ctx, world, advance, user, market } = setup();
    advance(24 * HOUR + 5 * 60_000);
    await world.tick();
    expect(market.status).toBe("SETTLING");
    expect(market.proposedSettlement).toBeTruthy();
    expect(ctx.state.settlements[market.id]).toBeUndefined();
    const balanceBefore = user.creditsBalance;
    // More ticks don't settle it on their own.
    advance(HOUR);
    await world.tick();
    expect(market.status).toBe("SETTLING");

    const r = approveSettlement(ctx, market.id, { actor: "admin" });
    expect(r.alreadySettled).toBe(false);
    expect(market.status).toBe("SETTLED");
    expect(market.finalMetric).toBe(market.proposedSettlement!.finalMetric);
    expect(user.creditsBalance).toBeGreaterThan(balanceBefore);
    // Approving again never pays twice.
    const ledgerRows = ctx.state.ledger.length;
    expect(approveSettlement(ctx, market.id, { actor: "admin" }).alreadySettled).toBe(true);
    expect(ctx.state.ledger.length).toBe(ledgerRows);
    expect(checkIntegrity(ctx.state).ok).toBe(true);
    const settlement = ctx.state.settlements[market.id];
    expect(settlement.metadata.engineVersion).toBe("settle-v2");
    expect(settlement.source).toBe("mock");
  });

  it("needs a written reason to settle on a number other than the recorded one", async () => {
    const { ctx, world, advance, market } = setup();
    advance(24 * HOUR + 60_000);
    await world.tick();
    const proposed = market.proposedSettlement!.finalMetric;
    expect(() => approveSettlement(ctx, market.id, { actor: "admin", finalMetric: proposed + 10 })).toThrow(/Explain why/);
    approveSettlement(ctx, market.id, { actor: "admin", finalMetric: proposed + 10, reason: "Platform corrected its count", acknowledgeIssues: true });
    expect(market.finalMetric).toBe(proposed + 10);
    expect(ctx.state.settlements[market.id].source).toBe("reviewer-correction");
  });

  it("settles automatically when the review flag is off", async () => {
    const { ctx, world, advance, market } = setup();
    setFlag(ctx, "settlementReview", { enabled: false }, "test");
    advance(24 * HOUR + 60_000);
    await world.tick();
    expect(market.status).toBe("SETTLED");
  });

  it("can't settle a market that is still open", () => {
    const { ctx, market } = setup();
    expect(() => settleMarket(ctx, market.id, 1000, { source: "test", actor: null })).toThrow(/Close trading/);
    lockMarket(ctx, market.id);
    expect(market.status).toBe("LOCKED");
  });

  it("cancellation refunds at cost, records a public reason and is idempotent", () => {
    const { ctx, user, market } = setup();
    const before = user.creditsBalance;
    const r = cancelMarket(ctx, market.id, { reason: "wrong video", code: "INCORRECT_SETUP", actor: "admin" });
    expect(r.refunds).toBeCloseTo(800, 1);
    expect(user.creditsBalance).toBeCloseTo(before + 800, 1);
    expect(market.cancellation?.reason).toBe("INCORRECT_SETUP");
    expect(market.cancellation?.explanation).toMatch(/incorrect information/);
    expect(cancelMarket(ctx, market.id, { reason: "again", actor: "admin" }).alreadyFinal).toBe(true);
    expect(ctx.state.notifications.some((n) => n.userId === user.id && n.kind === "CANCELLED")).toBe(true);
    expect(checkIntegrity(ctx.state).ok).toBe(true);
  });
});
