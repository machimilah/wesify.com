import type { RangeDef } from "../shared/constants";
import { compactNumber } from "../shared/format";

/**
 * Outcome ranges (checklist §1): four ranges sized to the creator, from their average likes and
 * follower count. Everything here is deterministic, so a market's ranges can be recomputed and
 * explained from `rangeBasis` alone.
 *
 *   engagement estimate = followers × 5%        (typical like-to-follower ratio)
 *   baseline            = avgLikes^0.7 × (followers × 5%)^0.3
 *                         (a geometric blend: past videos count most, audience size tempers it;
 *                          whichever input is missing is simply left out)
 *   center              = max(baseline, current likes × 2.5)
 *                         (a video that's already big still gets a real contest above it)
 *   boundaries          = center ÷ 2, center, center × 2, each rounded to a "nice" number
 *   ranges              = below b1 · b1 to b2 · b2 to b3 · b3 and above
 *
 * With no creator data at all the baseline falls back to current likes × 4.
 */
export const RANGE_FORMULA_VERSION = "ranges-v1";
export const RANGE_COUNT = 4;
export const ENGAGEMENT_RATE = 0.05;
const AVG_WEIGHT = 0.7;
const CURRENT_MULTIPLIER = 2.5;
const FALLBACK_MULTIPLIER = 4;
const MIN_BOUNDARY = 100;

export type RangeBasis = {
  followers: number | null;
  avgLikes: number | null;
  baseline: number;
  center: number;
  formulaVersion: string;
};

const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

/** Rounds to the closest of 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8 × 10^k. */
export function niceRound(x: number): number {
  if (!(x > 0)) return 0;
  const exp = Math.floor(Math.log10(x));
  const base = 10 ** exp;
  const f = x / base;
  let best = NICE_STEPS[0];
  for (const s of NICE_STEPS) if (Math.abs(Math.log(s / f)) < Math.abs(Math.log(best / f))) best = s;
  return Math.round(best * base);
}

/** Smallest nice number strictly greater than x. */
export function niceAbove(x: number): number {
  const exp = Math.floor(Math.log10(Math.max(1, x)));
  for (let e = exp; e <= exp + 1; e++) {
    for (const s of NICE_STEPS) {
      const v = Math.round(s * 10 ** e);
      if (v > x) return v;
    }
  }
  return Math.ceil(x * 1.25);
}

export function rangeBaseline(input: { followers: number | null; avgLikes: number | null; currentLikes: number }): number {
  const followers = input.followers && input.followers > 0 ? input.followers : null;
  const avg = input.avgLikes && input.avgLikes > 0 ? input.avgLikes : null;
  if (avg && followers) return Math.pow(avg, AVG_WEIGHT) * Math.pow(followers * ENGAGEMENT_RATE, 1 - AVG_WEIGHT);
  if (avg) return avg;
  if (followers) return followers * ENGAGEMENT_RATE;
  return Math.max(MIN_BOUNDARY, input.currentLikes * FALLBACK_MULTIPLIER);
}

export function generateRanges(input: { followers: number | null; avgLikes: number | null; currentLikes: number }): { ranges: RangeDef[]; basis: RangeBasis } {
  const baseline = rangeBaseline(input);
  const center = Math.max(baseline, input.currentLikes * CURRENT_MULTIPLIER, MIN_BOUNDARY * 2);
  const b: number[] = [niceRound(center / 2), niceRound(center), niceRound(center * 2)];
  // Every range must still be reachable when the market opens, and boundaries strictly increase.
  if (b[0] <= input.currentLikes) b[0] = niceAbove(input.currentLikes);
  for (let i = 1; i < b.length; i++) if (b[i] <= b[i - 1]) b[i] = niceAbove(b[i - 1]);

  const ranges: RangeDef[] = [
    { label: `< ${compactNumber(b[0])}`, min: null, max: b[0] },
    { label: `${compactNumber(b[0])}–${compactNumber(b[1])}`, min: b[0], max: b[1] },
    { label: `${compactNumber(b[1])}–${compactNumber(b[2])}`, min: b[1], max: b[2] },
    { label: `${compactNumber(b[2])}+`, min: b[2], max: null },
  ];
  return {
    ranges,
    basis: { followers: input.followers, avgLikes: input.avgLikes, baseline: Math.round(baseline), center: Math.round(center), formulaVersion: RANGE_FORMULA_VERSION },
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Cold-start prior (§19): a wide log-normal around the creator's baseline, used while a market has
 * too little trajectory to trust the forecast. Works for any number of ranges.
 */
export function coldStartPrior(ranges: RangeDef[], center: number, sigma = 1.1): number[] {
  const cdf = (x: number) => (x <= 0 ? 0 : normalCdf((Math.log(x) - Math.log(Math.max(1, center))) / sigma));
  const ps = ranges.map((r) => Math.max(0, (r.max === null ? 1 : cdf(r.max)) - (r.min === null ? 0 : cdf(r.min))));
  const total = ps.reduce((a, b) => a + b, 0);
  return total > 0 ? ps.map((p) => p / total) : ranges.map(() => 1 / ranges.length);
}
