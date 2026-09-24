import {
  REFERRAL_MAX_REWARDS_PER_USER,
  REFERRAL_MIN_MARKETS,
  REFERRAL_MIN_TRADES,
  REFERRAL_REWARD,
} from "@/lib/shared/constants";
import { newId } from "@/lib/shared/random";
import { audit, flagRisk, notify, track, type Ctx } from "./context";
import { flagEnabled } from "./flags";
import { postLedger } from "./ledger";
import type { WorldState } from "./state";

/**
 * Referrals (checklist §30, §28). Signing up with a code creates a pending referral; both people get
 * W$1,000 only after the new user has verified their email and made 3 trades in at least 2 markets.
 * Referrals from the same device or network are rejected (referral farming), a referrer can earn at
 * most 20 rewards, and nothing is paid while the `referrals` flag is off.
 */

export function referrerByCode(state: WorldState, code: string) {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return Object.values(state.users).find((u) => u.referralCode === c && !u.isBot && u.status !== "deleted") ?? null;
}

export function attachReferral(ctx: Ctx, refereeId: string, code: string, meta: { deviceId: string | null; ipHash: string | null }) {
  const referrer = referrerByCode(ctx.state, code);
  const referee = ctx.state.users[refereeId];
  if (!referrer || !referee || referrer.id === refereeId) return null;
  const refereeDevice = meta.deviceId ? ctx.state.devices[meta.deviceId] : undefined;
  const sharesDevice =
    Boolean(refereeDevice?.userIds.includes(referrer.id)) ||
    (meta.ipHash !== null && Object.values(ctx.state.devices).some((d) => d.userIds.includes(referrer.id) && d.ipHashes.includes(meta.ipHash!)));
  const row = {
    id: newId("ref"),
    referrerId: referrer.id,
    refereeId,
    status: sharesDevice ? ("rejected" as const) : ("pending" as const),
    reason: sharesDevice ? "Same device or network as the referrer" : null,
    createdAt: ctx.now(),
    decidedAt: sharesDevice ? ctx.now() : null,
  };
  ctx.state.referrals.push(row);
  referee.referredByUserId = referrer.id;
  if (sharesDevice) flagRisk(ctx, { entityType: "user", entityId: referrer.id, reason: "Referral from the same device or network", severity: 0.5, metadata: { refereeId } });
  track(ctx, "referral_signup", refereeId, { referrer_id: referrer.id, status: row.status });
  return row;
}

/** Called after each trade by the referee; pays both sides once the usage bar is met. */
export function evaluateReferral(ctx: Ctx, refereeId: string) {
  const ref = ctx.state.referrals?.find((r) => r.refereeId === refereeId && r.status === "pending");
  if (!ref || !flagEnabled(ctx, "referrals")) return;
  const referee = ctx.state.users[refereeId];
  const referrer = ctx.state.users[ref.referrerId];
  if (!referee?.emailVerifiedAt || !referrer || referrer.status !== "active" || referee.status !== "active") return;
  const trades = ctx.state.trades.filter((t) => t.userId === refereeId);
  if (trades.length < REFERRAL_MIN_TRADES || new Set(trades.map((t) => t.marketId)).size < REFERRAL_MIN_MARKETS) return;
  const rewarded = ctx.state.referrals.filter((r) => r.referrerId === referrer.id && r.status === "rewarded").length;
  const now = ctx.now();
  ref.decidedAt = now;
  if (rewarded >= REFERRAL_MAX_REWARDS_PER_USER) {
    ref.status = "rejected";
    ref.reason = "Referrer reached the reward limit";
    return;
  }
  ref.status = "rewarded";
  for (const [userId, other] of [
    [referrer.id, referee.username],
    [referee.id, referrer.username],
  ] as const) {
    postLedger(ctx, { userId, type: "REFERRAL", amount: REFERRAL_REWARD, referenceType: "referral", referenceId: ref.id, description: `Referral reward (${other})` });
    notify(ctx, { userId, kind: "REWARD", title: `You got W$${REFERRAL_REWARD.toLocaleString("en-US")} for a referral.`, body: `Thanks for bringing ${other} to Wesify. W$ is play money.`, marketId: null });
  }
  audit(ctx, { actor: "system", action: "referral.reward", entityType: "referral", entityId: ref.id, metadata: { referrerId: referrer.id, refereeId } });
  track(ctx, "referral_converted", referrer.id, { referee_id: refereeId });
}
