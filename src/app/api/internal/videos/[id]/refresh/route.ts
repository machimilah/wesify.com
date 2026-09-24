import type { NextRequest } from "next/server";
import { providerFor } from "@/lib/social-providers";
import { handle } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { recordSnapshot } from "@/server/world/markets";

/** Fetches the latest metric for a video and reprices its market. `id` is the video id. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/internal/videos/[id]/refresh">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "cron", mainOnly: true }, async (rc) => {
    const video = rc.ctx.state.videos[id];
    if (!video) throw Errors.notFound("Video");
    const market = Object.values(rc.ctx.state.markets).find((m) => m.videoId === id);
    if (!market) throw Errors.notFound();
    const metrics = await providerFor(video).getMetrics(video, rc.ctx.now());
    const recorded = recordSnapshot(rc.ctx, market.id, metrics);
    return { recorded, likes: metrics.likes, marketId: market.id };
  });
}
