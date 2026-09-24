import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { usersList } from "@/server/admin/readModels";

/** User search (§33). `filter`: flagged | restricted. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => usersList(rc.ctx, { q: p.get("q") ?? "", filter: p.get("filter") ?? "" }));
}
