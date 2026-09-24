import type { NextRequest } from "next/server";
import { z } from "zod";
import { providerFor } from "@/lib/social-providers";
import { handle } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { getMarket, lockMarket, proposeSettlement } from "@/server/world/markets";

const Body = z.object({ finalLikes: z.number().int().nonnegative().optional() });

/**
 * Records a proposed final result for a market past its settlement time. Payout still waits for a
 * reviewer (§1), so a forged or repeated call can never pay anyone (§28). Idempotent.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/internal/markets/[id]/settle">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "cron", mainOnly: true }, async (rc) => {
    const body = Body.parse(await req.json().catch(() => ({})));
    const { market, video } = getMarket(rc.ctx, id);
    if (rc.ctx.now() < market.settlesAt) throw Errors.invalid("This market hasn't reached its settlement time.");
    let likes = body.finalLikes;
    let source = "internal";
    if (likes === undefined) {
      const metrics = await providerFor(video).getMetrics(video, market.settlesAt);
      likes = metrics.likes;
      source = metrics.source;
    }
    lockMarket(rc.ctx, id, "internal");
    return proposeSettlement(rc.ctx, id, { likes, source, capturedAt: rc.ctx.now() }, { actor: "internal", requireReview: true });
  });
}
