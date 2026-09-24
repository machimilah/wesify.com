/**
 * Resets the local store and seeds the main world with simulated markets (§47).
 * Stop the dev server first; it keeps state in memory and would overwrite the file.
 *
 *   npm run seed -- [--markets 24]
 */
import fs from "node:fs";
import path from "node:path";
import { seedMainWorld } from "../src/server/world/seed";
import { emptyState } from "../src/server/world/state";
import { MAIN_WORLD_DEFAULTS, World } from "../src/server/world/world";

const i = process.argv.indexOf("--markets");
const count = i > 0 ? Number(process.argv[i + 1]) : 24;
const dir = process.env.WESIFY_DATA_DIR || path.join(process.cwd(), ".data");

async function main() {
  const now = Date.now();
  const world = new World(emptyState("main", { epochReal: now, epochWorld: now, scale: 1 }), MAIN_WORLD_DEFAULTS);
  seedMainWorld(world.ctx, count);
  await world.tick();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.json"), JSON.stringify(world.state));
  const open = Object.values(world.state.markets).filter((m) => m.status === "OPEN").length;
  console.log(`Seeded ${open} open markets and ${Object.values(world.state.users).filter((u) => u.isBot).length} simulated traders → ${dir}`);
}

void main();
