import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { captureError } from "@/server/world/context";

const Body = z.object({
  message: z.string().max(1000),
  stack: z.string().max(4000).optional().nullable(),
  page: z.string().max(300).optional().nullable(),
  digest: z.string().max(200).optional().nullable(),
  kind: z.enum(["error", "unhandledrejection", "boundary"]).default("error"),
});

/** Frontend error reports (§42): grouped with server errors in /admin → Health. */
export async function POST(req: NextRequest) {
  return handle(req, { tick: false, mainOnly: true, rateLimit: { name: "client-errors", limit: 30, windowMs: 60_000 } }, async (rc) => {
    const body = await readJson(req, Body);
    const err = new Error(body.message);
    err.stack = body.stack ?? undefined;
    captureError(rc.ctx, "client", err, { page: body.page ?? null, digest: body.digest ?? null, kind: body.kind, userAgent: req.headers.get("user-agent")?.slice(0, 160) ?? null });
    return { ok: true };
  });
}
