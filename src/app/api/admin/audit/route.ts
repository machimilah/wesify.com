import type { NextRequest } from "next/server";
import { handle } from "@/server/http";

/** Audit log search (§33, §43): by actor, action or entity id. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").toLowerCase();
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) =>
    rc.ctx.state.auditLogs
      .filter((a) => !q || a.action.toLowerCase().includes(q) || a.entityId.toLowerCase().includes(q) || (a.actor ?? "system").toLowerCase().includes(q))
      .slice(-300)
      .reverse(),
  );
}
