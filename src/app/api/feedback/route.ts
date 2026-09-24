import type { NextRequest } from "next/server";
import { z } from "zod";
import { newId } from "@/lib/shared/random";
import { handle, readJson } from "@/server/http";
import { track } from "@/server/world/context";

const Body = z.object({
  rating: z.number().int().min(1).max(5).optional().nullable(),
  kind: z.enum(["general", "bug", "idea", "churn"]).default("general"),
  body: z.string().trim().min(2, "Write a few words.").max(3000),
  page: z.string().max(200).optional().nullable(),
});

/** Early-user feedback form (§58), including "why are you leaving?" on account deletion (kind churn). */
export async function POST(req: NextRequest) {
  return handle(req, { tick: false, mainOnly: true, rateLimit: { name: "feedback", limit: 10, windowMs: 60 * 60_000 } }, async (rc) => {
    const body = await readJson(req, Body);
    rc.ctx.state.feedback.push({ id: newId("fbk"), userId: rc.user?.id ?? null, rating: body.rating ?? null, kind: body.kind, body: body.body, page: body.page ?? null, createdAt: rc.ctx.now() });
    track(rc.ctx, "feedback_sent", rc.user?.id ?? null, { kind: body.kind, rating: body.rating ?? null });
    return { ok: true };
  });
}
