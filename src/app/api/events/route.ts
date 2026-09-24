import type { NextRequest } from "next/server";
import { z } from "zod";
import { CONSENT_COOKIE, handle, readJson } from "@/server/http";
import { track } from "@/server/world/context";
import { recordActivity } from "@/server/world/metrics";

/**
 * Client-side product events (§39). Server-side events (signups, trades, settlement) are tracked in
 * the engine. Behavioural events are only stored with analytics consent (§65); the taxonomy is in
 * docs/analytics-taxonomy.md.
 */
const Body = z.object({
  name: z.enum([
    "app_opened",
    "market_viewed",
    "trade_started",
    "portfolio_viewed",
    "share_clicked",
    "market_shared",
    "notification_opened",
    "original_video_opened",
    "referral_sent",
    "onboarding_step",
    "tutorial_step",
    "visit_heartbeat",
  ]),
  properties: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
});

/** Needed to run the product (traffic back to creators, share counts) regardless of consent. */
const ESSENTIAL = new Set(["original_video_opened", "market_shared", "share_clicked"]);

export async function POST(req: NextRequest) {
  return handle(req, { tick: false, rateLimit: { name: "events", limit: 240, windowMs: 60_000 } }, async (rc) => {
    const body = await readJson(req, Body);
    const consent = rc.user?.consent?.analytics ?? req.cookies.get(CONSENT_COOKIE)?.value?.includes("analytics") ?? false;
    if (body.name === "market_viewed") recordActivity(rc.ctx, rc.user?.id ?? null, req.cookies.get("wesify_visit")?.value ?? null, { marketView: true });
    if (body.name === "visit_heartbeat") return { ok: true };
    if (!consent && !ESSENTIAL.has(body.name)) return { ok: true, stored: false };
    track(rc.ctx, body.name, rc.user?.id ?? null, body.properties);
    return { ok: true, stored: true };
  });
}
