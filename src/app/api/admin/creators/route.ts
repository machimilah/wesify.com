import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { listApplications } from "@/server/world/creatorProgram";

/** Review queue for the creator program. */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "admin", mainOnly: true }, (rc) => ({ applications: listApplications(rc.ctx) }));
}
