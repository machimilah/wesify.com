import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { creatorOverview, syncAccount } from "@/server/world/creators";

/** Check this account for new uploads and likes now, instead of waiting for the next poll. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/social/accounts/[id]/sync">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", mainOnly: true, rateLimit: { name: "creator-sync", limit: 6, windowMs: 60_000 } }, async (rc) => {
    const account = rc.ctx.state.socialAccounts.find((a) => a.id === id && a.userId === rc.user!.id && a.status !== "revoked");
    if (!account) throw Errors.notFound("Account");
    await syncAccount(rc.ctx, id);
    return creatorOverview(rc.ctx, rc.user!.id);
  });
}
