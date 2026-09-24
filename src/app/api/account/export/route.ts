import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { audit } from "@/server/world/context";
import { exportUserData } from "@/server/world/users";

/** Everything Wesify holds about the signed-in user (§4 data export, §44). The client saves it as a file. */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "user", tick: false, mainOnly: true, rateLimit: { name: "export", limit: 5, windowMs: 60 * 60_000, key: "user" } }, (rc) => {
    audit(rc.ctx, { actor: rc.user!.id, action: "user.export", entityType: "user", entityId: rc.user!.id });
    return exportUserData(rc.ctx, rc.user!);
  });
}
