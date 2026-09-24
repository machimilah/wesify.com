import { z } from "zod";
import type { CancelReason } from "@/lib/shared/types";
import { providerFor } from "@/lib/social-providers";
import { appEnv } from "../env";
import type { AdminPrincipal } from "../http";
import { audit, type Ctx } from "../world/context";
import { creatorMetrics } from "../world/creators";
import { Errors } from "../world/errors";
import { approveSubmission, refreshThumbnails, setManualLikes, setSimulatedAvailability, takedownVideo } from "../world/ingestion";
import { isFinal } from "../world/lifecycle";
import {
  approveSettlement,
  cancelMarket,
  getMarket,
  lockMarket,
  pauseMarket,
  proposeSettlement,
  recordSnapshot,
  refreshPrices,
  rejectDraft,
  resumeMarket,
} from "../world/markets";
import { createSimulatedMarket, nextSeed } from "../world/seed";

const CANCEL_CODES = ["DELETED_CONTENT", "PRIVATE_CONTENT", "PLATFORM_OUTAGE", "METRIC_CORRUPTION", "MANIPULATION", "INCORRECT_SETUP", "CONTENT_REMOVED", "ADMIN"] as const;

/**
 * Admin market actions (§33). Anything that moves money or ends a market needs `confirm`: the
 * word CANCEL / SETTLE / TAKEDOWN / RESET, or the final like count typed again. The UI asks for it
 * in a dialog, and the server re-checks it so a stray request can't do damage either.
 */
export const MarketAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), reason: z.string().trim().min(3).max(200) }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("lock") }),
  z.object({ action: z.literal("set-likes"), likes: z.number().int().nonnegative() }),
  z.object({ action: z.literal("refresh-metric") }),
  z.object({ action: z.literal("refresh-thumbnail") }),
  z.object({ action: z.literal("approve-submission"), note: z.string().max(300).optional(), force: z.boolean().default(false) }),
  z.object({ action: z.literal("reject-submission"), note: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("propose-settlement"), finalLikes: z.number().int().nonnegative() }),
  z.object({
    action: z.literal("approve-settlement"),
    finalLikes: z.number().int().nonnegative().optional(),
    reason: z.string().max(500).optional(),
    acknowledgeIssues: z.boolean().default(false),
    confirm: z.string(),
  }),
  z.object({ action: z.literal("cancel"), code: z.enum(CANCEL_CODES), note: z.string().max(300).optional(), confirm: z.literal("CANCEL") }),
  z.object({ action: z.literal("feature"), featured: z.boolean() }),
  z.object({ action: z.literal("takedown"), reason: z.string().trim().min(3).max(300), confirm: z.literal("TAKEDOWN") }),
  z.object({ action: z.literal("simulate-availability"), availability: z.enum(["available", "deleted", "private"]) }),
  z.object({ action: z.literal("edit-liquidity"), liquidity: z.number().min(100).max(100_000) }),
  z.object({ action: z.literal("reset"), confirm: z.literal("RESET") }),
]);

export type MarketActionInput = z.infer<typeof MarketAction>;

export async function runMarketAction(ctx: Ctx, admin: AdminPrincipal, id: string, body: MarketActionInput) {
  const { market, video } = getMarket(ctx, id);
  const actor = admin.id;
  const log = (action: string, metadata: Record<string, unknown> = {}) => audit(ctx, { actor, action, entityType: "market", entityId: id, metadata: { ...metadata, via: admin.via } });
  switch (body.action) {
    case "pause":
      pauseMarket(ctx, id, body.reason, actor);
      log("admin.market.pause", { reason: body.reason });
      break;
    case "resume":
      resumeMarket(ctx, id, actor);
      log("admin.market.resume");
      break;
    case "lock":
      lockMarket(ctx, id, actor);
      break;
    case "set-likes":
      setManualLikes(ctx, { marketId: id, likes: body.likes, actor });
      break;
    case "refresh-metric": {
      if (isFinal(market.status)) throw Errors.invalid("This market is finished.");
      const m = video.provider === "creator" ? await creatorMetrics(ctx, video, ctx.now()) : await providerFor(video).getMetrics(video, ctx.now());
      const recorded = recordSnapshot(ctx, id, { likes: m.likes, capturedAt: Math.max(ctx.now(), market.lastPricedAt + 1), source: m.source });
      log("admin.market.refresh_metric", { likes: m.likes, recorded });
      return { likes: m.likes, recorded };
    }
    case "refresh-thumbnail":
      return { refreshed: await refreshThumbnails(ctx, id) };
    case "approve-submission":
      approveSubmission(ctx, id, { actor, note: body.note, force: body.force });
      break;
    case "reject-submission":
      rejectDraft(ctx, id, { actor, note: body.note });
      break;
    case "propose-settlement":
      // Manual-provider markets: a reviewer enters the final count; a second step approves it.
      if (market.status === "LOCKED" || market.status === "SETTLING") {
        return proposeSettlement(ctx, id, { likes: body.finalLikes, source: "manual-entry", capturedAt: ctx.now() }, { actor, requireReview: true });
      }
      throw Errors.invalid("Trading must be closed before proposing a result.");
    case "approve-settlement": {
      const expected = String(body.finalLikes ?? market.proposedSettlement?.finalMetric ?? "");
      if (body.confirm.replace(/[,\s]/g, "") !== expected) throw Errors.invalid(`Type the final like count (${expected}) to confirm.`);
      if (market.status === "OPEN" || market.status === "PAUSED") {
        if (ctx.now() < market.settlesAt) throw Errors.invalid("This market hasn't reached its settlement time. Cancel it instead if it can't run.");
        lockMarket(ctx, id, actor);
      }
      return approveSettlement(ctx, id, { actor, finalMetric: body.finalLikes, reason: body.reason, acknowledgeIssues: body.acknowledgeIssues });
    }
    case "cancel":
      return cancelMarket(ctx, id, { reason: body.note || body.code, code: body.code as CancelReason, note: body.note ?? null, actor });
    case "feature":
      market.featured = body.featured;
      log("admin.market.feature", { featured: body.featured });
      break;
    case "takedown":
      takedownVideo(ctx, { marketId: id, reason: body.reason, actor });
      break;
    case "simulate-availability":
      if (appEnv() === "production") throw Errors.forbidden();
      setSimulatedAvailability(ctx, { marketId: id, availability: body.availability, actor });
      break;
    case "edit-liquidity": {
      // Only before the first trade: rescaling quantities afterwards would break state reconstruction.
      if (ctx.state.trades.some((t) => t.marketId === id)) throw Errors.invalid("Liquidity can only change before the first trade.");
      const before = market.liquidityParameter;
      market.liquidityParameter = body.liquidity;
      refreshPrices(ctx, market, ctx.now());
      log("admin.market.edit_liquidity", { before, after: body.liquidity });
      break;
    }
    case "reset": {
      // Staging only (§20 market-reset tool): refund everyone and open a fresh simulated copy.
      if (appEnv() === "production") throw Errors.forbidden();
      if (!isFinal(market.status)) cancelMarket(ctx, id, { reason: "reset (staging)", code: "ADMIN", actor });
      const fresh = createSimulatedMarket(ctx, { scenario: video.scenario ?? "stable-mid", openedAt: ctx.now(), seed: nextSeed(), handle: video.creatorHandle, actor: "admin" });
      log("admin.market.reset", { newMarketId: fresh.market.id });
      return { newMarketId: fresh.market.id };
    }
  }
  return { ok: true, status: market.status };
}
