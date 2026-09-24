import type { MarketRow, MarketStatus } from "@/lib/shared/types";
import { audit, type Ctx } from "./context";
import { WesifyError } from "./errors";

/**
 * Market lifecycle (checklist §24):
 *
 *   DRAFT ──approve──▶ OPEN ◀──resume/pause──▶ PAUSED
 *     │                 │                        │
 *     │               lock ────────┬───────── lock
 *     │                 ▼          ▼
 *     │               LOCKED ──▶ SETTLING ──▶ SETTLED
 *     └───────────▶ CANCELLED ◀── (any non-final state)
 *
 * Trading happens only in OPEN. SETTLED and CANCELLED are final.
 */
const ALLOWED: Record<MarketStatus, MarketStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["PAUSED", "LOCKED", "CANCELLED"],
  PAUSED: ["OPEN", "LOCKED", "CANCELLED"],
  LOCKED: ["SETTLING", "CANCELLED"],
  SETTLING: ["SETTLED", "CANCELLED"],
  SETTLED: [],
  CANCELLED: [],
};

export function canTransition(from: MarketStatus, to: MarketStatus) {
  return ALLOWED[from].includes(to);
}

export const isFinal = (status: MarketStatus) => status === "SETTLED" || status === "CANCELLED";
/** Markets that still track likes (everything between opening and settlement). */
export const isLive = (status: MarketStatus) => status === "OPEN" || status === "PAUSED" || status === "LOCKED" || status === "SETTLING";

/** Validates, applies and audits a status change. A no-op when already in `to`. */
export function transition(ctx: Ctx, market: MarketRow, to: MarketStatus, opts: { actor: string | null; reason?: string | null } = { actor: null }) {
  const from = market.status;
  if (from === to) return false;
  if (!canTransition(from, to)) {
    throw new WesifyError("INVALID_TRANSITION", `A ${from.toLowerCase()} market can't become ${to.toLowerCase()}.`, 409);
  }
  market.status = to;
  if (to === "PAUSED") market.pausedReason = opts.reason ?? "Trading is paused.";
  else if (from === "PAUSED") market.pausedReason = null;
  audit(ctx, {
    actor: opts.actor,
    action: "market.transition",
    entityType: "market",
    entityId: market.id,
    metadata: { from, to, reason: opts.reason ?? null },
  });
  return true;
}
