import { noiseAt } from "../shared/random";
import type { ScenarioName } from "../shared/types";

const HOUR = 3_600_000;

/** Keypoints: [hours since market open, likes]. Scenarios A–C mirror spec §69. */
export const SCENARIOS: Record<ScenarioName, { label: string; points: [number, number][] }> = {
  flat: {
    label: "Flat",
    points: [[0, 1_000], [3, 1_400], [6, 1_800], [12, 2_200], [24, 2_500]],
  },
  "slow-growth": {
    label: "Slow growth",
    points: [[0, 3_000], [3, 7_000], [6, 12_000], [12, 26_000], [24, 58_000]],
  },
  "viral-spike": {
    label: "Viral breakout",
    points: [[0, 2_000], [3, 8_000], [6, 25_000], [9, 130_000], [12, 620_000], [18, 1_400_000], [24, 2_100_000]],
  },
  "spike-decay": {
    label: "Viral decay",
    points: [[0, 5_000], [3, 20_000], [6, 250_000], [9, 620_000], [12, 810_000], [24, 940_000]],
  },
  "late-spike": {
    label: "Late surge",
    points: [[0, 1_500], [6, 4_000], [12, 9_000], [15, 45_000], [18, 260_000], [21, 610_000], [24, 780_000]],
  },
  "fake-spike": {
    label: "Fake spike",
    points: [[0, 3_000], [5.9, 9_000], [6.1, 170_000], [9, 176_000], [24, 188_000]],
  },
  "stable-mid": {
    label: "Stable mid-range",
    points: [[0, 20_000], [3, 60_000], [6, 110_000], [12, 190_000], [24, 280_000]],
  },
  "double-spike": {
    label: "Multiple spikes",
    points: [[0, 2_500], [3, 6_000], [5, 60_000], [8, 75_000], [14, 90_000], [16, 420_000], [19, 520_000], [24, 560_000]],
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

/** Base curve with log-linear interpolation between keypoints. */
function baseLikes(scenario: ScenarioName, hours: number): number {
  const pts = SCENARIOS[scenario].points;
  if (hours <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [h1, l1] = pts[i];
    if (hours <= h1) {
      const [h0, l0] = pts[i - 1];
      const f = (hours - h0) / (h1 - h0);
      return Math.exp(Math.log(l0) + f * (Math.log(l1) - Math.log(l0)));
    }
  }
  return pts[pts.length - 1][1];
}

export type TrajectoryParams = {
  scenario: ScenarioName;
  seed: number;
  scale: number;
  openedAt: number;
  publishedAt: number;
};

/**
 * Likes at world time `t`. Before market open the curve ramps from 0 at publish time.
 * A small multiplicative noise term keeps the series from looking synthetic.
 */
export function simulatedLikes(p: TrajectoryParams, t: number): number {
  if (t <= p.publishedAt) return 0;
  const hours = (t - p.openedAt) / HOUR;
  let likes: number;
  if (hours < 0) {
    // Ramp L0·f^k from publish to open, with k chosen so the slope at open matches the first
    // post-open segment; otherwise the engine would see an artificial deceleration at open.
    const age = (p.openedAt - p.publishedAt) / HOUR;
    const [[h0, l0], [h1, l1]] = SCENARIOS[p.scenario].points;
    const k = Math.min(3, Math.max(0.5, (age * Math.log(l1 / l0)) / (h1 - h0)));
    const f = Math.max(0, (hours + age) / age);
    likes = l0 * Math.pow(f, k);
  } else {
    likes = baseLikes(p.scenario, Math.min(hours, 30));
  }
  const bucket = Math.floor(t / (5 * 60_000));
  const noise = 1 + 0.006 * noiseAt(p.seed, bucket);
  return Math.max(0, Math.round(likes * p.scale * noise));
}
