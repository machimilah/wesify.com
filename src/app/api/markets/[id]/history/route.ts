import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { priceHistory } from "@/server/world/queries";

const RANGES = ["1H", "3H", "6H", "ALL"] as const;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/markets/[id]/history">) {
  const { id } = await ctx.params;
  const param = req.nextUrl.searchParams.get("range")?.toUpperCase();
  const range = RANGES.find((r) => r === param) ?? "1H";
  return handle(req, {}, (rc) => priceHistory(rc.ctx, id, range));
}
