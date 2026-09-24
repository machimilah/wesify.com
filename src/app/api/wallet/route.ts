import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { wallet } from "@/server/world/queries";

/** W$ transaction history from the ledger (§10), newest first, paged by `cursor`. */
export async function GET(req: NextRequest) {
  const cursor = Number(req.nextUrl.searchParams.get("cursor"));
  return handle(req, { auth: "user" }, (rc) => wallet(rc.ctx, rc.user!, { cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : undefined }));
}
