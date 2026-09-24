import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { reviewApplication } from "@/server/world/creatorProgram";

const Body = z.object({ action: z.enum(["approve", "reject", "revoke"]), note: z.string().max(500).optional() });

/** Approve, reject, or remove a creator. The applicant is notified either way. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/creators/[id]">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "admin", mainOnly: true }, async (rc) => {
    const body = await readJson(req, Body);
    const app = reviewApplication(rc.ctx, { applicationId: id, action: body.action, note: body.note, actor: "admin" });
    return { id: app.id, status: app.status };
  });
}
