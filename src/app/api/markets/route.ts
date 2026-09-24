import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { createMarketFromUrl } from "@/server/world/ingestion";
import { feed, type FeedSort } from "@/server/world/queries";
import { track } from "@/server/world/context";

const SORTS: FeedSort[] = ["trending", "new", "closing", "movers", "volume"];

/** Market feed (§6): search, sort, and pagination (never more than 100 markets per page, §37). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").slice(0, 200);
  const sort = SORTS.find((s) => s === p.get("sort")) ?? "trending";
  const limit = Number(p.get("limit") ?? 60);
  const offset = Number(p.get("offset") ?? 0);
  return handle(req, {}, (rc) => {
    if (q && p.get("track") === "1") track(rc.ctx, "market_searched", rc.user?.id ?? null, { length: q.length, looks_like_url: /https?:|\.com\//.test(q) });
    return feed(rc.ctx, { q, sort, limit: Number.isFinite(limit) ? limit : 60, offset: Number.isFinite(offset) ? offset : 0 });
  });
}

const Body = z.object({ url: z.string().min(1, "Paste a TikTok link.").max(500), source: z.enum(["paste", "share"]).default("paste") });

/** Submit a video link (§14, §15). Returns the existing market, or a submission awaiting review. */
export async function POST(req: NextRequest) {
  return handle(req, { auth: "user", rateLimit: { name: "create-market", limit: 10, windowMs: 60_000, key: "user" } }, async (rc) => {
    const { url, source } = await readJson(req, Body);
    return createMarketFromUrl(rc.ctx, url, rc.user!.id, source);
  });
}
