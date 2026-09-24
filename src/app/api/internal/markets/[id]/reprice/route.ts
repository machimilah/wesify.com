import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { audit } from "@/server/world/context";
import { getMarket, reprice } from "@/server/world/markets";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/internal/markets/[id]/reprice">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "cron", mainOnly: true }, (rc) => {
    const { market, outcomes } = getMarket(rc.ctx, id);
    const { forecast } = reprice(rc.ctx, market, rc.ctx.now());
    audit(rc.ctx, { actor: "internal", action: "market.reprice", entityType: "market", entityId: id });
    return {
      momentum: { score: market.momentumScore, label: market.momentumLabel },
      expectedFinalLikes: Math.round(forecast.expectedFinalLikes),
      prices: Object.fromEntries(outcomes.map((o) => [o.label, o.currentPrice])),
    };
  });
}
