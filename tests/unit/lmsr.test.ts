import { describe, expect, it } from "vitest";
import * as lmsr from "@/lib/market-engine/lmsr";

const base = (): lmsr.LmsrState => ({
  b: 1000,
  quantities: [0, 0, 0, 0, 0],
  modelProbabilities: [0.03, 0.07, 0.2, 0.3, 0.4],
});

describe("LMSR", () => {
  it("prices equal the model prior when no shares are outstanding", () => {
    const p = lmsr.prices(base());
    expect(p.map((x) => +x.toFixed(6))).toEqual([0.03, 0.07, 0.2, 0.3, 0.4]);
  });

  it("prices always sum to 1", () => {
    const s = { ...base(), quantities: [500, -200, 1200, 0, 3000] };
    expect(lmsr.prices(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("matches the canonical formula p_i = exp(q_i/b)/Σ exp(q_j/b) with a uniform prior", () => {
    const s = { b: 1000, quantities: [100, 0, 300], modelProbabilities: [1 / 3, 1 / 3, 1 / 3] };
    const e = s.quantities.map((q) => Math.exp(q / s.b));
    const total = e.reduce((a, b) => a + b, 0);
    lmsr.prices(s).forEach((p, i) => expect(p).toBeCloseTo(e[i] / total, 12));
  });

  it("buy cost equals the change in the cost function", () => {
    const s = base();
    const shares = lmsr.sharesForCredits(s, 4, 100);
    const after = lmsr.withQuantityDelta(s, 4, shares);
    expect(lmsr.cost(after) - lmsr.cost(s)).toBeCloseTo(100, 8);
    expect(lmsr.creditsForShares(s, 4, shares)).toBeCloseTo(100, 8);
  });

  it("buying raises that outcome's price and lowers the others", () => {
    const s = base();
    const after = lmsr.withQuantityDelta(s, 4, lmsr.sharesForCredits(s, 4, 500));
    const [p0, p1] = [lmsr.prices(s), lmsr.prices(after)];
    expect(p1[4]).toBeGreaterThan(p0[4]);
    for (let i = 0; i < 4; i++) expect(p1[i]).toBeLessThan(p0[i]);
  });

  it("buy then sell with an unchanged prior is cost-neutral", () => {
    const s = base();
    const shares = lmsr.sharesForCredits(s, 1, 250);
    const after = lmsr.withQuantityDelta(s, 1, shares);
    expect(lmsr.proceedsForShares(after, 1, shares)).toBeCloseTo(250, 8);
  });

  it("small trades fill near the current price (shares ≈ credits / price)", () => {
    const s = { ...base(), b: 1_000_000 };
    expect(lmsr.sharesForCredits(s, 4, 100)).toBeCloseTo(100 / 0.4, 0);
  });

  it("selling after the model reprices upward realizes a gain", () => {
    const s = base();
    const shares = lmsr.sharesForCredits(s, 4, 100);
    const bought = lmsr.withQuantityDelta(s, 4, shares);
    const repriced = lmsr.withModel(bought, [0.01, 0.02, 0.07, 0.2, 0.7]);
    expect(lmsr.proceedsForShares(repriced, 4, shares)).toBeGreaterThan(100);
  });
});
