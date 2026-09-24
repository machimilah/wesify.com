import {
  BROAD_PRIOR,
  PROBABILITY_FLOOR,
  SMOOTHING_ALPHA,
  SMOOTHING_ALPHA_SPIKE,
  type RangeDef,
} from "../shared/constants";
import type { MetricSnapshot, MomentumLabel } from "../shared/types";

const MIN = 60_000;
const EPSILON_VELOCITY = 0.5; // likes/min
const VELOCITY_CEILING = 3000; // likes/min mapped to normalized 1.0

export type ViralityFeatures = {
  velocity5m: number;
  velocity15m: number;
  velocity30m: number;
  velocity1h: number;
  velocity3h: number;
  velocity6h: number;
  acceleration30m: number;
  acceleration1h: number;
  relativeAcceleration30m: number;
  relativeAcceleration1h: number;
  /** 5-minute velocity relative to the 1-hour velocity (>1 = speeding up right now). */
  relativeVelocity: number;
  /** Fractional like growth over the last 3 hours (4.38 = +438%). */
  change3h: number;
  momentumScore: number;
  /** Minutes of trajectory data available. */
  coverageMinutes: number;
};

export type Forecast = {
  expectedFinalLikes: number;
  medianGrowth: number;
  /** Log-space standard deviation of future growth. */
  uncertainty: number;
  probabilities: number[];
};

// ---------------------------------------------------------------------------
// Time-series helpers
// ---------------------------------------------------------------------------

/** Linear interpolation of likes at time t. History must be sorted by capturedAt. */
export function likesAt(history: MetricSnapshot[], t: number): number | null {
  if (history.length === 0) return null;
  if (t < history[0].capturedAt) return null;
  const last = history[history.length - 1];
  if (t >= last.capturedAt) return last.likes;
  let lo = 0;
  let hi = history.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (history[mid].capturedAt <= t) lo = mid;
    else hi = mid;
  }
  const a = history[lo];
  const b = history[hi];
  const span = b.capturedAt - a.capturedAt;
  if (span <= 0) return b.likes;
  return a.likes + ((b.likes - a.likes) * (t - a.capturedAt)) / span;
}

/**
 * velocity_window = (new_likes - old_likes) / elapsed_minutes, evaluated at `at`.
 * When history does not reach back a full window, uses the earliest available point.
 */
export function velocity(history: MetricSnapshot[], at: number, windowMin: number): number {
  if (history.length < 2) return 0;
  const now = likesAt(history, at);
  if (now === null) return 0;
  const start = Math.max(at - windowMin * MIN, history[0].capturedAt);
  const elapsedMin = (at - start) / MIN;
  if (elapsedMin <= 0) return 0;
  const old = likesAt(history, start)!;
  return (now - old) / elapsedMin;
}

export function relativeAcceleration(current: number, previous: number): number {
  return (current - previous) / Math.max(previous, EPSILON_VELOCITY);
}

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Log-scaled velocity → [0, 1]. */
export function normalizeVelocity(v: number): number {
  return clamp(Math.log10(1 + Math.max(0, v)) / Math.log10(1 + VELOCITY_CEILING), 0, 1);
}

/** Relative acceleration → [0, 1], 0.5 = constant velocity. */
export function normalizeAcceleration(rel: number): number {
  return clamp(0.5 + 0.5 * Math.tanh(rel / 1.5), 0, 1);
}

export function computeFeatures(history: MetricSnapshot[], now: number): ViralityFeatures {
  const v5 = velocity(history, now, 5);
  const v15 = velocity(history, now, 15);
  const v30 = velocity(history, now, 30);
  const v1h = velocity(history, now, 60);
  const v3h = velocity(history, now, 180);
  const v6h = velocity(history, now, 360);
  const prev30 = velocity(history, now - 30 * MIN, 30);
  const prev1h = velocity(history, now - 60 * MIN, 60);

  const rel30 = relativeAcceleration(v30, prev30);
  const rel1h = relativeAcceleration(v1h, prev1h);

  const likesNow = likesAt(history, now) ?? 0;
  const likes3hAgo = likesAt(history, Math.max(now - 180 * MIN, history[0]?.capturedAt ?? now)) ?? 0;
  const change3h = likes3hAgo > 0 ? (likesNow - likes3hAgo) / likes3hAgo : 0;

  const momentumScore = clamp(
    0.3 * normalizeVelocity(v5) +
      0.2 * normalizeVelocity(v30) +
      0.2 * normalizeVelocity(v1h) +
      0.15 * normalizeAcceleration(rel30) +
      0.1 * normalizeAcceleration(rel1h) +
      0.05 * normalizeVelocity(v3h),
    0,
    1,
  );

  return {
    velocity5m: v5,
    velocity15m: v15,
    velocity30m: v30,
    velocity1h: v1h,
    velocity3h: v3h,
    velocity6h: v6h,
    acceleration30m: v30 - prev30,
    acceleration1h: v1h - prev1h,
    relativeAcceleration30m: rel30,
    relativeAcceleration1h: rel1h,
    relativeVelocity: v5 / Math.max(v1h, EPSILON_VELOCITY),
    change3h,
    momentumScore,
    coverageMinutes: history.length ? (now - history[0].capturedAt) / MIN : 0,
  };
}

