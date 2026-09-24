import type { NextRequest } from "next/server";
import { z } from "zod";
import { SCENARIO_NAMES } from "@/lib/simulation/trajectories";
import type { ScenarioName } from "@/lib/shared/types";
import { handle, readJson } from "@/server/http";
import { marketsList } from "@/server/admin/readModels";
import { createManualMarket } from "@/server/world/ingestion";
import { createSimulatedMarket, nextSeed } from "@/server/world/seed";

/** Market search (§33). `status`: all | live | review | OPEN | PAUSED | … */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return handle(req, { auth: "support", mainOnly: true }, (rc) => marketsList(rc.ctx, { q: p.get("q") ?? "", status: p.get("status") ?? "live" }));
}

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("simulated"), scenario: z.enum(SCENARIO_NAMES as [ScenarioName, ...ScenarioName[]]), handle: z.string().regex(/^[A-Za-z0-9._]{2,24}$/).optional() }),
  z.object({
    kind: z.literal("manual"),
    url: z.string().url(),
    initialLikes: z.number().int().nonnegative(),
    ageMinutes: z.number().int().min(0).max(359).optional(),
    followers: z.number().int().positive().optional(),
    avgLikes: z.number().int().positive().optional(),
  }),
]);

/** Create a market directly (admin override of eligibility, §14). */
export async function POST(req: NextRequest) {
  return handle(req, { auth: "admin", mainOnly: true }, async (rc) => {
    const body = await readJson(req, Body);
    if (body.kind === "simulated") {
      const { market } = createSimulatedMarket(rc.ctx, { scenario: body.scenario, handle: body.handle, openedAt: rc.ctx.now(), seed: nextSeed(), actor: "admin" });
      return { marketId: market.id };
    }
    return createManualMarket(rc.ctx, { ...body, actor: rc.admin!.id });
  });
}
