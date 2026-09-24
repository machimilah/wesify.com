import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { launchGate } from "@/server/admin/readModels";
import { founderDashboard } from "@/server/world/metrics";

/** Founder dashboard (§67): today's numbers, queues and system status without SQL. */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true }, (rc) => {
    const gate = launchGate(rc.ctx);
    return {
      now: rc.ctx.now(),
      admin: rc.admin,
      dashboard: founderDashboard(rc.ctx),
      launchGate: gate,
      alerts: (rc.ctx.state.alerts ?? []).filter((a) => !a.acknowledgedAt).slice(-20).reverse(),
    };
  });
}
