import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { creatorOverview, simulateUpload, syncAccount } from "@/server/world/creators";

/** Simulated accounts only: fake a fresh upload that already qualifies, to try the flow end to end. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/social/accounts/[id]/simulate-upload">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", mainOnly: true, rateLimit: { name: "creator-sim", limit: 10, windowMs: 60_000 } }, async (rc) => {
    simulateUpload(rc.ctx, rc.user!.id, id);
    await syncAccount(rc.ctx, id);
    return creatorOverview(rc.ctx, rc.user!.id);
  });
}
