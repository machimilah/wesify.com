import type { NextRequest } from "next/server";
import { handle, readJson } from "@/server/http";
import { MarketAction, runMarketAction } from "@/server/admin/marketActions";
import { marketAdminDetail } from "@/server/admin/readModels";
import { Errors } from "@/server/world/errors";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/markets/[id]">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "support", mainOnly: true }, (rc) => {
    const d = marketAdminDetail(rc.ctx, id);
    if (!d) throw Errors.notFound();
    return d;
  });
}

/** Market actions (§33): pause/resume, metrics, review, settlement, cancellation, takedown. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/markets/[id]">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "admin", mainOnly: true }, async (rc) => {
    const body = await readJson(req, MarketAction);
    return runMarketAction(rc.ctx, rc.admin!, id, body);
  });
}
