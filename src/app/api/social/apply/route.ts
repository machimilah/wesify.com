import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { applyToProgram } from "@/server/world/creatorProgram";

const Body = z.object({
  // Free text: creators name the platform they post on, even one Wesify can't track yet.
  platform: z.string().min(2).max(40),
  handle: z.string().min(2).max(60),
  profileUrl: z.string().url().max(300),
  followerCount: z.number().int().min(0).max(1_000_000_000),
  about: z.string().min(20).max(1000),
});

/** Apply to the creator program (§51). Reviewed by an admin before anything can be connected. */
export async function POST(req: NextRequest) {
  return handle(req, { auth: "user", mainOnly: true, rateLimit: { name: "creator-apply", limit: 5, windowMs: 60 * 60_000 } }, async (rc) => {
    const body = await readJson(req, Body);
    const app = applyToProgram(rc.ctx, rc.user!.id, body);
    return { id: app.id, status: app.status };
  });
}
