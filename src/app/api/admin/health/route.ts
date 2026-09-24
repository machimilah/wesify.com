import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { healthReport } from "@/server/admin/readModels";
import { audit } from "@/server/world/context";
import { checkIntegrity } from "@/server/world/integrity";

/** System health (§42): jobs, providers, errors, alerts, latency, storage, env, costs. `?integrity=1` runs the balance audit. */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => {
    if (req.nextUrl.searchParams.get("integrity") === "1") return { integrity: checkIntegrity(rc.ctx.state) };
    return healthReport(rc.ctx);
  });
}

const Body = z.object({ action: z.literal("ack-alerts"), ids: z.array(z.string()).max(500).optional() });

export async function POST(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    const now = rc.ctx.now();
    let n = 0;
    for (const a of rc.ctx.state.alerts ?? []) {
      if (a.acknowledgedAt || (body.ids && !body.ids.includes(a.id))) continue;
      a.acknowledgedAt = now;
      n++;
    }
    audit(rc.ctx, { actor: rc.admin!.id, action: "admin.ack_alerts", entityType: "alert", entityId: "*", metadata: { count: n } });
    return { acknowledged: n };
  });
}
