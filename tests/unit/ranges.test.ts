import { describe, expect, it } from "vitest";
import { coldStartPrior, generateRanges, niceAbove, niceRound, rangeBaseline } from "@/lib/market-engine/ranges";
import { winningRangeIndex } from "@/lib/virality-engine";

describe("range formula (§1: four ranges from average likes and followers)", () => {
  it("always produces four contiguous ranges", () => {
    const { ranges } = generateRanges({ followers: 200_000, avgLikes: 30_000, currentLikes: 4_000 });
    expect(ranges).toHaveLength(4);
    expect(ranges[0].min).toBeNull();
    expect(ranges[3].max).toBeNull();
    for (let i = 1; i < 4; i++) expect(ranges[i].min).toBe(ranges[i - 1].max);
  });

  it("blends average likes (70%) with the follower estimate (30%) geometrically", () => {
    const baseline = rangeBaseline({ followers: 1_000_000, avgLikes: 20_000, currentLikes: 0 });
    // 20,000^0.7 × (1,000,000 × 5%)^0.3
    expect(baseline).toBeCloseTo(Math.pow(20_000, 0.7) * Math.pow(50_000, 0.3), 3);
    expect(rangeBaseline({ followers: null, avgLikes: 8_000, currentLikes: 0 })).toBe(8_000);
    expect(rangeBaseline({ followers: 100_000, avgLikes: null, currentLikes: 0 })).toBe(5_000);
    expect(rangeBaseline({ followers: null, avgLikes: null, currentLikes: 3_000 })).toBe(12_000);
  });

  it("centers on the baseline with boundaries at half, one and two times it", () => {
    const { ranges, basis } = generateRanges({ followers: null, avgLikes: 50_000, currentLikes: 1_000 });
    expect(basis.center).toBe(50_000);
    expect(ranges.map((r) => r.max)).toEqual([25_000, 50_000, 100_000, null]);
    expect(ranges.map((r) => r.label)).toEqual(["< 25K", "25K–50K", "50K–100K", "100K+"]);
  });

  it("keeps every range reachable when the video is already big", () => {
    const { ranges } = generateRanges({ followers: 10_000, avgLikes: 500, currentLikes: 40_000 });
    expect(ranges[0].max!).toBeGreaterThan(40_000);
  });

  it("scales with creator size", () => {
    const small = generateRanges({ followers: 5_000, avgLikes: 400, currentLikes: 100 }).ranges;
    const big = generateRanges({ followers: 5_000_000, avgLikes: 400_000, currentLikes: 20_000 }).ranges;
    expect(big[1].min!).toBeGreaterThan(small[1].min! * 100);
  });

  it("rounds boundaries to easy numbers", () => {
    expect(niceRound(47_311)).toBe(50_000);
    expect(niceRound(1_190)).toBe(1_200);
    expect(niceRound(2_310)).toBe(2_500);
    expect(niceAbove(25_000)).toBe(30_000);
  });

  it("places a count exactly on a boundary in the higher range (tie rule)", () => {
    const { ranges } = generateRanges({ followers: null, avgLikes: 50_000, currentLikes: 1_000 });
    expect(winningRangeIndex(ranges, 25_000)).toBe(1);
    expect(winningRangeIndex(ranges, 24_999)).toBe(0);
    expect(winningRangeIndex(ranges, 100_000)).toBe(3);
  });

  it("builds a cold-start prior that sums to 1 and peaks near the center", () => {
    const { ranges, basis } = generateRanges({ followers: 300_000, avgLikes: 40_000, currentLikes: 2_000 });
    const prior = coldStartPrior(ranges, basis.center);
    expect(prior.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(prior[1] + prior[2]).toBeGreaterThan(prior[0]);
    expect(prior[1] + prior[2]).toBeGreaterThan(prior[3]);
  });
});
