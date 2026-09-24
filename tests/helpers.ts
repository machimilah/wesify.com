import { emptyState } from "@/server/world/state";
import { World, type WorldOptions } from "@/server/world/world";

export const HOUR = 3_600_000;
export const MIN = 60_000;

/** A world with a controllable clock, no bots, and no automatic market top-up. */
export function testWorld(start = Date.UTC(2026, 8, 13, 12), opts: WorldOptions = {}) {
  let real = start;
  const state = emptyState("main", { epochReal: start, epochWorld: start, scale: 1 });
  const world = new World(state, { realNow: () => real, bots: false, minActiveMarkets: 0, ...opts });
  return {
    world,
    ctx: world.ctx,
    advance: (ms: number) => {
      real += ms;
    },
    now: () => real,
  };
}
