import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { audit, raiseAlert } from "@/server/world/context";
import { setFlag } from "@/server/world/flags";
import { approveSettlement, pauseMarket, resumeMarket } from "@/server/world/markets";

const Body = z.discriminatedUnion("action", [
  // Incident response (§56): pause every market / disable trading everywhere, and undo.
  z.object({ action: z.literal("pause-all"), reason: z.string().trim().min(3).max(200), confirm: z.literal("PAUSE ALL") }),
  z.object({ action: z.literal("resume-all") }),
  z.object({ action: z.literal("trading-kill-switch"), enabled: z.boolean(), confirm: z.literal("CONFIRM") }),
  // Settlement review queue: approve every proposal that passed all integrity checks.
  z.object({ action: z.literal("approve-clean-settlements"), confirm: z.literal("APPROVE") }),
]);

export async function POST(req: NextRequest) {
  return handle(req, { auth: "admin", mainOnly: true }, async (rc) => {
    const body = await readJson(req, Body);
    const actor = rc.admin!.id;
    const markets = Object.values(rc.ctx.state.markets);
    switch (body.action) {
      case "pause-all": {
        const reason = `Paused by Wesify: ${body.reason}`;
        let n = 0;
        for (const m of markets) if (m.status === "OPEN" && pauseMarket(rc.ctx, m.id, reason, actor)) n++;
        audit(rc.ctx, { actor, action: "admin.pause_all", entityType: "market", entityId: "*", metadata: { count: n, reason: body.reason } });
        raiseAlert(rc.ctx, "critical", `All markets paused by ${actor}: ${body.reason}`);
        return { paused: n };
      }
      case "resume-all": {
        let n = 0;
        for (const m of markets) if (m.status === "PAUSED" && m.pausedReason?.startsWith("Paused by Wesify:") && resumeMarket(rc.ctx, m.id, actor)) n++;
        audit(rc.ctx, { actor, action: "admin.resume_all", entityType: "market", entityId: "*", metadata: { count: n } });
        return { resumed: n };
      }
      case "trading-kill-switch":
        setFlag(rc.ctx, "globalPause", { enabled: body.enabled }, actor);
        audit(rc.ctx, { actor, action: "admin.global_pause", entityType: "flag", entityId: "globalPause", metadata: { enabled: body.enabled } });
        raiseAlert(rc.ctx, "critical", `Trading ${body.enabled ? "DISABLED" : "re-enabled"} globally by ${actor}`);
        return { globalPause: body.enabled };
      case "approve-clean-settlements": {
        const done: string[] = [];
        for (const m of markets) {
          if (m.status !== "SETTLING" || !m.proposedSettlement || m.proposedSettlement.issues.length) continue;
          approveSettlement(rc.ctx, m.id, { actor });
          done.push(m.id);
        }
        return { settled: done.length };
      }
    }
  });
}
