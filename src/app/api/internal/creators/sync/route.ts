import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { isSyncDue, syncAccount } from "@/server/world/creators";

/**
 * For a cron job (every 1–5 minutes) so connected accounts keep being checked even when nobody is
 * browsing — page traffic alone only syncs a capped number of accounts per request.
 */
export async function POST(req: NextRequest) {
  return handle(req, { auth: "admin", mainOnly: true, tick: false }, async (rc) => {
    const now = rc.ctx.now();
    const due = rc.ctx.state.socialAccounts.filter((a) => isSyncDue(a, now));
    for (const a of due) await syncAccount(rc.ctx, a.id);
    return { synced: due.length };
  });
}