export function momentumLabel(score: number): MomentumLabel {
  if (score < 0.2) return "COOLING";
  if (score < 0.4) return "STABLE";
  if (score < 0.6) return "RISING";
  if (score < 0.8) return "SURGING";
  return "EXPLODING";
}

/** EWMA smoothing of the momentum score so one data point cannot flip the label. */
export function smoothMomentum(previous: number | null, next: number, alpha = 0.3): number {
  if (previous === null) return next;
  return alpha * next + (1 - alpha) * previous;
}

// ---------------------------------------------------------------------------
// Forecast & distribution
// ---------------------------------------------------------------------------

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Tunable V0 parameters; `npm run backtest -- --sweep` evaluates alternatives. Chosen from a coarse
 * sweep on synthetic trajectories (initial hand-set values were overconfident: 85% calls hit 49%).
 * Re-tune once real trajectories exist.
 */
export const MODEL_PARAMS = {
  halfLifeBase: 480,
  halfLifeMomentum: 1200,
  sigmaBase: 0.3,
  sigmaHorizon: 2,
  sigmaMomentum: 0.35,
};

/** Stored with every forecast (§19 "store model version"); bump when the model's math changes. */
export const MODEL_VERSION = "v0.2-decay-lognormal";

export type ForecastInput = {
  currentLikes: number;
  now: number;
  settlesAt: number;
  features: ViralityFeatures;
  ranges: RangeDef[];
  /**
   * Cold-start prior (§19), e.g. from the creator's baseline. Blended in while trajectory data is
   * thin. Defaults to the legacy five-range broad prior, or uniform for other range counts.
   */
  prior?: number[];
};

/**
 * V0 heuristic: decay-adjusted velocity integrated to settlement.
 *   future_velocity(t) = v_now * accel * exp(-k t)
 *   growth = ∫ future_velocity = v_now * accel * (1 - e^{-kT}) / k
 * Future growth is modelled as log-normal around that median; final = current + growth.
 */
export function forecast(input: ForecastInput): Forecast {
  const { currentLikes, now, settlesAt, features: f, ranges } = input;
  const remainingMin = Math.max(0, (settlesAt - now) / MIN);

  const vNow = Math.max(0, 0.5 * f.velocity30m + 0.3 * f.velocity1h + 0.2 * f.velocity5m);
  const accel = clamp(
    1 + 0.35 * clamp(f.relativeAcceleration30m, -1, 3) + 0.25 * clamp(f.relativeAcceleration1h, -1, 3),
    0.4,
    2.5,
  );
  const P = MODEL_PARAMS;
  const halfLifeMin = P.halfLifeBase + P.halfLifeMomentum * f.momentumScore;
  const k = Math.LN2 / halfLifeMin;
  const medianGrowth = Math.max(1, (vNow * accel * (1 - Math.exp(-k * remainingMin))) / k);

  const horizon = Math.sqrt(remainingMin / 1440);
  const uncertainty = P.sigmaBase + horizon * (P.sigmaHorizon + P.sigmaMomentum * f.momentumScore);

  const growthCdf = (x: number) =>
    x <= 0 ? 0 : normalCdf((Math.log(x) - Math.log(medianGrowth)) / Math.max(uncertainty, 1e-6));

  let probabilities = ranges.map((r) => {
    const upper = r.max === null ? 1 : growthCdf(r.max - currentLikes);
    const lower = r.min === null ? 0 : growthCdf(r.min - currentLikes);
    return Math.max(0, upper - lower);
  });

  // Blend toward the cold-start prior when trajectory data is thin (§19 fallback with little history).
  const confidence = clamp(f.coverageMinutes / 60, 0, 1);
  const prior =
    input.prior && input.prior.length === ranges.length
      ? input.prior
      : ranges.length === BROAD_PRIOR.length
        ? BROAD_PRIOR
        : ranges.map(() => 1 / ranges.length);
  if (confidence < 1) {
    probabilities = probabilities.map((p, i) => confidence * p + (1 - confidence) * prior[i]);
  }

  const expectedFinalLikes =
    currentLikes + medianGrowth * Math.exp((uncertainty * uncertainty) / 2);

  return {
    expectedFinalLikes,
    medianGrowth,
    uncertainty,
    probabilities: enforceReachable(normalize(probabilities), ranges, currentLikes),
  };
}

