import type { NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { clerkEnabled, deleteClerkUser } from "@/server/auth/clerk";
import { handle, readJson } from "@/server/http";
import { audit, track } from "@/server/world/context";
import { Errors } from "@/server/world/errors";
import { accountSettings, meDTO } from "@/server/world/queries";
import { changePassword, deleteAccount, recordAcceptance, revokeSession, setEmail, verifyPassword, hashPassword, passwordIssue } from "@/server/world/users";
import { MIN_PASSWORD_LENGTH } from "@/lib/shared/constants";

export async function GET(req: NextRequest) {
  return handle(req, { auth: "user", tick: false }, (rc) => accountSettings(rc.ctx, rc.user!, rc.sessionHash, rc.authProvider));
}

const Patch = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preferences"),
    notificationPrefs: z
      .object({
        priceMoves: z.boolean(),
        closingSoon: z.boolean(),
        marketOpened: z.boolean(),
        emailSettlement: z.boolean(),
        emailMarketOpened: z.boolean(),
        emailProduct: z.boolean(),
      })
      .partial()
      .optional(),
    showOnLeaderboard: z.boolean().optional(),
  }),
  z.object({ action: z.literal("consent"), analytics: z.boolean(), marketing: z.boolean() }),
  z.object({ action: z.literal("onboarding-complete") }),
  z.object({ action: z.literal("tutorial-complete") }),
  z.object({ action: z.literal("change-password"), current: z.string().max(200).nullable(), next: z.string().min(1).max(200) }),
  z.object({ action: z.literal("revoke-session"), sessionId: z.string().min(8).max(64) }),
  z.object({
    action: z.literal("upgrade"),
    email: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(200),
    ageConfirmed: z.boolean(),
    acceptTerms: z.boolean(),
  }),
  z.object({ action: z.literal("set-email"), email: z.string().trim().min(3).max(254) }),
]);

/** Account settings (§4, §12, §44, §65). */
export async function PATCH(req: NextRequest) {
  return handle(req, { auth: "user", tick: false, rateLimit: { name: "account", limit: 30, windowMs: 60_000, key: "user" } }, async (rc) => {
    const body = await readJson(req, Patch);
    const user = rc.user!;
    const now = rc.ctx.now();
    switch (body.action) {
      case "preferences":
        if (body.notificationPrefs) user.notificationPrefs = { ...(user.notificationPrefs ?? {}), ...body.notificationPrefs } as typeof user.notificationPrefs;
        if (body.showOnLeaderboard !== undefined) user.showOnLeaderboard = body.showOnLeaderboard;
        break;
      case "consent":
        user.consent = { analytics: body.analytics, marketing: body.marketing, updatedAt: now };
        audit(rc.ctx, { actor: user.id, action: "user.consent", entityType: "user", entityId: user.id, metadata: { analytics: body.analytics, marketing: body.marketing } });
        break;
      case "onboarding-complete":
        if (!user.onboardingCompletedAt) {
          user.onboardingCompletedAt = now;
          track(rc.ctx, "onboarding_completed", user.id);
        }
        break;
      case "tutorial-complete":
        user.tutorialCompletedAt ??= now;
        break;
      case "change-password":
        if (rc.authProvider === "clerk") throw Errors.clerkManaged();
        changePassword(rc.ctx, user, { current: body.current, next: body.next, keepTokenHash: rc.sessionHash });
        break;
      case "revoke-session":
        revokeSession(rc.ctx, user.id, body.sessionId);
        break;
      case "upgrade":
        // Accounts made before V1 (username only) add an email, password and the current terms.
        if (rc.authProvider === "clerk") throw Errors.clerkManaged();
        if (user.passwordHash) throw Errors.invalid("This account already has a password.");
        if (!body.ageConfirmed) throw Errors.invalid("You need to be 18 or older to use Wesify.");
        if (!body.acceptTerms) throw Errors.invalid("Accept the Terms and Privacy Policy to continue.");
        if (passwordIssue(body.password)) throw Errors.weakPassword(MIN_PASSWORD_LENGTH);
        setEmail(rc.ctx, user, body.email);
        user.passwordHash = hashPassword(body.password);
        recordAcceptance(rc.ctx, user, { ageConfirmed: body.ageConfirmed, acceptTerms: body.acceptTerms });
        break;
      case "set-email":
        if (rc.authProvider === "clerk") throw Errors.clerkManaged();
        setEmail(rc.ctx, user, body.email);
        break;
    }
    return meDTO(rc.ctx, user, rc.authProvider);
  });
}

const Delete = z.object({ confirm: z.literal("DELETE"), password: z.string().max(200).optional().nullable(), reason: z.string().max(500).optional().nullable() });

/**
 * Account deletion (§4, §12, §44). Requires typing DELETE and, for password accounts, the password.
 * With Clerk, the Clerk identity is deleted after the response.
 */
export async function DELETE(req: NextRequest) {
  return handle(req, { auth: "user", tick: false, mainOnly: true, rateLimit: { name: "account-delete", limit: 5, windowMs: 60 * 60_000 } }, async (rc) => {
    const body = await readJson(req, Delete);
    const user = rc.user!;
    if (user.passwordHash && !verifyPassword(body.password ?? "", user.passwordHash)) throw Errors.invalid("Your password is wrong.");
    const clerkId = user.clerkUserId;
    deleteAccount(rc.ctx, user, user.id, body.reason ?? null);
    rc.response.cookies.push({ name: rc.sessionCookie, value: "", maxAge: 0 });
    if (clerkId && clerkEnabled()) after(() => deleteClerkUser(clerkId).catch(() => undefined));
    return { deleted: true };
  });
}
