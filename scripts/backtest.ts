/**
 * Backtest of the V0 virality model (§70–71):
 *   historical snapshot → predicted bucket distribution → compare with actual final bucket.
 *
 * Until real trajectories are collected this runs on the synthetic scenarios with randomized
 * scales, so it validates mechanics and calibration shape rather than real-world accuracy.
 *
 *   npm run backtest -- [--runs 40] [--sweep]
 */
import { mulberry32 } from "../src/lib/shared/random";
import { SCENARIO_NAMES } from "../src/lib/simulation/trajectories";
import { MODEL_PARAMS, naiveLinearForecast, winningRangeIndex } from "../src/lib/virality-engine";
import { rangesOf } from "../src/server/world/markets";
import { createSimulatedMarket } from "../src/server/world/seed";
import { emptyState } from "../src/server/world/state";
import { World } from "../src/server/world/world";

const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 40;
const SWEEP = process.argv.includes("--sweep");
const CHECKPOINTS_H = [1, 3, 6, 12, 18];

type Obs = { hour: number; probs: number[]; naive: number[]; actual: number };

async function collect(runs: number): Promise<Obs[]> {
  const rnd = mulberry32(2026);
  const observations: Obs[] = [];
  for (let r = 0; r < runs; r++) {
    for (const scenario of SCENARIO_NAMES) {
      const start = Date.UTC(2026, 0, 1) + r * 7_200_000;
      let real = start;
      const state = emptyState("main", { epochReal: start, epochWorld: start, scale: 1 });
      const world = new World(state, { realNow: () => real, bots: false, minActiveMarkets: 0 });
      const { market } = createSimulatedMarket(world.ctx, {
        scenario,
        seed: Math.floor(rnd() * 2 ** 31),
        openedAt: start,
        scale: 0.15 + rnd() * 2.5,
        ageHours: 0.5 + rnd() * 4,
      });
      const outcomes = state.outcomes[market.id];
      const snapshots: { hour: number; probs: number[]; naive: number[] }[] = [];
      for (const hour of CHECKPOINTS_H) {
        real = start + hour * 3_600_000;
        await world.tick();
        const snaps = state.snapshots[market.videoId];
        const now = world.now();
        const hourAgo = snaps.find((x) => x.capturedAt >= now - 3_600_000) ?? snaps[0];
        const last = snaps[snaps.length - 1];
        const v1h = (last.likes - hourAgo.likes) / Math.max(1, (last.capturedAt - hourAgo.capturedAt) / 60_000);
        snapshots.push({
          hour,
          probs: outcomes.map((o) => o.modelProbability),
          naive: naiveLinearForecast({ currentLikes: market.currentLikes, now, settlesAt: market.settlesAt, velocity1h: v1h, ranges: rangesOf(outcomes) }),
        });
      }
      real = start + 25 * 3_600_000;
      await world.tick();
      // Flagged markets wait for a reviewer; score them on the recorded (proposed) final count.
      const actual = winningRangeIndex(rangesOf(outcomes), market.finalMetric ?? market.proposedSettlement?.finalMetric ?? market.currentLikes);
      for (const s of snapshots) observations.push({ ...s, actual });
    }
  }
  return observations;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const brier = (obs: Obs[]) => mean(obs.map((o) => o.probs.reduce((s, p, i) => s + (p - (i === o.actual ? 1 : 0)) ** 2, 0)));
const logloss = (obs: Obs[]) => mean(obs.map((o) => -Math.log(Math.max(1e-6, o.probs[o.actual]))));

/** Expected calibration error across 10 bins, weighted by bin size. */
function ece(obs: Obs[]) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, hits: 0 }));
  let total = 0;
  for (const o of obs) {
    o.probs.forEach((p, i) => {
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.n++;
      total++;
      b.predicted += p;
      if (i === o.actual) b.hits++;
    });
  }
  return { bins, ece: bins.reduce((s, b) => s + (b.n ? (b.n / total) * Math.abs(b.predicted / b.n - b.hits / b.n) : 0), 0) };
}

async function report() {
  const observations = await collect(RUNS);
  console.log(`\nBacktest: ${RUNS} runs × ${SCENARIO_NAMES.length} scenarios = ${observations.length / CHECKPOINTS_H.length} markets`);
  console.log(`Params: ${JSON.stringify(MODEL_PARAMS)}\n`);
  const naive = observations.map((o) => ({ ...o, probs: o.naive }));
  console.log(`Model vs naive linear extrapolation: Brier ${brier(observations).toFixed(3)} vs ${brier(naive).toFixed(3)}, log loss ${logloss(observations).toFixed(3)} vs ${logloss(naive).toFixed(3)}
`);
  console.log("hour   brier   logloss   top-outcome acc");
  for (const hour of CHECKPOINTS_H) {
    const obs = observations.filter((o) => o.hour === hour);
    const acc = mean(obs.map((o) => (o.probs.indexOf(Math.max(...o.probs)) === o.actual ? 1 : 0)));
    console.log(`${String(hour).padStart(4)}   ${brier(obs).toFixed(3)}   ${logloss(obs).toFixed(3).padStart(7)}   ${(acc * 100).toFixed(1)}%`);
  }
  const cal = ece(observations);
  console.log(`\nCalibration (ECE ${(cal.ece * 100).toFixed(1)} pts)`);
  console.log("bin        n      predicted   actual");
  cal.bins.forEach((b, i) => {
    if (!b.n) return;
    console.log(`${`${i * 10}–${(i + 1) * 10}%`.padEnd(9)} ${String(b.n).padStart(5)}    ${((b.predicted / b.n) * 100).toFixed(1).padStart(6)}%   ${((b.hits / b.n) * 100).toFixed(1).padStart(6)}%`);
  });
}

async function sweep() {
  const base = { ...MODEL_PARAMS };
  const grid = [];
  for (const halfLifeBase of [90, 240, 480])
    for (const halfLifeMomentum of [540, 1200])
      for (const sigmaBase of [0.12, 0.3])
        for (const sigmaHorizon of [0.75, 1.3, 2]) grid.push({ ...base, halfLifeBase, halfLifeMomentum, sigmaBase, sigmaHorizon });
  const results = [];
  for (const params of grid) {
    Object.assign(MODEL_PARAMS, params);
    const obs = await collect(Math.min(RUNS, 12));
    results.push({ params, logloss: logloss(obs), brier: brier(obs), ece: ece(obs).ece });
  }
  results.sort((a, b) => a.logloss - b.logloss);
  console.log("logloss  brier   ECE    params");
  for (const r of results.slice(0, 10)) {
    console.log(`${r.logloss.toFixed(3)}   ${r.brier.toFixed(3)}  ${(r.ece * 100).toFixed(1).padStart(4)}   ${JSON.stringify(r.params)}`);
  }
  Object.assign(MODEL_PARAMS, base);
}

void (SWEEP ? sweep() : report());
