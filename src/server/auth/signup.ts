import { SIGNUPS_PER_DEVICE_PER_DAY, SIGNUPS_PER_IP_PER_DAY } from "@/lib/shared/constants";
import type { UserRow } from "@/lib/shared/types";
import type { RequestContext } from "../http";
import { audit, flagRisk, track, type Ctx } from "../world/context";
import { Errors } from "../world/errors";
import { flagEnabled, flagValue } from "../world/flags";
import { attachReferral } from "../world/referrals";
import { createUser, sendVerification, type CreateUserInput } from "../world/users";

/** Registration gates shared by the built-in signup and Clerk profile completion (§4, §28, §58). */
export function assertCanRegister(ctx: Ctx, input: { inviteCode?: string | null; deviceId: string | null; ipHash: string | null }) {
  if (!flagEnabled(ctx, "registrations")) throw Errors.registrationsClosed();
  const cap = flagValue(ctx, "maxBetaUsers") ?? 0;
  if (cap > 0 && Object.values(ctx.state.users).filter((u) => !u.isBot && u.status !== "deleted").length >= cap) throw Errors.betaFull();
  const invite = input.inviteCode ? ctx.state.invites[input.inviteCode.trim().toUpperCase()] : undefined;
  if (flagEnabled(ctx, "inviteOnly")) {
    if (!invite || invite.uses >= invite.maxUses || (invite.expiresAt && invite.expiresAt < Date.now())) throw Errors.inviteRequired();
  }
  // Signup farms (§28): cap new accounts per device and per network per day.
  const dayAgo = Date.now() - 86_400_000;
  const recent = (ctx.state.signups ?? []).filter((s) => s.at > dayAgo);
  const byDevice = input.deviceId ? recent.filter((s) => s.deviceId === input.deviceId).length : 0;
  const byIp = input.ipHash ? recent.filter((s) => s.ipHash === input.ipHash).length : 0;
  if (byDevice >= SIGNUPS_PER_DEVICE_PER_DAY || byIp >= SIGNUPS_PER_IP_PER_DAY) {
    const prior = recent.find((s) => s.deviceId === input.deviceId || s.ipHash === input.ipHash);
    if (prior) flagRisk(ctx, { entityType: "user", entityId: prior.userId, reason: "Many sign-ups from one device or network", severity: 0.5, metadata: { byDevice, byIp } });
    throw Errors.rateLimited();
  }
  return invite ?? null;
}

export function registerUser(
  rc: RequestContext,
  input: CreateUserInput & { inviteCode?: string | null; referralCode?: string | null },
): UserRow {
  const { ctx } = rc;
  if (!input.ageConfirmed) throw Errors.invalid("You need to be 18 or older to use Wesify.");
  if (!input.acceptTerms) throw Errors.invalid("Accept the Terms and Privacy Policy to continue.");
  const invite = assertCanRegister(ctx, { inviteCode: input.inviteCode, deviceId: rc.deviceId, ipHash: rc.ipHash });
  const user = createUser(ctx, { ...input, cohort: invite?.cohort ?? input.cohort ?? null });
  if (invite) invite.uses++;
  (ctx.state.signups ??= []).push({ at: Date.now(), ipHash: rc.ipHash, deviceId: rc.deviceId, userId: user.id });
  const devices = (ctx.state.devices ??= {});
  if (input.referralCode) attachReferral(ctx, user.id, input.referralCode, { deviceId: rc.deviceId, ipHash: rc.ipHash });
  const d = (devices[rc.deviceId] ??= { userIds: [], ipHashes: [], firstSeenAt: ctx.now(), lastSeenAt: ctx.now() });
  if (!d.userIds.includes(user.id)) d.userIds.push(user.id);
  if (rc.ipHash && !d.ipHashes.includes(rc.ipHash)) d.ipHashes.push(rc.ipHash);
  if (input.email && !input.clerkUserId) sendVerification(ctx, user);
  audit(ctx, { actor: user.id, action: "user.signup", entityType: "user", entityId: user.id, metadata: { cohort: user.cohort, invite: invite?.code ?? null, method: input.clerkUserId ? "clerk" : "password" } });
  track(ctx, "user_signed_up", user.id, { cohort: user.cohort, referred: Boolean(user.referredByUserId) });
  return user;
}
