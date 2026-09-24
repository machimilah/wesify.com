import { hashString } from "@/lib/shared/random";
import type { Ctx } from "./context";
import type { FlagRow } from "./state";

/**
 * Feature flags (checklist §57). Stored in world state so an admin can flip them at runtime without
 * a deploy; every change is audited by the admin route. `rollout` (0–100) releases a flag to a
 * stable share of users: the same user always lands on the same side.
 */
export type FlagName =
  | "trading"
  | "selling"
  | "registrations"
  | "providers"
  | "marketCreation"
  | "marketApproval"
  | "settlementReview"
  | "notifications"
  | "emailNotifications"
  | "leaderboard"
  | "referrals"
  | "inviteOnly"
  | "maxBetaUsers"
  | "globalPause"
  | "firstTradeTutorial";

export type FlagDef = { description: string; default: boolean; value?: number; kind: "switch" | "number" | "rollout" };

export const FLAG_DEFS: Record<FlagName, FlagDef> = {
  trading: { description: "Buying is allowed anywhere on Wesify. Off = the trading kill switch.", default: true, kind: "switch" },
  selling: { description: "Selling is allowed. Keep on unless selling itself is broken.", default: true, kind: "switch" },
  registrations: { description: "New accounts can sign up.", default: true, kind: "switch" },
  providers: { description: "Metric providers are called. Off = stop all provider traffic (markets pause as delayed).", default: true, kind: "switch" },
  marketCreation: { description: "Users can submit video links for new markets.", default: true, kind: "switch" },
  marketApproval: { description: "User-submitted markets wait for admin approval before opening.", default: true, kind: "switch" },
  settlementReview: { description: "Settlements wait for a reviewer to confirm the final like count.", default: true, kind: "switch" },
  notifications: { description: "Non-essential in-app notifications (price moves, closing soon, new markets).", default: true, kind: "switch" },
  emailNotifications: { description: "Notification emails (settlement results, new markets).", default: true, kind: "switch" },
  leaderboard: { description: "The leaderboard page and API.", default: true, kind: "switch" },
  referrals: { description: "Referral rewards are paid.", default: false, kind: "switch" },
  inviteOnly: { description: "Signing up requires an invite code (private beta).", default: false, kind: "switch" },
  maxBetaUsers: { description: "Cap on registered users while the beta is limited (0 = no cap).", default: true, value: 0, kind: "number" },
  globalPause: { description: "Emergency: trading paused on every market (markets keep tracking likes).", default: false, kind: "switch" },
  firstTradeTutorial: { description: "Show the guided first-trade walkthrough to new users (supports gradual rollout).", default: true, kind: "rollout" },
};

export const FLAG_NAMES = Object.keys(FLAG_DEFS) as FlagName[];

function row(ctx: Ctx, name: FlagName): FlagRow {
  const stored = ctx.state.featureFlags?.[name];
  if (stored) return stored;
  const def = FLAG_DEFS[name];
  return { enabled: def.default, rollout: 100, value: def.value ?? null, updatedAt: 0, updatedBy: null };
}

/** True when the flag is on (and, for rollout flags, when this user is inside the rollout). */
export function flagEnabled(ctx: Ctx, name: FlagName, userId?: string | null): boolean {
  const r = row(ctx, name);
  if (!r.enabled) return false;
  if (r.rollout >= 100) return true;
  // A partial rollout only reaches signed-in users, so each person sees one consistent version.
  if (!userId) return false;
  return hashString(`${name}:${userId}`) % 100 < r.rollout;
}

export function flagValue(ctx: Ctx, name: FlagName): number | null {
  return row(ctx, name).value;
}

export function setFlag(ctx: Ctx, name: FlagName, patch: { enabled?: boolean; rollout?: number; value?: number | null }, actor: string) {
  const current = row(ctx, name);
  const next: FlagRow = {
    enabled: patch.enabled ?? current.enabled,
    rollout: Math.max(0, Math.min(100, Math.round(patch.rollout ?? current.rollout))),
    value: patch.value === undefined ? current.value : patch.value,
    updatedAt: ctx.now(),
    updatedBy: actor,
  };
  (ctx.state.featureFlags ??= {})[name] = next;
  return next;
}

export function listFlags(ctx: Ctx) {
  return FLAG_NAMES.map((name) => ({ name, ...FLAG_DEFS[name], ...row(ctx, name) }));
}

/** The subset of flags the browser needs, evaluated for one user. */
export function clientFlags(ctx: Ctx, userId: string | null) {
  return {
    trading: flagEnabled(ctx, "trading") && !flagEnabled(ctx, "globalPause"),
    selling: flagEnabled(ctx, "selling"),
    registrations: flagEnabled(ctx, "registrations"),
    marketCreation: flagEnabled(ctx, "marketCreation"),
    leaderboard: flagEnabled(ctx, "leaderboard"),
    referrals: flagEnabled(ctx, "referrals"),
    inviteOnly: flagEnabled(ctx, "inviteOnly"),
    globalPause: flagEnabled(ctx, "globalPause"),
    firstTradeTutorial: flagEnabled(ctx, "firstTradeTutorial", userId),
  };
}
