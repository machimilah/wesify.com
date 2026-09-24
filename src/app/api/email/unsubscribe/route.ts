import { NextResponse, type NextRequest } from "next/server";
import { getMainWorld } from "@/server/store";
import { verifyHmac } from "@/server/secrets";
import { audit, DEFAULT_NOTIFICATION_PREFS } from "@/server/world/context";

/**
 * One-click unsubscribe from signed email links (§50). `g=marketing` withdraws marketing consent;
 * `g=notifications` turns off notification emails. Transactional email (verification, password
 * reset) is never affected.
 */
async function unsubscribe(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const userId = q.get("u") ?? "";
  const group = q.get("g") === "marketing" ? "marketing" : "notifications";
  const sig = q.get("s") ?? "";
  const done = new URL("/unsubscribed", req.url);
  if (!verifyHmac(`unsub:${userId}.${group}`, sig)) {
    done.searchParams.set("error", "1");
    return NextResponse.redirect(done, 303);
  }
  const world = getMainWorld();
  world.mutate((ctx) => {
    const user = ctx.state.users[userId];
    if (!user) return;
    if (group === "marketing") user.consent = { analytics: user.consent?.analytics ?? false, marketing: false, updatedAt: ctx.now() };
    else user.notificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(user.notificationPrefs ?? {}), emailSettlement: false, emailMarketOpened: false, emailProduct: false };
    audit(ctx, { actor: userId, action: `user.unsubscribe_${group}`, entityType: "user", entityId: userId });
  });
  done.searchParams.set("g", group);
  return NextResponse.redirect(done, 303);
}

export const GET = unsubscribe;
/** RFC 8058 List-Unsubscribe-Post support. */
export const POST = unsubscribe;
