import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { marketDetail } from "@/server/world/queries";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/markets/[id]">) {
  const { id } = await ctx.params;
  return handle(req, {}, (rc) => marketDetail(rc.ctx, id, rc.user, { isAdmin: Boolean(rc.admin) }));
}
