import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { signContract } from "@/server/world/creatorProgram";

const Body = z.object({ fullName: z.string().min(2).max(120), version: z.string().min(1).max(20), agree: z.literal(true) });

/** Sign the creator agreement. Required after approval, and again whenever the terms change. */
export async function POST(req: NextRequest) {
  return handle(req, { auth: "user", mainOnly: true }, async (rc) => {
    const body = await readJson(req, Body);
    const app = signContract(rc.ctx, rc.user!.id, { fullName: body.fullName, version: body.version });
    return { signedAt: app.contractSignedAt, version: app.contractVersion };
  });
}
