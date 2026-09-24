import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { portfolio } from "@/server/world/queries";

export async function GET(req: NextRequest) {
  return handle(req, { auth: "user" }, (rc) => portfolio(rc.ctx, rc.user!));
}