export function normalize(ps: number[], floor = PROBABILITY_FLOOR): number[] {
  const floored = ps.map((p) => (Number.isFinite(p) ? Math.max(p, 0) : 0));
  const total = floored.reduce((a, b) => a + b, 0);
  const base = total > 0 ? floored.map((p) => p / total) : floored.map(() => 1 / floored.length);
  const lifted = base.map((p) => Math.max(p, floor));
  const liftedTotal = lifted.reduce((a, b) => a + b, 0);
  return lifted.map((p) => p / liftedTotal);
}

/** Ranges already exceeded by current likes can no longer win: pin them to the floor. */
export function enforceReachable(ps: number[], ranges: RangeDef[], currentLikes: number): number[] {
  const adjusted = ps.map((p, i) => {
    const max = ranges[i].max;
    return max !== null && currentLikes >= max ? 0 : p;
  });
  return normalize(adjusted);
}

/**
 * smoothed = alpha * new + (1 - alpha) * previous. Alpha rises to 0.35 during spikes.
 */
export function smoothProbabilities(
  previous: number[] | null,
  next: number[],
  opts: { spike: boolean },
): number[] {
  if (!previous || previous.length !== next.length) return normalize(next);
  const alpha = opts.spike ? SMOOTHING_ALPHA_SPIKE : SMOOTHING_ALPHA;
  return normalize(next.map((p, i) => alpha * p + (1 - alpha) * previous[i]));
}

export function isSpike(f: ViralityFeatures): boolean {
  return f.momentumScore >= 0.6 && f.relativeAcceleration30m > 0.5;
}

/**
 * Index of the range that contains `likes`. Boundaries are min-inclusive, max-exclusive, so a count
 * exactly on a boundary belongs to the higher range (§1 tie and boundary rule).
 */
export function winningRangeIndex(ranges: RangeDef[], likes: number): number {
  return ranges.findIndex(
    (r) => (r.min === null || likes >= r.min) && (r.max === null || likes < r.max),
  );
}

/**
 * A model output is valid when it has one finite probability per range, each in [0, 1], summing
 * to 1 (§19 "alert if model output becomes invalid"). Invalid output is never priced.
 */
export function isValidDistribution(ps: number[], n: number): boolean {
  if (ps.length !== n) return false;
  let sum = 0;
  for (const p of ps) {
    if (!Number.isFinite(p) || p < 0 || p > 1) return false;
    sum += p;
  }
  return Math.abs(sum - 1) < 1e-6;
}

/**
 * Naive baseline for model evaluation (§19 "compare against naive linear extrapolation"): the last
 * hour's velocity continued in a straight line to settlement, with a fixed log-normal spread.
 */
export function naiveLinearForecast(input: { currentLikes: number; now: number; settlesAt: number; velocity1h: number; ranges: RangeDef[] }): number[] {
  const remainingMin = Math.max(0, (input.settlesAt - input.now) / MIN);
  const median = Math.max(1, input.velocity1h * remainingMin);
  const sigma = 0.6;
  const cdf = (x: number) => (x <= 0 ? 0 : normalCdf((Math.log(x) - Math.log(median)) / sigma));
  const ps = input.ranges.map((r) => Math.max(0, (r.max === null ? 1 : cdf(r.max - input.currentLikes)) - (r.min === null ? 0 : cdf(r.min - input.currentLikes))));
  return enforceReachable(normalize(ps), input.ranges, input.currentLikes);
}

/**
 * Protection against one noisy snapshot (§19): drops points that break monotonic growth by more
 * than 20% or jump far above both neighbours, so velocity isn't computed from a glitch.
 */
export function robustHistory(history: MetricSnapshot[]): MetricSnapshot[] {
  if (history.length < 3) return history;
  const out: MetricSnapshot[] = [history[0]];
  for (let i = 1; i < history.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = history[i];
    const next = history[i + 1];
    const dropped = cur.likes < prev.likes * 0.8;
    const spikeThenRevert = cur.likes > prev.likes * 3 && next.likes < cur.likes * 0.5 && cur.likes - prev.likes > 1000;
    if (!dropped && !spikeThenRevert) out.push(cur);
  }
  out.push(history[history.length - 1]);
  return out;
}
