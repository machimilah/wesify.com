import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { resolveVideo } from "@/server/world/ingestion";

const Body = z.object({ url: z.string().min(1).max(500) });

export async function POST(req: NextRequest) {
  return handle(req, { rateLimit: { name: "resolve", limit: 30, windowMs: 60_000 }, tick: false }, async (rc) => {
    const { url } = await readJson(req, Body);
    const r = await resolveVideo(rc.ctx, url);
    return {
      platform: r.meta.platform,
      platformVideoId: r.meta.platformVideoId,
      creatorHandle: r.meta.creatorHandle,
      canonicalUrl: r.meta.canonicalUrl,
      publishedAt: r.meta.publishedAt,
      existingMarketId: r.existingMarketId,
      eligible: r.eligible,
    };
  });
}
