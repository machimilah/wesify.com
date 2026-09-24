import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { DEMO_COOKIE, DEMO_SESSION_COOKIE, setCookie, worldMeta } from "@/server/http";
import { createDemoWorld, deleteDemoWorld } from "@/server/store";
import { meDTO } from "@/server/world/queries";
import { createSession, createUser } from "@/server/world/users";

const DEMO_COOKIE_AGE = 60 * 60;

/** Starts (or restarts) a private demo sandbox: 24 hours compressed into 3 minutes (§90). */
export async function POST(req: NextRequest) {
  const previous = req.cookies.get(DEMO_COOKIE)?.value;
  if (previous) deleteDemoWorld(previous);
  const { id, world } = createDemoWorld();
  const user = createUser(world.ctx, { username: `you.${randomBytes(2).toString("hex")}` });
  const token = createSession(world.ctx, user.id);
  const res = NextResponse.json({ data: meDTO(world.ctx, user), meta: worldMeta(world) });
  setCookie(res, DEMO_COOKIE, id, DEMO_COOKIE_AGE);
  setCookie(res, DEMO_SESSION_COOKIE, token, DEMO_COOKIE_AGE);
  return res;
}

export async function DELETE(req: NextRequest) {
  const id = req.cookies.get(DEMO_COOKIE)?.value;
  if (id) deleteDemoWorld(id);
  const res = NextResponse.json({ data: { ok: true } });
  setCookie(res, DEMO_COOKIE, "", 0);
  setCookie(res, DEMO_SESSION_COOKIE, "", 0);
  return res;
}
