import { NextResponse, type NextRequest } from "next/server";
import { getMainWorld } from "@/server/store";
import { isCreatorPlatform } from "@/server/creator/providers";
import { creatorRedirectUri } from "@/server/creator/redirect";
import { resolveMainUser } from "@/server/http";
import { WesifyError } from "@/server/world/errors";
import { completeConnect, syncAccount } from "@/server/world/creators";
import { programState } from "@/server/world/creatorProgram";

/** OAuth return leg: validates `state`, exchanges the code, links the account, runs a first sync. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/social/[platform]/callback">) {
  const { platform } = await ctx.params;
  const q = req.nextUrl.searchParams;

  const world = getMainWorld();
  const user = await resolveMainUser(req, world);
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings", req.url));
  // Creators go back to the studio; everyone else connected from their settings page.
  const back = new URL(programState(world.ctx, user.id) === "active" ? "/creator" : "/settings", req.url);
  if (!isCreatorPlatform(platform)) {
    back.searchParams.set("error", "Unsupported platform.");
    return NextResponse.redirect(back);
  }

  const denied = q.get("error_description") ?? q.get("error");
  try {
    const account = await completeConnect(world.ctx, {
      state: q.get("state") ?? "",
      code: denied ? null : q.get("code"),
      redirectUri: creatorRedirectUri(req, platform),
      wesifyUserId: user.id,
    });
    await syncAccount(world.ctx, account.id);
    back.searchParams.set("connected", platform);
  } catch (err) {
    back.searchParams.set("error", err instanceof WesifyError ? err.message : "Could not connect the account.");
  } finally {
    world.mutate(() => undefined); // persist
  }
  return NextResponse.redirect(back);
}
