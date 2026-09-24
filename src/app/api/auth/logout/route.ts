import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { destroySession, destroyUserSessions } from "@/server/world/users";

/** Signs out this device, or every device with `?all=1` (§4 session management). */
export async function POST(req: NextRequest) {
  return handle(req, { tick: false }, (rc) => {
    const token = req.cookies.get(rc.sessionCookie)?.value;
    if (req.nextUrl.searchParams.get("all") === "1" && rc.user) destroyUserSessions(rc.ctx, rc.user.id);
    else if (token) destroySession(rc.ctx, token);
    rc.response.cookies.push({ name: rc.sessionCookie, value: "", maxAge: 0 });
    return { ok: true };
  });
}
