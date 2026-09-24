import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { shareCard } from "@/server/world/queries";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/share/[id]">) {
  const { id } = await ctx.params;
  return handle(req, {}, (rc) => shareCard(rc.ctx, id));
}
