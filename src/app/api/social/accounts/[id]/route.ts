import { after, type NextRequest } from "next/server";
import { revokePlatformToken } from "@/server/creator/providers";
import { handle } from "@/server/http";
import { disconnectAccount } from "@/server/world/creators";

/** Disconnect (§31): tokens are deleted now and revoked with the platform after the response. `?purge=1` also deletes tracked-video data. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/social/accounts/[id]">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "user", mainOnly: true }, (rc) => {
    const revoke = disconnectAccount(rc.ctx, rc.user!.id, id, { purge: req.nextUrl.searchParams.get("purge") === "1" });
    if (revoke) after(() => revokePlatformToken(revoke.platform, revoke.token));
    return { ok: true, revoked: Boolean(revoke) };
  });
}
