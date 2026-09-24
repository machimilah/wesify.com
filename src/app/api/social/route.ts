import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { creatorOverview } from "@/server/world/creators";

/** Connected accounts, watched uploads, and the creator's daily limit. */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "user", mainOnly: true }, (rc) => creatorOverview(rc.ctx, rc.user!.id));
}
