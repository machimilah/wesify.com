import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { buy } from "@/server/world/trading";

const Body = z.object({
  outcomeId: z.string().min(1).max(100),
  credits: z.number({ error: "Enter an amount." }).positive("Enter an amount.").max(1_000_000),
  /** Price the user confirmed; the order fails with PRICE_CHANGED if it moved more than the tolerance. */
  expectedPrice: z.number().min(0).max(1).optional(),
  tolerance: z.number().min(0.001).max(0.2).optional(),
});

/** Server-side validated, atomic and idempotent (send an Idempotency-Key header) buy (§8). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/markets/[id]/buy">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", idempotent: true, rateLimit: { name: "trade", limit: 40, windowMs: 60_000, key: "user" } }, async (rc) => {
    const body = await readJson(req, Body);
    return buy(rc.ctx, { userId: rc.user!.id, marketId: id, ...body });
  });
}
