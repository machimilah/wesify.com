import { NextResponse, type NextRequest } from "next/server";
import { getMainWorld } from "@/server/store";
import { isCreatorPlatform } from "@/server/creator/providers";
import { resolveMainUser } from "@/server/http";
import { creatorRedirectUri } from "@/server/creator/redirect";
import { WesifyError } from "@/server/world/errors";
import { startConnect } from "@/server/world/creators";

/** Starts OAuth: sends the browser to the platform's consent screen (or the simulated stand-in). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/social/[platform]/connect">) {
  const { platform } = await ctx.params;
  const back = new URL(req.nextUrl.searchParams.get("from") === "creator" ? "/creator" : "/settings", req.url);
  if (!isCreatorPlatform(platform)) return NextResponse.redirect(new URL("/creator?error=Unsupported%20platform", req.url));

  const world = getMainWorld();
  const user = await resolveMainUser(req, world);
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings", req.url));

  try {
    const { url } = world.mutate((c) => startConnect(c, user.id, platform, creatorRedirectUri(req, platform)));
    return NextResponse.redirect(url);
  } catch (err) {
    back.searchParams.set("error", err instanceof WesifyError ? err.message : "Could not start connecting.");
    return NextResponse.redirect(back);
  }
}
