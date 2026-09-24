import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { businessMetrics, cohorts, funnel, modelAnalytics } from "@/server/world/metrics";

/** Business metrics (§40), cohorts and funnel (§39), and model analytics (§41). */
export async function GET(req: NextRequest) {
  const part = req.nextUrl.searchParams.get("part") ?? "business";
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => {
    if (part === "model") return modelAnalytics(rc.ctx);
    return { business: businessMetrics(rc.ctx), cohorts: cohorts(rc.ctx), funnel: funnel(rc.ctx) };
  });
}
