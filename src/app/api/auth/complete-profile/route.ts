import type { NextRequest } from "next/server";
import { z } from "zod";
import { clerkEnabled, clerkPrimaryEmail } from "@/server/auth/clerk";
import { registerUser } from "@/server/auth/signup";
import { handle, readJson } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { meDTO } from "@/server/world/queries";

const Body = z.object({
  username: z.string().min(1, "Pick a username.").max(40),
  ageConfirmed: z.boolean(),
  acceptTerms: z.boolean(),
  inviteCode: z.string().max(40).optional().nullable(),
  referralCode: z.string().max(40).optional().nullable(),
});

/**
 * Clerk sign-up, step 2: Clerk has verified the person; Wesify creates their profile (username,
 * age confirmation, terms acceptance, W$ welcome credits) linked to the Clerk user id.
 */
export async function POST(req: NextRequest) {
  return handle(req, { tick: false, mainOnly: true, rateLimit: { name: "complete-profile", limit: 10, windowMs: 60 * 60_000 } }, async (rc) => {
    if (!clerkEnabled() || !rc.clerkUserId) throw Errors.unauthorized();
    if (rc.user?.clerkUserId === rc.clerkUserId) return meDTO(rc.ctx, rc.user, "clerk");
    const body = await readJson(req, Body);
    const { email, verified } = await clerkPrimaryEmail(rc.clerkUserId);
    const user = registerUser(rc, {
      username: body.username,
      email,
      clerkUserId: rc.clerkUserId,
      ageConfirmed: body.ageConfirmed,
      acceptTerms: body.acceptTerms,
      inviteCode: body.inviteCode,
      referralCode: body.referralCode ?? req.cookies.get("wesify_ref")?.value ?? null,
    });
    if (verified) user.emailVerifiedAt = rc.ctx.now();
    return meDTO(rc.ctx, user, "clerk");
  });
}
