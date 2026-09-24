import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { openCreatorMarket } from "@/server/world/creators";

/** Creator opens the market for one of their eligible uploads (max 1 per rolling 24h). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/social/videos/[id]/open">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", mainOnly: true, rateLimit: { name: "creator-open", limit: 10, windowMs: 60_000 } }, (rc) =>
    openCreatorMarket(rc.ctx, rc.user!.id, id),
  );
}
