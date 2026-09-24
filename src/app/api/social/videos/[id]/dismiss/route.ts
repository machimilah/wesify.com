import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { dismissVideo } from "@/server/world/creators";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/social/videos/[id]/dismiss">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", mainOnly: true }, (rc) => {
    dismissVideo(rc.ctx, rc.user!.id, id);
    return { ok: true };
  });
}
