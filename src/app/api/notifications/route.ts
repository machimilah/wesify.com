import type { NextRequest } from "next/server";
import { handle } from "@/server/http";

export async function GET(req: NextRequest) {
  return handle(req, { auth: "user" }, (rc) =>
    rc.ctx.state.notifications
      .filter((n) => n.userId === rc.user!.id)
      .slice(-30)
      .reverse()
      .map(({ userId: _userId, ...n }) => n),
  );
}

/** Marks all notifications read. */
export async function POST(req: NextRequest) {
  return handle(req, { auth: "user", tick: false }, (rc) => {
    for (const n of rc.ctx.state.notifications) if (n.userId === rc.user!.id) n.read = true;
    return { ok: true };
  });
}
