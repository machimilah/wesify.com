/**
 * Simulates one video market end to end and prints how prices react to the trajectory (§68).
 *
 *   npm run simulate-market -- --scenario viral-spike [--scale 1] [--bots] [--seed 42]
 */
import { compactNumber } from "../src/lib/shared/format";
import type { ScenarioName } from "../src/lib/shared/types";
import { SCENARIO_NAMES } from "../src/lib/simulation/trajectories";
import { createSimulatedMarket, ensureBots } from "../src/server/world/seed";
import { emptyState } from "../src/server/world/state";
import { World } from "../src/server/world/world";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "true";
}

const scenario = (arg("scenario") ?? "viral-spike") as ScenarioName;
if (!SCENARIO_NAMES.includes(scenario)) {
  console.error(`Unknown scenario "${scenario}". Options: ${SCENARIO_NAMES.join(", ")}`);
  process.exit(1);
}
const scale = Number(arg("scale") ?? 1);
const seed = Number(arg("seed") ?? 42);
const bots = arg("bots") === "true";

async function main() {
  const start = Date.UTC(2026, 0, 1, 12);
  let real = start;
  const state = emptyState("main", { epochReal: start, epochWorld: start, scale: 1 });
  const world = new World(state, { realNow: () => real, bots, minActiveMarkets: 0 });
  if (bots) ensureBots(world.ctx, 12);
  const { market } = createSimulatedMarket(world.ctx, { scenario, seed, scale, openedAt: start, ageHours: 1 });
  const outcomes = state.outcomes[market.id];

  const header = ["hour", "likes", "momentum", ...outcomes.map((o) => o.label.padStart(9))];
  console.log(`\nScenario: ${scenario}  scale: ${scale}  bots: ${bots}\n`);
  console.log(header.join("  "));
  const row = (h: number) =>
    [
      String(h).padStart(4),
      compactNumber(market.currentLikes).padStart(5),
      market.momentumLabel.padEnd(9),
      ...outcomes.map((o) => `${(o.currentPrice * 100).toFixed(1)}%`.padStart(9)),
    ].join("  ");

  console.log(row(0));
  for (let h = 1; h <= 24; h++) {
    real = start + h * 3_600_000;
    await world.tick();
    console.log(row(h));
  }
  const winner = outcomes.find((o) => o.id === market.winningOutcomeId);
  console.log(`\nStatus: ${market.status}  final likes: ${compactNumber(market.finalMetric ?? 0)}  winner: ${winner?.label ?? "—"}`);
  if (bots) console.log(`Trades: ${state.trades.length}  risk flags: ${state.riskFlags.length}`);
}

void main();
