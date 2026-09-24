import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { sell } from "@/server/world/trading";

const Body = z.object({
  outcomeId: z.string().min(1).max(100),
  shares: z.number({ error: "Enter shares to sell." }).positive("Enter shares to sell.").max(1e12),
  expectedPrice: z.number().min(0).max(1).optional(),
  tolerance: z.number().min(0.001).max(0.2).optional(),
});

/** Server-side validated, atomic and idempotent sell (§9). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/markets/[id]/sell">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", idempotent: true, rateLimit: { name: "trade", limit: 40, windowMs: 60_000, key: "user" } }, async (rc) => {
    const body = await readJson(req, Body);
    return sell(rc.ctx, { userId: rc.user!.id, marketId: id, ...body });
  });
}
