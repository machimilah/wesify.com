import { describe, expect, it } from "vitest";
import { DEFAULT_RANGES } from "@/lib/shared/constants";
import type { MetricSnapshot } from "@/lib/shared/types";
import {
  computeFeatures,
  enforceReachable,
  forecast,
  likesAt,
  momentumLabel,
  normalize,
  normalizeAcceleration,
  relativeAcceleration,
  smoothProbabilities,
  velocity,
  winningRangeIndex,
} from "@/lib/virality-engine";

const MIN = 60_000;
const t0 = 1_000_000_000_000;

/** Series of snapshots every 5 minutes following likes(minute). */
function series(minutes: number, likes: (m: number) => number): MetricSnapshot[] {
  const out: MetricSnapshot[] = [];
  for (let m = 0; m <= minutes; m += 5) out.push({ capturedAt: t0 + m * MIN, likes: Math.round(likes(m)) });
  return out;
}

describe("velocity", () => {
  it("is (new − old) / elapsed minutes", () => {
    const h = series(120, (m) => 1000 + 10 * m);
    expect(velocity(h, t0 + 120 * MIN, 5)).toBeCloseTo(10);
    expect(velocity(h, t0 + 120 * MIN, 60)).toBeCloseTo(10);
  });

  it("uses the earliest point when history is shorter than the window", () => {
    const h = series(30, (m) => 100 + 2 * m);
    expect(velocity(h, t0 + 30 * MIN, 360)).toBeCloseTo(2);
  });

  it("interpolates between snapshots", () => {
    const h = [{ capturedAt: t0, likes: 0 }, { capturedAt: t0 + 10 * MIN, likes: 100 }];
    expect(likesAt(h, t0 + 5 * MIN)).toBe(50);
  });

  it("returns 0 with fewer than two snapshots", () => {
    expect(velocity([{ capturedAt: t0, likes: 5 }], t0, 5)).toBe(0);
  });
});

describe("acceleration", () => {
  it("relative acceleration normalizes by previous velocity with epsilon", () => {
    expect(relativeAcceleration(40, 20)).toBe(1);
    expect(relativeAcceleration(10, 0)).toBe(20); // epsilon = 0.5
    expect(relativeAcceleration(10, 20)).toBe(-0.5);
  });

  it("detects acceleration in an exponential series", () => {
    const h = series(180, (m) => 1000 * Math.exp(m / 40));
    const f = computeFeatures(h, t0 + 180 * MIN);
    expect(f.acceleration30m).toBeGreaterThan(0);
    expect(f.relativeAcceleration30m).toBeGreaterThan(0.5);
  });

  it("acceleration normalization is 0.5 for constant velocity", () => {
    expect(normalizeAcceleration(0)).toBe(0.5);
    expect(normalizeAcceleration(5)).toBeGreaterThan(0.9);
    expect(normalizeAcceleration(-1)).toBeLessThan(0.5);
  });
});

describe("momentum", () => {
  it("maps scores to the five labels", () => {
    expect(momentumLabel(0.1)).toBe("COOLING");
    expect(momentumLabel(0.3)).toBe("STABLE");
    expect(momentumLabel(0.5)).toBe("RISING");
    expect(momentumLabel(0.7)).toBe("SURGING");
    expect(momentumLabel(0.95)).toBe("EXPLODING");
  });

  it("scores an exploding video above a flat one", () => {
    const flat = computeFeatures(series(180, (m) => 1000 + 0.5 * m), t0 + 180 * MIN);
    const viral = computeFeatures(series(180, (m) => 5000 * Math.exp(m / 30)), t0 + 180 * MIN);
    expect(flat.momentumScore).toBeLessThan(0.4);
    expect(viral.momentumScore).toBeGreaterThan(0.7);
  });
});

describe("probabilities", () => {
  it("normalize sums to 1 and applies a floor", () => {
    const p = normalize([0, 0, 1, 0, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...p)).toBeGreaterThan(0);
  });

  it("forecast distribution sums to 1 and favors higher ranges for viral trajectories", () => {
    const now = t0 + 180 * MIN;
    const settlesAt = t0 + 24 * 60 * MIN;
    const flatH = series(180, (m) => 2000 + 1 * m);
    const viralH = series(180, (m) => 20_000 * Math.exp(m / 45));
    const flat = forecast({ currentLikes: flatH.at(-1)!.likes, now, settlesAt, features: computeFeatures(flatH, now), ranges: DEFAULT_RANGES });
    const viral = forecast({ currentLikes: viralH.at(-1)!.likes, now, settlesAt, features: computeFeatures(viralH, now), ranges: DEFAULT_RANGES });
    expect(flat.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(viral.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(flat.probabilities[0]).toBeGreaterThan(0.5);
    expect(viral.probabilities[4]).toBeGreaterThan(flat.probabilities[4]);
    expect(viral.expectedFinalLikes).toBeGreaterThan(flat.expectedFinalLikes);
  });

  it("ranges already exceeded cannot keep probability", () => {
    const p = enforceReachable([0.4, 0.3, 0.2, 0.05, 0.05], DEFAULT_RANGES, 150_000);
    expect(p[0]).toBeLessThan(0.01);
    expect(p[1]).toBeLessThan(0.01);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("EWMA smoothing moves 20% toward the new distribution", () => {
    const prev = [0.2, 0.2, 0.2, 0.2, 0.2];
    const next = [0, 0, 0, 0, 1];
    const s = smoothProbabilities(prev, next, { spike: false });
    expect(s[4]).toBeCloseTo(0.36, 2);
    const spike = smoothProbabilities(prev, next, { spike: true });
    expect(spike[4]).toBeGreaterThan(s[4]);
  });

  it("winning range boundaries are [min, max)", () => {
    expect(DEFAULT_RANGES[winningRangeIndex(DEFAULT_RANGES, 9_999)].label).toBe("< 10K");
    expect(DEFAULT_RANGES[winningRangeIndex(DEFAULT_RANGES, 10_000)].label).toBe("10K–100K");
    expect(DEFAULT_RANGES[winningRangeIndex(DEFAULT_RANGES, 712_428)].label).toBe("500K–1M");
    expect(DEFAULT_RANGES[winningRangeIndex(DEFAULT_RANGES, 1_000_000)].label).toBe("1M+");
  });
});
