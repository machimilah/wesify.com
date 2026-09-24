import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { profile } from "@/server/world/queries";

export async function GET(req: NextRequest) {
  return handle(req, { auth: "user" }, (rc) => profile(rc.ctx, rc.user!));
}
